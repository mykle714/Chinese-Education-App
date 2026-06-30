# Authentication: Access + Refresh Token Scheme

## Overview
Authentication uses a **short-lived access token** plus a **long-lived, rotating
refresh token**. The client transparently refreshes an expired access token in
the background (reactively, on the first 401) and only redirects to `/login` when
the refresh itself fails. This replaces the old single 24h JWT that bounced the
user to login the moment it lapsed.

| Token | Lifetime | Form | Transport | Revocable? |
|---|---|---|---|---|
| **Access** | 15 min | stateless JWT (`userId`, `email`) | httpOnly cookie `token` (path `/`) + `Authorization: Bearer` header | No (short by design) |
| **Refresh** | 30 days | opaque 256-bit random string | httpOnly cookie `refreshToken` (path `/api/auth`) | **Yes** — stateful, rotated |

Only the **hash** of each refresh token is stored server-side, and every refresh
**rotates** the token with **reuse detection** (theft defense).

## Server

### Database — `refresh_tokens` table (migration 85)
`database/migrations/85-create-refresh-tokens-table.sql`. One row per issued
refresh token. Columns: `id`, `"userId"` (FK→`users`, `ON DELETE CASCADE`),
`"tokenHash"` (SHA-256 hex — raw token is never stored), `"expiresAt"`,
`"createdAt"`, `"revokedAt"` (NULL = valid), `"replacedByHash"` (successor on
rotation → forms a per-login "family" chain), `"userAgent"`. Unique index on
`"tokenHash"`, index on `"userId"`.

### Token logic — `server/services/UserService.ts`
- `ACCESS_TOKEN_TTL = '15m'`, `REFRESH_TOKEN_TTL_MS = 30d` (lines ~16-19).
- `generateAccessToken(user)` (~112-118) — signs the 15m access JWT (shared by
  login + refresh).
- `hashRefreshToken(raw)` (~121-123) — SHA-256 hex.
- `issueRefreshToken(userId, userAgent?)` (~130-145) — mints a random token,
  stores its hash, returns the **raw** token + expiry (the family root on login,
  or a successor on rotation).
- `rotateRefreshToken(raw, userAgent?)` (~165-215) — the refresh exchange:
  - unknown hash → reject (`Invalid refresh token`)
  - **already-revoked hash** → either a benign concurrency race OR a theft replay,
    indistinguishable from the token alone, so a **grace window** decides
    (`REFRESH_REUSE_GRACE_MS = 20_000`):
    - revoked **within** the grace window **and** has a successor
      (`replacedByHash !== null`) → treat as a **benign race** (a second tab / a
      retried refresh whose `Set-Cookie` was lost): fall through and issue a fresh
      pair, do **not** burn the family. `revoke` is idempotent (COALESCE), so the
      original revoke moment + successor link are preserved; the re-presentation
      just mints an additional sibling token.
    - otherwise (revoked too long ago, or no successor) → **REUSE DETECTED**:
      `revokeAllForUser` (burn the whole family) then reject.
  - expired → reject
  - valid → issue successor, revoke the presented token linked to it
    (`replacedByHash`), return new access token + new refresh token + user.

  The grace window fixes a false-positive logout: two tabs (or a network-retried
  refresh) racing the rotation near the 15m access-token boundary used to burn the
  family and bounce **both** sessions to `/login` mid-use (observed as a "crash" /
  lost in-progress edit). A genuine stolen-token replay surfaces minutes/hours
  later — outside the 20s window — so it still burns the family.
- `revokeRefreshToken(raw)` / `revokeAllRefreshTokens(userId)` — logout / "log out
  everywhere" / account deletion.

`authenticateUser` (~50-95) now signs only the access token; the controller issues
the matching refresh token.

### Storage — `server/dal/implementations/RefreshTokenDAL.ts`
Pure storage (interface `server/dal/interfaces/IRefreshTokenDAL.ts`): `create`,
`findByHash`, `revoke(hash, replacedByHash)` (COALESCE-guarded so the first
revoke moment is preserved), `revokeAllForUser`. Wired in `server/dal/setup.ts`
(`refreshTokenDAL` → injected into `UserService`).

### HTTP — `server/controllers/UserController.ts` + `server/server.ts`
- `setAuthCookies` / `clearAuthCookies` (~33-46) — the access cookie is path `/`
  (sent with every request); the refresh cookie is path `/api/auth` (only sent to
  refresh/logout/delete-account, shrinking exposure). **`clearCookie` must use the
  same path or the browser keeps the cookie.** Add `secure: true` to both under
  HTTPS.
- `login` — authenticate → `issueRefreshToken` → `setAuthCookies`. The refresh
  token is **cookie-only**, never in the response body.
- `refresh` (`POST /api/auth/refresh`) — reads the refresh cookie, calls
  `rotateRefreshToken`, sets new cookies, returns `{ user, token }`. **Not behind
  `authenticateToken`** (the access token is expired by design here; the refresh
  cookie is the credential). On failure it clears cookies so a dead token stops
  being resent.
- `logout` (`POST /api/auth/logout`) — revokes the refresh token, clears cookies.
- `deleteAccount` — `revokeAllRefreshTokens` then delete (CASCADE also clears rows).

`authMiddleware.ts` is unchanged and still verifies the access token from header
**or** cookie (header wins — see the client retry note below).

## Client

### Shared refresh core — `src/utils/tokenRefresh.ts`
Single source of truth so the fetch interceptor, axios client, and AuthContext
share **one** in-flight refresh (a burst of concurrent 401s → exactly one
`/api/auth/refresh`). `attemptTokenRefresh()` POSTs to `/api/auth/refresh` (with
the refresh cookie), on success persists the new access token to localStorage,
broadcasts it via `setRefreshHandlers`, and returns it; returns `null` on failure.
Captures the **native** fetch at module load so refresh requests are never
self-intercepted.

### Interceptor — `src/utils/fetchInterceptor.ts`

This is the single auth layer: it monkeypatches the global `fetch`, so every
request (including those made via the `src/api/http.ts` typed wrapper) is covered.
(The former axios `apiClient` was retired — the app now uses one fetch-based
transport.)
On a 401/403 from a **refreshable** endpoint:
1. `attemptTokenRefresh()`.
2. On success, **retry the original request once** with the fresh token, then
   return the retry response (caller never sees the 401).
3. On failure (or still-401 retry), clear auth state, set the `sessionExpired`
   flag, and redirect to `/login`.

`NO_REFRESH_PATHS` excludes `login`/`register`/`logout`/`refresh` (a 401 there is a
real failure or would recurse). **`/api/auth/me` is intentionally eligible** so an
expired access token on app load is refreshed instead of logging the user out.

**Header-precedence gotcha:** `authMiddleware` prefers the `Authorization` header
over the cookie, so the retry **rewrites the header** with the new token —
otherwise a stale header would override the freshly-set access cookie and 401
again. The native-`fetch` retry bypasses the interceptor (no recursion); the axios
retry uses a `_retried` flag.

### `src/AuthContext.tsx`
- Registers the refresh handler (`setRefreshHandlers`) to mirror a refreshed token
  into React state.
- `login` stores only the access token (refresh lives in the httpOnly cookie).
- `checkAuth` (effect keyed on `token`): with a valid access token, calls
  `/api/auth/me` (the interceptor auto-refreshes on 401). With **no** usable access
  token, it still attempts a silent `attemptTokenRefresh()` so a valid refresh
  cookie keeps the user signed in across reloads / localStorage clears.
  - **Refresh-driven token changes skip the `/me` refetch** (`if (token && user)
    return;` at the top): a background access-token refresh changes `token` while
    the authenticated `user` is already set, and the user is unchanged, so the
    re-validation round-trip is redundant. Skipping it also **narrows the rotation
    race window** that contributed to the false-positive reuse logout above
    (one fewer request firing right after a token change). Initial load and the
    silent-refresh-on-load path both have `user === null`, so they fall through and
    still validate. The effect stays keyed on `token` only (an
    `eslint-disable react-hooks/exhaustive-deps` documents that `user` is read as a
    guard, not a trigger).

## Security model
- Refresh tokens are opaque + **hashed at rest** → a DB leak yields no usable
  tokens.
- **Rotation + reuse detection**: replaying a spent refresh token revokes the
  entire family, forcing re-login (standard stolen-token defense). A short **20s
  reuse grace window** (`REFRESH_REUSE_GRACE_MS`) exempts benign concurrency races
  (multi-tab / retried refresh) from the family burn while keeping the theft-replay
  window tiny — the standard "reuse interval" trade-off.
- httpOnly cookies → tokens invisible to JS (XSS can't read them).
- Short 15m access window limits the blast radius of a leaked access token.

## Manual testing
The full server lifecycle (login → refresh/rotation → reuse detection → logout
revocation) is exercisable with curl against `http://localhost:5000`:
1. `POST /api/auth/login` → two `Set-Cookie`s (`token` Max-Age 900, `refreshToken`
   Max-Age ~2.6M, path `/api/auth`).
2. `POST /api/auth/refresh` (with cookies) → 200, new `token`, rotated
   `refreshToken`.
3. Replay the pre-rotation refresh token. **Within 20s** of the rotation it's
   treated as a benign race → `200` with a fresh pair (family preserved). **After
   20s** it's `401 Refresh token reuse detected` and the family is burned (the
   post-rotation token is dead too). To exercise the theft path deterministically,
   wait out `REFRESH_REUSE_GRACE_MS` before replaying.
4. `POST /api/auth/logout` → both cookies cleared; the token can no longer refresh.

To observe the client refresh-and-retry in a browser: log in, delete the `token`
cookie (DevTools → Application → Cookies) leaving `refreshToken`, then trigger any
API call — it should refresh transparently and NOT redirect to login. Delete the
`refreshToken` too and the next 401 redirects to `/login` with the session-expired
notice.

## Future enhancements
1. Proactive refresh (decode `exp`, refresh just before expiry) in addition to the
   reactive path.
2. An "active sessions" UI backed by `refresh_tokens."userAgent"` + a "log out
   everywhere" button (server already supports `revokeAllRefreshTokens`).
3. Periodic cleanup of expired/revoked `refresh_tokens` rows (not required for
   correctness — expiry is checked at use).
4. `secure: true` cookies once served over HTTPS.

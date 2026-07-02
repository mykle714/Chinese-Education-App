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

### HTTP — `server/controllers/UserController.ts` + `server/routes/authRoutes.ts`
- Route registrations live in `server/routes/authRoutes.ts` (split out of
  server.ts). `login`/`register` sit behind `authLimiter` (20/15min/IP) and
  `refresh` behind the looser `refreshLimiter` (120/15min/IP) — see
  `server/middleware/rateLimits.ts`.
- `setAuthCookies` / `clearAuthCookies` — the access cookie is path `/`
  (sent with every request); the refresh cookie is path `/api/auth` (only sent to
  refresh/logout/delete-account, shrinking exposure). **`clearCookie` must use the
  same path + flags or the browser keeps the cookie.** Both cookies carry
  `secure: true` when `NODE_ENV === 'production'` (prod is HTTPS-only; dev is
  http://localhost where `secure` would drop the cookies).
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
the refresh cookie), on success stores the new access token in authStorage's
**in-memory slot** (`src/utils/authStorage.ts` — the token is never persisted),
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
- `login` stores only the access token, **in memory** via
  `src/utils/authStorage.ts` (refresh lives in the httpOnly cookie; the access
  token is deliberately not persisted — see below).
- `checkAuth` (effect keyed on `token`): with a valid access token, calls
  `/api/auth/me` (the interceptor auto-refreshes on 401). With **no** usable access
  token — which is now every fresh page load — it attempts a silent
  `attemptTokenRefresh()` so a valid refresh cookie keeps the user signed in
  across reloads and new tabs.
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
- **Access token is never persisted client-side** (`src/utils/authStorage.ts`
  holds it in a module variable; the old `localStorage['token']` copy — which an
  XSS payload could read off disk — is purged on load). Reloads/new tabs
  re-establish the session via the httpOnly refresh cookie; concurrent per-tab
  refreshes are covered by the 20s rotation-race grace window.
- Login/register are rate-limited (20/15min/IP) against bcrypt brute force;
  refresh at 120/15min/IP. `server/middleware/rateLimits.ts`.
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

## ⛔ Client rule: never reload/reset a page on a silent token refresh

The access token rotates **every ~15 min** (and on the first 401 after idle), so
the `token` string from `useAuth()` **changes identity on every refresh** even
though the user and their session are unchanged. Any React effect that lists
`token` (or a `token`-memoized callback) in its dependency array therefore
**re-runs on each refresh** — reloading data and wiping in-progress UI.

**Real incident (2026-07-02 01:52 AM PDT, user `michael@michael.com`, iOS Chrome):**
a mid-game Word Search reset itself and broke until manual reload. Root cause was
`WordSearchPage`'s mount effect keyed on `[token, fetchGrid, startBoard]`: a
background refresh burst (3 rotations in 278 ms, visible in `refresh_tokens`)
changed `token`, re-ran the loader, and fetched a brand-new board (wiping found
words + timer). The concurrent `fetchGrid` calls racing the rotation left the
page in the broken state.

### The rule
> **A data-load / state-reset `useEffect` must key on a STABLE auth identity —
> `user?.id` or `isAuthenticated` (both `!!user`-derived, unchanged across a
> refresh) — NEVER on the raw `token` string.**

- `token` is still fine **inside** a memoized *fetch callback* (it closes over
  `token` for the `Authorization` header and self-heals via the interceptor's
  refresh-and-retry) — it just must not be a **reload trigger**. Pass `user?.id`
  as the trigger and read the callback without depending on it
  (`// eslint-disable-next-line react-hooks/exhaustive-deps` + a one-line reason).
- If a **fetch callback itself drives a load effect** (e.g. `useEffect(() => {
  fetchX(); }, [fetchX])`), the callback must not churn on refresh either: build
  its header with **`authHeader()`** (`src/utils/authHeader.ts`, reads the live
  in-memory token) and **drop `token` from the callback's deps**. Its identity
  then stays stable while the header stays fresh.
- Hooks that receive `token` as a prop/arg (no `useAuth()` in scope, e.g.
  `useWorkingLoop`) key on `Boolean(token)` — the stable auth-presence flag.

### `authHeader()` helper — `src/utils/authHeader.ts`
Returns `{ Authorization: 'Bearer <live token>' }` from authStorage's in-memory
slot (kept current by the refresh core), or `{}` when there is no token (the
request then falls back to the httpOnly access-token cookie every request already
sends). Use it in fetch callbacks that drive load effects so they don't need
`token` in their deps.

### Sites converted (reference)
Loader effects re-keyed to `user?.id` / `isAuthenticated` / `Boolean(token)`:
`WordSearchPage.tsx` (mount load), `BubbleMatchPage.tsx` (pool load + wins seed),
`useWorkingLoop.ts` (distributed-loop fetch), `ReaderPage.tsx`,
`FlashcardsPage.tsx` (×2), `FlashcardsDecksPage.tsx`, `MasteredCardsPage.tsx`,
`VocabEntryCards.tsx` (×3), `PracticeWritingButton.tsx`, `useCategoryCounts.ts`,
`EntryDetailPage.tsx`, `EditEntryPage.tsx`, `SortCardsPage.tsx`,
`SkippedCardsPage.tsx`, `DictionaryPage.tsx`, `CommunityPage.tsx`,
`useMinutePoints.ts` (reads `tokenRef.current`). Driver callbacks moved to
`authHeader()`: `useLeaderboard.ts`, `useCalendarMinutePoints.ts`,
`useNightMarket.ts`.

## Future enhancements
1. Proactive refresh (decode `exp`, refresh just before expiry) in addition to the
   reactive path.
2. An "active sessions" UI backed by `refresh_tokens."userAgent"` + a "log out
   everywhere" button (server already supports `revokeAllRefreshTokens`).
3. Periodic cleanup of expired/revoked `refresh_tokens` rows (not required for
   correctness — expiry is checked at use).

# Login Rework: boot cover, redirects, phone signup, verification

> ↑ Part of [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md)
> (the auth umbrella).

> **STATUS: BUILT ON DEV (2026-11-14), NOT DEPLOYED.** P1–P8 are all built; migrations 188 and
> 189 are applied on dev. Deploy: [LOGIN_REWORK_DEPLOY_RUNBOOK.md](./LOGIN_REWORK_DEPLOY_RUNBOOK.md)
> (189 is a contract migration, after the rebuild). Real email needs `RESEND_API_KEY` and the
> `mren.me` DNS records; phone sign-in needs the Firebase setup (§ 7). Until then dev logs
> email codes to the backend console and hides the phone option.

Four strands, in build order:

1. **Boot cover:** the app-opening animation plays on every app open, *before* auth
   resolves, and its circle opens onto td (signed in) or `/login` (signed out).
2. **Redirect fixes:** six known defects in today's login flow (§ 2).
3. **Login / register UI** in the design system (today it is stock MUI).
4. **Phone signup + email / phone verification**, sending mail from `mren.me`.

Mobile SSO is **out of scope**. It is a Capacitor requirement
([REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) § "Concrete product demands on a
native shell"; [DEFERRED_WORK.md](./DEFERRED_WORK.md) item 44).

---

## 1. Boot cover (strand 1)

**Today.** The cover (`src/features/deckTower/launch/LaunchScreen.tsx` → `LaunchScreen`,
[LAUNCH_SCREEN.md](./LAUNCH_SCREEN.md)) is a stage *inside* td
(`src/features/deckTower/DeckTowerPage.tsx` → `launchUp`). td is code-split and wrapped in
`ProtectedRoute`, so a signed-out launch never mounts it: blank frame → spinner →
`<Navigate to="/login">`. It also only shows when the launch landed on `/`
(`launchDue.ts` → `launchDueOnMount`).

**As built (2026-11-14).** The cover is the app shell's:

```
App.tsx    BootCoverProvider (inside AuthProvider + router; renderCover = lazy BootLaunchScreen)
Layout     BootCoverSlot in BOTH shells (frame: absolute over the phone card; plain: fixed)
routes     <Suspense>{page}<BootRouteMounted/></Suspense>, inside ProtectedRoute for protected pages
td         useHoldBootCover(!launchReady); reads useBootCover() for its holds and snapSky
```

It opens when auth has settled, the current path's page has mounted, and no page holds it.
`/login` and `/register` moved into the frame so the signed-out path never switches shells
under the cover. The scene is lazily loaded over a plain ground in the same sky colour, so the
main chunk did not grow (571.3 kB vs 570.8 kB). Details: [LAUNCH_SCREEN.md](./LAUNCH_SCREEN.md)
§ When it shows.

| Piece | Layer |
|---|---|
| `src/hooks/useBootCover.ts`: context, `useBootCover`, `useHoldBootCover` | Shared state |
| `src/components/bootCover/BootCover.tsx`: `BootCoverProvider`, `BootCoverSlot`, `BootRouteMounted` | Shared view (app shell) |
| `src/components/bootCover/bootCoverGround.ts`: `BOOT_COVER_GROUND` | Shared constant |
| `src/features/deckTower/launch/BootLaunchScreen.tsx` | Feature view, lazy chunk |
| `src/features/deckTower/DeckTowerPage.tsx`: `useHoldBootCover`, `launchUp`, `launchCovering` | Page (td) |

## 2. Redirect fixes (strand 2)

| # | Defect today | Fix |
|---|---|---|
| R1 ✅ | The page you were trying to reach is lost: `ProtectedRoute` passes no `from`, and `AuthContext.login` hard-codes `navigate('/')` | `<Navigate to="/login" replace state={{ from: location }} />`. Built: `from` is attached only while the boot cover is up (a cold-start deep link, Q2); `LoginPage` → `postLoginPath` (`src/utils/loginRedirect.ts`, in-app paths only) |
| R2 ✅ | Back-button trap: `ProtectedRoute`, the interceptor's `navigateToLogin`, `logout` and `deleteAccount` all **push** `/login` | `replace` on every path into `/login` |
| R3 ✅ | Two redirects to `/` on login (`login()` navigates, then `LoginPage` re-renders and returns `<Navigate to="/" replace>`) | `login()` stops navigating. `LoginPage` decides where to go after login |
| R4 ✅ | Two copies of the error state: `LoginPage.loginError` is seeded from the context `error` once, and `login()` writes both | `login()` throws, and the page owns the message |
| R5 | Stock MUI look (`Container`, `Paper elevation={3}`), no `COLORS` / `FONTS` / outline / rounded edge | Strand 3 |
| R6 ✅ | `authLog('LoginPage: render', …)` runs on every render | Drop it. Keep the submit / accept / reject traces |

Code: `src/components/ProtectedRoute.tsx`, `src/AuthContext.tsx` (`login`, `logout`,
`deleteAccount`, `handleTokenExpiration`), `src/utils/fetchInterceptor.ts`,
`src/pages/LoginPage.tsx`, `src/pages/RegisterPage.tsx`.

## 3. The login screen (strand 3, BUILT)

One route, `/login` (`/register` redirects, `src/pages/RegisterRedirect.tsx`), in the phone frame.
It continues the launch sky (Q12): the day sky (`BOOT_COVER_GROUND`), the launch pawn on its
platform at rest (`useBootScene` → App.tsx → `BootSceneStill` → `LaunchScreen.tsx` →
`LaunchSceneStill`, so the page never imports the Deck Tower kit), and the form in a raised white
card. The scene stays **exactly where the drop left it**: `LaunchSceneStill` places it as the
cover does (feet `FEET_AT_SCREEN_Y` = 0.8 down the box, pawn centred across), and the form goes in
the region above it (`BootSceneRenderProps.children`, ending just over the pawn's head). The form
centres in that sky when it fits and scrolls inside it when it does not (the details step on a
short phone), so it never covers the pawn. The card **slides in from the top** once the boot
cover has gone (after the circle on a cold start, at once otherwise): a 600 ms ease-out, no
gravity, no bounce (`src/pages/login/useCardSlideIn.ts`; off under reduced motion; once per
visit, not per step).

```
identifier ─ email ─▶ password │ "Email me a code" │ "Forgot password?"   (same for every address)
           │              └─▶ code ─▶ signed in (known) │ details (new)   (verify first)
           │              └─▶ reset code + new password ─▶ signed in
           └ phone ─▶ SMS code (Firebase) ─▶ signed in (known) │ details (new)
details: @username (live check) · name (optional) · password (email only) · gender · DOB
```

| File | Role |
|---|---|
| `src/pages/LoginPage.tsx` | Step state, the session-expired notice, the one post-sign-in redirect (a sign-in made on the page leaves through the reverse boot circle, closing onto the platform: LAUNCH_SCREEN.md § "Leaving the login screen") |
| `src/pages/login/loginUi.tsx` | `PlateButton` (gold action plate / white outlined plate), `Field`, `LoginCard` (rounded edge), `TextAction`, `FormMessage`, `OrDivider`, `StepHeading` |
| `src/pages/login/identifier.ts` | `parseEmail`, `parsePhone` (E.164, no guessed country; the settings change-email / change-phone field), `spreadDigits` + `parseUsPhoneDigits` (the login screen's ten phone boxes), `formatPhone` (display), `errorMessage` |
| `src/pages/login/PhoneDigitsField.tsx` | The ten-box +1 phone field: auto-advance, Backspace back, paste / autofill fills all ten |
| `src/pages/login/IdentifierStep.tsx`, `EmailPasswordStep.tsx`, `CodeStep.tsx`, `PhoneStep.tsx`, `DetailsStep.tsx` | The steps |
| `src/pages/login/useResendCountdown.ts` | The 30 s resend timer |
| `src/pages/login/useCardSlideIn.ts` | The card's slide in from the top after the boot cover |
| `src/api/auth.ts` | Every sign-in / channel call (through `http.ts`) |
| `src/utils/firebasePhone.ts` | Firebase Phone Auth, lazily loaded; App Check when `VITE_FIREBASE_APPCHECK_SITE_KEY` is set; the dev stand-in in the Vite dev server (§ 4c) |
| `AuthContext` → `establishSession`, `replaceUser`, `deleteAccount(proof)` | Adopting a session; settings updates |

Colours are framework tokens only: the action plate is `gld` / `gldFrame` with ink print, the
alternative plate white / `card` with the `border` outline, fields white with `border`, every
text and error ink. The gender choice chips use `bluM` for the selected fill, under an ink ring.

### Settings (Q24, BUILT)

`/settings/account` (`AccountSecurityPage`) gained "Your account"
(`src/pages/account/AccountIdentitySection.tsx`): username and name save in place; email and
phone run **confirm it's you** (`src/pages/account/StepUpPanel.tsx`: password, email code or
text code, whichever the account has) → the new address → its code. The password form shows
only for an account with a password; deleting a passwordless account confirms through the same
panel and sends the step-up token.

## 4. Phone signup + verification (strand 4)

### 4a. Sending domain: `mren.me`

The owner approved `mren.me` (PPE's domain) as the sender for now (2026-11-13). Its DNS is
on **Cloudflare**, and on 2026-11-13 it had no MX, SPF or DMARC record, so nothing conflicts.
Sending needs SPF + DKIM records from the chosen provider, plus a DMARC record. Mail goes from
`no-reply@mren.me`. A product domain would replace it later. Only the From address and the DNS
records change.

### 4b. Email

A 6-digit code generated and stored by us (hashed, with an expiry and an attempt cap),
sent through a transactional sender: Amazon SES, Resend or Postmark (not chosen yet). Google
Workspace is for a human inbox at most, because its SMTP relay is not built for
transactional mail.

### 4c. Phone

**Firebase Phone Auth** (Q6). It sends from Google's own numbers, so the app buys no number and
does no US carrier registration (10DLC / toll-free). Firebase attaches to the existing GCP
project the TTS service account uses, and is used **only to check that the phone is real**:

```
Client ── Firebase SDK sends SMS, user enters code ──▶ Firebase ID token   (src/utils/firebasePhone.ts)
Client ── POST /api/auth/phone/verify { idToken } ──▶ SignInController
Server ── FirebasePhoneVerifier checks the token against Google's keys → phone_number
Server ── SignInService finds the user (signed in) or issues a sign-up ticket
Server ── the app's own access + refresh tokens (session system unchanged)
```

The login screen takes US / Canada numbers only (Q10); settings take any E.164 number.
SMS delivery to mainland China is unreliable.

**Dev stand-in (no Firebase on a dev box).** The phone twin of the email console transport:
`server/services/auth/DevConsolePhoneVerifier.ts` → `DevConsolePhoneVerifier`. With no
`FIREBASE_PROJECT_ID` and `NODE_ENV` ≠ `production`, `createPhoneVerifier` picks it, and
`authRoutes.ts` mounts `POST /api/auth/phone/devSendCode { phone }` (prints
`📱 [dev sms] code for +1…: 123456` to the backend log) and `POST /api/auth/phone/devConfirmCode
{ phone, code }` → `{ idToken }`, an opaque single-use token the real phone endpoints accept in
place of a Firebase ID token. The client (`firebasePhone.ts` → `sendSmsCode`) uses it when the
build has no Firebase config AND runs in the Vite dev server (`import.meta.env.DEV`). Neither
half can be live on PPE: its backend runs with `NODE_ENV=production` and its frontend is a built
bundle. Tests: `server/__tests__/devConsolePhoneVerifier.test.ts`.

### 4c'. Server (BUILT)

| Piece | Layer |
|---|---|
| `server/services/auth/SignInService.ts` | Service: email codes, sign-up tickets, phone, step-up, channel changes, step-up delete |
| `server/services/auth/EmailSender.ts` | Adapter: Resend (`RESEND_API_KEY`, `EMAIL_FROM`), or the dev console transport |
| `server/services/auth/FirebasePhoneVerifier.ts` | Adapter: verifies Firebase ID tokens against Google's keys (`FIREBASE_PROJECT_ID`); no `firebase-admin` |
| `server/services/auth/DevConsolePhoneVerifier.ts` | Adapter: the dev phone stand-in, and `createPhoneVerifier` (which verifier this process uses) |
| `server/dal/implementations/EmailCodeDAL.ts` | DAL over `email_codes` (HMACs only) |
| `server/controllers/SignInController.ts` | HTTP; routes in `server/routes/authRoutes.ts` (the controller header lists them) |
| `server/controllers/authCookies.ts`, `httpErrors.ts` | Shared cookie + error helpers (were private to UserController) |
| `UserService` → `createUser(NewAccountInput)`, `issueSession`, `assertUsernameAvailable`, `suggestUsername`, `changeUsername`, `changeName`, `setPassword`, `checkPassword`, `deleteUserUnchecked` | Account rules |

The two tickets (sign-up 30 min, step-up 10 min) are JWTs signed with keys DERIVED from
`JWT_SECRET`, never `JWT_SECRET` itself, so neither can pass `authMiddleware` as an access
token. Removed: `POST /api/auth/register`, `POST /api/users` (no admin check), the unrouted
`updateProfile`. `deleteAccount` moved to `SignInController` and now checks the credential
before revoking sessions (the old handler revoked first). Tests:
`server/__tests__/signInService.test.ts`.

### 4d. Schema (APPROVED 2026-11-13, migrations 188 + 189)

**`users` changes** (expand migration, safe under the standard `/deploy`):

| Change | Rule |
|---|---|
| `+ username` text NOT NULL | UNIQUE; CHECK `^[a-z][a-z0-9_]{2,19}$`; stored lowercase; backfilled from `name` (Q22) |
| `+ phone` text NULL | UNIQUE; CHECK E.164 `^\+[1-9][0-9]{6,14}$` |
| `+ "emailVerifiedAt"` timestamptz | Existing email accounts are stamped `now()` (Q4) |
| `+ "phoneVerifiedAt"` timestamptz | |
| `~ email` → nullable, stored lowercase | Dev had 0 case-insensitive collisions on 2026-11-13. The runbook pre-checks PPE and the migration aborts on a collision |
| `~ password` → nullable | Phone-only accounts |
| `~ name` → nullable | Q19 |
| `+ CHECK (email IS NOT NULL OR phone IS NOT NULL)` | Every account has a channel |
| `+ CHECK (password IS NULL OR email IS NOT NULL)` | A password belongs to the email channel |
| `− "isPublic"` | Dropped by **migration 189**, a contract migration run after the code ships (Q7, § 7) |

**New table `email_codes`:** `id`, `email` (lowercase), `purpose` (`'sign-in'` |
`'reset'` | `'verify-new-email'` | `'step-up'`), `"codeHash"`, `"expiresAt"`, `attempts`,
`"consumedAt"`, `"createdAt"`. Index on (`email`, `"createdAt"`) for the 5-per-hour limit
(Q16). Rows older than a day are purged by the same cleanup as `refresh_tokens`
([DEFERRED_WORK.md](./DEFERRED_WORK.md) item 48). SMS codes are stored by Firebase, not here.

**Stateless (no table):**
- **Sign-up ticket:** after a code checks out for an identifier with no account, the server
  returns a signed 30-minute token carrying the verified email or phone. The details step
  presents it, so no unverified row ever exists (Q14).
- **Access-token JWT** drops its `email` claim and carries `userId` only. Every reader of the
  claim is audited before it goes.

### 4e. Session length: 180 days, sliding (BUILT 2026-11-13)

`server/services/UserService.ts` → `REFRESH_TOKEN_TTL_MS` is 180 days (was 30). Every
rotation re-issues the full lifetime, so only 180 days without opening the app ends a
session. The refresh cookie's `maxAge` is derived from `expiresAt`
(`server/controllers/UserController.ts`), so the constant is the only knob. Existing tokens
keep their old 30-day expiry until their next rotation, about 15 minutes of use.
This is what makes passwordless SMS codes cheap: a learner enters one roughly once per device.

Follow-ups: step-up re-auth before sensitive changes is **in scope** (Q24); native secure
storage under Capacitor is held ([DEFERRED_WORK.md](./DEFERRED_WORK.md) item 47).

## 5. Code this doc depends on

`src/features/deckTower/launch/LaunchScreen.tsx` → `LaunchScreen`;
`src/features/deckTower/launch/launchDue.ts` → `launchDueOnMount`;
`src/features/deckTower/DeckTowerPage.tsx` → `launchUp`, `launchReady`, `endLaunch`;
`src/components/ProtectedRoute.tsx` → `ProtectedRoute`;
`src/AuthContext.tsx` → `login`, `logout`, `deleteAccount`, `register`;
`src/utils/fetchInterceptor.ts` → `setupFetchInterceptor`;
`src/pages/LoginPage.tsx`, `src/pages/RegisterPage.tsx`;
`server/routes/authRoutes.ts`; `src/routes/routeMeta.ts` (`access: "open"` routes).

## 6. Open questions

| Q | Question | Answer |
|---|---|---|
| Q1 | Should the boot cover play on **every** cold start, including deep links and a signed-out launch to `/register`? Today it only plays when the launch lands on `/` | **Every cold start** (owner, 2026-11-13). The circle opens onto whatever route resolved underneath. `launchDueOnMount`'s "landed on `/`" rule goes away |
| Q2 | After a **mid-session** expiry, should the user get a plain redirect with no cover? Does return-to apply there, or only to cold-start deep links? (Returning into a game starts it fresh) | **Plain redirect, no cover, and after login always to `/`** (owner, 2026-11-13). Return-to (R1) applies **only** to a cold-start deep link. The interceptor's path into `/login` passes no `from` |
| Q3 | Phone auth style: passwordless SMS code, or phone + password? Should email also allow a code login? | **Passwordless SMS code** for phone accounts (owner, 2026-11-13): a phone account has no password, and a code signs it in for 180 days (§ 4e). Email code login: Q8 |
| Q4 | Verification policy: does it block using the app, or is it a soft prompt? What happens to existing unverified accounts? | **Block until verified** (owner, 2026-11-13). A new signup cannot use the app until it enters the code. Existing accounts are **marked verified** by the migration that adds the verified-at column (owner, 2026-11-13), so no existing user hits the verification screen |
| Q5 | Email sender: SES / Resend / Postmark? | **Resend** (owner, 2026-11-13): API key plus SPF/DKIM records in Cloudflare; the free tier covers this app's volume |
| Q6 | Phone: Firebase Phone Auth or Twilio Verify? | **Firebase Phone Auth** (owner, 2026-11-13), used only to check the phone is real (§ 4c) |
| Q7 | Should new signups still default to `isPublic = true`? | **Remove `isPublic` as a concept; every account is always public** (owner, 2026-11-13). Its one live effect was hiding a private user's streak on the leaderboard; the client's "demo account" reading (`ProtectedRoute` `requireFullAccount`, `access: "account"`, games `requiresAuth`) was dead code. In scope: § 7 |
| Q8 | Can an email account also sign in with an emailed code? | **Yes, either** (owner, 2026-11-13): the password step offers "Email me a code instead" |
| Q10 | Entry screen structure | **One screen, identifier first** (owner, 2026-11-13): one "email or phone" field; the server says whether the account exists, then sign-in (password / code) or sign-up continues. One route replaces `/login` + `/register`. **Amended (owner, 2026-11-14): phone first.** Step 1 opens on a ten-box US / Canada phone field (fixed "+1", boxes grouped 3·3·4; `PhoneDigitsField.tsx`, `identifier.ts` → `spreadDigits`, `parseUsPhoneDigits`) and its gold Continue. Below an "or": "Continue with email" swaps the phone field for the Email box ("Use phone instead" swaps back), then reserved single-sign-on slots (Apple, Google: disabled placeholders, `IdentifierStep.tsx` → `SSO_PROVIDERS`). While phone sign-in is not configured the phone field stays first but greyed out with "Phone sign-in is coming soon." This reverses the earlier "no guessed country" rule for the login screen only; the settings change-phone field still takes any E.164 number (`parsePhone`). (Superseded the same day's two-box Email + Phone layout.) |
| Q11 | Forgot password for email accounts? | **In scope** (owner, 2026-11-13): reset via an emailed code, on the same code table and screen |
| Q12 | Look | **Continue the launch sky** (owner, 2026-11-13): the circle opens onto the same day sky (`COLORS.bluMk`) with the pawn on its platform; the form sits below as outlined, rounded-edge cards |
| Q13 | Account enumeration | **Hide it** (owner, 2026-11-13): no response may reveal whether an email or phone has an account. Flow in Q17 |
| Q14 | Sign-up order | **Verify first, then details** (owner, 2026-11-13): identifier → code → name / gender / DOB (+ password for email) → account created. An unverified account never exists, so "block until verified" needs no gate inside the app |
| Q15 | Route | **Keep `/login`** as the one screen; `/register` redirects to it (owner, 2026-11-13) |
| Q16 | Emailed-code rules | **Defaults** (owner, 2026-11-13): 6 digits, valid 10 min, 5 wrong tries kills the code, resend after 30 s, max 5 codes per address per hour, stored hashed. Firebase applies its own rules to SMS |
| Q17 | The hidden-enumeration sign-in flow | **Accepted** (owner, 2026-11-13). After the identifier, every email sees the same step: a password field, "Email me a code" and "Forgot password?". A wrong password and an unknown account give the same error ("Wrong email or password. New here? Email me a code"), and the password check runs a dummy hash for unknown accounts so timing matches. "Email me a code" always sends: a known account signs in, an unknown address continues to sign-up. Phone is code-only; the server decides known vs new after Firebase confirms the number |
| Q18 | SMS fraud without a region allowlist | **Layered defenses** (owner, 2026-11-13): Firebase App Check (reCAPTCHA Enterprise); reCAPTCHA SMS fraud scoring (Identity Platform SMS defense); a GCP budget alert on SMS spend; and a runbook step to switch on a region **denylist** for the countries an attack comes from. ⚠️ Feature names and pricing to be verified before building |
| Q19 | Sign-up details | **Name optional; username required (see Q20); gender and DOB as today** (required, with "Prefer not to answer") (owner, 2026-11-13) |
| Q20 | Username | **Required, a public handle and an add-friend key** (owner, 2026-11-13). It is shown on leaderboards and friends in place of the name, and the add-friend field accepts it as well as the friend code. Email and phone are never shown to other users, and the leaderboard wire stops sending `email` |
| Q21 | Username rules | **3–20 characters of a–z, 0–9 and `_`, starting with a letter, stored lowercase, unique across all users, with a small reserved list (admin, support, …). Changeable at any time, no cooldown** (owner, 2026-11-13) |
| Q22 | Usernames for existing accounts | **Auto-generated, no prompt** (owner, 2026-11-13): the migration derives one from `name` (lowercased, other characters → `_`, a digit suffix on collision); users change it in settings |
| Q23 | Overlap with the in-progress friends rework | **Edit alongside** (owner, 2026-11-13): small, targeted edits to `FriendsService` / the friends screens to accept a username in add-friend |
| Q24 | Settings editing in scope | **All four** (owner, 2026-11-13): change username, change name, add the other channel (email ↔ phone), change email / phone. The last two bring step-up re-auth (formerly DEFERRED_WORK item 46) into scope: password or a fresh code before the change, and a code to the new address |
| Q9 | What does signup ask for? | **Email OR phone** (owner, 2026-11-13). An email account has a password; a phone account is passwordless. Adding the other channel to an existing account is a follow-up |

## 7. Scope

**In scope**

- Boot cover on every cold start, with the circle opening onto td or `/login` (§ 1, Q1).
- Redirect fixes R1–R6 (§ 2). After a mid-session expiry, a plain redirect and always `/` (Q2).
- One identifier-first `/login` screen in the launch sky; `/register` redirects to it (Q10, Q12, Q15).
- Email accounts: password **or** emailed code sign-in, forgot password, hidden enumeration (Q8, Q11, Q13, Q17).
- Phone accounts: passwordless, through Firebase Phone Auth with the layered SMS-fraud defenses (Q3, Q6, Q18).
- Verify-first sign-up: name optional, username required, gender + DOB as today (Q14, Q19–Q21).
- Settings: change username / name, add the other channel, change email / phone, with step-up re-auth (Q24).
- Add-friend by username (Q20, Q23).
- Remove `isPublic` everywhere: leaderboard streak masking, `ProtectedRoute` `requireFullAccount`,
  `access: "account"`, games `requiresAuth`, the column (Q7).
- The leaderboard wire stops sending `email`; other users never see an email or phone (Q20).
- 180-day sliding sessions (§ 4e, built).

**Out of scope**

- Mobile SSO: a Capacitor requirement ([DEFERRED_WORK.md](./DEFERRED_WORK.md) item 44).
- Refresh token in native secure storage: Capacitor (item 47).
- `refresh_tokens` / `email_codes` purge (item 48).
- An SMS region allowlist (Q18 chose defenses instead; a denylist is the incident response).
- A product domain: mail goes from `no-reply@mren.me` for now (§ 4a).

**Owner-side setup (cannot be done from the repo)**: tracked as work items in
[DEFERRED_WORK.md](./DEFERRED_WORK.md).

- Item 50: Resend account → API key, and its SPF / DKIM records plus a DMARC record in
  Cloudflare for `mren.me`. **Blocks the deploy.**
- Item 51: Firebase on the existing GCP project: Blaze plan, Phone provider on, App Check with
  a reCAPTCHA Enterprise key, SMS defense, a GCP budget alert on SMS spend. No service account
  is needed (the ID token is checked against Google's public keys, § 4c).
- Item 52: the Firebase keys in PPE's `.env` (backend) and `.env.production` (frontend build).

Until the keys exist, dev runs on console stand-ins: email codes print as `📧 [dev email]` and
SMS codes as `📱 [dev sms]` in the `cow-backend` log (§ 4c).

## 8. Build plan

All eight phases are **built on dev** (2026-11-14). Migrations: **188** (expand) and **189**
(contract); 187 is the friends session's `users."friendCode"`.

| Phase | Work | Layers |
|---|---|---|
| P1 | Boot cover moved to the app shell, plus R1–R4, R6 | Client: shared view + state, td page, `ProtectedRoute`, `AuthContext`, interceptor |
| P2 | Expand migration (§ 4d minus the drop); username backfill; `isPublic` readers removed; leaderboard stops sending `email`; JWT drops `email` | Migration, DAL, service, wire contract, client |
| P3 | Email codes: Resend sender (console transport on dev), `email_codes` DAL, start / verify / sign-up-ticket / complete-sign-up / reset endpoints, dummy-hash password check | Server: DAL, service, controller, routes |
| P4 | The new `/login` UI (identifier → password-or-code → details) in the launch sky; `/register` redirect | Client: page, `src/api/` |
| P5 | Phone: Firebase client SDK (lazy) → ID token → `/api/auth/phone/verify` (verified by hand against Google's keys, no `firebase-admin`) | Client + server |
| P6 | Settings: username, name, add channel, change email / phone, step-up re-auth | Client page + server |
| P7 | Add-friend by username | `FriendsService` + friends screens |
| P8 | Held-back migration dropping `users."isPublic"`, with `docs/LOGIN_REWORK_DEPLOY_RUNBOOK.md` | Migration + runbook |

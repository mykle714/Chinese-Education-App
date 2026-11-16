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
the region above it (`BootSceneRenderProps.children`, ending just over the pawn's head).

**Layout: a fixed title, windows hung below it** (owner, 2026-11-15). The **app title** has one
spot and never moves: `TITLE_TOP_SHARE` (14 %) of the way down the sky region, never above
`TITLE_MIN_TOP` (`LoginPage.tsx`). It is a **placeholder**: the app name (`usePageTitle.ts` →
`APP_NAME`) in plain bold display type, until a wordmark is designed. Every window hangs from
16 px below it (`TITLE_TO_CARD_GAP_PX`) and grows **downward only**, covering the pawn when it
must ("Other ways to sign in" opening, a longer step). **Create account** (the details step) is
the exception: tall enough to need the screen, it starts near the top (`TALL_CARD_TOP`) and
covers the title. The title sits outside `login-page__scroller`, under it, so it stays put while
a window scrolls; the scroller reaches the bottom of the screen (`belowPx`, measured with a
ResizeObserver along with the sky height `skyPx`), so a grown window covers the pawn instead of
being clipped. Title and card **slide in from the top** together once the boot cover has gone
(after the circle on a cold start, at once otherwise): a 600 ms ease-out, no gravity, no bounce,
the slide distance measured to the card's bottom
(`src/pages/login/useCardSlideIn.ts`; off under reduced motion; once per visit, not per step).

**Test sign-up identifiers** (owner, 2026-11-15): the phone number `444 444 4444` and the email
`4444@4444.com` always walk that channel's sign-up flow and never create an account
(`src/pages/login/testSignUp.ts` → `TEST_SIGN_UP_PHONE`, `TEST_SIGN_UP_EMAIL`,
`testSignUpNext`). Both are pure client-side dry runs that read **exactly** like the real flow: a
pretend send (`TEST_SEND_DELAY_MS`), the server's own wording for every failure, and the code
(`444444`, `TEST_SIGN_UP_CODE`) never shown.
- **Phone:** step 1 lets it continue even without phone sign-in configured
  (`IdentifierStep.tsx` → `phoneIsTest`); `PhoneStep.tsx` sends no SMS, plays the "Sending a
  code…" beat, and takes only `444444` (else "That code is wrong").
- **Email:** `CodeStep.tsx`'s "Sign in with password" answers "Wrong email or password" (an
  unknown address), and "Send code" / "Forgot password?" play a pretend send
  (`TEST_CODE_SENT`); `CodeStep.tsx` takes only `444444` for sign-in (else "That code is wrong
  or has expired"), and a reset always fails as it would for an address with no account (new
  password checked first, as the server does).
- **Both:** `DetailsStep.tsx` skips `completeSignUp` on "Create account" (`onTestFinished`; an
  email sign-up's password is checked first with `wire.ts` → `passwordProblem`, the server's
  own rule, reported in the form message where the server's rejection lands), and
  `LoginPage.tsx` returns to step 1 with "Test sign-up finished. No account was created."
  (`testFinished`), the only giveaway. The only server call on either path is the read-only
  username check.
- The server replies are copied into `testSignUp.ts` (`TEST_CODE_SENT`,
  `TEST_BAD_EMAIL_CODE_MESSAGE`, `TEST_WRONG_CREDENTIALS_MESSAGE`); keep them in step with
  `SignInService.ts` (`RESEND_AFTER_S`, `CODE_TTL_MIN`, `BAD_CODE_MESSAGE`) and
  `UserService.ts` (`WRONG_CREDENTIALS_MESSAGE`).
- The phone field is still disabled while phone sign-in is not configured, so on such a build
  the test number cannot be typed (the email works everywhere).

**Window changes slide left** (owner, 2026-11-15): every change of window (a new step, back steps
included, and step 1's phone ⇄ email swap) translates the card left: the old card slides off
to the left as the new one comes in from the right, side by side (320 ms, the page slide's
ease-out). `src/pages/login/WindowSlide.tsx` wraps `LoginCard`; `LoginPage.tsx` → `windowKey`
names the window (`identifier-phone` / `identifier-email` / the step kind; step 1 reports its
swaps through `IdentifierStep` → `onModeChange`). The outgoing card is a DOM clone taken in
`getSnapshotBeforeUpdate` and laid over `.login-page` at its old rect (inert, aria-hidden, ids
stripped). The title does not move. A swap folds "Other ways to sign in" at once
(`Disclosure` → `animate={false}`) so the new window arrives folded. The scroller is
`overflow-x: hidden` and resets any sideways scroll a mid-slide autofocus causes. Off under
reduced motion.

**Verification windows** (owner, 2026-11-15; supersedes the email password window). After the
identifier, BOTH channels land on a verification window that sends **nothing until tapped**
("Send code" / "Text me a code": a text costs money, and a password user should not trigger a
send). The window is **"Continue with email"** over the address with an inline **"Change"**
(`loginUi.tsx` → `IdentifierLine`, back to step 1), or **"Continue with phone"** with no number
shown, just **"Use a different phone number"** (owner, 2026-11-15), then a proper
**accordion** (`loginUi.tsx` → `Accordion`) bleeding to the card's edges: two sections, each a
full-width header row (label + chevron) over its content, exactly ONE open at a time (the open
header is `aria-disabled`; tapping the closed one swaps them, both folding at 250 ms). Closed
headers sit on paper, the open section on white.
- **Same height, both sections** (owner, 2026-11-15): switching sections never resizes the
  card. Both are built from the same pieces in the same order, a field with its reserved note
  line, a plate button, a row of text links, all spaced by `loginUi.tsx` →
  `ACCORDION_SECTION_GAP`. On sign-in the code field's note line carries its error (and, on
  email, the status "We'll email you…" / "We emailed you…" / "New code sent…"), exactly where
  the password field keeps its error, so neither an error nor a send grows a section. (Reset
  windows keep their boxed form message: their errors can be about the new password.)
- **"Email me a code" / "Text me a 6-digit code"** (open by default): the code field
  (always laid out, disabled until a send) and the primary button whose label swaps "Send code"
  / "Text me a code" → "Continue", so sending moves nothing; then the resend row.
- **"Sign in with password"** (`PasswordSignInForm.tsx`): password, gold "Sign in",
  "Forgot password?". Offered for every identifier whether or not it has an account; the
  server answers every failure identically (`SignInService.passwordSignIn` →
  `UserService.authenticateWithPassword`: one bcrypt compare, "Wrong email or password" /
  "Wrong phone number or password"), so it reveals nothing. Its "Forgot password?" leads to that
channel's reset window: email sends a reset code (`CodeStep` purpose `reset`); phone moves to the
reset version of the phone window (`PhoneStep` purpose `reset`: SMS code + new password →
`POST /api/auth/password/resetWithPhone`). The **password is optional for every account**, chosen
on Create account or later in Settings ("Set a password", `SetPasswordSection.tsx`, step-up
gated); migration 191 dropped 188's `chk_users_password_needs_email`.

```
identifier ─ email ─▶ verify: "Send code" ─▶ code ─▶ signed in (known) │ details (new)   (verify first)
           │                └ "Sign in with password" ─▶ signed in │ "Forgot password?" ─▶ reset code + new password ─▶ signed in
           └ phone ─▶ verify: "Text me a code" ─▶ SMS code (Firebase) ─▶ signed in (known) │ details (new)
                            └ "Sign in with password" ─▶ signed in │ "Forgot password?" ─▶ SMS code + new password ─▶ signed in
details: @username (live check) · name (optional) · password (optional, either channel) · gender (optional) · DOB (optional)
```

| File | Role |
|---|---|
| `src/pages/LoginPage.tsx` | Step state, the session-expired notice, the one post-sign-in redirect (a sign-in made on the page leaves through the reverse boot circle, closing onto the platform: LAUNCH_SCREEN.md § "Leaving the login screen") |
| `src/pages/login/loginUi.tsx` | `PlateButton` (gold action plate / white outlined plate), `Field`, `LoginCard` (rounded edge), `TextAction`, `FormMessage`, `OrDivider`, `Disclosure` (the card's pull-down bottom section), `Accordion` (the verification windows' exactly-one-open sections), `IdentifierLine` (identifier + inline "Change"), `StepHeading`, `SwapText` (a status line whose wording changes without reflowing: all wordings share one grid cell), `CodeLinksRow` (the code steps' never-wrapping "Resend code in 30s · Back / Change number" row, its countdown width reserved) |
| `src/pages/login/identifier.ts` | `parseEmail`, `parsePhone` (E.164, no guessed country; the settings change-email / change-phone field), `spreadDigits` + `parseUsPhoneDigits` (the login screen's ten phone boxes), `formatPhone` (display), `errorMessage` |
| `src/pages/login/PhoneDigitsField.tsx` | The ten-box +1 phone field: auto-advance, Backspace back, paste / autofill fills all ten |
| `src/pages/login/IdentifierStep.tsx`, `CodeStep.tsx` (email verification + reset), `PhoneStep.tsx` (phone verification + reset), `DetailsStep.tsx` | The steps |
| `src/pages/login/PasswordSignInForm.tsx` | "Sign in with password" + "Forgot password?", the verification windows' second accordion section |
| `src/pages/account/SetPasswordSection.tsx` | Settings → "Set a password" for an account without one (step-up → `POST /api/auth/password/set`) |
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
| `+ username` text NOT NULL | UNIQUE; CHECK `chk_users_username_shape` (188: `^[a-z][a-z0-9_]{2,19}$`; **migration 190** replaced it with Instagram's rules, see Q21); stored lowercase; backfilled from `name` (Q22) |
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
| Q3 | Phone auth style: passwordless SMS code, or phone + password? Should email also allow a code login? | **Passwordless SMS code** for phone accounts (owner, 2026-11-13): a phone account has no password, and a code signs it in for 180 days (§ 4e). Email code login: Q8. **Amended (owner, 2026-11-15):** a phone account MAY have an optional password (migration 191), used through "Sign in with password" on the phone verification window; the SMS code remains the default |
| Q4 | Verification policy: does it block using the app, or is it a soft prompt? What happens to existing unverified accounts? | **Block until verified** (owner, 2026-11-13). A new signup cannot use the app until it enters the code. Existing accounts are **marked verified** by the migration that adds the verified-at column (owner, 2026-11-13), so no existing user hits the verification screen |
| Q5 | Email sender: SES / Resend / Postmark? | **Resend** (owner, 2026-11-13): API key plus SPF/DKIM records in Cloudflare; the free tier covers this app's volume |
| Q6 | Phone: Firebase Phone Auth or Twilio Verify? | **Firebase Phone Auth** (owner, 2026-11-13), used only to check the phone is real (§ 4c) |
| Q7 | Should new signups still default to `isPublic = true`? | **Remove `isPublic` as a concept; every account is always public** (owner, 2026-11-13). Its one live effect was hiding a private user's streak on the leaderboard; the client's "demo account" reading (`ProtectedRoute` `requireFullAccount`, `access: "account"`, games `requiresAuth`) was dead code. In scope: § 7 |
| Q8 | Can an email account also sign in with an emailed code? | **Yes, either** (owner, 2026-11-13): the password step offers "Email me a code instead". **Amended (owner, 2026-11-15):** the code is now the default and the password the folded alternative (§ 3 "Verification windows") |
| Q10 | Entry screen structure | **One screen, identifier first** (owner, 2026-11-13): one "email or phone" field; the server says whether the account exists, then sign-in (password / code) or sign-up continues. One route replaces `/login` + `/register`. **Amended (owner, 2026-11-14): phone first.** Step 1 opens on a ten-digit US / Canada phone field (fixed "+1", boxes grouped 3·3·4; `PhoneDigitsField.tsx`, `identifier.ts` → `spreadDigits`, `parseUsPhoneDigits`) and its gold Continue. Below an "or": "Continue with email" swaps the phone field for the Email box (a mirror "Continue with phone" swaps back), then reserved single-sign-on slots (Apple, Google: disabled placeholders, `IdentifierStep.tsx` → `SSO_PROVIDERS`). While phone sign-in is not configured the phone field stays first but greyed out with "Phone sign-in is coming soon." This reverses the earlier "no guessed country" rule for the login screen only; the settings change-phone field still takes any E.164 number (`parsePhone`). (Superseded the same day's two-box Email + Phone layout.) **Quietened (owner, 2026-11-15):** no subline under "Welcome", no "US and Canada numbers" hint under the phone boxes, the ten digit boxes became **underlined spots** (a 2 px rule, `border` when empty and ink when focused / filled / in error; `PhoneDigitsField.tsx` → `SPOT_*`), and "Continue with email" + the SSO slots fold into the card's closed-by-default bottom section, "Other ways to sign in" (`loginUi.tsx` → `Disclosure`: a full-bleed paper strip under one hairline with a quiet centred caption + chevron that rides the bottom edge: the options unroll at the top seam under the hairline and push the caption down; it replaces the "or" divider on this step). **No "+1" (owner, 2026-11-15):** the fixed country code was dropped too. In its place: the first spot swallows a typed 0 or 1 (the habitual country code; no NANP area code starts with either), typing always starts from the first empty spot (a tap past it lands there; `spreadDigits` never fills past it), the digit that completes the number releases focus (`PhoneDigitsField.tsx` → `put`) rather than leaving the last spot selected, a "Clear" button sits in the field's top-right corner on the label's line while any spot holds a digit (`login-phone-digits__clear`; empties all ten, caret to the first), and a number failing the NANP shape check is told "Only US and Canada numbers work right now" (`identifier.ts` → `US_ONLY_MESSAGE`), the field's only US-only cue. On the email side, the old "Use phone instead" text link under the form became a "Continue with phone" plate inside "Other ways to sign in", mirroring "Continue with email" on the phone side. **Continue gated (owner, 2026-11-15):** the phone Continue stays greyed out until the ten spots hold a valid number (`IdentifierStep.tsx` → `phoneValid`); since a submit can then no longer explain a bad number, a full-but-invalid one shows its error live (`phoneError`), while a partly typed one shows nothing. The email Continue is gated the same way (`emailValid`); its error (`emailError`) shows once the learner leaves the box with an invalid address, and clears when they type again. **Errors never grow the card (owner, 2026-11-15):** the note line of every field that can show an error (`loginUi.tsx` → `FieldNote`; the caller passes `error`, `null` when clear) is always laid out, one caption line tall even when empty, with the hint and the error stacked in one grid cell (the inactive one invisible), so an error appearing or clearing moves nothing. A field that can never error and has no hint (Name) draws no line, so no blank gap. |
| Q11 | Forgot password for email accounts? | **In scope** (owner, 2026-11-13): reset via an emailed code, on the same code table and screen |
| Q12 | Look | **Continue the launch sky** (owner, 2026-11-13): the circle opens onto the same day sky (`COLORS.bluMk`) with the pawn on its platform; the form sits below as outlined, rounded-edge cards |
| Q13 | Account enumeration | **Hide it** (owner, 2026-11-13): no response may reveal whether an email or phone has an account. Flow in Q17 |
| Q14 | Sign-up order | **Verify first, then details** (owner, 2026-11-13): identifier → code → name / gender / DOB (+ password for email) → account created. An unverified account never exists, so "block until verified" needs no gate inside the app |
| Q15 | Route | **Keep `/login`** as the one screen; `/register` redirects to it (owner, 2026-11-13) |
| Q16 | Emailed-code rules | **Defaults** (owner, 2026-11-13): 6 digits, valid 10 min, 5 wrong tries kills the code, resend after 30 s, max 5 codes per address per hour, stored hashed. Firebase applies its own rules to SMS |
| Q17 | The hidden-enumeration sign-in flow | **Superseded in form, kept in substance (owner, 2026-11-15):** there is no password window; every identifier lands on the same verification window, sends nothing until tapped, and "Sign in with password" is shown for every identifier with one identical failure message per channel. Original: **Accepted** (owner, 2026-11-13). After the identifier, every email sees the same step: a password field, "Email me a code" and "Forgot password?". A wrong password and an unknown account give the same error ("Wrong email or password. New here? Email me a code"), and the password check runs a dummy hash for unknown accounts so timing matches. "Email me a code" always sends: a known account signs in, an unknown address continues to sign-up. Phone is code-only; the server decides known vs new after Firebase confirms the number |
| Q18 | SMS fraud without a region allowlist | **Layered defenses** (owner, 2026-11-13): Firebase App Check (reCAPTCHA Enterprise); reCAPTCHA SMS fraud scoring (Identity Platform SMS defense); a GCP budget alert on SMS spend; and a runbook step to switch on a region **denylist** for the countries an attack comes from. ⚠️ Feature names and pricing to be verified before building |
| Q19 | Sign-up details | **Name optional; username required (see Q20); gender and DOB as today** (required, with "Prefer not to answer") (owner, 2026-11-13). **Amended (owner, 2026-11-15): gender and DOB are optional** ("Gender (optional)", "Date of birth (optional)"); the date of birth lost its "Prefer not to answer" checkbox, and a blank sends null (`DetailsStep.tsx`). Gender is Female · Male · **Non-binary** (migration 192 widened `chk_users_gender`; Settings → About you shows it too) · **Prefer not to answer** (a chip again; it and a blank both send null). The password box ("Password (optional)", a two-line hint: "At least 8 characters, with a letter and a number." / "A password lets you sign in without a code.") unrolls a **Confirm password** box once it has content, checked on submit ("The passwords don't match"). **Start over** sits in the card's top-right corner, on the heading's line. The step also lost the "Verified <email / phone>" subline, the Immersive World purpose line and the name hint, and the username hint is just "You can change it any time." |
| Q20 | Username | **Required, a public handle and an add-friend key** (owner, 2026-11-13). It is shown on leaderboards and friends in place of the name, and the add-friend field accepts it as well as the friend code. Email and phone are never shown to other users, and the leaderboard wire stops sending `email` |
| Q21 | Username rules | **3–20 characters of a–z, 0–9 and `_`, starting with a letter, stored lowercase, unique across all users, with a small reserved list (admin, support, …). Changeable at any time, no cooldown** (owner, 2026-11-13). **Amended (owner, 2026-11-15): Instagram's rules** — 1–30 characters of a–z, 0–9, `_` and `.`; no period at the start or end; no two periods in a row; may start with a digit or `_`. Still lowercase, unique, reserved list, changeable any time. `server/contracts/wire.ts` → `USERNAME_PATTERN` + `usernameProblem` (tests: `server/__tests__/usernameRules.test.ts`) and the `chk_users_username_shape` CHECK of **migration 190** (a superset of 188's, so it auto-runs before the rebuild in a standard `/deploy`; applied on dev 2026-11-15, **not yet on PPE**). `UserService.suggestUsername` no longer adds a `u_` prefix or pads to 3. |
| Q22 | Usernames for existing accounts | **Auto-generated, no prompt** (owner, 2026-11-13): the migration derives one from `name` (lowercased, other characters → `_`, a digit suffix on collision); users change it in settings |
| Q23 | Overlap with the in-progress friends rework | **Edit alongside** (owner, 2026-11-13): small, targeted edits to `FriendsService` / the friends screens to accept a username in add-friend |
| Q24 | Settings editing in scope | **All four** (owner, 2026-11-13): change username, change name, add the other channel (email ↔ phone), change email / phone. The last two bring step-up re-auth (formerly DEFERRED_WORK item 46) into scope: password or a fresh code before the change, and a code to the new address |
| Q9 | What does signup ask for? | **Email OR phone** (owner, 2026-11-13). An email account has a password; a phone account is passwordless. Adding the other channel to an existing account is a follow-up. **Amended (owner, 2026-11-15):** the password is OPTIONAL for either channel (Create account → "Password (optional)"; Settings → "Set a password"); migration 191 |

## 7. Scope

**In scope**

- Boot cover on every cold start, with the circle opening onto td or `/login` (§ 1, Q1).
- Redirect fixes R1–R6 (§ 2). After a mid-session expiry, a plain redirect and always `/` (Q2).
- One identifier-first `/login` screen in the launch sky; `/register` redirects to it (Q10, Q12, Q15).
- Email accounts: password **or** emailed code sign-in, forgot password, hidden enumeration (Q8, Q11, Q13, Q17).
- Phone accounts: passwordless, through Firebase Phone Auth with the layered SMS-fraud defenses (Q3, Q6, Q18).
- Verify-first sign-up: name, gender and DOB optional, username required (Q14, Q19–Q21).
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

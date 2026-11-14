# Login Rework — Deploy Runbook

> ⚠️ **TEMPORARY.** Delete this file (and its row in [DEPLOY_RUNBOOKS.md](./DEPLOY_RUNBOOKS.md))
> once every check below has passed on PPE.
>
> **Status: DEPLOYED 2026-11-14** (`b242d8a`). 187 + 188 applied before the rebuild, 189 after
> it (by hand with tracking rows; `migrate.sh` needs a TCP password on PPE). V1–V4 and the HTTP
> checks passed; `/api/auth/login` answers "Wrong email or password" (400) on the new schema.
> Deployed WITHOUT `RESEND_API_KEY` (owner's call), so phone is off and V6 waits for item 50.
> **Still open:** V5, V6 (after Resend), V7 with a real account, V8.
>
> Written 2026-11-14. Design: [LOGIN_REWORK.md](./LOGIN_REWORK.md).

## What ships

- **Migration 188** (expand): `users.username` (NOT NULL, backfilled from `name`), `phone`,
  `emailVerifiedAt` (existing accounts stamped), `phoneVerifiedAt`; `email` / `password` /
  `name` made nullable with CHECKs; emails lowercased; the new `email_codes` table.
- **Migration 189** (contract): drops `users."isPublic"`. **Held back until after the rebuild.**
- **Migration 187** (`users."friendCode"`) is a separate change from the friends session. It is
  expand-only and order-independent; if it is not on PPE yet it goes with 188.
- Code: the boot cover in the app shell, the identifier-first `/login`, verify-first sign-up,
  email codes (Resend), phone sign-in (Firebase), step-up re-auth, the username, add-friend by
  username, `isPublic` removed, emails no longer sent to other users, the JWT's `email` claim
  dropped, 180-day sliding sessions. `POST /api/auth/register` and `POST /api/users` are gone.

## New configuration

| Where | Variable | Needed for | Without it |
|---|---|---|---|
| backend env | `RESEND_API_KEY` | sending email codes | **every email code send fails (503)**: no new sign-ups, no code sign-in, no reset. Password sign-in still works |
| backend env | `EMAIL_FROM` | the sender | defaults to `no-reply@mren.me` |
| backend env | `FIREBASE_PROJECT_ID` | verifying phone ID tokens | phone sign-in hidden (`/api/auth/methods` → `phone: false`) |
| frontend build env | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | the SMS step in the browser | phone boxes greyed out, "Phone sign-in is coming soon." |
| frontend build env | `VITE_FIREBASE_APPCHECK_SITE_KEY` | App Check (SMS-fraud layer 1, LOGIN_REWORK Q18) | phone works, but without App Check |

"Backend env" is the repo-root `.env` on PPE (the backend's `env_file`). "Frontend build env"
is the repo-root **`.env.production`** on PPE: `.dockerignore` keeps `.env` out of the
frontend build, and the `Dockerfile` takes no build args. The `VITE_*` values are baked in at
**build** time, so set them before the frontend rebuild.

Owner-side setup is tracked as work items in [DEFERRED_WORK.md](./DEFERRED_WORK.md):
- **Item 50: Resend + mail DNS.** The owner chose to deploy WITHOUT it (2026-11-14: "as long
  as email login is working"). Password sign-in works for every existing account (all have an
  email + password); new sign-ups, code sign-in and password reset fail until the key is in
  PPE's `.env` and the backend is restarted (`docker-compose -f docker-compose.ppe.yml up -d
  backend`). V6 waits for that.
- **Item 51: Firebase project setup.** Optional for the deploy; without it phone shows as
  "coming soon".
- **Item 52: Firebase keys on PPE.** Do this after item 51.

## Step order

1. **Pre-check** (PPE database). Must return **0 rows**:
   ```sql
   SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
   ```
   If not 0: two accounts share an email case-insensitively. Stop; ask the owner which to
   keep. Migration 188 aborts on this rather than guessing.
2. Set the backend env (`RESEND_API_KEY`, optional `EMAIL_FROM`, optional `FIREBASE_PROJECT_ID`)
   and the frontend build env (`VITE_FIREBASE_*`, optional). All may be skipped (item 50 note above).
3. Apply **187 (if pending) and 188 only**, by hand with their tracking rows (the
   [DEPLOY_RUNBOOKS.md](./DEPLOY_RUNBOOKS.md) 147–149 lesson: do NOT let `migrate.sh` run 189
   before the rebuild). Each in one transaction:
   ```sql
   BEGIN;
   \i database/migrations/188-users-identity-channels-and-email-codes.sql
   INSERT INTO schema_migrations (version, name) VALUES (188, '188-users-identity-channels-and-email-codes.sql');
   COMMIT;
   ```
   Window between this step and step 4: the OLD code's register endpoint fails (it inserts no
   username). Sign-in and everything else keep working. Keep the window short.
4. Rebuild **both** containers (backend and frontend) per `/deploy`.
5. Run `migrate.sh`: it now applies **189** alone.
6. Verification (below).

## Verification

```sql
-- V1: every account has a username and is marked verified (expect 0, 0)
SELECT count(*) FILTER (WHERE username IS NULL), count(*) FILTER (WHERE email IS NOT NULL AND "emailVerifiedAt" IS NULL) FROM users;
-- V2: the column is gone (expect 0 rows)
SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'isPublic';
-- V3: the new table exists (expect 'email_codes')
SELECT to_regclass('email_codes');
-- V4: migrations applied (expect 189)
SELECT max(version) FROM schema_migrations;
```

HTTP (from the PPE box):
- `curl -s https://mren.me/api/auth/methods` → `{"email":true,"phone":<true if Firebase set>}`
- `curl -s "https://mren.me/api/auth/usernameAvailable?username=admin"` → `"available":false`
- `curl -s -o /dev/null -w "%{http_code}" -X POST https://mren.me/api/auth/phone/devSendCode` →
  **404** (the dev phone stand-in must not be mounted; anything else means the backend is not
  running with `NODE_ENV=production` — stop and fix that before anything else)

In the app (someone has to do these):
- **V5** A cold start signed out: the pawn drops, the circle opens onto the login screen.
- **V6** "Email me a code" to a real inbox arrives (check spam, too: it is the SPF/DKIM test),
  and completing sign-up lands on the Deck Tower.
- **V7** An existing account signs in with its password; a wrong password reads "Wrong email
  or password".
- **V8** The tester leaderboard shows usernames and no emails.

## If a check fails

- 188 aborts on the pre-check: fix the duplicate by hand (owner decides), re-run step 3.
- V6 fails with a 503: `RESEND_API_KEY` missing or the domain unverified; the backend log line
  starting `SignInService: email send failed` carries Resend's reason.
- V6 mail lands in spam: the DNS records are incomplete; check them in Resend's domain page.

## Rollback

- Code: redeploy the previous commit. Before 189 runs, the old code works against the
  188 schema except its register endpoint (username NOT NULL).
- Schema: 188 is additive except the NOT NULL drops and the lowercasing, which old code
  tolerates. After 189 the old code fails (it selects `isPublic`): restore with
  `ALTER TABLE users ADD COLUMN "isPublic" boolean DEFAULT true;` before rolling back code.

## Behaviour change to expect

- Everyone lands on the new login screen; old `/register` links redirect to it.
- Existing users keep their passwords and get a generated username (changeable in
  Settings → Account & security).
- Every streak is shown on the leaderboard (no private accounts).
- Sessions now last 180 days of inactivity (was 30).

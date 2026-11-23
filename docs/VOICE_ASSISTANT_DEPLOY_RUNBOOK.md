# Voice Assistant — deploy runbook

> ⚠️ **TEMPORARY.** Delete this file (and its row in [DEPLOY_RUNBOOKS.md](./DEPLOY_RUNBOOKS.md))
> once PPE is verified.
>
> **Status: NOT DEPLOYED** (written 2026-11-21).

The Voice Tutor ([VOICE_ASSISTANT.md](./VOICE_ASSISTANT.md)) ships **with its flag OFF**
(`FEATURE_FLAGS.voiceAssistant = false`, `server/contracts/featureFlags.ts`). The deploy is
standard `/deploy` with four things the diff does not make obvious:

1. **Migration 202** (`database/migrations/202-create-voice-sessions.sql`) — additive (two new
   tables). Safe for `migrate.sh` to auto-run before the rebuild. Old code never reads it.
2. **Two new backend packages** — `ws` and `@google-cloud/speech` (gRPC, pure JS; no native
   build on musl). `server/server.ts` IMPORTS `routes/voiceRoutes.ts` even with the flag off,
   so a backend built without them crashes at startup with `ERR_MODULE_NOT_FOUND`. A normal
   `docker compose … up --build` runs `npm ci` from the updated lockfile and is enough —
   just do not skip the backend rebuild.
3. **New env var `VOICE_AI_API_KEY`** on the backend (the repo-root `.env` on PPE — `docker-compose.ppe.yml` loads `env_file: ./.env`, not `server/.env`). Needed only when
   the flag is ON; without it the routes still mount but report the tutor unavailable.
4. **The app's first WebSocket** (`/api/voice/session`). Path: Cloudflare (HTTPS, Flexible) →
   frontend nginx :80 (`location /api` already sends `Upgrade`/`Connection`) → backend :5000.
   Only matters once the flag is ON, but verify it now (step V3) so a flip is a one-line change.

Also worth knowing: migrations **200 / 205** (the story-commonality pair; 205 was renumbered from 201) have their own runbook,
[STORY_COMMONALITY_DEPLOY_RUNBOOK.md](./STORY_COMMONALITY_DEPLOY_RUNBOOK.md), with a
contract step. 202 is independent of them and has no ordering constraint against either.

## Step order

1. Pull on PPE (rebase first if the PPE checkout is ahead — oracle cron commits land there).
2. Apply 202 by hand together with 200, 203 and 204 — the batch order is in the story runbook
   (STORY_COMMONALITY_DEPLOY_RUNBOOK.md § "Step order"); plain `migrate.sh` here would also apply
   the held-back 205.
3. Rebuild **both** containers via `/deploy`.
4. Run V1–V3 below.

## Verification

**V1 — tables exist** (expected: two rows)
```sql
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('voice_sessions', 'voice_turns') ORDER BY 1;
```

**V2 — backend started and the voice router is NOT mounted** (flag off). Expected `404`:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://mren.me/api/voice/usage
docker logs --since 10m cow-backend 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Server running"
```
A `401` here means the flag is ON in the deployed build; `ERR_MODULE_NOT_FOUND` means the
backend image was not rebuilt from the new lockfile (rebuild it).

**V3 — nginx forwards WebSocket upgrades on `/api`** (expected: both headers present):
```bash
docker exec cow-frontend sh -c 'grep -A12 "location /api" /etc/nginx/conf.d/default.conf' | grep -E "Upgrade|Connection"
```
If missing, add to the `/api` block in `nginx.conf`:
`proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection 'upgrade';`
and rebuild the frontend. Cloudflare proxies WebSockets by default (Network → WebSockets: On).

## Flipping the flag ON (later, owner's call)

1. Set `VOICE_AI_API_KEY` in PPE's repo-root `.env`; confirm the Speech-to-Text API is enabled on the
   Google project of `GOOGLE_APPLICATION_CREDENTIALS` (it was, 2026-11-18).
2. `voiceAssistant: true` in `server/contracts/featureFlags.ts`, commit, `/deploy` (both
   containers — the client inlines the flag).
3. Check: `curl -s https://mren.me/api/voice/usage` → `401` (mounted, wants auth). In the app:
   Menu → **Voice Tutor** → Start talking; the orb should go listening → thinking → speaking.
4. The daily cap is a placeholder (`DAILY_VOICE_SECONDS` = 30 min, `server/services/voice/voiceConfig.ts`);
   Q9 says measure cost per voice minute on PPE before real users.

## Rollback

Flag stays OFF → nothing user-visible changed. To remove entirely: revert the commit; the two
tables can stay (nothing reads them) or be dropped with
`DROP TABLE voice_turns; DROP TABLE voice_sessions;` plus `DELETE FROM schema_migrations WHERE version = 202;`.

## User-visible change

None while the flag is off.

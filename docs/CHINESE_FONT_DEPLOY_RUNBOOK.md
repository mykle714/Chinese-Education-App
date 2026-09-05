# TEMPORARY — Chinese typeface setting deploy runbook

**Delete this file once verified on prod.**
**Status: NOT YET DEPLOYED as of 2026-09-04.** Prod is current through migration 156.

Ships migration **157** (`users."chineseFont"`) plus the account setting that reads it.

---

## 1 · Why this cannot be a plain `/deploy`

**Migration 157 MUST be applied BEFORE the container rebuild.**

The shipped `UserDAL.findById` selects `"chineseFont"` **by name**:

```sql
SELECT id, email, name, ..., "showSegmentSpaces", "chineseFont", "arenaMessage", ...
FROM Users WHERE id = $1
```

Old schema + new code therefore 500s **every authenticated request**, not just the
settings page. This is the identical failure shape as migration 152
(`users."arenaMessage"`) and 156 (`study_challenges.taunts`) — see the CLAUDE.md deploy
log for both.

There is no held-back/contract half. 157 is expand-only, so old code against the NEW
schema is fine: it simply never selects or writes the column, and the DEFAULT keeps
every row valid. That makes the ordering one-directional and the rollback cheap.

---

## 2 · Step order

1. **Pull the code on prod, do NOT rebuild yet.**
   Run the standard divergence check first, including `git status --short` — prod's
   checkout carries real uncommitted work (the oracle cron lives there).
2. **Apply 157 alone:**
   ```bash
   cd database/deploy && ./migrate.sh --dry-run   # expect: only 157 pending
   ./migrate.sh
   ```
3. **Verify (§3) before rebuilding.** If the backfill check fails, STOP — see §4.
4. **Rebuild the containers** as `/deploy` normally does.
5. **Smoke-test** any authenticated page, then Settings → Display.

---

## 3 · Verification SQL

```sql
-- (a) Column exists, is NOT NULL, and defaults to the new-account face.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'chineseFont';
-- EXPECT exactly one row:
--   chineseFont | text | NO | '975-maru'::text

-- (b) EVERY pre-existing account was backfilled to the historical face.
SELECT "chineseFont", count(*) FROM users GROUP BY 1 ORDER BY 2 DESC;
-- EXPECT a SINGLE row: noto-sans-sc | <total user count>
--   Any '975-maru' row here means the UPDATE did not run, and existing
--   learners will see their Chinese text change typeface. See §4.

-- (c) Migration is recorded.
SELECT version, name FROM schema_migrations WHERE version = 157;
-- EXPECT one row.
```

After the rebuild, confirm the round trip (substitute a real token):

```bash
curl -s -X PUT https://<host>/api/users/displaySettings \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"chineseFont":"bogus-face"}'
# EXPECT 400: chineseFont must be one of: noto-sans-sc, lxgw-wenkai, xiaolai-sc,
#             yozai, 975-maru, maoken-zhuyuan
```

---

## 4 · When a check fails

**(b) returns any `975-maru` rows.** The `UPDATE users SET "chineseFont" =
'noto-sans-sc';` in the migration did not run, or new accounts were created between
the ALTER and the UPDATE. Safe to re-run by hand — it is idempotent and touches only
display:

```sql
UPDATE users SET "chineseFont" = 'noto-sans-sc' WHERE "chineseFont" = '975-maru';
```

Only do this **before** the rebuild. Afterwards you would be resetting the choice of
anyone who has since picked a face — check `updatedAt`/your deploy timestamp first.

**Every authenticated request 500s after the rebuild.** 157 did not apply. Apply it
now; no code rollback is needed, the errors stop as soon as the column exists.

---

## 5 · Rollback

Code-only rollback (redeploy the previous image) is safe and needs **no** DB change —
the column is simply ignored by older code.

Full rollback, if the column itself must go:

```sql
ALTER TABLE users DROP COLUMN IF EXISTS "chineseFont";
DELETE FROM schema_migrations WHERE version = 157;
```

Do this only **after** the old image is live, since the new code selects the column.

---

## 6 · User-visible behaviour to expect

* **Existing accounts: nothing changes.** They are pinned to `noto-sans-sc`, the face
  the app has always rendered.
* **New signups get `975-maru` (975 Maru SC)** — a rounded gothic. This is the first
  time a new account looks different from an old one; that is intended.
* **Settings → Display gains a "Chinese typeface" picker** (Chinese-language accounts
  only, same gate as the existing word-spacing switch). Six faces.
* **New third-party origin on the critical path:** five of the six faces load from
  `cdn.jsdelivr.net` (the `cn-fontsource` project). The existing nginx CSP
  (`default-src 'self' http: https: data: blob: 'unsafe-inline'`) already permits it —
  **no CSP change is needed** — but a jsDelivr outage now degrades typography for
  anyone not on Noto Sans SC. It degrades per-glyph to Noto Sans SC rather than to
  tofu, because `cjkFontStack()` keeps the default stack as a tail fallback.
* `/font-lab` is a dev-only page and is not linked from any menu.

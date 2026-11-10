# TEMPORARY — Deploy runbook: Night Market + Immersive World removal (migration 185)

> **Delete this file once PPE is verified.** Status: **DEPLOYED 2026-11-09** (`6a227da`; 185 + 186 via `migrate.sh`
> after the rebuild; checks 1–5 passed, check 6 awaits the first HH:01 tick). Written 2026-11-09.
> Note: 185 carries its own `BEGIN`/`COMMIT`, so `migrate.sh` printed two harmless
> "transaction in progress" warnings. Context: [ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md).

Why this needs a runbook even though it ships under the standard `/deploy`: it changes
the **systemd maintenance unit** (a cron change) and drops tables, and the order of those two
matters.

## What changes

| Piece | Change |
|---|---|
| Code | NM + IW routers, services, DAL, client routes and menu rows are gone. The minute-point increment no longer calls `grantUnlocks`. `UserDAL.findById` no longer selects `"isTemplateAuthor"`. |
| `database/cron/expire-stale-streaks.sql` | The occupant-decay CTEs and the `CREATE OR REPLACE FUNCTION nightmarket_unlocks_for_minutes` block are removed. The NOTICE line loses `decayed_unlocks=`. |
| `database/cron/cow-maintenance.service.template` | The middle `ExecStart` (`dist/scripts/night-market/prune-dangling-templates.js`) is removed. Study-challenge expiry becomes step 2. |
| Migration **185** | Drops the 8 NM/IW tables, `users."isTemplateAuthor"`, and `nightmarket_unlocks_for_minutes(int)`. |

## Step order

1. **Standard `/deploy`**: `git pull`, rebuild both containers, **then
   `bash database/cron/install-timers.sh`**. That step is already in the deploy skill. Here
   it is **required**, not just routine. The rebuilt backend image no longer contains
   `dist/scripts/night-market/`. The old unit's step 2 would then fail every hour, and
   because systemd aborts a oneshot unit on the first failing `ExecStart`, **study-challenge
   expiry would silently stop running**.
2. **Then apply migration 185** (auto-run is safe: the new code reads none of the dropped
   objects). Applying it **before** the new code is live would 500 every authenticated
   request, because the old `findById` names `"isTemplateAuthor"`.
   - Migration 184 (`drop-vocabentries-note`) may also be pending. Apply 184 before 185, in
     `sort -V` order as usual.

## Verification

```sql
-- 1. Tables gone — expect 0 rows
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND (table_name LIKE 'nightmarket%' OR table_name LIKE 'iw\_%');

-- 2. Column gone — expect 0 rows
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'users' AND column_name = 'isTemplateAuthor';

-- 3. Function gone — expect 0 rows (the new cron file no longer recreates it)
SELECT proname FROM pg_proc WHERE proname = 'nightmarket_unlocks_for_minutes';

-- 4. Migration recorded — expect one row
SELECT version, name FROM schema_migrations WHERE version = 185;
```

```bash
# 5. Unit has exactly two ExecStart lines, no prune step — expect 2, then no output
grep -c '^ExecStart=' ~/.config/systemd/user/cow-maintenance.service
grep night-market ~/.config/systemd/user/cow-maintenance.service

# 6. After the next HH:01 tick — expect status 0/SUCCESS, and a fresh study-challenges.log line
systemctl --user status cow-maintenance --no-pager | head -12
tail -3 ~/vocabulary-app/logs/streak-expire.log ~/vocabulary-app/logs/study-challenges.log
```

## When a check fails

- **Check 1/2 shows rows:** the migration did not run or did not record. Re-run the file;
  it is idempotent (`IF EXISTS` throughout).
- **Check 3 shows the function:** the old cron SQL ran after the migration, which means
  the `git pull` did not land. Confirm `grep -c nightmarket database/cron/expire-stale-streaks.sql`
  returns only the two comment lines, then drop the function by hand:
  `DROP FUNCTION IF EXISTS nightmarket_unlocks_for_minutes(int);`
- **Check 5 still shows the prune step:** `install-timers.sh` was skipped. Run it (no sudo).
- **Check 6 failed:** look at `journalctl --user -u cow-maintenance -n 50`.

## Rollback

The code rolls back by redeploying the previous commit. **The table drop is not
reversible.** The tables can be recreated empty from `archive/schema.sql` on the
`archive/night-market-immersive-world` branch, but their rows are gone. That data loss
was approved.

## User-visible changes

- The Menu popover no longer shows the Night Market, Immersive World, Template Editor,
  Template Sandbox or Scene Editor rows. Their flags were already OFF, so for everyone
  except template authors nothing visibly changes.
- A user profile no longer offers "Visit their night market" (already hidden by the flag).
- Feature testers (rather than template authors) now see the Beginner Keyboard's
  recognizer debug-dump button.
- The Usage dashboard loses its "Immersive World runs" row and the per-learner IW run count.

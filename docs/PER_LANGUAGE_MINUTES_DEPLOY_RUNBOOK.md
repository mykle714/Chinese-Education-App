# Deploy Runbook — Per-Language Minute Points & Night Market (migrations 133 → 136)

**TEMPORARY.** Delete this file once the change is live on prod and verified. It exists
only because this deploy has a step the standard `/deploy` flow does not handle.

**Status:** applied and verified on DEV. **Not yet deployed to prod.**

---

## ⚠️ The one nonstandard thing

`migrate.sh` applies every pending migration in a single pass. This change ships an
**expand/contract pair** that is only safe if the contract half lands *after* the new
server code is running:

| Migration | Role | Safe to run before the code deploy? |
|---|---|---|
| `133-add-lifetime-minutes-earned.sql` | expand — adds a counter to `users` | ✅ yes |
| `134-create-user-language-minute-totals.sql` | expand — creates + backfills the per-language table | ✅ yes |
| `135-drop-global-minute-counters.sql` | **contract — DROPS 5 `users` columns** | ❌ **NO** |
| `136-add-language-to-night-market.sql` | expand — adds `language` to the two market tables, backfills `'zh'`, widens two indexes | ✅ yes |

If 135 runs while the old code is still serving, **every minute-points request 500s**
until the new code restarts — the old code selects `users."totalMinutePoints"`,
`"currentStreak"`, `"lastStreakDate"`, `"lastPenaltyDate"`, `"lifetimeMinutesEarned"`
by name. On a single-box deploy that window is seconds, but it is a real outage window
and it is avoidable.

### Recommended order

```
1. Hold 135 back        — move it out of database/migrations/ before deploying:
                          mv database/migrations/135-drop-global-minute-counters.sql /tmp/
                          (Leave 136 in place — it is purely additive.)
2. Run the normal /deploy skill
                        — migrate.sh applies 133, 134, 136 (all additive, old code unaffected),
                          then the new code ships and restarts.
3. Verify (below)
4. Apply 135 manually:
     docker exec -i cow-postgres-prod psql -U <user> -d <db> < /tmp/135-drop-global-minute-counters.sql
5. Record it so migrate.sh does not re-run 133 later:
     INSERT INTO schema_migrations (version, name)
     VALUES (135, '135-drop-global-minute-counters.sql') ON CONFLICT DO NOTHING;
6. Move 135 back into database/migrations/ and commit that state.
```

**If you skip the hold-back** and let all three run in one pass, the deploy still ends in
a correct state — just accept a few seconds of 5xx on minute-points endpoints between the
migration and the restart. Decide deliberately; do not discover it in the logs.

> **Why step 5 matters.** `133` starts with `ALTER TABLE users ADD COLUMN IF NOT EXISTS
> "lifetimeMinutesEarned"`. If 135 is applied without being recorded in
> `schema_migrations`, a later `migrate.sh` run re-applies 133 and **resurrects the
> column 135 just dropped**. Harmless but confusing dead schema.

---

## Verify after step 2 (before dropping columns)

```sql
-- 1. Every user's per-language nets must sum to their old global net.
SELECT bool_and(s.sum_net = GREATEST(0, u."totalMinutePoints")) AS net_preserved
FROM (SELECT "userId", SUM("netMinutePoints") sum_net
      FROM user_language_minute_totals GROUP BY "userId") s
JOIN users u ON u.id = s."userId";

-- 2. Gross must never be below net.
SELECT bool_and("lifetimeMinutesEarned" >= "netMinutePoints") AS invariant_ok
FROM user_language_minute_totals;

-- 3. Gross must match the ledger exactly.
SELECT bool_and(t."lifetimeMinutesEarned" = l.g) AS gross_matches_ledger
FROM user_language_minute_totals t
JOIN (SELECT "userId", language, SUM("minutesEarned") g
      FROM userminutepoints GROUP BY 1,2) l
  ON l."userId" = t."userId" AND l.language = t.language;
```

All three must return `t`. If #1 fails, **stop** — do not run 135; the old columns are
still the only correct copy of the balances.

Then smoke-test the API (any real user token):

```
GET /api/users/minutePoints/summary?language=zh&tz=…&timestamp=…
GET /api/users/minutePoints/summary?language=es&tz=…&timestamp=…
```
Both must return `{totalMinutePoints, lifetimeMinutesEarned, todayMinutes, currentStreak}`
with **different** values per language (a never-studied language correctly returns all zeros).

## Verify after step 4

```sql
\d users                          -- the 5 columns must be gone
```
Then re-run the cron by hand once and confirm it completes and logs sanely:
```
psql … < database/cron/expire-stale-streaks.sql
```
Expect `BEGIN / DO / COMMIT`, plus a `NOTICE … languages={…}` line only if something was
actually penalized. The NOTICE now includes a `languages=` array — that field is new.

---

## Night Market becomes per-language (migration 136)

Every existing placement and occupant is backfilled to `'zh'`, so **no user's current market
changes**. A user who also studies Spanish gets an *empty* Spanish market that seeds its own
hub the first time they open it.

Two index changes are load-bearing, not cosmetic — verify they applied:

```sql
-- Must exist: per-MARKET corner uniqueness. Migration 112's UNIQUE (userId, offsetCol,
-- offsetRow) would make the second language's hub at (0,0) a hard 23505 and that market
-- could never start.
SELECT indexname FROM pg_indexes
WHERE tablename = 'nightmarkettemplatelocations'
  AND indexname IN ('idx_nmtl_user_language_corner', 'idx_nightmarkettemplatelocations_user_corner');
-- expect exactly: idx_nmtl_user_language_corner   (the old name must be GONE)
```

Smoke-test after deploy (any real token) — the second call must seed a fresh hub without
disturbing the first:
```
GET /api/nightMarket/layout?language=zh   → the user's existing market
GET /api/nightMarket/layout?language=es   → 1 placement: night-market-hub at (0,0)
GET /api/nightMarket/layout?language=zh   → unchanged from the first call
```

**Do NOT re-add a `(userId, assetId)` unique index on `nightmarketunlocks` in any form.**
Migration 114 dropped it because occupants share a generic assetId; re-adding it 23505s the
grant flow on the second occupant.

## The cron file changed — reinstall is NOT needed

`database/cron/expire-stale-streaks.sql` was rewritten for per-language penalties, but the
**filename and crontab entries are unchanged**, so `install-cron.sh` does not need to be
re-run. The prod crontab invokes the file by path; shipping the new contents is enough.

Confirm the deploy actually copied it (the prod box runs the file from the repo checkout):
```
grep -c user_language_minute_totals database/cron/expire-stale-streaks.sql   # expect > 0
```

## Behaviour changes to expect in prod

- **The daily threshold is now per language.** 3 minutes of zh advance the zh streak only;
  a user splitting 2 min zh + 2 min es now advances neither streak. Testers may report
  "my streak didn't go up".
- **Streaks reset for secondary languages.** Per-language streak history never existed, so
  the backfill carries the old global streak onto the one language that earned the user's
  most recent qualifying day; other languages start at 0.
- **Each language now grows its own market.** Entitlement is per (user, language): studying
  Spanish grows the Spanish market and leaves the Chinese one alone, and the penalty cron
  decays only the neglected language's market. Existing markets are untouched at migration
  (all backfilled to `'zh'`), so nobody gains or loses occupants on deploy day.

## Rollback

After 135 has run there is **no migration-based rollback** — 134's backfill reads the
dropped columns. Restore from a pre-deploy dump. Take one before step 4.

---

Related: [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md),
[STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)

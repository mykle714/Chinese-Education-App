# TEMPORARY — Deploy runbook: arena message (152) + card-fill repaint (153)

> **Delete this file once prod is verified.** It exists only because this deploy
> cannot be shipped by running `/deploy` as-is.
>
> **Status: NOT YET DEPLOYED as of 2026-08-22.** Do not trust this line — derive the
> real state from `schema_migrations` and a `migrate.sh --dry-run` (see CLAUDE.md's
> warning about stale runbook status lines).

## Why this is nonstandard

`/deploy`'s default block pulls, rebuilds the containers, then runs migrations. That
order is **wrong for migration 152**:

- **152 must land BEFORE the rebuild.** It adds `users."arenaMessage"`, and the shipped
  `UserDAL.findById` selects that column by name. `findById` is the core user lookup —
  on old schema + new code, essentially every authenticated request 500s, not just the
  arena. There is no both-versions-work window in that direction.
- **153 is order-independent.** It only remaps stored `vet."cardColor"` hexes. Old code
  renders the new hexes as raw CSS without re-validating on read, so it may run on
  either side of the rebuild. It is placed after for simplicity.

Neither migration is destructive and both are idempotent, so a re-run is safe.

## Step order

```bash
cd ~/vocabulary-app
sudo systemctl stop nginx   # only if host nginx is active — frees port 80
git pull origin main

# ── 1. BEFORE the rebuild: 152 (adds users."arenaMessage") ──────────────────
docker cp database/migrations/152-add-arena-message.sql cow-postgres-prod:/tmp/152-add-arena-message.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f /tmp/152-add-arena-message.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "INSERT INTO schema_migrations (version, name) VALUES (152, '152-add-arena-message.sql');"

# ── 2. Rebuild (brief downtime for real users) ──────────────────────────────
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d

# ── 3. Schedules — idempotent, safe every deploy ────────────────────────────
bash database/cron/install-timers.sh   # NO sudo

# ── 4. AFTER the rebuild: 153 (remaps stored card fills) ────────────────────
docker cp database/migrations/153-repaint-card-color-fills.sql cow-postgres-prod:/tmp/153-repaint-card-color-fills.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f /tmp/153-repaint-card-color-fills.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "INSERT INTO schema_migrations (version, name) VALUES (153, '153-repaint-card-color-fills.sql');"
```

## Verification (copy-pasteable, with expected results)

```bash
docker-compose -f docker-compose.prod.yml ps      # all prod containers Up
curl http://localhost/api/health                  # 200
```

```sql
-- Expect exactly rows 152 and 153, both with a recent applied_at.
SELECT version, name, applied_at FROM schema_migrations WHERE version >= 152 ORDER BY version;

-- Expect one row: arenaMessage | character varying | 80 | YES
SELECT column_name, data_type, character_maximum_length, is_nullable
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'arenaMessage';

-- Expect 0. Any row here is an un-remapped old fill that will render as the theme
-- default instead of the colour the learner picked.
SELECT count(*) FROM (
  SELECT "cardColor" FROM vocabentries_zh
  UNION ALL SELECT "cardColor" FROM vocabentries_es
) t WHERE "cardColor" IN ('#D8D8DC','#F2BAC9','#BAF2D8','#BAD7F2','#F2E2BA','#D8BAF2');
```

## When a check fails

- **152 errors on apply** — it is `ADD COLUMN IF NOT EXISTS` plus a guarded constraint,
  so the only realistic failure is an existing `arenaMessage` with a different type.
  Stop before the rebuild; the old containers are still serving and nothing is broken.
- **Rebuild comes up but auth requests 500** — 152 did not actually apply. Confirm with
  the `information_schema` query above, apply it, and restart the backend container.
- **The last query returns > 0** — 153 did not run (or ran before rows existed). It is
  idempotent; just re-run step 4's `psql -f`.

## Rollback

- Code: `git checkout <previous SHA>` and rebuild.
- 152: leave it. A nullable added column is inert for old code; dropping it is riskier
  than keeping it.
- 153: no automatic reverse. The mapping is 1:1 and disjoint, so it *can* be inverted by
  swapping old/new in the `VALUES` list, but there is no reason to — the old hexes are
  valid CSS and would simply render as the pre-repaint pastels.

## User-visible changes to expect

- Arena rows show a competitor's one-line message where the per-row progress meter used
  to be (`docs/ARENA_FEATURE.md` § 2.1a). ⚠️ The message is user-authored text shown to
  24 strangers and is **length-capped and sanitised, not moderated** — moderation is
  tracked in `docs/DEFERRED_WORK.md`.
- App-wide palette repaint: the pastel accent family moves to near-white tints. Flashcard
  fills chosen in the fie move with it; 153 is what keeps already-chosen fills pointing
  at the right swatch.

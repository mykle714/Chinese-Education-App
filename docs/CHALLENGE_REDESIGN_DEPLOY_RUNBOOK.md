# TEMPORARY — Challenge flow redesign deploy runbook

**Delete this file once prod is verified.**

**Status: APPLIED ON DEV (2026-09-01), NOT ON PROD.** Dev is at migration **156** and its
verification queries below all passed; prod is still at **155**. Derive the real state from
`schema_migrations` and `migrate.sh --dry-run` — per CLAUDE.md, this banner is not evidence.

⚠️ **Dev hit this runbook's own failure mode before the migration was applied**: the
containers were already running the new code, so every challenge read 500'd with
`column "taunts" does not exist` (the badge endpoint made it visible on the challenges
list). That is precisely the ordering hazard below — it is not hypothetical.

⚠️ **`migrate.sh` cannot run on the dev host**: `psql` is not installed there, only inside
`cow-postgres-local`, so step 1's `--dry-run` fails with `psql: command not found` before
doing anything. The equivalent, preserving `migrate.sh`'s one-transaction contract:

```bash
{ echo "BEGIN;"; cat database/migrations/156-add-challenge-taunts.sql; echo "";
  echo "INSERT INTO schema_migrations (version, name) VALUES (156, '156-add-challenge-taunts.sql');";
  echo "COMMIT;"; } | docker exec -i cow-postgres-local psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -q -f -
```

On prod use `migrate.sh` as written if `psql` is on the PATH there.

Covers the 2026-09-01 shelf-system redesign of Study Challenge
([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)). One migration, one ordering constraint,
one user-visible behaviour change worth warning about.

---

## Why this needs a runbook

**Migration 156 must be applied BEFORE the container rebuild.**

The column is additive with a default, so it is safe against the *old* code. The problem
is the other direction: the shipped `StudyChallengeService.toSummary` reads `row.taunts`,
and `StudyChallengeDAL`'s `ROW_COLUMNS` selects `taunts` **by name**. New code against
old schema fails on `SELECT ... taunts ...` — so *every* challenge read 500s, which is
the challenges page, the badge on the hp Friends row, the detail page and the history
page. This is the same failure shape as migration 152 (`users."arenaMessage"`), and the
same remedy: schema first, then rebuild.

There is no contract/DROP half, so nothing is held back after the rebuild.

---

## Step order

1. **Confirm what is pending.**
   ```bash
   cd /path/to/repo/server
   ./migrate.sh --dry-run
   ```
   Expect exactly `156-add-challenge-taunts.sql` (plus anything else genuinely pending).
   If 156 does not appear, stop and check `schema_migrations` before going further.

2. **Apply the migration — BEFORE the rebuild.**
   ```bash
   ./migrate.sh
   ```

3. **Verify the column (copy-paste, with the expected result).**
   ```sql
   SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'study_challenges' AND column_name = 'taunts';
   ```
   Expected — exactly one row:
   ```
    column_name | data_type | is_nullable |   column_default
   -------------+-----------+-------------+---------------------
    taunts      | jsonb     | NO          | '{}'::jsonb
   ```
   And every existing row backfilled by the default:
   ```sql
   SELECT count(*) AS total, count(*) FILTER (WHERE taunts = '{}'::jsonb) AS empty
     FROM study_challenges;
   ```
   Expected: `total = empty`. A non-empty taunt before the feature has shipped means
   something other than this deploy wrote to the column — stop and investigate.

   **If a check fails:** do not rebuild. The old containers keep working against the old
   schema, so the app stays up while you sort it out.

4. **Rebuild the containers** the usual way (`/deploy`).

5. **Verify end to end** — open `/friends/challenges` as a real account. The page
   loading at all is the meaningful check: it is the read path that would have 500'd on
   the wrong order.

No cron, systemd unit or backfill is involved.

---

## Rollback

**Code-only rollback is safe and sufficient.** Redeploy the previous image; the column
is additive and defaulted, so the old code ignores it entirely. Do **not** drop the
column as part of a rollback — a dropped column would then break a re-deploy of the new
code, and an empty jsonb costs nothing to leave in place.

If the column genuinely must go:
```sql
ALTER TABLE study_challenges DROP COLUMN taunts;
```
Only after the old image is running.

---

## User-visible behaviour changes to expect

These are intended, but they will look like bugs to anyone who has not read
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md):

1. **The opponent's rounds now appear as they are submitted** (§ 6). Previously nothing
   of theirs was visible until both players finished. Whoever plays second can now see
   the score they are chasing — a deliberate trade for making page 2 of View Challenge
   a real page rather than a four-day blank.
2. **Issuing / withdrawing / answering a challenge no longer navigates.** They open a
   sheet over the challenges list. The routes `/friends/challenges/new/:friendUserId`
   and `/friends/challenges/review/:challengeId` **no longer exist** — a bookmark or an
   open tab pointing at either will 404. Both were transient screens nobody would have
   bookmarked, so no redirect was added.
3. **The row pills are relabelled and recoloured** (§ 1): *Review words* →
   **Incoming Challenge** (green), *Waiting on them* → **Withdraw** (red — and it is now
   actionable, where it used to be inert), *Study deck* → **See Cards** (orange),
   *Play test* → **Take Test**.
4. **Striking a word takes two taps** — tap the card to select, then the pill to commit
   (§ 3.2). The always-visible *I know it* button under each card is gone.
5. **The between-round scoreboard is a full-screen dark board**, not a popup card
   (§ 5.5). Still non-minimizable; the exits are unchanged.

---

## Screenshots still outstanding (not a blocker)

The two stepped explainers (§ 5.4c) ship with **placeholder frames**: each step draws a
hatched panel captioned with what the shot should show. They are fully usable this way.
Filenames and descriptions are in `src/assets/challengeHelp/README.md`; dropping a file
in improves that step with no code change and no redeploy of anything else.

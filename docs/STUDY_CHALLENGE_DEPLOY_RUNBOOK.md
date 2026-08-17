# Study Challenge — Deploy Runbook

> **TEMPORARY.** Delete this file once prod is verified.
> **Deployed to prod yet? NO** (as of 2026-08-17).

**Audience:** the agent performing the production deploy. Read this end to end before
running anything. It covers only what is unusual about this change; the standard
procedure still comes from the `/deploy` skill.

Feature design: [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) (its status table says what is
built and what is not).

---

## 1. Why this needs a runbook

Three reasons, in descending order of how badly each bites if missed:

1. **A unit-template change is NOT rolled out by a git pull.** The feature's entire
   time-triggered half — invitations lapsing, windows closing, winners being declared —
   lives in an hourly `ExecStart` step. The rendered unit on prod is a *substituted*
   copy in `~/.config/systemd/user/`, so until `install-timers.sh` is re-run prod keeps
   executing the old two-step unit and **nothing about a challenge ever expires or
   resolves.** Every request-driven part of the feature works perfectly meanwhile, which
   is exactly what makes this easy to miss.
2. **Migration 148 must land before the new code starts.** It creates
   `study_challenges` and adds `decks."editMode"`; the shipped code selects `editMode`
   in every deck read (`DECK_COLS`), so the old schema + new code = a 500 on `/decks`.
3. **It is numbered 148, not 147.** 147 is the `compute_utcm_category` drop, which was
   written and applied to dev first. If prod is missing 147, `migrate.sh` applies both in
   order in one pass — that is fine and expected, but do not "fix" the gap.

## 2. What ships

| Artifact | Notes |
|---|---|
| `database/migrations/148-create-study-challenges.sql` | `study_challenges`; `decks."editMode"` + its CHECK; `decks_user_language_name_uniq` rebuilt **partial**; two `friendships` block booleans. Idempotent |
| Server | `StudyChallengeDAL`/`Service`/`Controller`, `studyChallengeRoutes`, DI in `dal/setup.ts`, `DeckService` preset guard, `StarterPacksService.ensureLibraryEntry`, `FriendshipDAL.setChallengesBlocked`, the unfriend hook in `FriendsService` |
| Contract | `server/contracts/wire.ts` — challenge constants, `CHALLENGE_GAMES`, `ProvisionMode`, scoring types |
| Shared | `server/shared/zonedTime.ts` (extracted), `server/shared/challengeWeek.ts`; `arenaWeek.ts` + `streakDay.ts` now import the extracted helpers |
| Client | `src/api/studyChallenges.ts`, `src/features/studyChallenge/*`, the Challenges button + badge on `/friends`, the fifth `/decks` section, preset-deck filtering in `AddToDeckMenu` / `CollectionViewPage` |
| Cron | `database/cron/expire-study-challenges.sql` + the third `ExecStart` and new `Description=` in `cow-maintenance.service.template` |

**Not shipping (and the feature is usable without it):** the scored round runner. The
games step is not built, so a player can issue, accept, study the deck and see the drawn
rounds, but cannot play a scored round. Every such challenge will resolve as
`no_contest` at its window close, which is correct behaviour, not a bug — see § 6.

## 3. Step order

1. **Pre-deploy dump of the two tables this touches structurally.** Cheap insurance;
   `decks` is the one that cannot be regenerated.
   ```bash
   pg_dump -U cow_user -d cow_db -t decks -t deck_cards -t friendships -Fc -f pre-148.dump
   ```
2. **`git pull`** on prod.
3. **Migrations.** 148 is safe to auto-run; nothing is held back.
   ```bash
   cd database/deploy && ./migrate.sh --dry-run     # confirm what is pending FIRST
   ./migrate.sh
   ```
   ⚠️ Derive pending work from this dry-run and `schema_migrations`, never from a status
   line in a doc (CLAUDE.md § Current open runbooks).
4. **Rebuild + restart** the backend and frontend containers, per `/deploy`.
5. **Re-render the systemd units — DO NOT SKIP.**
   ```bash
   ./database/cron/install-timers.sh
   systemctl --user status cow-maintenance --no-pager | head -5
   ```
   The `Description=` line is the tell: it must now read
   *"inactivity penalty + dangling-template prune + study-challenge expiry"*. If it still
   says only *"inactivity penalty + dangling-template prune"*, the old unit is still
   installed and step 5 did not take.
6. **Run the maintenance SQL once by hand**, rather than waiting up to an hour to find
   out whether it works:
   ```bash
   docker exec -i cow-postgres-prod psql -U cow_user -d cow_db \
     < database/cron/expire-study-challenges.sql
   ```
   Expect `BEGIN / DO / COMMIT` and no NOTICE lines on a prod with no challenges yet.
   Any error here means the SQL is running against a schema that lacks 148.

## 4. Verification SQL

Each block states the expected result. Run all of them.

**a. The table and its indexes exist.**
```sql
SELECT count(*) FROM information_schema.tables WHERE table_name = 'study_challenges';
-- expect: 1
SELECT indexname FROM pg_indexes WHERE tablename = 'study_challenges' ORDER BY 1;
-- expect 6: challengee_history_idx, challengee_idx, challenger_history_idx,
--           challenger_idx, live_status_idx, pair_week_uniq  (+ study_challenges_pkey)
```

**b. The deck name index really is PARTIAL.** This is the one schema change that fails
silently if the DROP ran and the CREATE did not — the symptom would be two challenge
decks against the same friend colliding on insert, weeks later.
```sql
SELECT indexdef FROM pg_indexes WHERE indexname = 'decks_user_language_name_uniq';
-- expect the definition to END WITH:  WHERE (("editMode")::text = 'custom'::text)
```

**c. `editMode` defaulted correctly for every existing deck.**
```sql
SELECT "editMode", count(*) FROM decks GROUP BY 1;
-- expect: custom | <all existing decks>.  ZERO rows with 'preset' on a fresh deploy.
```

**d. The friendship block flags exist and are false.**
```sql
SELECT count(*) FILTER (WHERE "requesterChallengesBlocked")
     + count(*) FILTER (WHERE "addresseeChallengesBlocked") AS blocked_count
  FROM friendships;
-- expect: 0
```

**e. The API is live** (401 proves the route is registered and guarded, not missing):
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/studyChallenges
# expect: 401
```

**f. `/decks` still works** — this is the read that breaks if 148 did not land before the
new code. Open the app's Decks page and confirm the user's decks render. A 500 here means
the code is selecting `editMode` from a table that lacks it: apply 148 and restart.

## 5. If a check fails

| Failure | What to do |
|---|---|
| `migrate.sh` halts on out-of-order | **Do not pass `--allow-out-of-order` reflexively.** Read what it names. If 147 is genuinely unapplied, this batch applying 147+148 in one pass is correct and the guard is about something else |
| Index in (b) is not partial | Re-run the two statements from 148 by hand; they are idempotent (`DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`) |
| `/decks` 500s | 148 did not land, or landed after the restart. Apply it, restart the backend |
| `Description=` unchanged after step 5 | The installer did not re-render. Check it ran as the right user (`--user` units) and that `install-timers.sh` is the renamed script (it installs both `cow-maintenance` and `cow-arena`) |
| SQL step 6 errors | Almost always a missing 148. Do not edit the SQL |

## 6. Behaviour to expect on prod

* **Nothing visible changes until someone has a friend.** The Challenges button appears
  on `/friends` for everyone, and its page shows the bare "No challenges yet." empty
  state until the viewer has a friend who studies the same language.
* **Every challenge issued before the games step ships will end `no_contest`.** Players
  can issue, accept, get their `vs <name>` deck and study it; they cannot play a scored
  round, so at window close neither side has three rounds and pass 2 correctly declares
  no contest. Nobody loses anything — the ten words stay in their library.
* **A `vs <name>` deck appears on `/decks`** in its own Challenges section, above the
  user's own decks, and cannot be renamed or deleted by them.
* **The 100-deck cap now counts authored decks only**, so a user at 100 who accepts a
  challenge still gets their challenge deck.
* **Unfriending someone ends any live challenge with them** (`no_contest`, both decks
  dropped) in the same transaction as the unfriend.

## 7. Rollback

The code is safely revertible; the migration is not worth reverting.

* **Code:** revert the commit and rebuild. The old code does not read `study_challenges`
  and does not select `editMode`, so it runs happily against the new schema — **except**
  `decks_user_language_name_uniq` is now partial. That is harmless for old code (it only
  ever created `custom` decks, which the partial index still constrains).
* **Schema:** leave 148 in place. Dropping `study_challenges` would destroy any challenge
  history already created, and restoring the full (non-partial) name index would fail if
  two preset decks already share a name. If you truly must, drop in this order:
  `DROP INDEX decks_user_language_name_uniq;` → recreate it non-partial → `ALTER TABLE
  decks DROP COLUMN "editMode";` → `DROP TABLE study_challenges;` → drop the two
  `friendships` columns — and delete every `editMode = 'preset'` deck first.
* **Cron:** revert the template and re-run `install-timers.sh`. Removing the third
  `ExecStart` is enough; the SQL file can stay on disk unreferenced.

# ⏳ TEMPORARY — Gloss Confusability phase 2 **half B** (runtime guard), prod deploy runbook

**Delete this file once prod is verified.**

**Status: DEPLOYED 2026-08-24.** Prod rebuilt from `cac71c1`; the § 2 state is now
**2a = 4 / 2b = 7647 — "Phase 2 ON"** (2a was `0` before). Health 200, all three containers
healthy, no errors in the backend log after restart. Nothing was pending in
`schema_migrations` (max 154, highest file 154), so the guard was the only code change in
the rebuild.

**Remaining before deletion:** the § 4 behavioural check — open a real game board and
confirm it fills rather than coming back short. That is the one over-blocking symptom the
infrastructure checks cannot see. Once someone has done that, delete this file and record
the retirement in CLAUDE.md.

> Derive state from the checks in § 2, not from this banner. If they disagree, the banner is
> the stale one — that is the standing rule in CLAUDE.md and it has caught five runbooks.

Owner doc: [GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md) § 6.
Half A (the data) shipped 2026-08-24 — see
[GLOSS_CONFUSABILITY_DEPLOY_RUNBOOK.md](./GLOSS_CONFUSABILITY_DEPLOY_RUNBOOK.md).

---

## 0. What makes this deploy different from half A

Half A was inert by construction: it wrote rows nothing read. **This one changes what
learners see**, and it does so the moment the containers restart — there is no feature
flag, no gradual rollout, and no separate "enable" step.

| | Half A (shipped) | **Half B (this runbook)** |
| --- | --- | --- |
| What ships | rows in `gloss_meaning_groups` | the code that reads them |
| Migration | 154 | **none** |
| User-visible change | none | **yes — game boards change** |
| How it goes live | the push itself | **the container rebuild** |

**There is no migration in this deploy.** Nothing to hold back, nothing to order around the
rebuild, no `schema_migrations` row to insert. If `migrate.sh --dry-run` reports pending
work, something else is riding along — stop and find out what.

---

## 1. What the guard actually does

Two chokepoints in `server/services/OnDeckVocabService.ts`, both marked
`PHASE 2 NEAR-MISS GUARD`:

- `getGameVocabPool` — every game that draws a vocab pool
- `getWordSearchGrid` — Word Search builds its grid separately

`fetchGroupIds` batch-resolves each candidate's `ddCollisionKey` to its precomputed
`meaningGroupId`, and the draw loop walks `takenGroups` alongside the existing `takenDds`.
Two cards in the same meaning group can no longer land on one board.

Three properties worth knowing before you ship it:

1. **A missing key imposes no constraint.** A gloss with no row is absent from the map and
   never blocks. This is why half A was safe alone, and it is also the rollback (§ 5).
2. **The guard is HARD except where lending cannot run.** `groupGuardHard = !opts.collection
   && mayLend`. A collection-restricted round and a non-rolling partial refill have no
   fallback to grow into, so they admit a same-group card rather than come back short.
   Exact-dd collisions stay hard in **both** cases — identical strings always collide.
3. **Memory Map is out of scope by design** and keeps phase-1 exact-dd only, because
   placements are durable and a re-cluster would act retroactively. Verified: no
   `meaningGroupId` / `gloss_meaning_groups` references anywhere in Memory Map code. If a
   future change adds one, that is a bug, not an improvement.

---

## 2. Pre-flight (answers "is it already on?")

The § 0 requirement from half A's runbook was to make **"phase 2 off"** distinguishable
from **"phase 2 on and finding nothing."** Two independent reads settle it — run both:

```bash
# 2a. Is the guard in the RUNNING container? (code half)
ssh -i ~/.ssh/id_ed25519_cow_prod michael@174.127.171.187 \
  'docker exec cow-backend-prod grep -c fetchGroupIds dist/services/OnDeckVocabService.js'
```

```bash
# 2b. Are there rows for it to act on? (data half)
ssh -i ~/.ssh/id_ed25519_cow_prod michael@174.127.171.187 \
  'docker exec cow-postgres-prod psql -U cow_user -d cow_db -tAc "SELECT count(*) FROM gloss_meaning_groups;"'
```

| 2a (code) | 2b (rows) | State |
| --- | --- | --- |
| `0` | 7647 | **Not deployed** — this runbook's starting state |
| ≥1 | 7647 | **Phase 2 ON** — deploy succeeded |
| ≥1 | `0` | **Rolled back** (§ 5) — guard live but inert |
| `0` | `0` | Neither half shipped |

"On and finding nothing" is not a real state to worry about: **4315 of 7647 keys sit in a
non-singleton group**, so the constraint has abundant material. If boards look unchanged
with 2a ≥ 1 and 2b = 7647, that is coincidence of draw, not a broken deploy.

---

## 3. Step order

Plain deploy. No migration, no held-back file, no split around the rebuild.

```bash
ssh -i ~/.ssh/id_ed25519_cow_prod michael@174.127.171.187
cd ~/vocabulary-app
git pull origin main
bash database/deploy/migrate.sh --dry-run     # EXPECT: nothing pending
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d
```

⚠️ **`down`/`up --build` takes the live site down for real users.** Confirm before running
it unless the user has already said to proceed. **Never** add `-v` — it destroys
`cow-prod_postgres_data` and all real user data.

---

## 4. Verification

```bash
# 4a. Guard is in the running container (expect ≥1; it is 0 before this deploy)
docker exec cow-backend-prod grep -c fetchGroupIds dist/services/OnDeckVocabService.js

# 4b. Data still intact — the rebuild must not have touched it (expect 7647)
docker exec cow-postgres-prod psql -U cow_user -d cow_db -tAc \
  'SELECT count(*) FROM gloss_meaning_groups;'

# 4c. App is healthy (expect 200)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/health

# 4d. Containers are up and healthy
docker-compose -f docker-compose.prod.yml ps
```

Then exercise one real board — open a game and confirm it still fills. The failure mode
that matters is **a board coming back short**: if the guard over-blocks, a round has fewer
cards than its baseline rather than crashing. Games cannot block on card count
(`CARD_BASELINES` + provisional lending, docs/PROVISIONAL_CARDS.md), so a short board is a
quiet symptom, not an error page. Check the backend log for lending that suddenly spikes.

---

## 5. When a check fails

| Failure | Do this |
| --- | --- |
| 4a returns `0` after the rebuild | The image did not rebuild from the new checkout. Confirm `git log -1` on prod is at/after `b5e2198`, then `up --build` again (a plain `up` reuses the old image). |
| 4b is not 7647 | Do **not** re-run half A blindly. Read `SELECT count(*), count(DISTINCT "meaningGroupId") FROM gloss_meaning_groups;` and compare against the half-A runbook before deciding; the rebuild has no business changing this. |
| Boards come back short / lending spikes | Roll back (§ 5). This is the over-blocking case and it is exactly what rollback is for. |
| 4c not 200 | Ordinary deploy failure, unrelated to this feature — `docker-compose logs cow-backend-prod`. |

---

## 6. Rollback

```sql
TRUNCATE gloss_meaning_groups;
```

Still the whole rollback, still no code change and no redeploy — § 1 property 1 means the
guard finds no group ids and degrades to phase-1 exact-dd behaviour.

⚠️ **Unlike half A, this now turns a live feature OFF rather than reverting an inert
table.** After truncating, the state is 2a ≥ 1 / 2b = `0` in the § 2 table — "rolled back",
which is deliberately distinguishable from "never deployed" (2a = `0`). Say which one you
are in when you hand off, because the two look identical from the app.

Nothing is lost: the rows are a pure function of (det corpus, model revision, template
version, thresholds), and rebuilding them is one GPU run on dev plus `/gloss-groups-push`.
To revert the **code** instead, redeploy a container built from `03a8ea4` — but prefer the
truncate, which is faster and has no rebuild window.

---

## 7. User-visible behaviour change to expect

**Near-identical glosses stop sharing a board.** Two cards meaning "a little" and "a bit"
will no longer appear in the same round, the same way exact duplicates already don't. This
affects every game drawing through `getGameVocabPool`, plus Word Search.

Not affected: Memory Map (§ 1 property 3), det data, mastery, scoring, minute points, and
any round that is collection-restricted or a non-rolling partial refill (§ 1 property 2,
where the guard deliberately yields rather than return a short board).

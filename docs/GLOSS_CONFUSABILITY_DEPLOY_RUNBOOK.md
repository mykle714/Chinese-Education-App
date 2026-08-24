# ⏳ TEMPORARY — Gloss Confusability phase 2, prod deploy runbook

**Delete this file once prod is verified.**

**Status: HALF A DEPLOYED AND VERIFIED 2026-08-24.** Migration 154 is applied on prod
(`max(version)` = 154) and `push-groups.ts` has been run: prod `gloss_meaning_groups` went
0 → **7647 rows / 5076 groups**, snapshot `zh+es-discoverable-5481rows-7647keys`. All four
§ 4 checks passed (4a one provenance row; 4b `broken = f` on all four contrast pairs; 4c
0 oversized groups; 4d `a little`/`a bit`/`a little bit`/`somewhat` all group 44).
Gold set at push time: recall 8/9 (89%), **must-NOT-block wrong 0/17 (0%)**.

**This runbook is now finished — it may be deleted.** What it does NOT cover is half B:
the runtime guard exists in the repo (`OnDeckVocabService` → `fetchGroupIds` /
`glossKeyToGroup`, commit `b5e2198`) but is **NOT in the running prod container**, which
was built before that commit. Phase 2 is therefore still inert on prod: the rows are there,
nothing reads them. **The next prod container rebuild turns phase 2 on** — that rebuild is
half B's deploy and needs its own runbook, per § 0.

> Derive pending work from `schema_migrations` and `migrate.sh --dry-run`, not from this
> line. If they disagree with this banner, **this banner is the stale one** — that is the
> standing rule in CLAUDE.md and it has caught four runbooks already.

Owner doc: [GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md).

---

## 0. Read this before anything else — there are TWO deploys, not one

The phase-2 work splits cleanly in half, and **only the first half exists today**:

| Half | State | What it does on prod |
| --- | --- | --- |
| **A — the data** (migration 154 + the pushed groups) | **Ready now** | **Nothing user-visible.** Creates a table and fills it. No code reads it. |
| **B — the runtime guard** (§ 6, the three chokepoints) | **NOT BUILT** | This is the half that changes what learners see. |

**Deploy A on its own and no behaviour changes at all.** That is by design, not an
oversight — § 6 rule 1 says *a gloss with no group id imposes no constraint*, and the
current code never asks for a group id in the first place. Shipping A early is still
worth doing: it de-risks B into a pure code deploy with no data step attached.

**Do not write a step into this runbook for B.** When B is built it needs its own runbook,
because it is the step that can regress gameplay, and it will need a rollback path that
this one does not (see § 6 below).

---

## 1. Pre-flight (on the dev box)

Run these **before** touching prod. Every one is a read.

```bash
cd /home/cow/server/scripts/gloss-pipeline

# 1a. The dev table is built, non-empty, and internally consistent.
docker exec cow-postgres-local psql -U cow_user -d cow_db -c '
  SELECT count(*) AS rows,
         count(DISTINCT "meaningGroupId") AS groups,
         count(DISTINCT "corpusSnapshot") AS snapshots,
         min("builtAt") AS built
    FROM gloss_meaning_groups;'
```

**Expected:** `rows` 7647, `groups` 5076, **`snapshots` = 1**.

`snapshots > 1` means the build was interrupted or two builds were merged. **Stop** and
re-run `cluster.py`; `push-groups.ts` will refuse this anyway, but find out here rather
than mid-deploy.

```bash
# 1b. The gold-set rates § 7 requires be recorded on EVERY push.
~/.venvs/gloss-pipeline/bin/python validate.py
```

**Expected from `validate.py`:** `must-block recall 8/9 (89%)`,
`must-NOT-block wrong 0/17 (0%)`, and a `group size distribution:` line whose largest
bucket is 11.

Note that `cannot-link violations after clustering: 0` and `size alarm: clear` are printed
by **`cluster.py`** at build time, not by `validate.py` — read them off the build log of the
run that produced the snapshot you are about to push, not off this step.

**The number that matters is `must-NOT-block wrong`.** Recall slipping means a missed
suppression — invisible, harmless. Wrong-block rising means the runtime will refuse to
show two cards that mean *different* things, which is a gameplay regression. **If it is
not 0, do not push.**

Record all three numbers plus the `corpusSnapshot` in the deploy notes. § 7 asks for this
because a rate is only interpretable against the previous rate.

```bash
# 1c. Dry run — reads dev, does not contact prod.
cd /home/cow/server && npx tsx scripts/gloss-pipeline/push-groups.ts --dry-run
```

**Expected:** `dev gloss_meaning_groups: 7647 rows, 5076 groups`, one provenance line,
then `--dry-run: prod not contacted, nothing written`.

---

## 2. Step order

**154 is order-independent.** It creates an empty table that no shipped code reads, so it
is safe before or after the container rebuild, and safe to leave sitting for weeks. This is
the easy case — unlike 152, where old schema + new code 500s every authenticated request.

1. **Apply migration 154** — plain `migrate.sh`, no special handling, no held-back file.
2. **Rebuild containers** — or don't. Nothing in this deploy needs new code. If 154 is
   riding along with an unrelated deploy, its position in that batch does not matter.
3. **Push the groups** (§ 3). This can be minutes or days after step 1.

There is **no expand/contract pair here** and nothing to split around the rebuild.

---

## 3. The push

`push-groups.ts` is the **only** writer of prod's copy of this table, and the only script
in the repo that writes prod from dev. It names exactly one table.

```bash
cd /home/cow/server
PROD_DB_HOST=<host> PROD_DB_PASSWORD=<password> \
  npx tsx scripts/gloss-pipeline/push-groups.ts
```

Get the host/password the same way `/deploy` does. **`PROD_*` variables only** — the script
refuses to fall back to the dev config, so a missing variable fails loudly instead of
silently pushing dev's table onto itself.

The write is `TRUNCATE` + batched `INSERT` **in one transaction**, so readers keep seeing
the previous snapshot until commit. It verifies the row count after committing and throws
on a mismatch.

---

## 4. Verification SQL (run against PROD)

```sql
-- 4a. Provenance: exactly one build, and it is the one you just pushed.
SELECT "modelRevision", "templateVersion", "corpusSnapshot",
       count(*) AS rows, count(DISTINCT "meaningGroupId") AS groups
  FROM gloss_meaning_groups
 GROUP BY 1, 2, 3;
```
**Expect ONE row:** `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli` | `v1` |
`zh+es-discoverable-5481rows-7647keys` | 7647 | 5076.
More than one row ⇒ the truncate did not take. Re-run the push.

```sql
-- 4b. The § 8g contrast properties survived the wire. These must be DIFFERENT ids.
SELECT a."glossKey", a."meaningGroupId", b."glossKey", b."meaningGroupId",
       (a."meaningGroupId" = b."meaningGroupId") AS BROKEN
  FROM gloss_meaning_groups a, gloss_meaning_groups b
 WHERE (a."glossKey", b."glossKey") IN
       (('big','small'), ('to buy','to sell'), ('to come','to go'), ('hot','cold'));
```
**Expect `broken = false` on every row.** A `true` here means the push corrupted the
grouping — that should be impossible (the ids are copied verbatim), so treat it as
evidence the wrong build was pushed.

```sql
-- 4c. The size alarm, re-derived on prod. Nothing should exceed 12 (§ 10 Q8).
SELECT "meaningGroupId", count(*) AS n
  FROM gloss_meaning_groups GROUP BY 1 HAVING count(*) > 12 ORDER BY n DESC;
```
**Expect 0 rows.** The largest real group is 11.

```sql
-- 4d. Sanity: the intended block actually holds.
SELECT "glossKey", "meaningGroupId" FROM gloss_meaning_groups
 WHERE "glossKey" IN ('a little', 'a bit', 'a little bit', 'somewhat') ORDER BY 2, 1;
```
**Expect all four to share one id.** (`not very` shares it too — known and accepted, see
§ 8k. It is the § 8i liberal-rule cost, and it is why 4c is load-bearing.)

---

## 5. When a check fails

| Failure | Do this |
| --- | --- |
| 1a shows `snapshots > 1` | Re-run `cluster.py` on dev. Do not push. |
| 1b `must-NOT-block wrong` > 0 | **Do not push.** Investigate on dev; a wrong-block is a gameplay regression, and there is no hurry — prod is unaffected either way. |
| Push throws mid-write | Nothing was committed; the transaction rolled back. Prod still holds the previous snapshot (or is still empty). Fix and re-run. |
| 4a shows >1 provenance | Re-run the push. If it persists, `TRUNCATE` and push again. |
| 4c shows an oversized group | Not a deploy failure — the alarm is doing its job. Leave the data in place (harmless while B is unbuilt) and take it to § 10 Q8. |

---

## 6. Rollback

```sql
TRUNCATE gloss_meaning_groups;
```

That is the whole rollback. With the table empty, § 6 rule 1 degrades the app to phase-1
exact-dd behaviour **with no code change and no redeploy**. `DROP TABLE` also works and is
only needed if you are reverting migration 154 itself.

**Nothing is lost by rolling back.** The contents are derived — a pure function of
(det corpus, model revision, template version, thresholds) — and rebuilding them costs one
GPU run on dev (~18 min, § 7). No user data lives here, and prod never authors a row.

⚠️ **Once half B ships, this rollback stops being free-of-charge in the same way.** It will
still be correct and still require no code change, but it silently turns the feature off
rather than reverting a change — so B's own runbook must say how to tell "phase 2 is off"
from "phase 2 is on and finding nothing."

---

## 7. User-visible behaviour change to expect

**From this deploy: none.** Not "subtle" — *none*. No shipped code path reads
`gloss_meaning_groups`; verified with
`grep -rn "meaningGroupId\|gloss_meaning_groups" server/services server/dal server/controllers src/`
returning nothing.

Separately, and **not** part of this deploy: the `stripParentheses` nesting fix (§ 8l)
rides along with any container rebuild and changes the displayed definition of 27
discoverable glosses — 21 Spanish, including `perro` (`dog, domesticated for thousands of
years and…)` → `dog`) and zh 的 / 加. That is a display fix in ordinary app code, needs no
migration, and needs no step here. It is called out only so the change is not a surprise
when someone notices their flashcards read differently after the deploy.

---

## 8. Do NOT do these

- ❌ **Do not add `gloss_meaning_groups` to `/data-prod-to-dev`.** Its source of truth is
  DEV — the only table in the app that inverts the rule. Pulling it down overwrites dev's
  freshly computed groups with prod's copy of what dev just sent up, and the loop is
  silent. The skill file already carries a ⛔ note; leave it there.
- ❌ **Do not create `gloss_vectors` / `gloss_pair_verdicts` on prod.** They are build
  caches, deliberately not migrations (`dev-tables.sql`). Prod runs no model, stores no
  vector, and needs no GPU.
- ❌ **Do not hand-edit rows on prod.** The table is replaced wholesale; an edit is
  overwritten by the next push and invalidates the provenance stamp meanwhile.
- ❌ **Do not push a build whose `corpusSnapshot` you cannot tie to a `validate.py` run.**
  The stamp is the only thread from a grouping on prod back to the evidence for it.

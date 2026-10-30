# Cluster v11 (over-compaction fix) — deploy runbook

> **TEMPORARY — delete once verified on PPE.** Status: **steps 1–2 DONE on PPE 2026-10-30** (re-stamped AFTER the pull via `restamp-cluster-version.js` through `run-ppe.sh`, before the next oracle tick — same predicate; result v11 28,210 / v10 93 / v9 1; `check-manifest-sync.js` ✅; 0 `selectedSense` on flagged words). **Step 3 heals pending a user decision.**
> Background: [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) § "Over-compaction: the translation test".

## What ships

- `chinese/backfill-cluster-definitions.js` **SCRIPT_VERSION 10 → 11** and its manifest entry
  (`shared/lib/requiredScripts.js`) — the translation-test prompt.
- `spanish/backfill-cluster-definitions.js` **SCRIPT_VERSION 4 → 5** + manifest — same rule, plus
  `max_tokens` 2000 → 4096. **No es data action**: every discoverable es row on PPE is already
  stamped v1/v3 (pending since the v4 bump); the user chose to leave es as it is.
- `shared/restamp-cluster-version.js` + `shared/cluster-overcompaction-2026-10-29.json` (93 zh /
  21 es headwords flagged by the audit).
- No migration. No container rebuild is needed for the data step.

## Why this is nonstandard

A version bump makes every row stamped below it pending, so the first oracle-cron tick after a
plain deploy would re-cluster all ~28k discoverable zh rows — minting new sense labels and
orphaning est `senseDict` tags and breakdown pointers corpus-wide. Only the flagged rows may
re-cluster. The user decided (2026-10-30) to re-stamp PPE's ~15.7k zh rows that the dev audit
never reviewed as well, unreviewed.

## Steps (in this order)

### 1. BEFORE pulling the code — re-stamp the unflagged zh rows (PPE)

Safe under the OLD code: v11 ≥ the old manifest's 10, so nothing becomes pending. Same
predicate as `restamp-cluster-version.js` (discoverable, stamped at exactly 10, not a flagged
headword; keeps `ranAt`, records `restampedFrom`).

```sql
-- preview: expect ~28.2k to move, ≤ 93 held back
SELECT (word1 = ANY('{一下子,一些,一分为二,上万,上心,上课,下世,下来,不会,不可,东家,中中,中间,为,主意,主打,之下,之中,二者,人物,以,以期,会,作为,信义区,像,先,全场,八字形,公,关,内核,出马,分,分发,分量,加重,发达,号,同化作用,和,哪些,哪儿,回报,地方,城关区,士,外传,失,头,如,学,实,对,小儿科,工夫,差,开,开尔文,开门,怎么,意见,成绩,房子,接,方,无,早,正音,比方,海口,海州区,满盘,生,管,约会,经,给,翻译,能,见,解,过,连动,通知单,铁西区,错,门,面,风声,餐厅,香精,龙门山}'::text[])) AS held_back, count(*)
  FROM dictionaryentries_zh
 WHERE discoverable AND ("enrichmentLog" #>> '{chinese/backfill-cluster-definitions,version}')::int = 10
 GROUP BY 1;

UPDATE dictionaryentries_zh
   SET "enrichmentLog" = jsonb_set("enrichmentLog", '{chinese/backfill-cluster-definitions}',
         ("enrichmentLog" -> 'chinese/backfill-cluster-definitions') || '{"version": 11, "restampedFrom": 10}'::jsonb)
 WHERE discoverable
   AND ("enrichmentLog" #>> '{chinese/backfill-cluster-definitions,version}')::int = 10
   AND NOT (word1 = ANY('{一下子,一些,一分为二,上万,上心,上课,下世,下来,不会,不可,东家,中中,中间,为,主意,主打,之下,之中,二者,人物,以,以期,会,作为,信义区,像,先,全场,八字形,公,关,内核,出马,分,分发,分量,加重,发达,号,同化作用,和,哪些,哪儿,回报,地方,城关区,士,外传,失,头,如,学,实,对,小儿科,工夫,差,开,开尔文,开门,怎么,意见,成绩,房子,接,方,无,早,正音,比方,海口,海州区,满盘,生,管,约会,经,给,翻译,能,见,解,过,连动,通知单,铁西区,错,门,面,风声,餐厅,香精,龙门山}'::text[]));
```

Verify (expected: v11 = the moved count, v10 = only flagged headwords, v9 = 1):

```sql
SELECT "enrichmentLog"->'chinese/backfill-cluster-definitions'->>'version' v, count(*)
  FROM dictionaryentries_zh WHERE discoverable GROUP BY 1 ORDER BY 1;
```

If v10 still holds rows whose word1 is NOT in the list, the UPDATE did not run — re-run it.

### 2. Deploy the code with `/deploy`

Then `check-manifest-sync.js` must pass (the oracle cron runs it as a preflight and aborts on drift).

### 3. Let the oracle cron re-cluster the flagged rows

The ≤ 93 held-back rows are now pending at v11 and re-cluster on the next ticks. Each
re-clustered row mints new sense labels:
- **breakdown pointers** on compounds using these characters — the `breakdownSenseOrphan`
  drift probe re-queues `backfill-breakdown-senses` for them automatically. On dev the same
  re-run orphaned **2,011** pointers (1,888 compounds).
- **est `senseDict` tags** in OTHER words' sentences — NOT healed automatically. Dev: **+4,882**
  newly orphaned (3,216 were already orphaned before). Heal per segment with
  `backfill-example-sentences.js --retag-segment=<word>` (one tagger call per sentence — ask the
  user before running; it is thousands of calls for 一些/会/能/开/给).
- each row's own `longDefinition` and est `sense` tags — re-run those steps for the flagged
  words (ask the user first).

## Rollback

Step 1 is reversible (only rows it moved carry `restampedFrom`):

```sql
UPDATE dictionaryentries_zh
   SET "enrichmentLog" = jsonb_set("enrichmentLog", '{chinese/backfill-cluster-definitions}',
         ("enrichmentLog" -> 'chinese/backfill-cluster-definitions') - 'restampedFrom'
           || jsonb_build_object('version', ("enrichmentLog" #>> '{chinese/backfill-cluster-definitions,restampedFrom}')::int))
 WHERE "enrichmentLog" -> 'chinese/backfill-cluster-definitions' ? 'restampedFrom';
```

Re-clustered rows cannot be rolled back from the cron; dev keeps a pre-run copy of the 114 rows'
clusters only in a session scratchpad, so take a dump of `definitionClusters` for the listed
words before step 2 if a rollback path is wanted.

## User-visible change

Flagged words show more, narrower senses in the sense picker (开: open / turn on / operate /
write out / boil). Learners had no `selectedSense` on any flagged word on dev at audit time —
re-check on PPE before step 3:
`SELECT count(*) FROM vocabentries_zh WHERE "selectedSense" IS NOT NULL AND "entryKey" = ANY('{一下子,一些,一分为二,上万,上心,上课,下世,下来,不会,不可,东家,中中,中间,为,主意,主打,之下,之中,二者,人物,以,以期,会,作为,信义区,像,先,全场,八字形,公,关,内核,出马,分,分发,分量,加重,发达,号,同化作用,和,哪些,哪儿,回报,地方,城关区,士,外传,失,头,如,学,实,对,小儿科,工夫,差,开,开尔文,开门,怎么,意见,成绩,房子,接,方,无,早,正音,比方,海口,海州区,满盘,生,管,约会,经,给,翻译,能,见,解,过,连动,通知单,铁西区,错,门,面,风声,餐厅,香精,龙门山}'::text[]);`

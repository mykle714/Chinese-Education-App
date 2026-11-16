# Private component U+E000 (two-dot ⺼) — deploy runbook

> **TEMPORARY.** Delete this file (and its row in [DEPLOY_RUNBOOKS.md](./DEPLOY_RUNBOOKS.md))
> once PPE is verified.
>
> **Status: NOT DEPLOYED.** Code and assets are on dev (uncommitted as of 2026-11-15).
> Dev's eight rows were rewritten directly so the bundled assets could be built from them.

## What ships

- **Pipeline change** — `server/scripts/backfill/chinese/lib/decompose.js` →
  `WRITTEN_FORM_OVERRIDES`: the ⺼ at the top-left of 然 / 祭 and the 月 at the top of 炙
  are stored as the private-use component **U+E000** (夕 with a second dot), defined in
  `server/contracts/privateComponents.ts`. Spec: docs/BEGINNER_KEYBOARD.md § 6z-15.
- **Client** — the outline renderer moved to `src/components/handwriting/ComponentGlyph.tsx`
  and now also draws Word Search's No Pinyin hint row; regenerated
  `src/assets/handwriting/glyph-lookup.bin`, `glyph-words.bin`, `glyph-templates.bin`.
- **No migration.** No new column; `dictionaryentries_zh.components` gains a new VALUE.

## Why a runbook

`/deploy` ships the code, but PPE's eight existing rows still hold the old parts. They are
only rewritten by a targeted re-run of the components step (the pipeline would otherwise
leave already-stamped rows alone — "patch, don't bump": no `SCRIPT_VERSION` change).

## Steps

1. **Deploy** with `/deploy` as usual. No migration to run or hold back.
2. **Re-run the components step for the eight characters on PPE** (inside the backend
   container, after the rebuild so it runs the new `decompose.js`):

   ```bash
   docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-character-components.js \
     --words=然,祭,察,擦,蔡,嚓,镲,炙 --force
   ```

   Expected output: `Written: 8`, `… with components: 8`.
   Do **not** run `generate-component-font.js` for this — U+E000 has no font glyph; it is
   always drawn from its outline.

## Verification

```sql
-- V1: exactly the eight characters carry U+E000.
SELECT word1, components
  FROM dictionaryentries_zh
 WHERE language = 'zh' AND components ? E''
 ORDER BY word1;
-- expect 8 rows: 嚓 察 擦 炙 然 祭 蔡 镲 — e.g. 然 → ["犬","灬",""] (the third element
-- is U+E000 and prints blank), 炙 → ["火",""].

-- V2: none of them still carries the etymological part.
SELECT word1, components
  FROM dictionaryentries_zh
 WHERE language = 'zh'
   AND word1 = ANY (ARRAY['然','祭','察','擦','蔡','嚓','镲','炙'])
   AND (components ? '⺼' OR components ? '月');
-- expect 0 rows.

-- V3: bystanders unchanged — 肰 alone keeps ⺼, 燃 keeps 然 whole.
SELECT word1, components FROM dictionaryentries_zh
 WHERE language = 'zh' AND word1 IN ('肰','燃');
-- expect 肰 → ["⺼","犬"] (or its frequency order), 燃 → ["火","然"].
```

**In the app:** on the beginner keyboard, drawing 然's top-left (4 strokes) offers a chip
drawn as 夕-with-two-dots (2nd chip on an empty buffer, 1st once 犬 and 灬 are in); 犬 + 灬
+ that chip finds 然. In a Word Search flp break on the No Pinyin board, 然's parts reveal
the same outline (not an empty box).

**If V1 returns fewer than 8:** the container ran old code — confirm the deploy rebuilt
`cow-backend`, then repeat step 2.

## Rollback

Revert the commit and redeploy, then repeat step 2 with the old code: the eight rows go
back to ⺼ / 月. Until then the reverted client prints U+E000 as an empty box in Word
Search for those characters.

## User-visible change

- Beginner keyboard: the new chip for 然 祭 察 擦 蔡 嚓 镲 炙; ⺼ no longer finds those
  characters (a learner who draws 月 for 然 must draw the two-dot form instead).
- Word Search No Pinyin hints: the new outline for those characters; the flat ⺈ and the
  留-style 卯 now also show there (§ 6z-13 forms, shared renderer).

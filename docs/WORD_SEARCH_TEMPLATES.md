# Word Search — Template Fallback for Placement (design)

> Status: **built.** This doc describes the shipped fallback system.

Parent doc: [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) §2 (grid generation).
This doc covers two changes to that section:

1. **Word-length ban**: words longer than 4 characters are no longer eligible
   for Word Search at all.
2. **Template fallback**: when random snaking placement (§2 of the parent doc)
   fails 5 whole-grid regenerations in a row, generation switches to one of 10
   pre-authored 9×6 layouts that *guarantee* all 12 words fit, instead of
   continuing to retry randomly (up to today's `MAX_GRID_ATTEMPTS = 100`).

Motivation: with 12 words all at the maximum allowed length (4 characters,
48 of the 54 cells), random sequential snaking placement has a good chance of
painting itself into a corner — an earlier word's path can wall off the only
route a later word needed. Rather than burning many retries against bad luck,
we fall back to a generated layout that already reserves 12 independent
4-cell "slots" for the words to drop into.

---

## 1. Word-length ban (≤4 characters only)

Word Search pool assembly (`OnDeckVocabService.getWordSearchGrid`) currently
selects 12 library cards via distribution + fallback top-up, then runs a
substring de-dup pass (`WORD_SEARCH_GAME.md` §1a). Add a length filter
alongside that:

- Each per-category candidate query (`OnDeckVocabService.ts`, the `queues[category]`
  SELECT around line 718) gets an added `AND LENGTH(ve."entryKey") <= 4`
  (Postgres `LENGTH` counts characters, not bytes, so this is exactly "4
  Chinese characters or fewer").
- This makes every selected word template-compatible by construction — the
  12-slot templates (§3) never need to reject a word for being too long.
- Cards with `entryKey` longer than 4 characters simply never enter any
  queue, so they're treated like "not in the library" for this game — the
  same fallback order applies. The `insufficient-distinct` path is no longer a
  "study more cards" block: the controller now provisions temporary cards and retries
  the grid at 1x/2x/3x the baseline (PROVISION_RETRY_FACTOR) before giving up — see
  [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) § Word Search is the awkward one. The
  remaining `sufficient: false` copy is a genuine dead end, reached only if a user's library can't
  produce 12 short-enough, substring-clean words.

No schema change — this is a query-time filter, same as the existing
`starterPackBucket = 'library'` condition.

---

## 2. Trigger: switch to template mode after 5 failed grid attempts

`generateWordSearchGrid` (`server/services/wordSearchGrid.ts`) keeps its
existing per-word retry (`MAX_WORD_ATTEMPTS = 10`) and whole-grid regeneration
loop unchanged for the first few attempts. New constant:

```ts
const RANDOM_GRID_ATTEMPTS = 5;
```

- Attempts `0..4` (5 total): today's algorithm exactly as documented in
  `WORD_SEARCH_GAME.md` §2 — random start, 4-directional snaking (short words
  then oriented into reading order), per-word backtracking, whole-grid
  regeneration on failure.
- If attempt 5 is reached (all 5 random attempts failed to place all 12
  words): **do not** keep retrying randomly. Instead pick one of the 10
  fixed templates (§3) at random and use the template placement path (§4).
  Because every word is now ≤4 characters (§1) and every template slot is
  exactly 4 cells, template placement cannot fail on cell-count grounds — the
  only remaining failure mode is the anti-duplicate pass (§2a of the parent
  doc), which still applies unchanged (see §5 below), so `MAX_GRID_ATTEMPTS`
  stays as an outer safety net but should essentially never be hit once
  template mode is in play.

---

## 3. Template data model

New file: `server/services/wordSearchTemplates.ts`.

A template is **12 disjoint "slots"**, each an ordered path of exactly 4
orthogonally-adjacent cells (a "snake" in the parent doc's sense — no cell
repeated within a slot, no branching). Across all 10 templates the **same 6
holes** are left uncovered (they become ordinary filler cells, no different
from any other unassigned cell in the random-placement path):

```
holes = { (0,0), (0,5), (8,0), (8,5), (4,2), (4,3) }
```

— the four board corners plus the two cells at the grid's center, symmetric
under `(r,c) → (8-r, 5-c)`. This is the second hole pattern this doc has
used: at `TOTAL_WORDS = 10` (until 2026-08-23) the board had 14 holes — a
dotted top/bottom row plus a full row-4 divider — because 40-of-54 cells
needed to be slot cells; at 12 words, 48-of-54 need to be, leaving room for
only 6 holes, so the divider-row approach no longer fits. Six holes is too
few to carry a "top/middle/bottom" structure the way 14 could, so the design
fell back to the simplest symmetric pattern that still reads as intentional
rather than arbitrary: mark the frame (corners) and the center.

The 10 templates are 10 different ways of tiling the remaining 48 cells into
12 four-cell paths — generated by a one-off backtracking script (true
exact-cover search against the fixed hole set above, not greedy-with-restart)
using only piece shapes that are valid as a single walked path (straight
I-shapes, L/J, S/Z, and the 2×2 O-shape, which **is** walkable as a path:
`(0,0)→(0,1)→(1,1)→(1,0)`). T/plus shapes are excluded because their center
cell has 3 same-piece neighbors, which no single path can visit without
reusing a cell.

Each was verified programmatically (not just eyeballed) for:
- exactly 12 pieces of exactly 4 cells each,
- every consecutive pair in a piece orthogonally adjacent,
- no cell in a piece adjacent to more than 2 other same-piece cells (rules
  out T/plus),
- no overlap between pieces or with the hole set,
- all 48 non-hole cells covered.

Example (`Template 0`, `0`–`9` then `a`,`b` = slot index (base 16), `.` = hole):

```
. 0 1 1 2 .
3 0 0 1 2 2
3 3 0 1 4 2
5 3 4 4 4 6
5 7 . . 8 6
5 7 8 8 8 6
5 7 7 9 9 6
a a a a 9 9
. b b b b .
```

`wordSearchTemplates.ts` exports:

```ts
export interface WordSearchTemplate {
  /** 12 slots, each an ordered path of exactly 4 [row, col] cells. */
  slots: [number, number][][];
}

export const WORD_SEARCH_TEMPLATES: WordSearchTemplate[]; // length 10, 9x6 only
```

Slot cell order is the slot's authored **traversal**, not a guaranteed reading
direction: a 4-character word always reads forward along it, but a 2- or 3-cell
run of it may point backwards (e.g. right-to-left). Such runs are therefore
passed through `orientPath` (parent doc §2 "Reading order") before being
committed, exactly as random placement does — so the short-word reading-order
rule holds identically in both modes.

---

## 4. Placement algorithm in template mode

Given the 12 (already length-filtered, substring-clean) words and a randomly
chosen `WordSearchTemplate`:

1. **Shuffle words across slots** (`Fisher–Yates` with the grid's `rng`) —
   one word per slot, order otherwise unrelated to word length/category. (12
   words, 12 slots: always a perfect 1:1 assignment given §1's ban.)
2. For each `(word, slot)` pair:
   - If `word.length === 4`: the word occupies the whole slot path, in the
     slot's defined order. Cells `0..3` ↔ characters `0..3`.
   - If `word.length === N < 4`: pick a **random contiguous run** of `N`
     cells within the slot's 4-cell path — i.e. a random `offset` in
     `0..(4-N)`, using slot cells `offset..offset+N-1` in order. The
     remaining `4-N` cells in that slot (before and/or after the run) are
     **not** part of any word — they're handed to the same filler flood as
     every other empty cell (parent doc §2 "Filler").
     The run is then handed to `orientPath` (parent doc §2 "Reading order"),
     which reverses it when its shape has an unambiguous reading direction —
     so a 2-char word never lands right-to-left/bottom-to-top, and a 3-char
     word reads correctly when straight or ⌞-bent.
3. Commit all word cells (`occupied[r][c] = true`, `cells[r][c] = {char,
   pinyin}`), exactly as the random-placement path already does after
   `tryPlaceWord` succeeds.
4. Flood every remaining empty cell (the 6 fixed holes, plus every
   leftover-run cell from step 2, plus — trivially, since 12×4=48 already
   accounts for every non-hole cell when all 12 words are 4 chars — nothing
   else) with the same level-appropriate filler pool used today.

No changes to the filler-sourcing logic itself (`fillerPool`,
`StarterPacksService.estimateLevel`, etc.) — template mode only changes
*where* word cells land, not how filler is drawn.

## 5. Anti-duplicate pass still runs

The dedup fixup (`findWordOccurrences` / `MAX_DEDUP_PASSES`, parent doc §2a)
is placement-method-agnostic — it operates on the finished `cells` grid and
each word's committed `cells` path, regardless of whether that path came from
random snaking or a template slot. **No changes needed there**: template-mode
output feeds into the exact same post-processing `generateWordSearchGrid`
already runs after any successful placement.

If the dedup pass can't converge for a template-mode grid (rare — same
"unfixable" condition as random mode, e.g. an accidental duplicate made
entirely of other words' cells), the existing behavior applies: bail and
regenerate the whole grid from scratch, which will re-enter attempt 0 of the
outer loop and could redo random attempts before falling back to a (possibly
different, randomly re-chosen) template again at attempt 5.

---

## 6. Confirmed design decisions

Resolved via user Q&A (this doc's design session):

| Question | Decision |
|---|---|
| How are the 10 templates authored? | **Generated literal coordinates** — a fixed (design-chosen) hole pattern + 10 tilings of 12 slots each found by a one-off backtracking exact-cover script, baked into `wordSearchTemplates.ts` as data (validated by the same script, not computed at runtime). |
| When does template mode kick in? | **After 5 failed whole-grid regeneration attempts** (`RANDOM_GRID_ATTEMPTS = 5`), not a lower per-word threshold. |
| Where does a short word sit within its 4-cell slot? | **Random contiguous run** of `N` cells within the slot (offset chosen at random each time), not always the first `N`. |
| How are words assigned to slots? | **Random shuffle** across all 12 slots — no correlation to word length or category. |

## 7. Notes

- `MAX_GRID_ATTEMPTS` (100) is unchanged and still wraps the whole loop —
  attempts `0..4` are random, `5..99` are template mode (near-guaranteed
  success, since template mode only fails if the post-placement anti-dup pass
  hits an unfixable occurrence, §5). In practice generation should never come
  close to 100.
- No new tables/columns — this was pure generation-algorithm and query-filter
  work, same as the rest of Word Search.

## 8. Files (as built)

- `server/services/wordSearchTemplates.ts` — `WORD_SEARCH_TEMPLATES` data
  (§3) + `WordSearchTemplate` type + `WORD_SEARCH_TEMPLATE_HOLES`.
- `server/services/wordSearchGrid.ts` — `generateWordSearchGrid` branches on
  `useTemplate = canUseTemplates && gridAttempt >= RANDOM_GRID_ATTEMPTS`
  (`templateModeApplicable` gates on exactly a 9×6 board — checked against
  `WORD_SEARCH_TEMPLATE_ROWS`/`COLS`, not a hardcoded literal — with 12 words all
  ≤4 characters, so a differently-shaped caller — e.g. a unit test — just
  keeps using random placement for the full `MAX_GRID_ATTEMPTS`). Template
  mode picks a random `WORD_SEARCH_TEMPLATES` entry, shuffles the prepared
  words (`shuffle`, Fisher–Yates over the grid's own `rng`) across the 12
  slots, and for a word shorter than 4 characters takes a random contiguous
  `slot.slice(offset, offset + len)`. Reuses the existing filler-flood and
  anti-dup pass (§5) unchanged.
- `server/services/OnDeckVocabService.ts` — the `LENGTH(ve."entryKey") <= 4`
  filter on the per-category queue queries (§1).
- `docs/WORD_SEARCH_GAME.md` — §1 and §2 point here; the Files section lists
  `wordSearchTemplates.ts`.

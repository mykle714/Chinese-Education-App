# CPCD Pinyin Shift

How `CPCDRow` (cpcd) spaces out long pinyin so a row of character + pinyin
columns stays readable. Layer: **front-end / presentation** — pure layout math
inside `src/components/CPCDRow.tsx`; no data or API involvement.

## Goal

Each character in a cpcd row gets a fixed-width **column box** (`COLUMN_WIDTH`
per size) with its pinyin centered beneath its glyph. Most syllables render
narrower than their column and fit. Some render wider than the column —
e.g. `shén` (神), `chuáng` (床), `zhuàng` (状), `shuāng` (双) — and would otherwise
either be clipped/left-anchored or visually collide with the neighbor's pinyin.
The shift system gives those wide syllables room **without disturbing the rest of
the row**.

## The model (collision relaxation)

The system solves a small 1-D **non-overlap constraint problem**: nudge adjacent
pinyin texts apart by *exactly* enough that they stop touching (plus a small gap),
and no more. Narrow pinyin and long sentences that don't collide are never
disturbed.

### Asymmetric text-extent model

For each syllable the layout measures its **rendered pinyin width** `textWidth`
and its **column-box width** `boxWidth = charCount × COLUMN_WIDTH`, then records
how far the text reaches **left** (`halfLeft`) and **right** (`halfRight`) of the
cell center. This is asymmetric when the text overflows, because the span is a
fixed, cell-width box with `text-align: center`:

- **Fits** (`textWidth ≤ boxWidth`): text is centered → `halfLeft = halfRight = textWidth / 2`.
- **Overflows** (`textWidth > boxWidth`): the browser **left-anchors** the text
  (left edge at the box's left edge, spilling only rightward — verified
  empirically) → `halfLeft = boxWidth / 2`, `halfRight = textWidth − boxWidth / 2`.

So a wide syllable barely intrudes on its **left** neighbor but reaches far into
its **right** neighbor. Modeling this asymmetry is what keeps a wide syllable's
narrow neighbor from being over-pushed.

### The constraint + relaxation solver

Each syllable gets a horizontal `offset` (initially `0`). For every adjacent pair
`(i, i+1)` in a visual row, their texts must not touch:

```
minSpacing   = halfRight[i] + halfLeft[i+1] + PINYIN_MIN_GAP_PX
actualSpacing = (center[i+1] + offset[i+1]) − (center[i] + offset[i])
deficit      = minSpacing − actualSpacing        # > 0 means overlapping
```

When a pair overlaps, the `deficit` is **split evenly** — the left syllable yields
left by `deficit / 2` and the right yields right by `deficit / 2`. Both give
ground equally, regardless of which is wider.

This is solved by **relaxation**: sweep the pairs left-to-right, pushing apart any
overlapping pair by half the deficit, and repeat until a full pass moves nothing
(or a `max(4, n)` pass cap is hit). Fixing one pair can re-violate its neighbor,
so the repeated sweeps let the row settle. It converges in a handful of passes for
the short runs cpcd renders (a word, or one wrapped line).

**Why even splitting (not "wide syllable anchors").** An earlier variant let a
syllable that overflows its column **anchor** (never move) and dumped the whole
push on its narrower neighbor. That breaks when a narrow syllable is sandwiched
between two wide ones — e.g. 丈夫上班 = `zhàng·fu·shàng`, where `fu` sits between
the wide `zhàng` and the wide `shàng`. Both wide neighbors refuse to move, so
there is no room for `fu`; the constraint becomes **infeasible** and the sweep
shoves `fu` *into* `zhàng` (they overlap by ~3.5px). Even splitting instead lets
the wide neighbors drift apart symmetrically: `zhàng` moves left, `shàng` moves
right, and `fu` stays centered on 夫 with clean gaps on both sides.

### Worked example — 丈夫上班 (zhàng fu shàng bān)

- `fu` (夫): narrow, fits its column.
- `zhàng` (丈) and `shàng` (上): both overflow their columns.

`fu` collides with both wide neighbors. Even splitting drifts `zhàng` left and
`shàng` right to open room, leaving `fu` centered over 夫 with a
`PINYIN_MIN_GAP_PX` gap on each side, versus an *overlap* on the `zhàng` side
under the old anchoring rule.

## Rendering detail

In a **multi-character** row an overflowing syllable keeps the browser's default
**left-anchored spill** — it is *not* re-centered over its glyph. The asymmetric
extent model already accounts for that rightward spill, and the relaxation frees
space on the right by pushing the right neighbor over. Final horizontal placement
of each span:

```
x = cell.offsetLeft + offset
```

### Lone syllable (`n === 1`)

When a visual row holds a **single** character there is no neighbor to
de-overlap against, so the relaxation solver is skipped. Instead the lone
syllable is **re-centered** over its glyph: it is pulled left by half its
overflow (`offset = −(halfRight − halfLeft) / 2`), which cancels the browser's
left-anchored spill. A fitting syllable has `halfRight == halfLeft`, so this is a
no-op. This keeps a single wide pinyin (e.g. `shuāng` over a lone 双) centered
rather than spilling only rightward.

## Same-tone separator apostrophes

Tone color is what normally signals where one syllable ends and the next begins.
When a run of **same-tone** syllables crowds together (their pinyin texts relaxed
to the `PINYIN_MIN_GAP_PX` minimum, or naturally near-touching), that cue
disappears and the run reads as **one long word** — e.g. 冰箱 `bīng xiāng` (both
tone 1) blurring into `bīngxiāng`.

To restore the boundary, `positionPinyins()` draws a **text-colored apostrophe**
(`&rsquo;` — the standard pinyin syllable divider, as in *Xi'an*) in the gap
between any adjacent pair that is **both** (a) the same tone color
(`getToneColor(left) === getToneColor(right)`) and (b) crowded — meaning the
collision solver actually **pushed** that pair apart (`pushed[k]`), relaxing their
touching texts to the bare `PINYIN_MIN_GAP_PX` minimum. Using the solver's own
"did I push this pair?" flag (rather than an absolute pixel threshold) is what
keeps apostrophes off pairs that merely sit a few px apart but read as clearly
separated. Pairs of different color (already color-separated) and same-color pairs
the solver left alone (any comfortable natural gap) get **no apostrophe**.

- It is placed at the midpoint of the real, post-shift gap
  (`rightEdge[i]`/`leftEdge[i+1]` derived from the same `centers`/`offsets`/
  `halfLeft`/`halfRight` the solver produced), horizontally centered on that
  midpoint via a `translateX(-50%)` on the shrink-wrapped glyph, and **top-anchored
  to the pinyin band** so it rides near the top of the pinyin text (not inline with
  it). It is **drawn on top** in a separate overlay above the pinyin layer, so it
  **consumes no layout space** — the shift math is unchanged; apostrophes are purely
  additive.
- Apostrophes are `pointer-events: none` + `user-select: none` and `aria-hidden`,
  so they never join a pinyin drag-copy and are skipped by assistive tech.
- Rendered as `items.length − 1` spans indexed by the **left** syllable's item
  index; each is hidden at the top of every `positionPinyins()` pass and re-shown
  only if its pair qualifies. Pairs that straddle a wrapped line are never adjacent
  within a visual row, so no apostrophe is drawn across the wrap.

## Upstream: the string this operates on is sandhi-corrected

Everything above is layout math over whatever pinyin string the row is handed. That string
is **not** the dictionary's citation reading: `ForeignText` applies 一/不 tone sandhi in
`buildCharItems` before building `CPCDRowItem`s, so 一流 arrives as `yì liú` rather than
`yī liú` (`src/utils/toneSandhi.ts`; full rationale in
[DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) § "The last step: 一/不 tone sandhi").

Two consequences land inside this document's scope:

- **Tone color.** `getToneColor` reads the diacritic off the same string, so the correction
  repaints the syllable as well as re-spelling it — that is the whole reason the transform
  rewrites the string rather than annotating it.
- **Same-tone separator apostrophes.** The apostrophe rule below keys on
  `getToneColor(left) === getToneColor(right)`, so sandhi can add or remove one: 不是
  citation `bù shì` is tone 4 + tone 4 (same color → apostrophe eligible if crowded), while
  the surface form `bú shì` is tone 2 + tone 4 (different colors → never eligible). Nothing
  here needs to special-case it; the rule simply evaluates the string it is given.

Sentences are handled one level up — `SegmentedSentenceDisplay` applies the pass across the
whole sentence in its `charData` memo, because a trigger and its target routinely straddle a
segment boundary (我 / 不 / 去) that a per-segment `ForeignText` cannot see. Those call sites
use the low-level `items` API, which `ForeignText` passes through untouched.

## Where it runs

- `positionPinyins()` in `src/components/CPCDRow.tsx` runs in a
  `useLayoutEffect` on every render and via a `ResizeObserver` on the chars
  block (so pinyin reflows when the row wraps or the container resizes).
- Text widths are measured with a `Range` over the live text node and divided by
  the ancestor scale factor (`safeScale`) so the math stays in unscaled px even
  when an ancestor applies a CSS `transform: scale()` (e.g. bubble-match shrinks
  long word bubbles).

## Tunables (`src/components/CPCDRow.tsx`)

| Constant | Meaning |
|---|---|
| `PINYIN_MIN_GAP_PX` | Minimum breathing space kept between adjacent pinyin texts when de-overlapping (2). |
| `COLUMN_WIDTH` | Per-size column-box width that defines overflow. |
| `OVERLAP_BY_SIZE` | Negative inter-cell margin (visual density of the glyphs). |
| `BIG_PINYIN_SCALE` | Multiplier applied to the pinyin font **and** the reserved pinyin band when the `bigPinyin` prop is on (1.2 → ~15.6px at `sm`). |
| `CHAR_LINE_HEIGHT` | Line-height of both the glyph and the pinyin text (1.21). Shared by the render and by `cpcdNaturalSize`, so a measured cell and a rendered one cannot disagree. |

### `cpcdNaturalSize(size, opts)` — the cell's box, without measuring the DOM

Exported from `CPCDRow.tsx`. Returns the natural (untransformed) `{width, height}`
of ONE character cell, derived from the same per-size tables the component renders
with: `width = charCount × COLUMN_WIDTH`, `height = VERTICAL_PADDING + round(charFont
× CHAR_LINE_HEIGHT) + the reserved pinyin band`. `opts` mirrors the props that move
those numbers (`charCount`, `compact`, `bigPinyin`, `reservePinyin`).

It exists because a cpcd cell is **much taller than it is wide**, so a caller that
wants a square (or otherwise explicit) tile around one cannot get there with
`aspect-ratio: 1` — that makes the browser reconcile a content-**width**-derived
width against a content-**height**-derived height, and engines disagree (see the
Safari overflow warning in [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) §3 "Cell
size"). Size the track from this instead and let the cell stretch into it.

Callers: `src/games/word-search/WordSearchGrid.tsx` (`cellSide`).

### Interaction with `bigPinyin`

The `bigPinyin` prop (`CPCDRow` / `ForeignText`, default `false`) scales the
pinyin overlay by `BIG_PINYIN_SCALE` while leaving the character glyph — and
therefore `COLUMN_WIDTH` — unchanged. Since overflow is defined as *text wider
than its column box*, big pinyin makes overflow (and therefore shifting and
same-tone separator apostrophes) **somewhat more common**: at `sm`, a ~15.6px
syllable against a 32px column overflows a little earlier than the 13px default.
No special-casing is needed — the solver measures live text and spaces each
colliding pair by exactly its deficit — but expect visibly wider spreading on
big-pinyin surfaces. The reserved band scales by the same factor, so the glyph
keeps its usual clearance and only the cell's total height grows.
Current big-pinyin surface: the Word Search **Pinyin** board
(`src/games/word-search/WordSearchGrid.tsx`, see
[WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) §3 "Cell size").

The `pinyinShift` prop (default `true`) toggles the whole behavior; with it off,
every pinyin stays at `offset 0` (centered/left-anchored per browser default)
with no neighbor pushes.

## History

An interim version replaced this relaxation model with a simpler "long syllables
push each neighbor by one discrete unit; opposing pushes cancel" rule (plus a
`−overflow/2` re-centering so overflow spilled symmetrically). The relaxation
model was **restored** because the discrete quantum could under- or over-space
colliding pairs, whereas the constraint solver spaces each pair by exactly what it
needs — worth the modest extra logic for the short runs cpcd renders.

The restored solver initially kept the original **"wide syllable anchors"**
share rule, which turned out to overlap a narrow syllable into a wide neighbor
whenever it was sandwiched between two wide ones (see *Why even splitting* above).
It was simplified to an **unconditional even split**, which resolves those
sandwiches and drops the per-pair `overflows[]` branching.

## Typeface dependency: the 1em han advance

The whole model assumes **each character cell is one full em wide** — pinyin is
centered over its character, and the solver pushes neighbours outward from that
column grid. That holds for every full-width CJK face (`FONTS.cjk`'s default
`Noto Sans SC` included) and does **not** hold for a condensed design, whose narrower
han advance walks every syllable progressively out of register across a row.

`FONTS.cjk` is swappable at runtime via the `--cjk-font` custom property
(`src/theme/fonts.ts`), so this is a live constraint on any typeface change, not a
frozen property of the app. The `/font-lab` page measures and reports each candidate's
han advance for exactly this reason —
→ [CJK_TYPEFACE_LAB.md](./CJK_TYPEFACE_LAB.md) § 2.

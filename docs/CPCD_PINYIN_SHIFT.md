# CPCD Pinyin Shift

How `CPCDRow` (cpcd) spaces out long pinyin so a row of character + pinyin
columns stays readable. Layer: **front-end / presentation** — pure layout math
inside `src/components/CPCDRow.tsx`; no data or API involvement.

## Goal

Each character in a cpcd row gets a fixed-width **column box** (`COLUMN_WIDTH`
per size) with its pinyin centered above its glyph. Most syllables render
narrower than their column and fit. Some render wider than the column —
e.g. `shén` (神), `chuáng` (床), `zhuàng` (状), `shuāng` (双) — and would otherwise
either be clipped/left-anchored or visually collide with the neighbor's pinyin.
The shift system gives those wide syllables room **without disturbing the rest of
the row**.

## The model (current, intentionally simple)

A syllable is **"long"** when its **rendered pinyin overflows its own character
column** — `textWidth > boxWidth + LONG_PINYIN_OVERFLOW_SLACK_PX`. The slack (px)
keeps a syllable sitting right at the column edge from flickering in and out of
"long" as measurement/font rounding jitters. This is a purely on-screen measure,
not a character count.

Then, **per visual row** (wrapped lines are handled independently):

- A long syllable **stays anchored** — centered over its own character. It does
  not move.
- It **pushes each immediate neighbor outward by one discrete push unit**:
  - the **left** neighbor moves **left** by `pushUnit`,
  - the **right** neighbor moves **right** by `pushUnit`,
  - where `pushUnit = columnWidth × PINYIN_PUSH_FRACTION` — a **fixed quantum**,
    not a magnitude derived from the syllable's exact overflow. A neighbor is
    therefore either pushed (by one unit) or it isn't.
- Pushes **accumulate additively**. A syllable that has a long neighbor on its
  **left** (pushing it right) *and* a long neighbor on its **right** (pushing it
  left) receives both pushes, which **cancel to net zero** → it stays put. Two
  adjacent long syllables push each other apart (each is the other's neighbor).

Short syllables with no long neighbor get offset `0` and never move. Because the
push is always outward, a syllable is never pulled *inward*.

### Worked example — 起床 (qǐ chuáng)

- `qǐ` (起): renders narrower than its column → not long.
- `chuáng` (床): renders wider than its column → **long**.

`chuáng` stays centered over 床 and pushes its left neighbor `qǐ` left by one
push unit. Result: **qǐ shifts left, chuáng stays centered** — the wide syllable
holds the anchor and the narrow neighbor yields.

## Rendering detail: re-centering overflow

The pinyin span is a fixed, cell-width box with `text-align: center`. When the
text fits, that centers it over the glyph. But when the text **overflows**, the
browser **left-anchors** it (the text's left edge sits at the box's left edge and
it spills only rightward — verified empirically). So for any overflowing syllable
the layout adds a **centering correction** of `−(textWidth − boxWidth)/2` to its
transform, re-centering the overflow over the character. This is what lets a long
syllable spill symmetrically and push both neighbors evenly, instead of hanging
off the right of its character.

Final horizontal placement of each span:

```
x = cell.offsetLeft + centeringCorrection + offset
```

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
| `LONG_PINYIN_OVERFLOW_SLACK_PX` | Px a syllable must overflow its column to count as "long" (2). |
| `PINYIN_PUSH_FRACTION` | One push unit as a fraction of the column width (0.05). |
| `COLUMN_WIDTH` | Per-size column-box width that defines overflow. |
| `OVERLAP_BY_SIZE` | Negative inter-cell margin (visual density of the glyphs). |

The `pinyinShift` prop (default `true`) toggles the whole behavior; with it off,
pinyin is simply centered/left-anchored per browser default with no neighbor
pushes.

## History

This replaced an earlier relaxation-based model that modeled asymmetric
left/right text reach per syllable and iteratively pushed apart every colliding
pair (with per-pair "who anchors" share logic). It was removed in favor of the
simpler "long syllables push neighbors, pushes cancel" rule above because the
extra precision wasn't worth the complexity for the short runs cpcd renders.

import { COMPONENT_DISPLAY_PATHS } from './componentDisplayForms.generated';
import { PRIVATE_COMPONENT_NAMES } from '../../../server/contracts/privateComponents';

/**
 * ComponentGlyph — how the app DRAWS one character component.
 *
 * LAYER: shared presentation primitive (src/components — used by two features). Pure
 * render, no state. Used by the beginner keyboard (CandidateRow's glyph chips,
 * ComponentBuffer's Parts chips) and Word Search's No Pinyin hint row
 * (WordSearchHintRow). Spec: docs/BEGINNER_KEYBOARD.md § 6z-13 and § 6z-15.
 *
 * Almost every component renders as its own font glyph — the caller's text, in the
 * caller's `FONTS.hanziComponents` styling. Two kinds render an outline instead
 * (`server/scripts/backfill/chinese/generate-component-display-forms.js`):
 *   - a standalone font glyph shaped unlike the component inside the characters a
 *     learner writes (⺈: the font draws the compact top of 角, while 你 and 尔 wear a
 *     wide, flat hat; 卯 as drawn in 留);
 *   - a private-use component (server/contracts/privateComponents.ts), which no font
 *     can print at all (U+E000, the two-dot ⺼ of 然).
 *
 * Display only: the component's identity — the buffer entry, the lookup key — stays the
 * real codepoint.
 */

/**
 * The em box of a `FONTS.hanziComponents` glyph inside a `lineHeight: 1` line box,
 * in flipped font units. Noto Sans SC's hhea (= OS/2 win) metrics are 1160 / −288, a
 * 1448-unit content area, so line-height 1 trims 224 units from each side and the line
 * box spans y = 936 down to y = −64. Flipped (y_svg = −y_font) that is a viewBox
 * starting at −936. Matching it keeps the outline exactly where the font would have
 * put a glyph, so the chip's vertical centring does not shift.
 */
const EM_BOX_VIEWBOX = '0 -936 1000 1000';

/**
 * Inline placement: an inline-block sits its bottom edge on the baseline, but the em box
 * above ends 64 units (0.064em) BELOW the baseline, so it is lowered by that much. Inside
 * a flex container (the keyboard chips) the box is blockified and this has no effect.
 */
const BASELINE_DROP = '-0.064em';

interface ComponentGlyphProps {
  /** The component's real codepoint (what the buffer and lookup use). */
  glyph: string;
}

export default function ComponentGlyph({ glyph }: ComponentGlyphProps) {
  const path = COMPONENT_DISPLAY_PATHS[glyph];
  if (!path) return <>{glyph}</>;
  return (
    <svg
      className="component-glyph-outline"
      viewBox={EM_BOX_VIEWBOX}
      // 1em square: the size of the font glyph it replaces, at the caller's fontSize.
      width="1em"
      height="1em"
      // currentColor: the caller's text colour, exactly as a font glyph would take it.
      fill="currentColor"
      role="img"
      // A private-use codepoint reads as nothing to a screen reader, so it gets a name.
      aria-label={PRIVATE_COMPONENT_NAMES[glyph] ?? glyph}
      style={{ display: 'inline-block', verticalAlign: BASELINE_DROP, flexShrink: 0 }}
    >
      <path transform="scale(1,-1)" d={path} />
    </svg>
  );
}

/**
 * ComponentBuffer — the strip of submitted components, left of the canvas.
 *
 * LAYER: presentation. Renders the buffer and reports taps; the search re-runs
 * because `buffer` is the lookup memo's dependency, not because this component
 * asks for it (§ 6r).
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6r (layout, removal), § 6x (expansion).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CHIP IS ONE COMPONENT (2026-09-09 — this REPLACES § 6x's submission chip)
 *
 * The strip shows the component buffer verbatim: one chip per part, and the
 * parts are exactly what the lookup searches on. A glyph drawn above the
 * alphabet's granularity was expanded at append time, so drawing 尔 puts two
 * chips here, ⺈ and 小.
 *
 * The chip used to show the DRAWN glyph with its leaves printed underneath,
 * small and muted. That made the strip a display list layered over a search
 * list — two things to keep in step, and a chip whose glyph was not in the
 * buffer at all. It is gone: what is on screen is what is being searched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TAP TO REMOVE, WITH NO × (decided 2026-09-07)
 *
 * Removal is the only correction the learner has: there is no clear button and no
 * undo (§ 6r, deferred). The chips carried a × for that reason — an explicit
 * affordance beats a swipe or a long-press, which are invisible.
 *
 * The × was dropped for being visual noise on a strip of small glyphs: it doubled
 * the width of a one-character chip and competed with the component itself, which
 * is the thing the learner is actually reading. The BEHAVIOUR is unchanged — the
 * whole chip is still a button, and it still removes on tap.
 *
 * ⚠️ That does make removal a slightly less discoverable affordance. It is kept
 * honest by the chip still rendering as a raised, bordered button with a pressed
 * state, and by `aria-label` naming the action for assistive tech. If learners
 * turn out not to find it, the fix is a hint elsewhere on the surface rather than
 * putting the × back on every chip. That hint now exists: while the strip holds parts, a
 * "Tap to clear" line sits at the bottom of the section (2026-11-15, owner).
 *
 * ORDER IS DISPLAYED BUT NOT MEANINGFUL. The lookup treats the buffer as a
 * multiset (§ 6d/§ 6h), so these read in submission order purely so the learner
 * can find the one they want to remove.
 */
import { Box, Typography } from '@mui/material';
import { COLORS, FONTS, SIZE, WEIGHT, TRACKING } from '../../theme';
import { KEYBOARD_COLORS } from './keyboardColors';
import { whiteKeySx } from './keycapStyle';

/** A part chip's face, px (square floor; a wide glyph may grow it). */
const PART_CHIP_SIZE = 40;
/** Space between chips in a row, px. */
const PART_CHIP_GAP = 6;
/**
 * The parts column's side padding, px. It is ALSO the whole gap between the parts and the
 * canvas — the canvas slot has no left inset — so the parts sit the same distance from
 * the screen's left edge as from the canvas (owner, 2026-11-15). BeginnerKeyboard's
 * controls row uses it too, so the ink keys line up with the chips.
 */
export const PARTS_COLUMN_PAD = 10;
/** How many chips one row must hold (owner, 2026-11-15: three parts on one row). */
const PARTS_PER_ROW = 3;

/**
 * The narrowest the parts column may be: PARTS_PER_ROW chips + their gaps + the strip's
 * padding (3·40 + 2·6 + 2·10 = 152px). BeginnerKeyboard sizes the canvas so the column
 * never gets narrower than this. Derived from the same constants the chips are drawn
 * with, so the two cannot drift. Docs: docs/BEGINNER_KEYBOARD.md § 6z-12 (canvas size).
 */
export const PARTS_COLUMN_MIN_WIDTH = PARTS_PER_ROW * PART_CHIP_SIZE + (PARTS_PER_ROW - 1) * PART_CHIP_GAP + 2 * PARTS_COLUMN_PAD;
import ComponentGlyph from '../../components/handwriting/ComponentGlyph';
import { PRIVATE_COMPONENT_NAMES } from '../../../server/contracts/privateComponents';

interface ComponentBufferProps {
  /** The component buffer, flat — one chip per entry. */
  buffer: string[];
  onRemove: (position: number) => void;
}

export default function ComponentBuffer({ buffer, onRemove }: ComponentBufferProps) {
  return (
    <Box
      className="beginner-keyboard__buffer"
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        p: `${PARTS_COLUMN_PAD}px`,
        overflowY: 'auto',
        touchAction: 'pan-y',
      }}
    >
      {/* The "PARTS" caption — removed and brought back the same day (2026-11-15,
          owner): it names the column. Centred over a hairline rule (owner, same day)
          so it reads as the section's header; the rule is the candidate row's
          COLORS.rowBorder, the keyboard's one divider colour. */}
      <Typography
        className="beginner-keyboard__buffer-label"
        sx={{
          textAlign: 'center',
          pb: 0.75,
          borderBottom: `1px solid ${COLORS.rowBorder}`,
          fontFamily: FONTS.label,
          fontSize: SIZE.micro,
          fontWeight: WEIGHT.semibold,
          letterSpacing: TRACKING.caps,
          textTransform: 'uppercase',
          color: KEYBOARD_COLORS.faint,
        }}
      >
        Parts
      </Typography>

      {/* Empty, the strip is just its caption (2026-11-15, owner): the dashed ghost
          chips that used to mark "parts land here" are gone — the candidate row's
          worked example (你 = 亻 + 尔) now does the teaching. */}
      {buffer.length > 0 && (
        // Rows sit 8px apart (columns 6px) so a wrapped row's lip never touches the
        // keys below it.
        <Box className="beginner-keyboard__buffer-chips" sx={{ display: 'flex', flexWrap: 'wrap', columnGap: `${PART_CHIP_GAP}px`, rowGap: 1 }}>
          {buffer.map((component, position) => (
            <Box
              component="button"
              type="button"
              // The same component can appear twice (林 → 木 木), so position is
              // part of the identity — keying on the glyph alone would collapse
              // the pair and make the wrong chip disappear on removal.
              key={`${component}-${position}`}
              className="beginner-keyboard__buffer-chip"
              onClick={() => onRemove(position)}
              // A private-use part (U+E000, § 6z-15) reads as nothing, so name it.
              aria-label={`Remove ${PRIVATE_COMPONENT_NAMES[component] ?? component}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: PART_CHIP_SIZE, // tap-target floor, now that the × no longer pads it out
                height: PART_CHIP_SIZE,
                px: 1,
                // A raised white keycap (keycapStyle.ts), the same object as the ā
                // pad's utility keys; the press is the snap-down, not a tint.
                ...whiteKeySx(),
              }}
            >
              <Box
                component="span"
                className="beginner-keyboard__buffer-glyph"
                sx={{
                  fontFamily: FONTS.hanziComponents,
                  fontSize: SIZE.subtitle,
                  lineHeight: 1,
                  color: KEYBOARD_COLORS.ink,
                }}
              >
                {/* § 6z-13: the cut outline where the font glyph is the wrong shape (⺈). */}
                <ComponentGlyph glyph={component} />
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* The removal hint, pinned to the section's BOTTOM (mt: auto) and shown only
          while there are parts to remove. Chips have no × (see header), so this line
          is what makes tap-to-remove discoverable. The owner chose the short "Tap to
          clear" (2026-11-15) even though a tap removes ONE part, not all. Same quiet label styling as the caption above. */}
      {buffer.length > 0 && (
        <Typography
          className="beginner-keyboard__buffer-hint"
          sx={{
            mt: 'auto',
            // Centred across the column (owner, 2026-11-15), still pinned to the bottom.
            textAlign: 'center',
            fontFamily: FONTS.sans,
            fontSize: SIZE.caption,
            color: KEYBOARD_COLORS.faint,
          }}
        >
          Tap to clear
        </Typography>
      )}
    </Box>
  );
}

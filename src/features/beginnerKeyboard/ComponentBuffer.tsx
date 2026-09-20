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
 * putting the × back on every chip.
 *
 * ORDER IS DISPLAYED BUT NOT MEANINGFUL. The lookup treats the buffer as a
 * multiset (§ 6d/§ 6h), so these read in submission order purely so the learner
 * can find the one they want to remove.
 */
import { Box, Typography } from '@mui/material';
import { COLORS, FONTS, SIZE, WEIGHT, TRACKING } from '../../theme';

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
        p: 1.25,
        overflowY: 'auto',
        touchAction: 'pan-y',
      }}
    >
      <Typography
        className="beginner-keyboard__buffer-label"
        sx={{
          fontFamily: FONTS.label,
          fontSize: SIZE.micro,
          fontWeight: WEIGHT.semibold,
          letterSpacing: TRACKING.caps,
          textTransform: 'uppercase',
          color: COLORS.textFaint,
        }}
      >
        Parts
      </Typography>

      {buffer.length === 0 ? (
        <Typography
          className="beginner-keyboard__buffer-empty"
          sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary }}
        >
          Parts you pick appear here.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
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
              aria-label={`Remove ${component}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 40, // tap-target floor, now that the × no longer pads it out
                height: 40,
                px: 1,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 2,
                backgroundColor: COLORS.white,
                cursor: 'pointer',
                '&:active': { backgroundColor: COLORS.rowHoverBg },
              }}
            >
              <Box
                component="span"
                className="beginner-keyboard__buffer-glyph"
                sx={{
                  fontFamily: FONTS.hanziComponents,
                  fontSize: SIZE.subtitle,
                  lineHeight: 1,
                  color: COLORS.onSurface,
                }}
              >
                {component}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

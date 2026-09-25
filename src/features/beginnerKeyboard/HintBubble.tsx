/**
 * HintBubble — the § 6z-4 suggestion that floats above one glyph chip.
 *
 * LAYER: presentation. Paints one `HintCharacter` and reports a tap; it does not
 * know what a tap means (the keyboard commits it via `hintCommit`) and it does not
 * position itself beyond "centred on `anchorX`, tail pointing down" — the row
 * measures where its chip is and hands that in.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-4.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT FLOATS OVER THE SWITCH BAR (decided 2026-09-24)
 *
 * The bubble sits ABOVE the candidate row, overlapping the 写/ABC switch bar (and,
 * for a tall bubble, the bottom edge of whatever is above that) rather than in a
 * lane of its own. A lane would either push the canvas down every time a hint
 * appeared or cost ~48px of canvas permanently; floating costs no height. The
 * accepted price is that a bubble can cover the switch bar's controls while it is
 * showing — it only shows while there is ink AND a buffer, i.e. mid-character,
 * which is not when a learner reaches for 写/ABC.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MOTION (§ 6z-4 "Motion", added 2026-09-24)
 *
 * The bubbles are meant to feel a little ethereal, like something rising out of
 * the chip rather than a tooltip snapping on:
 *
 *   enter — after `delayMs` (the row's settle delay + a left-to-right stagger),
 *           grow from the tail up with a slight overshoot
 *   exit  — POP: swell and vanish, leaving a faint ring expanding outward
 *
 * `useHintBubblePresence` owns WHEN (it keeps a popping bubble mounted for
 * `popMs`); this file owns only HOW. Under `prefers-reduced-motion` both motions
 * collapse to a plain fade — the delay, stagger and scroll behaviour stay, since
 * they are timing rather than movement.
 *
 * The positioned wrapper carries the `translateX(-50%)` centring and the scaling
 * happens on the button inside it: one element cannot own both transforms, and an
 * animated `transform` would otherwise wipe the centring for its duration.
 *
 * The reading goes through `ForeignText` (the project rule — cpcd/`CPCDRow` are
 * private to it), with the character's default reading: context-naive, the same
 * accepted trade as § 6p's "Cell content".
 */
import { Box, useMediaQuery } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import ForeignText from '../../components/ForeignText';
import type { HintCharacter } from '../../components/handwriting/glyphLookup';
import { COLORS, SHADOW } from '../../theme';
import { HINT_MOTION } from './hintMotion';

interface HintBubbleProps {
  hint: HintCharacter;
  /** Horizontal centre of the chip this bubble belongs to, in px from the row's left edge. */
  anchorX: number;
  /** 'in' grows (after `delayMs`) and stays; 'out' pops and is then unmounted by the row. */
  phase: 'in' | 'out';
  /** Wait before the grow-in starts. Frozen at entry — see useHintBubblePresence. */
  delayMs: number;
  onSelect: (hint: HintCharacter) => void;
}

/** How far the tail reaches down past the bubble's body — into the row's top padding. */
const TAIL_SIZE = 7;

// Grow from the tail: starts as a speck at the chip, overshoots a touch, settles.
const growIn = keyframes({
  '0%': { transform: 'translateY(6px) scale(0.2)', opacity: 0 },
  '60%': { transform: 'translateY(-1px) scale(1.08)', opacity: 1 },
  '100%': { transform: 'translateY(0) scale(1)', opacity: 1 },
});

// The pop: a quick swell, then gone — a soap bubble, not a fade.
const popOut = keyframes({
  '0%': { transform: 'scale(1)', opacity: 1 },
  '35%': { transform: 'scale(1.16)', opacity: 0.9 },
  '100%': { transform: 'scale(1.3)', opacity: 0 },
});

// The film left behind by the pop: a thin ring that expands and dissolves.
const popRing = keyframes({
  '0%': { transform: 'translate(-50%, -50%) scale(0.8)', opacity: 0 },
  '25%': { opacity: 0.55 },
  '100%': { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 },
});

const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const fadeOut = keyframes({ from: { opacity: 1 }, to: { opacity: 0 } });

export default function HintBubble({ hint, anchorX, phase, delayMs, onSelect }: HintBubbleProps) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const popping = phase === 'out';

  // Plain ease-out: the overshoot lives in the keyframes. An overshooting curve on
  // top would bounce EACH keyframe segment and read as jitter, not a spring.
  // `both` holds the first keyframe (scale 0.2, transparent) through the delay, so
  // a bubble that has not appeared yet is invisible and — scaled to a speck —
  // effectively untappable. The pop needs no delay: it answers something the
  // learner just did.
  const bodyAnimation = popping
    ? `${reduceMotion ? fadeOut : popOut} ${HINT_MOTION.popMs}ms ease-out forwards`
    : `${reduceMotion ? fadeIn : growIn} ${HINT_MOTION.growMs}ms ease-out ${delayMs}ms both`;

  return (
    <Box
      className={`beginner-keyboard__hint-anchor beginner-keyboard__hint-anchor--${phase}`}
      sx={{
        position: 'absolute',
        left: anchorX,
        // The body's bottom edge sits on the row's top edge; the tail dips into
        // the row's padding and points at the chip.
        bottom: TAIL_SIZE - 2,
        transform: 'translateX(-50%)',
        // A popping bubble must not catch a tap meant for what is behind it.
        pointerEvents: popping ? 'none' : 'auto',
      }}
    >
      {popping && !reduceMotion && (
        <Box
          className="beginner-keyboard__hint-pop-ring"
          aria-hidden
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 46,
            height: 46,
            borderRadius: '50%',
            border: `1.5px solid ${COLORS.border}`,
            animation: `${popRing} ${HINT_MOTION.popMs}ms ease-out forwards`,
            pointerEvents: 'none',
          }}
        />
      )}
      <Box
        component="button"
        type="button"
        tabIndex={popping ? -1 : 0}
        className="beginner-keyboard__hint-bubble"
        aria-label={`Insert ${hint.text}`}
        // Belt and braces: the host already swallows mousedown so a keyboard tap never
        // moves focus off the field, but this button is the one control that renders
        // outside the keyboard's own box, so it guards itself too.
        onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
        onClick={() => onSelect(hint)}
        sx={{
          position: 'relative',
          display: 'flex',
          // Grow out of the tail's tip, i.e. out of the chip below.
          transformOrigin: `50% calc(100% + ${TAIL_SIZE}px)`,
          animation: bodyAnimation,
          minWidth: 44, // the platform tap-target floor, same as the chips
          minHeight: 44,
          px: 0.5,
          py: 0.25,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLORS.white,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 2,
          boxShadow: SHADOW.chip,
          cursor: 'pointer',
          // Darken rather than swap to `rowHoverBg`: that token is translucent, and
          // this bubble sits over the switch bar, which would show through it.
          '&:active': { filter: 'brightness(0.95)' },
          // The tail: a small square turned 45°, sharing the body's fill and showing
          // only its bottom/right border, so it reads as one outline with the body.
          '&::after': {
            content: '""',
            position: 'absolute',
            left: '50%',
            bottom: -TAIL_SIZE / 2 - 1,
            width: TAIL_SIZE,
            height: TAIL_SIZE,
            transform: 'translateX(-50%) rotate(45deg)',
            backgroundColor: 'inherit',
            borderRight: `1px solid ${COLORS.border}`,
            borderBottom: `1px solid ${COLORS.border}`,
          },
        }}
      >
        <ForeignText
          className="beginner-keyboard__hint-text"
          language="zh"
          text={hint.text}
          pronunciation={hint.pronunciation || undefined}
          showPinyin={hint.pronunciation !== ''}
          size="sm"
        />
      </Box>
    </Box>
  );
}

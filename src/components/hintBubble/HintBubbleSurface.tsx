/**
 * HintBubbleSurface — the shared look and motion of a hint bubble: a white,
 * outlined speech bubble with a downward tail, which GROWS out of its tail on
 * entry and POPS (swell + fading ring) on exit.
 *
 * LAYER: shared presentation (src/components — two features use it):
 *   - the beginner keyboard's glyph-chip hints (features/beginnerKeyboard/HintBubble,
 *     docs/BEGINNER_KEYBOARD.md § 6z-4), which positions it over a chip and commits on tap;
 *   - the writing flp's used-in bubbles (features/flashcards/FlashcardsLearnPage/
 *     WritingUsedInBubbles, docs/WRITING_PRACTICE_REWORK.md § 3), which are inert.
 *
 * It owns only HOW a bubble looks and animates. WHEN it enters / pops is the caller's
 * `useHintBubblePresence`; WHERE it sits is the caller's positioned wrapper (this
 * component is a `position: relative` box, so the pop ring can centre on it).
 *
 * Interactive vs inert: pass `onSelect` for a tappable `<button>`; omit it for a plain,
 * non-focusable `<div>` that never catches a tap.
 *
 * Motion notes (the bk's § 6z-4 "Motion" decisions, kept for every user):
 *   - Plain ease-out: the overshoot lives in the keyframes. An overshooting curve on
 *     top would bounce EACH keyframe segment and read as jitter, not a spring.
 *   - `both` holds the first keyframe (scale 0.2, transparent) through `delayMs`, so a
 *     bubble that has not appeared yet is invisible and — scaled to a speck —
 *     effectively untappable. The delay is pure CSS; it must be frozen at entry (see
 *     useHintBubblePresence) or a re-render would restart the grow.
 *   - The pop needs no delay: it answers something that just happened.
 *   - `prefers-reduced-motion`: grow and pop collapse to plain fades, no ring.
 */
import { Box, useMediaQuery } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { COLORS, SHADOW } from '../../theme';
import { HINT_MOTION } from './hintMotion';

/** How far the tail reaches down past the bubble's body. */
export const HINT_BUBBLE_TAIL_SIZE = 7;

// Grow from the tail: starts as a speck at whatever it points at, overshoots a touch, settles.
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

interface HintBubbleSurfaceProps {
  /** 'in' grows (after `delayMs`) and stays; 'out' pops — the caller unmounts it after `HINT_MOTION.popMs`. */
  phase: 'in' | 'out';
  /** Wait before the grow-in starts. Frozen at entry — see useHintBubblePresence. */
  delayMs: number;
  /** Descriptive class for the bubble body; the ring gets `${className}-pop-ring`. */
  className: string;
  /** Tappable when given (rendered as a button); inert when omitted. */
  onSelect?: () => void;
  /** Accessible name of the tappable bubble. */
  ariaLabel?: string;
  children: ReactNode;
}

export default function HintBubbleSurface({ phase, delayMs, className, onSelect, ariaLabel, children }: HintBubbleSurfaceProps) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const popping = phase === 'out';
  const interactive = !!onSelect && !popping;

  const bodyAnimation = popping
    ? `${reduceMotion ? fadeOut : popOut} ${HINT_MOTION.popMs}ms ease-out forwards`
    : `${reduceMotion ? fadeIn : growIn} ${HINT_MOTION.growMs}ms ease-out ${delayMs}ms both`;

  return (
    <Box
      className={`${className}-surface`}
      sx={{
        position: 'relative',
        // A popping (or inert) bubble must not catch a tap meant for what is behind it.
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {popping && !reduceMotion && (
        <Box
          className={`${className}-pop-ring`}
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
        {...(onSelect
          ? {
              component: 'button' as const,
              type: 'button' as const,
              tabIndex: popping ? -1 : 0,
              'aria-label': ariaLabel,
              // A tap must never move focus off whatever field the bubble serves
              // (the bk keeps the text field focused while the keyboard is up).
              onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
              onClick: onSelect,
            }
          : {})}
        className={className}
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          // Grow out of the tail's tip, i.e. out of what the bubble points at.
          transformOrigin: `50% calc(100% + ${HINT_BUBBLE_TAIL_SIZE}px)`,
          animation: bodyAnimation,
          minWidth: 44, // the platform tap-target floor
          minHeight: 44,
          px: 0.5,
          py: 0.25,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLORS.white,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 2,
          boxShadow: SHADOW.chip,
          cursor: onSelect ? 'pointer' : 'default',
          font: 'inherit',
          color: 'inherit',
          // Darken rather than swap to `rowHoverBg`: that token is translucent, and a
          // bubble usually floats over other content, which would show through it.
          ...(onSelect ? { '&:active': { filter: 'brightness(0.95)' } } : {}),
          // The tail: a small square turned 45°, sharing the body's fill and showing
          // only its bottom/right border, so it reads as one outline with the body.
          '&::after': {
            content: '""',
            position: 'absolute',
            left: '50%',
            bottom: -HINT_BUBBLE_TAIL_SIZE / 2 - 1,
            width: HINT_BUBBLE_TAIL_SIZE,
            height: HINT_BUBBLE_TAIL_SIZE,
            transform: 'translateX(-50%) rotate(45deg)',
            backgroundColor: 'inherit',
            borderRight: `1px solid ${COLORS.border}`,
            borderBottom: `1px solid ${COLORS.border}`,
          },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

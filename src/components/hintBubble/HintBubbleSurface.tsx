/**
 * HintBubbleSurface — the shared look and motion of a hint bubble: a white,
 * outlined speech bubble with a downward (or leftward) tail, which GROWS out of its tail on
 * entry and POPS (swell + fading ring) on exit.
 *
 * LAYER: shared presentation (src/components — two features use it):
 *   - the beginner keyboard's glyph-chip hints (features/beginnerKeyboard/HintBubble,
 *     docs/BEGINNER_KEYBOARD.md § 6z-4), which positions it over a chip and commits on tap;
 *   - the flp hint pawn's speech bubble (features/flashcards/FlashcardsLearnPage/
 *     hintPawn/HintPawn, docs/HINT_PAWN.md), which sits BESIDE the pawn and draws its own
 *     tail angled up at the pawn's head (`tailSide="custom"`); a tap on it closes it.
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

// The same grow for a bubble whose tail is on its LEFT edge: it comes in sideways.
const growInFromLeft = keyframes({
  '0%': { transform: 'translateX(-6px) scale(0.2)', opacity: 0 },
  '60%': { transform: 'translateX(1px) scale(1.04)', opacity: 1 },
  '100%': { transform: 'translateX(0) scale(1)', opacity: 1 },
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
  /**
   * Where along the bottom edge the tail sits, as a CSS length from the body's left
   * (default `'50%'`, centred). The grow-in starts from the tail's tip, so it moves too.
   */
  tailX?: string;
  /**
   * Which edge the tail is on: `'bottom'` (default — the bubble floats over what it points
   * at), `'left'` (it sits beside it, to the right; `tailY` places it), or `'custom'`: the
   * caller draws its own tail as a child (e.g. one angled at a point off the edge — the
   * hint pawn's head); the grow still comes in from the left edge at `tailY`.
   */
  tailSide?: 'bottom' | 'left' | 'custom';
  /** Where along the LEFT edge the tail sits (`tailSide="left"`), as a CSS length from the body's top. Default `'50%'`. */
  tailY?: string;
  /** Extra styles on the bubble body (e.g. a wider body, left-aligned content). */
  bodySx?: Record<string, unknown>;
  children: ReactNode;
}

export default function HintBubbleSurface({ phase, delayMs, className, onSelect, ariaLabel, tailX = '50%', tailSide = 'bottom', tailY = '50%', bodySx, children }: HintBubbleSurfaceProps) {
  const tailLeft = tailSide !== 'bottom';
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const popping = phase === 'out';
  const interactive = !!onSelect && !popping;

  const bodyAnimation = popping
    ? `${reduceMotion ? fadeOut : popOut} ${HINT_MOTION.popMs}ms ease-out forwards`
    : `${reduceMotion ? fadeIn : tailLeft ? growInFromLeft : growIn} ${HINT_MOTION.growMs}ms ease-out ${delayMs}ms both`;

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
          transformOrigin: tailLeft
            ? `-${HINT_BUBBLE_TAIL_SIZE}px ${tailY}`
            : `${tailX} calc(100% + ${HINT_BUBBLE_TAIL_SIZE}px)`,
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
          ...bodySx,
          // The tail: a small square turned 45°, sharing the body's fill and showing
          // only the two borders that face out (bottom/right for a bottom tail,
          // bottom/left for a left one), so it reads as one outline with the body.
          '&::after': tailSide === 'custom' ? undefined : {
            content: '""',
            position: 'absolute',
            width: HINT_BUBBLE_TAIL_SIZE,
            height: HINT_BUBBLE_TAIL_SIZE,
            backgroundColor: 'inherit',
            ...(tailLeft
              ? {
                  top: tailY,
                  left: -HINT_BUBBLE_TAIL_SIZE / 2 - 1,
                  transform: 'translateY(-50%) rotate(45deg)',
                  borderLeft: `1px solid ${COLORS.border}`,
                  borderBottom: `1px solid ${COLORS.border}`,
                }
              : {
                  left: tailX,
                  bottom: -HINT_BUBBLE_TAIL_SIZE / 2 - 1,
                  transform: 'translateX(-50%) rotate(45deg)',
                  borderRight: `1px solid ${COLORS.border}`,
                  borderBottom: `1px solid ${COLORS.border}`,
                }),
          },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

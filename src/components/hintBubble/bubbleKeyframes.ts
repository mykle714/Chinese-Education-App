/**
 * The bubble motion's keyframes — grow in (with a small overshoot), pop out (swell + fade)
 * and the pop's fading ring:
 *   - HintBubbleSurface (the bk's glyph-chip hints, the flp hint pawn's speech bubble)
 *     plays all of them;
 *   - CpcdPopup (the est's segment definition box, CPCDRow's copy message, the eip sense
 *     list's commonality popup) plays only the grow-in + `fadeOut` — its exit is a plain
 *     fade, the pop being too loud for a caption (owner's call 2026-11-10).
 * Timing lives with them in `HINT_MOTION` (./hintMotion.ts). Played with a plain ease-out:
 * the overshoot is in the keyframes, and an overshooting curve on top would bounce each
 * segment (docs/BEGINNER_KEYBOARD.md § 6z-4 "Motion").
 *
 * Its own non-component module so both component files keep exporting only components
 * (React fast refresh).
 */
import { keyframes } from '@mui/material/styles';

// Grow from below: starts as a speck at whatever it floats ABOVE, overshoots a touch, settles.
export const growIn = keyframes({
  '0%': { transform: 'translateY(6px) scale(0.2)', opacity: 0 },
  '60%': { transform: 'translateY(-1px) scale(1.08)', opacity: 1 },
  '100%': { transform: 'translateY(0) scale(1)', opacity: 1 },
});

// The mirror of `growIn`, for a bubble that floats BELOW what it points at (a popup Popper
// flipped under its anchor): it grows downward out of the anchor.
export const growInFromAbove = keyframes({
  '0%': { transform: 'translateY(-6px) scale(0.2)', opacity: 0 },
  '60%': { transform: 'translateY(1px) scale(1.08)', opacity: 1 },
  '100%': { transform: 'translateY(0) scale(1)', opacity: 1 },
});

// The same grow for a bubble whose tail is on its LEFT edge: it comes in sideways.
export const growInFromLeft = keyframes({
  '0%': { transform: 'translateX(-6px) scale(0.2)', opacity: 0 },
  '60%': { transform: 'translateX(1px) scale(1.04)', opacity: 1 },
  '100%': { transform: 'translateX(0) scale(1)', opacity: 1 },
});

// The pop: a quick swell, then gone — a soap bubble, not a fade.
export const popOut = keyframes({
  '0%': { transform: 'scale(1)', opacity: 1 },
  '35%': { transform: 'scale(1.16)', opacity: 0.9 },
  '100%': { transform: 'scale(1.3)', opacity: 0 },
});

// The film left behind by the pop: a thin ring that expands and dissolves. Centred on its
// box by `left/top: 50%` + the translate baked in here.
export const popRing = keyframes({
  '0%': { transform: 'translate(-50%, -50%) scale(0.8)', opacity: 0 },
  '25%': { opacity: 0.55 },
  '100%': { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 },
});

// `prefers-reduced-motion`: grow and pop collapse to these.
export const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
export const fadeOut = keyframes({ from: { opacity: 1 }, to: { opacity: 0 } });

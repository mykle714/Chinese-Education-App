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
 *   enter — after `delayMs` (the row's settle delay + a stagger in random order),
 *           grow from the tail up with a slight overshoot
 *   exit  — POP: swell and vanish, leaving a faint ring expanding outward
 *
 * `useHintBubblePresence` owns WHEN (it keeps a popping bubble mounted for
 * `popMs`); this file owns only HOW. Under `prefers-reduced-motion` both motions
 * collapse to a plain fade — the delay, stagger and scroll behaviour stay, since
 * they are timing rather than movement.
 *
 * The look and the grow / pop keyframes live in the shared
 * `components/hintBubble/HintBubbleSurface` (also used by the writing flp's used-in
 * bubbles). This file is the bk's wrapper: it positions the surface over its chip
 * and commits on tap. The positioned wrapper carries the `translateX(-50%)` centring
 * and the scaling happens on the surface inside it: one element cannot own both
 * transforms, and an animated `transform` would otherwise wipe the centring.
 *
 * The reading goes through `ForeignText` (the project rule — cpcd/`CPCDRow` are
 * private to it), with the character's default reading: context-naive, the same
 * accepted trade as § 6p's "Cell content".
 */
import { Box } from '@mui/material';
import ForeignText from '../../components/ForeignText';
import type { HintCharacter } from '../../components/handwriting/glyphLookup';
import HintBubbleSurface, { HINT_BUBBLE_TAIL_SIZE } from '../../components/hintBubble/HintBubbleSurface';

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

export default function HintBubble({ hint, anchorX, phase, delayMs, onSelect }: HintBubbleProps) {
  return (
    <Box
      className={`beginner-keyboard__hint-anchor beginner-keyboard__hint-anchor--${phase}`}
      sx={{
        position: 'absolute',
        left: anchorX,
        // The body's bottom edge sits on the row's top edge; the tail dips into
        // the row's padding and points at the chip.
        bottom: HINT_BUBBLE_TAIL_SIZE - 2,
        transform: 'translateX(-50%)',
      }}
    >
      <HintBubbleSurface
        phase={phase}
        delayMs={delayMs}
        className="beginner-keyboard__hint-bubble"
        ariaLabel={`Insert ${hint.text}`}
        onSelect={() => onSelect(hint)}
      >
        <ForeignText
          className="beginner-keyboard__hint-text"
          language="zh"
          text={hint.text}
          pronunciation={hint.pronunciation || undefined}
          showPinyin={hint.pronunciation !== ''}
          size="sm"
        />
      </HintBubbleSurface>
    </Box>
  );
}

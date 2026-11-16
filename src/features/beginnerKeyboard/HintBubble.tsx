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
 * showing — a hint only shows while there is ink AND a buffer, i.e. mid-character,
 * which is not when a learner reaches for 写/ABC. (§ 6z-7's covers bubble needs
 * only ink, so it can also sit over the bar while the first component is drawn.)
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO KINDS OF CONTENT
 *
 *   'hint'   — § 6z-4: a character the chip is on track to spell, with its pinyin.
 *   'covers' — § 6z-7: the look-alike this merged chip also stands for (土's chip
 *              → 士), with the word "covers" in the pinyin line above it. It takes
 *              priority over a hint on the same chip (the row decides that).
 *
 * The 'covers' bubble must be EXACTLY the size of a 'hint' bubble, but with the
 * label ON TOP — and CPCDRow puts its pinyin BELOW the glyph. So it is a plain
 * text band stacked over a PINYINLESS `ForeignText` row. The band is exactly the
 * height CPCDRow would have reserved for the pinyin (`PINYIN_RESERVED_HEIGHT`), so
 * band + row add up to the hint's row height. The WIDTH is deliberately NOT the
 * hint's (owner, 2026-11-15): the label sits in normal flow with a little side
 * padding, so the word "covers" sizes the bubble — a visibly wider bubble that
 * reads as a different kind from the glyph-wide hints.
 * The label is set in the pinyin's own font metrics (size, line height, condensed,
 * regular weight) in the muted secondary ink; the glyph keeps the primary ink.
 */
import { Box } from '@mui/material';
import ForeignText from '../../components/ForeignText';
import type { HintCharacter } from '../../components/handwriting/glyphLookup';
import HintBubbleSurface, { HINT_BUBBLE_TAIL_SIZE } from '../../components/hintBubble/HintBubbleSurface';
import { COLORS } from '../../theme';
import { FONTS } from '../../theme/fonts';
import { WEIGHT } from '../../theme/scale';
import { PINYIN_FONT_SIZE, PINYIN_RESERVED_HEIGHT, VERTICAL_PADDING, type CPCDSize } from '../../components/cpcdLayout';

/** What a bubble shows — see "TWO KINDS OF CONTENT" above. */
export type HintBubbleContent =
  | { kind: 'hint'; hint: HintCharacter }
  | { kind: 'covers'; glyph: string };

/** The label drawn in the band above a 'covers' bubble's glyph. */
const COVERS_LABEL = 'covers';

/** The cpcd size both bubble kinds render at — shared so their sizes cannot drift. */
const BUBBLE_CPCD_SIZE: CPCDSize = 'sm';

/**
 * Space under the covers glyph. A pinyinless CPCDRow pads its glyph on TOP only
 * (`VERTICAL_PADDING`) — the bottom padding exists only to hold pinyin — so the
 * glyph would sit flush on the bubble's floor. Half the top padding goes below it
 * (owner, 2026-11-15: a 2px split): the full 4px lifted the glyph enough but left
 * "covers" crowding the top edge, and halving it brings both down 2px together.
 * The label band gives up the same amount, so the bubble's total height still
 * matches a hint's.
 */
const COVERS_GLYPH_FLOOR_PX = parseFloat(VERTICAL_PADDING[BUBBLE_CPCD_SIZE]) / 2;

interface HintBubbleProps {
  content: HintBubbleContent;
  /** Horizontal centre of the chip this bubble belongs to, in px from the row's left edge. */
  anchorX: number;
  /** 'in' grows (after `delayMs`) and stays; 'out' pops and is then unmounted by the row. */
  phase: 'in' | 'out';
  /** Wait before the grow-in starts. Frozen at entry — see useHintBubblePresence. */
  delayMs: number;
  /** The row binds what a tap means: commit the hint, or select the covering chip. */
  onSelect: () => void;
}

export default function HintBubble({ content, anchorX, phase, delayMs, onSelect }: HintBubbleProps) {
  const covers = content.kind === 'covers';
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
        className={covers ? 'beginner-keyboard__covers-bubble' : 'beginner-keyboard__hint-bubble'}
        ariaLabel={covers ? `Also covers ${content.glyph}` : `Insert ${content.hint.text}`}
        onSelect={onSelect}
      >
        {covers ? (
          <Box className="beginner-keyboard__covers-content" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* The band: the pinyin's reserved height, moved from below the glyph to above it. */}
            <Box
              className="beginner-keyboard__covers-label-band"
              sx={{
                display: 'flex',
                alignItems: 'flex-end',
                height: PINYIN_RESERVED_HEIGHT[BUBBLE_CPCD_SIZE] - COVERS_GLYPH_FLOOR_PX,
                // In flow, so the label's width (plus this light padding) sets the bubble's.
                px: '3px',
              }}
            >
              <Box
                component="span"
                className="beginner-keyboard__covers-label"
                sx={{
                  whiteSpace: 'nowrap',
                  fontFamily: FONTS.sans,
                  fontSize: PINYIN_FONT_SIZE[BUBBLE_CPCD_SIZE],
                  fontWeight: WEIGHT.regular,
                  fontStretch: 'condensed',
                  // A tight line box: the shortened band leaves no room for pinyin
                  // leading, and "covers" has no ascenders or descenders to clip.
                  lineHeight: 1,
                  color: COLORS.textSecondary,
                }}
              >
                {COVERS_LABEL}
              </Box>
            </Box>
            {/* No pronunciation → CPCDRow reserves no pinyin space below the glyph.
                The wrapper re-points `--cjk-font` (which FONTS.cjk reads) at the
                component face: a covered glyph can be a bound form Google's Noto Sans
                SC subset does not serve (§ 6z-13's ⺈), and the chips themselves are
                pinned to FONTS.hanziComponents whatever the learner's Chinese typeface. */}
            <Box
              className="beginner-keyboard__covers-text-face"
              sx={{ '--cjk-font': FONTS.hanziComponents }}
            >
              <ForeignText
                className="beginner-keyboard__covers-text"
                language="zh"
                text={content.glyph}
                characterColor={COLORS.onSurface}
                size={BUBBLE_CPCD_SIZE}
              />
            </Box>
            <Box className="beginner-keyboard__covers-glyph-floor" sx={{ height: COVERS_GLYPH_FLOOR_PX }} />
          </Box>
        ) : (
          <ForeignText
            className="beginner-keyboard__hint-text"
            language="zh"
            text={content.hint.text}
            pronunciation={content.hint.pronunciation || undefined}
            showPinyin={content.hint.pronunciation !== ''}
            size={BUBBLE_CPCD_SIZE}
          />
        )}
      </HintBubbleSurface>
    </Box>
  );
}

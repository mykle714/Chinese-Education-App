/**
 * CandidateRow — the strip along the top of the beginner keyboard.
 *
 * LAYER: presentation. Paints whatever `useComposition` decided; it does not
 * consult the recognizers, and it never works out what a tap means — the
 * candidate's own `action` carries that.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6p (the bar), § 6r (its modality).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS ROW IS MODAL, AND THAT IS THE DESIGN'S ONE REAL RISK (§ 6r)
 *
 * The same strip shows ink guesses while drawing and buffer results when the
 * canvas is empty. Nothing about a row of Chinese characters says which it is,
 * so the mode is signalled by a ground colour AND the chip outline, rather than
 * by colour alone — colour on its own would fail exactly the users this keyboard
 * is for. The row USED to carry a third cue, a vertical text label ("What you
 * drew" / "Tap to insert"); it was dropped by product decision (2026-09-09) to
 * give the chips the full width, so the two remaining channels are now the whole
 * of the modality signal.
 *
 * ⚠️ NEVER RENDERS EMPTY WHILE THERE IS INK. With no clear button (§ 6r), an
 * empty row would strand the learner with ink they cannot remove: submission is
 * the only exit, and submission needs something to tap. The matcher guarantees
 * candidates for any non-empty ink; the empty state here is only ever "canvas
 * clean, buffer clean".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESKTOP-ONLY SCROLL ARROWS
 *
 * The strip overflows horizontally whenever the matcher returns more chips than
 * fit. A touch user just swipes it (`touchAction: 'pan-x'`), but a mouse user has
 * no equivalent gesture — a vertical wheel does not scroll a horizontal box, and
 * the scrollbar is hidden. So on pointer-fine devices only, the scroller is
 * flanked by two arrow buttons that page it by ~80% of its visible width.
 *
 * That behaviour is no longer implemented here: it lives in
 * `useHorizontalScrollArrows` + `ScrollArrow`, shared with the iw composer's hint
 * tray, which needed the identical pattern. All this file still supplies is the
 * per-mode accent colour the arrows take.
 */
import { Box, Typography } from '@mui/material';
import ScrollArrow from '../../components/ScrollArrow';
import { useHorizontalScrollArrows } from '../../hooks/useHorizontalScrollArrows';
import { COLORS, FONTS, SIZE } from '../../theme';
import type { Candidate, CandidateMode } from './useComposition';

interface CandidateRowProps {
  candidates: Candidate[];
  mode: CandidateMode;
  /** True while the templates are still downloading. */
  loading: boolean;
  onSelect: (candidate: Candidate) => void;
}

/** Per-mode chrome. Kept as data so the two modes cannot drift apart in styling. */
const MODE_STYLE: Record<CandidateMode, { ground: string; chip: string; accent: string }> = {
  // Drawing: the row is a guess about the ink, so it is tinted and clearly "live".
  glyph: { ground: COLORS.bluTint, chip: COLORS.white, accent: COLORS.bluA },
  // Idle: the row is the result of the buffer, which is the committing surface.
  result: { ground: COLORS.grnTint, chip: COLORS.white, accent: COLORS.grnA },
};

export default function CandidateRow({ candidates, mode, loading, onSelect }: CandidateRowProps) {
  const style = MODE_STYLE[mode];

  // Desktop-only paging arrows for the overflowing chip strip; see the shared hook. The
  // candidate list is replaced on every stroke, so it is the re-measure trigger.
  const { scrollerRef, showArrows, canScrollLeft, canScrollRight, page, onScroll } =
    useHorizontalScrollArrows({ deps: candidates });

  /** One arrow, in this row's current mode colour. Mounted only while the strip overflows. */
  const arrow = (direction: -1 | 1) => {
    if (!showArrows) return null;
    return (
      <ScrollArrow
        direction={direction}
        enabled={direction === -1 ? canScrollLeft : canScrollRight}
        onClick={() => page(direction)}
        classBlock="beginner-keyboard__candidate"
        accentColor={style.accent}
        label={direction === -1 ? 'Scroll candidates left' : 'Scroll candidates right'}
      />
    );
  };

  return (
    <Box
      className="beginner-keyboard__candidate-row"
      sx={{
        display: 'flex',
        alignItems: 'center',
        px: 1.25,
        py: 0.75,
        minHeight: 56,
        backgroundColor: style.ground,
        borderBottom: `1px solid ${COLORS.rowBorder}`,
      }}
    >
      {arrow(-1)}

      <Box
        ref={scrollerRef}
        className="beginner-keyboard__candidate-scroller"
        onScroll={onScroll}
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          // The scroller is the one horizontally scrolling surface in the keyboard;
          // the app is otherwise touchAction: none, so this opts in deliberately.
          overflowX: 'auto',
          overflowY: 'hidden',
          touchAction: 'pan-x',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {candidates.length === 0 ? (
          <Typography
            className="beginner-keyboard__candidate-row-empty"
            sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, pl: 0.5 }}
          >
            {loading ? 'Loading handwriting data…' : 'Draw a component or a whole character'}
          </Typography>
        ) : (
          candidates.map((candidate, position) => (
            <Box
              component="button"
              type="button"
              // Index is part of the key because the same glyph can legitimately
              // appear twice across a re-rank; text alone is not unique.
              key={`${candidate.text}-${position}`}
              className={`beginner-keyboard__candidate beginner-keyboard__candidate--${candidate.action}`}
              onClick={() => onSelect(candidate)}
              sx={{
                flexShrink: 0,
                minWidth: 44, // the platform tap-target floor
                height: 44,
                px: candidate.text.length > 1 ? 1.25 : 0,
                border: `1px solid ${candidate.action === 'commit' ? style.accent : COLORS.border}`,
                // A commit chip is filled, an append chip is outlined — the second
                // channel behind the ground colour, so the two tap meanings differ
                // in shape and not only in colour.
                borderWidth: candidate.action === 'commit' ? 2 : 1,
                borderRadius: 2,
                backgroundColor: style.chip,
                cursor: 'pointer',
                fontFamily: FONTS.hanziComponents,
                fontSize: SIZE.title,
                lineHeight: 1,
                color: COLORS.onSurface,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '&:active': { backgroundColor: COLORS.rowHoverBg },
              }}
            >
              {candidate.text}
            </Box>
          ))
        )}
      </Box>

      {arrow(1)}
    </Box>
  );
}

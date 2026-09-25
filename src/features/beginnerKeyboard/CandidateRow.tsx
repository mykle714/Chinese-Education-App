/**
 * CandidateRow — the strip along the top of the beginner keyboard.
 *
 * LAYER: presentation. Paints whatever `useComposition` decided; it does not
 * consult the recognizers, and it never works out what a tap means — the
 * candidate's own `action` carries that.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6p (the bar), § 6r (its modality), § 6z-4
 * (hint bubbles).
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HINT BUBBLES (§ 6z-4)
 *
 * A glyph chip may carry a `hint`; its bubble floats ABOVE the row, over the
 * switch bar. It cannot live inside the scroller — `overflow-x: auto` forces the
 * scroller to clip vertically too, so anything poking out of the strip would be
 * cut off. Instead the bubbles sit in a zero-height layer pinned to the row's top
 * edge, and each one is placed at its chip's measured centre. The measurement is
 * redone whenever the chips change, the row resizes, or a scroll comes to rest,
 * and a bubble whose chip is out of view is not painted. The motion — delayed,
 * staggered grow-in, pop on exit, pop-while-scrolling — is described in
 * HintBubble.tsx and useHintBubblePresence.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import ScrollArrow from '../../components/ScrollArrow';
import { useHorizontalScrollArrows } from '../../hooks/useHorizontalScrollArrows';
import { COLORS, FONTS, SIZE } from '../../theme';
import type { HintCharacter } from '../../components/handwriting/glyphLookup';
import HintBubble from './HintBubble';
import { HINT_MOTION } from './hintMotion';
import { useHintBubblePresence, type PresenceItem } from './useHintBubblePresence';
import type { Candidate, CandidateMode } from './useComposition';

interface CandidateRowProps {
  candidates: Candidate[];
  mode: CandidateMode;
  /** True while the templates are still downloading. */
  loading: boolean;
  onSelect: (candidate: Candidate) => void;
  /** § 6z-4: a hint bubble was tapped. The keyboard decides what that means. */
  onSelectHint: (hint: HintCharacter) => void;
}

/**
 * Per-mode chrome. Kept as data so the two modes cannot drift apart in styling.
 * The GROUND tint says which mode the row is in; the accent (scroll arrows, the commit
 * chip's border) is ink in both — v2 has no per-hue ink tier.
 */
const MODE_STYLE: Record<CandidateMode, { ground: string; chip: string; accent: string }> = {
  // Drawing: the row is a guess about the ink, so it is tinted and clearly "live".
  glyph: { ground: COLORS.bluTint, chip: COLORS.white, accent: COLORS.onSurface },
  // Idle: the row is the result of the buffer, which is the committing surface.
  result: { ground: COLORS.grnTint, chip: COLORS.white, accent: COLORS.onSurface },
};

export default function CandidateRow({ candidates, mode, loading, onSelect, onSelectHint }: CandidateRowProps) {
  const style = MODE_STYLE[mode];

  // Desktop-only paging arrows for the overflowing chip strip; see the shared hook. The
  // candidate list is replaced on every stroke, so it is the re-measure trigger.
  const { scrollerRef, showArrows, canScrollLeft, canScrollRight, page, onScroll } =
    useHorizontalScrollArrows({ deps: candidates });

  // ── § 6z-4 hint-bubble anchoring ──────────────────────────────────────────
  const rowRef = useRef<HTMLDivElement | null>(null);
  // Chip elements by position, filled by callback refs; stale slots past the
  // current length are ignored because measurement iterates `candidates`.
  const chipRefs = useRef<(HTMLElement | null)[]>([]);
  /**
   * Chip centre per position (px from the row's left edge), or null when scrolled
   * out of view — tagged with the candidate list it was measured FOR. For one
   * render after the chips change, the measurement still describes the old list;
   * the tag is how the bubble derivation below knows to wait for the re-measure.
   */
  const [anchors, setAnchors] = useState<{ for: Candidate[]; xs: (number | null)[] }>({ for: [], xs: [] });
  const hasHints = candidates.some((candidate) => candidate.hint);

  const measureAnchors = useCallback(() => {
    const row = rowRef.current;
    const scroller = scrollerRef.current;
    if (!row || !scroller || !hasHints) {
      setAnchors({ for: candidates, xs: [] });
      return;
    }
    const rowLeft = row.getBoundingClientRect().left;
    const view = scroller.getBoundingClientRect();
    setAnchors({
      for: candidates,
      xs: candidates.map((candidate, position) => {
        const chip = chipRefs.current[position];
        if (!candidate.hint || !chip) return null;
        const box = chip.getBoundingClientRect();
        const centre = box.left + box.width / 2;
        // Only paint a bubble whose chip's centre is inside the visible strip —
        // otherwise it would float over the scroll arrows or off the row's edge.
        return centre >= view.left && centre <= view.right ? centre - rowLeft : null;
      }),
    });
  }, [candidates, hasHints, scrollerRef]);

  // Layout effect, not effect: the bubbles must land on their chips in the same
  // frame the chips appear, or they visibly jump on every stroke.
  useLayoutEffect(() => {
    measureAnchors();
    const scroller = scrollerRef.current;
    if (!scroller || !hasHints) return;
    const observer = new ResizeObserver(measureAnchors);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [measureAnchors, hasHints, scrollerRef]);

  /**
   * § 6z-4 "Motion": while the learner slides the strip hunting for more, every
   * bubble pops; once the strip has been still for `scrollSettleMs` they are
   * re-measured and grow back in, staggered, over wherever the chips came to rest.
   * Measuring is skipped mid-scroll — nothing is shown then, so it would be wasted.
   *
   * The ref mirrors the state so a burst of scroll events sets state once, not
   * on every event.
   */
  const [scrolling, setScrolling] = useState(false);
  const scrollingRef = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = useCallback(() => {
    onScroll();
    if (!hasHints) return;
    if (!scrollingRef.current) {
      scrollingRef.current = true;
      setScrolling(true);
    }
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      scrollingRef.current = false;
      measureAnchors();
      setScrolling(false);
    }, HINT_MOTION.scrollSettleMs);
  }, [onScroll, hasHints, measureAnchors]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  /**
   * The bubbles that SHOULD be up right now, for the presence hook to reconcile
   * against. Keyed by chip POSITION + glyph + hinted character, so a bubble
   * survives a stroke only if its chip stayed in the same slot with the same hint.
   * A chip that moves gets a new key: its old bubble pops and a new one grows in
   * over the new slot (decided 2026-09-24 — bubbles never slide sideways). The
   * position also makes the key unique when a glyph repeats across a re-rank.
   *
   * null = "anchors are stale, hold still" (see `useHintBubblePresence`).
   */
  const desiredBubbles = useMemo<PresenceItem<{ hint: HintCharacter; anchorX: number }>[] | null>(() => {
    if (scrolling || !hasHints) return [];
    if (anchors.for !== candidates) return null;
    const out: PresenceItem<{ hint: HintCharacter; anchorX: number }>[] = [];
    candidates.forEach((candidate, position) => {
      const anchorX = anchors.xs[position];
      if (!candidate.hint || anchorX == null) return;
      out.push({
        key: `${position}|${candidate.text}|${candidate.hint.text}`,
        order: anchorX,
        value: { hint: candidate.hint, anchorX },
      });
    });
    return out;
  }, [scrolling, hasHints, anchors, candidates]);

  const bubbles = useHintBubblePresence(desiredBubbles, {
    enterDelayMs: HINT_MOTION.enterDelayMs,
    staggerMs: HINT_MOTION.staggerMs,
    exitMs: HINT_MOTION.popMs,
  });

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
      ref={rowRef}
      className="beginner-keyboard__candidate-row"
      sx={{
        // Positioned (and lifted) so the § 6z-4 bubble layer can hang off its top
        // edge and paint over the switch bar, which precedes it in the DOM.
        position: 'relative',
        zIndex: 1,
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
        onScroll={handleScroll}
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
              ref={(element: HTMLElement | null) => {
                chipRefs.current[position] = element;
              }}
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

      {/* Mounted while ANY bubble is up — including popping ones after the hints
          are gone (a commit, a cleared canvas), so the pop gets to play. */}
      {bubbles.length > 0 && (
        <Box
          className="beginner-keyboard__hint-layer"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: '100%',
            height: 0,
            // The layer itself must not swallow taps on the switch bar beneath it;
            // each bubble opts back in.
            pointerEvents: 'none',
          }}
        >
          {bubbles.map((bubble) => (
            <HintBubble
              key={bubble.key}
              hint={bubble.value.hint}
              anchorX={bubble.value.anchorX}
              phase={bubble.phase}
              delayMs={bubble.delayMs}
              onSelect={onSelectHint}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

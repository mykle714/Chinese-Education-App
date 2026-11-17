/**
 * CandidateRow — the strip along the top of the beginner keyboard.
 *
 * LAYER: presentation. Paints whatever `useComposition` decided; it does not
 * consult the recognizers, and it never works out what a tap means — the
 * candidate's own `action` carries that.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6p (the bar), § 6r (its modality), § 6z-4
 * (hint bubbles), § 6z-8 (the blue direct-commit section).
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
 * The one exception to "one mode per row" is § 6z-8's DIRECT-COMMIT SECTION: in
 * glyph mode the strip may open with a single chip on a GREEN ground — the
 * result row's own colour, because it commits exactly as a result chip does —
 * repeating the top guess so a whole character the learner drew goes straight
 * to the field. It sits OUTSIDE the scroller, so it never scrolls away, and a
 * hairline divider plus the commit chip's filled border separate it from the
 * blue chips without relying on the two pale tints alone.
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
 * `useHorizontalScrollArrows` + `ScrollArrow`, extracted when Immersive World's composer
 * hint tray (removed 2026-11-09, archived — docs/ARCHIVED_FEATURES.md) needed the identical pattern. All this file still supplies is the
 * per-mode accent colour the arrows take.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HINT BUBBLES (§ 6z-4)
 *
 * A glyph chip may carry a `hint` (§ 6z-4) or a `covers` (§ 6z-7) — one bubble per
 * chip, `covers` first (see `bubbleContentFor`). The bubble floats ABOVE the row, over the
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
import { COLORS, FONTS, SIZE, WEIGHT } from '../../theme';
import type { HintCharacter } from '../../components/handwriting/glyphLookup';
import HintBubble, { type HintBubbleContent } from './HintBubble';
import ComponentGlyph from '../../components/handwriting/ComponentGlyph';
import { HINT_MOTION } from '../../components/hintBubble/hintMotion';
import { useHintBubblePresence, type PresenceItem } from '../../components/hintBubble/useHintBubblePresence';
import type { Candidate, CandidateMode } from './useComposition';
import { KEYBOARD_COLORS } from './keyboardColors';
import { CHAR_KEY_FACE, KEY_LIP, KEY_RADIUS, keyFaceHeightForShownAspect, keyPressSx, whiteKeySx } from './keycapStyle';

interface CandidateRowProps {
  candidates: Candidate[];
  /** § 6z-8: the blue direct-commit chip leading a glyph-mode row, or null. */
  directCandidate: Candidate | null;
  mode: CandidateMode;
  /** True while the templates are still downloading. */
  loading: boolean;
  onSelect: (candidate: Candidate) => void;
  /** § 6z-4: a hint bubble was tapped. The keyboard decides what that means. */
  onSelectHint: (hint: HintCharacter) => void;
}

/**
 * A candidate chip's face, px (square for a one-glyph chip; a multi-glyph chip grows
 * wider). The shared CHAR_KEY_FACE, so the ink keys below the parts match it.
 * Read by renderChip. Docs: docs/BEGINNER_KEYBOARD.md § 6z-12.
 */
const CHIP_FACE = CHAR_KEY_FACE;

/** How far each chip's invisible tap target reaches past its face, px: (44 − 38) / 2. */
const CHIP_HIT_SLOP = (44 - CHIP_FACE) / 2;

/** How wide the scroller's edge fade is, px, at an edge that has chips cut off past it. */
const EDGE_FADE_PX = 24;

/**
 * Per-mode chrome. Kept as data so the two modes cannot drift apart in styling.
 * The GROUND tint says which mode the row is in; the accent (the scroll arrows) is ink
 * in both — v2 has no per-hue ink tier.
 */
const MODE_STYLE: Record<CandidateMode, { ground: string; chip: string; accent: string }> = {
  // The two grounds (owner, 2026-11-15; were the near-white bluTint / grnTint, then
  // briefly the Deck Tower's saturated gld / bluMk, then yel / blu surfaces, then org mid / blu surface):
  //   drawing — the org ramp's MID, the gold of the Friends page's friend-code card
  //             (FriendsBody → RAMP.org.mid), so the app has one "gold" fill;
  //   idle    — the blu ramp's MID, the 写 switch key's face (KeyboardSwitchBar →
  //             SEGMENTS), so both grounds sit on the same MID tier and weigh the same.
  // Drawing: the row is a guess about the ink, so it is tinted and clearly "live".
  glyph: { ground: COLORS.orgM, chip: COLORS.white, accent: COLORS.onSurface },
  // Idle: the row is the result of the buffer, which is the committing surface.
  result: { ground: COLORS.bluM, chip: COLORS.white, accent: COLORS.onSurface },
};

/**
 * The EMPTY row (canvas clean, buffer clean — the only time it has no chips) sits on a
 * gold, not the idle blue (owner, 2026-11-15). Nothing on it commits, so blue's "this
 * commits" meaning would be wrong; gold is the colour the row turns the moment the
 * learner starts drawing, so the empty row previews the drawing state its hint is about.
 * It is the org ramp's SURFACE step (`org`), one step paler than the drawing ground's
 * MID (`orgM`) (owner, 2026-11-17): a faded preview of the live gold, so the resting row
 * recedes behind its hint and the first stroke visibly "lights" it up to full gold.
 */
const EMPTY_GROUND = COLORS.org;

/**
 * The empty row's one-line hint (owner, 2026-11-15; rewritten 2026-11-17). Every
 * learner knows to draw in the canvas; what they don't know is how this differs from
 * the OS Chinese keyboard: you build a character out of its COMPONENTS, one at a time —
 * and "component" means nothing until you see one. So the row shows one worked example,
 * phrased as an option ("you can") rather than an order: "To get 你, you can use
 * 亻 + 尔". Wording
 * history, all 2026-11-17 unless noted: "To write 你, draw 亻 then 尔" (2026-11-15, read as a
 * command) → "e.g. …" prefix → the equation "亻 + 尔 = 你" (read as intimidating and
 * unclear) → "Try it: Build 你 from parts like 亻 & 尔" (prefix dropped for width
 * and brevity, & → +) → "Build 你 from parts like 亻 + 尔" → this.
 * 你 from 亻 and 尔: its left and right halves (owner, 2026-11-15; was 好 from 女, 子). NOT the
 * three leaves `dictionaryentries_zh.components` stores (`[亻, ⺈, 小]`) — ⺈ teaches
 * nothing to a beginner, and it needn't: drawing 尔 works because the buffer expands a
 * decomposable glyph to its leaves on entry (glyphLookup.ts → expandGlyph, whose doc
 * uses this very character). Docs: docs/BEGINNER_KEYBOARD.md § 6p.
 */
const EXAMPLE_TARGET = '你';
const EXAMPLE_COMPONENTS = ['亻', '尔'] as const;

/** One bubble the presence hook tracks: what it shows, the chip it belongs to, where. */
interface BubbleValue {
  content: HintBubbleContent;
  candidate: Candidate;
  anchorX: number;
}

/**
 * The ONE bubble a chip gets, if any. § 6z-7's "covers" bubble wins over a § 6z-4
 * hint: a merged chip silently answers for its look-alike, and saying so matters
 * more than a suggestion the learner can still reach through the result row.
 */
function bubbleContentFor(candidate: Candidate): HintBubbleContent | null {
  if (candidate.covers) return { kind: 'covers', glyph: candidate.covers };
  if (candidate.hint) return { kind: 'hint', hint: candidate.hint };
  return null;
}

export default function CandidateRow({
  candidates,
  directCandidate,
  mode,
  loading,
  onSelect,
  onSelectHint,
}: CandidateRowProps) {
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
  const hasHints = candidates.some((candidate) => bubbleContentFor(candidate));

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
        if (!bubbleContentFor(candidate) || !chip) return null;
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
  const desiredBubbles = useMemo<PresenceItem<BubbleValue>[] | null>(() => {
    if (scrolling || !hasHints) return [];
    if (anchors.for !== candidates) return null;
    const out: PresenceItem<BubbleValue>[] = [];
    candidates.forEach((candidate, position) => {
      const anchorX = anchors.xs[position];
      const content = bubbleContentFor(candidate);
      if (!content || anchorX == null) return;
      // The kind is in the key, so a chip switching between a hint and a covers
      // bubble pops the old one and grows the new one, like any other change.
      const shown = content.kind === 'covers' ? content.glyph : content.hint.text;
      out.push({
        key: `${position}|${candidate.text}|${content.kind}|${shown}`,
        value: { content, candidate, anchorX },
      });
    });
    return out;
  }, [scrolling, hasHints, anchors, candidates]);

  const bubbles = useHintBubblePresence(desiredBubbles, {
    enterDelayMs: HINT_MOTION.enterDelayMs,
    staggerMs: HINT_MOTION.staggerMs,
    exitMs: HINT_MOTION.popMs,
  });

  /**
   * One chip. Shared by the scroller and the § 6z-8 direct section so the two
   * cannot drift in shape.
   */
  const renderChip = (
    candidate: Candidate,
    key: string,
    extraClass: string,
    ref?: (element: HTMLElement | null) => void,
  ) => (
    <Box
      component="button"
      type="button"
      key={key}
      ref={ref}
      className={`beginner-keyboard__candidate beginner-keyboard__candidate--${candidate.action}${extraClass}`}
      onClick={() => onSelect(candidate)}
      sx={{
        flexShrink: 0,
        // 38×38 face (owner, 2026-11-15; was 44×44): the 22px glyph had 11px of air
        // above and below, more than the key needed. The glyph keeps its size; only
        // the air shrinks, to 8px.
        minWidth: CHIP_FACE,
        height: CHIP_FACE,
        px: candidate.text.length > 1 ? 1 : 0,
        // Hit slop: the drawn key is under the 44px tap-target floor, so an invisible
        // ::before restores a 44px target around it. CHIP_HIT_SLOP (3px) a side fits
        // inside the strip's 8px chip gap, so neighbouring targets never overlap.
        // keycapPressSx draws with box-shadow + transform only, so ::before is free.
        position: 'relative',
        '&::before': { content: '""', position: 'absolute', inset: -CHIP_HIT_SLOP },
        // A raised white keycap (keycapStyle.ts), the same object as every other key
        // on the keyboard: 1px outline, grey lip, for commit and append chips alike.
        // The row's ground tint is the only commit / append signal now. (Until
        // 2026-11-15 a commit chip wore a 2px ink ring, which out-weighed the lip and
        // made the key read flat; a green lip replaced it briefly and was dropped —
        // owner: no green sides.)
        border: 'none',
        borderRadius: KEY_RADIUS,
        backgroundColor: style.chip,
        ...keyPressSx(style.chip, KEYBOARD_COLORS.keyEdge, COLORS.border, 1),
        cursor: 'pointer',
        fontFamily: FONTS.hanziComponents,
        fontSize: SIZE.title,
        lineHeight: 1,
        color: COLORS.onSurface,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* § 6z-13: a glyph chip draws its component through ComponentGlyph, which swaps
          in a cut outline where the font's standalone glyph is the wrong shape (⺈). */}
      {candidate.action === 'append' ? <ComponentGlyph glyph={candidate.text} /> : candidate.text}
    </Box>
  );

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
        sx={arrowKeySx(direction === -1 ? canScrollLeft : canScrollRight)}
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
        // 4px + 38px chip + 3px lip + 4px lands well inside the 56px floor, so the
        // raised chips cost the canvas no height (the floor, not the chip, sets it).
        py: 0.5,
        minHeight: 56,
        backgroundColor: candidates.length === 0 ? EMPTY_GROUND : style.ground,
        borderBottom: `1px solid ${COLORS.rowBorder}`,
      }}
    >
      {directCandidate && (
        <Box
          className="beginner-keyboard__direct-section"
          sx={{
            // Bleeds to the row's top, bottom and left edges (cancelling the row's
            // padding) so it reads as a SECTION of the strip, not a floating chip.
            alignSelf: 'stretch',
            my: -0.5,
            ml: -1.25,
            pl: 1.25,
            pr: 1,
            // Matches the scroller's lip room, so the direct chip and the strip's
            // chips sit on one baseline.
            pb: `${KEY_LIP}px`,
            mr: 1,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            backgroundColor: MODE_STYLE.result.ground,
            borderRight: `1px solid ${COLORS.rowBorder}`,
          }}
        >
          {renderChip(
            directCandidate,
            `direct-${directCandidate.text}`,
            ' beginner-keyboard__candidate--direct',
          )}
        </Box>
      )}

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
          // Room for the chips' lips: overflowY clips at the padding box, and the lip
          // paints below the chip's own box (keycapStyle.ts header).
          pb: `${KEY_LIP}px`,
          // Edge fade (2026-11-15): an edge dissolves only while chips are cut off
          // past it, read off the same scroll state the arrows use — at rest at the
          // start, only the right edge fades. A mask, not an overlay, so it works on
          // either mode's tinted ground and never intercepts a tap.
          ...edgeFadeSx(canScrollLeft, canScrollRight),
          touchAction: 'pan-x',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {candidates.length === 0 ? (
          <Typography
            className="beginner-keyboard__candidate-row-empty"
            // A gentle hint (owner, 2026-11-17): it wears the keyboard's hint ink
            // (KEYBOARD_COLORS.faint — the same as ComponentBuffer's "Tap to clear"), so it recedes the way an input's placeholder does. Was
            // semibold textSecondary (2026-11-15), which read as a command. Size stays
            // bodyLg (16px): body (14px) was tried and read awkwardly small for a row
            // whose whole width it fills (owner, 2026-11-17). Normal letter spacing: the
            // 0.12em tracking belonged to the equation wording and would only stretch a
            // sentence. ⚠️ faint on org (EMPTY_GROUND) is ~2.2 : 1, well under WCAG AA's
            // 4.5 : 1 — accepted because this is placeholder-class copy gone on the first
            // stroke.
            sx={{
              // The hint is set entirely in the app's Chinese face (FONTS.cjk → 975 Maru
              // SC, owner 2026-11-17): it is mixed-script, and Maru's slices cover Latin
              // too, so 你/亻/尔 and the English share one rounded face instead of the
              // English sitting in Instrument Sans while the characters fell through to
              // the OS's CJK font. Same precedent as towerPlate.ts → TOWER_STUDY_FONT. The
              // loading line stays in the UI sans. Maru ships ONE weight (regular), so the
              // weight is regular — anything heavier would be synthesised.
              fontFamily: loading ? FONTS.sans : FONTS.cjk,
              fontSize: SIZE.bodyLg,
              fontWeight: WEIGHT.regular,
              color: KEYBOARD_COLORS.faint,
              // Centred in the band (owner, 2026-11-15): with no chips it is the row's
              // only content, so it reads as a message rather than a stray left label.
              flex: 1,
              textAlign: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? (
              'Loading handwriting data…'
            ) : (
              // Plain inline characters, the sentence's own size and weight (owner,
              // 2026-11-15) — an earlier pass set them a size up in the CJK face.
              `To get ${EXAMPLE_TARGET}, you can use ${EXAMPLE_COMPONENTS[0]} + ${EXAMPLE_COMPONENTS[1]}`
            )}
          </Typography>
        ) : (
          candidates.map((candidate, position) =>
            renderChip(
              candidate,
              // Index is part of the key because the same glyph can legitimately
              // appear twice across a re-rank; text alone is not unique.
              `${candidate.text}-${position}`,
              '',
              (element: HTMLElement | null) => {
                chipRefs.current[position] = element;
              },
            ),
          )
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
              content={bubble.value.content}
              anchorX={bubble.value.anchorX}
              phase={bubble.phase}
              delayMs={bubble.delayMs}
              onSelect={() => {
                const { content, candidate } = bubble.value;
                // § 6z-7: a covers bubble is the chip's own label, so a tap on it is a
                // tap on the chip. A § 6z-4 hint commits its character instead.
                if (content.kind === 'covers') onSelect(candidate);
                else onSelectHint(content.hint);
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * The candidate scroller's horizontal edge-fade mask. Each side fades over EDGE_FADE_PX
 * only when there is content cut off on that side; with neither, no mask at all. Both
 * spellings, because iOS Safari still needs the prefixed property. (The app's other
 * edge fades are VERTICAL — src/components/scrollEdgeFade.ts — so this one is local.)
 */
function edgeFadeSx(fadeLeft: boolean, fadeRight: boolean) {
  if (!fadeLeft && !fadeRight) return {};
  const left = fadeLeft ? `transparent, #000 ${EDGE_FADE_PX}px` : '#000, #000';
  const right = fadeRight ? `#000 calc(100% - ${EDGE_FADE_PX}px), transparent` : '#000, #000';
  const mask = `linear-gradient(to right, ${left}, ${right})`;
  return { maskImage: mask, WebkitMaskImage: mask } as const;
}

/**
 * The scroll arrow's face: 3 : 2 PORTRAIT as shown, face plus lip (keycapStyle.ts →
 * keyFaceHeightForShownAspect). 28 wide → 42 shown → a 39px face above the 3px lip.
 */
const ARROW_KEY_WIDTH = 28;
const ARROW_KEY_HEIGHT = keyFaceHeightForShownAspect(ARROW_KEY_WIDTH, 2 / 3);

/**
 * The scroll arrows as raised white keycaps (2026-11-15, owner), matching the chips
 * they page. 28 wide × 42 shown (39 face + 3 lip) — 3 : 2 PORTRAIT as the eye reads it,
 * the switch bar's 3 : 2 shape (it has since moved on) stood on end (owner, 2026-11-15; was 28×44, the chips' height,
 * then briefly a 28×42 face); a 4px gap off the strip so its lip and the
 * chips' never touch. At an end of travel the arrow stays mounted (ScrollArrow's rule)
 * at 25% and sits flat: the press is cancelled so a dead key never moves, and the hover
 * tint ScrollArrow paints by default is dropped (a keycap's feedback is the press).
 * Only mounted on hover-and-fine-pointer devices (useHorizontalScrollArrows).
 */
function arrowKeySx(enabled: boolean) {
  const raised = whiteKeySx();
  return {
    ...raised,
    width: ARROW_KEY_WIDTH,
    height: ARROW_KEY_HEIGHT,
    mx: 0.5,
    cursor: enabled ? 'pointer' : 'default',
    '&:hover': { backgroundColor: raised.backgroundColor },
    '&:disabled:active': { transform: raised.transform, boxShadow: raised.boxShadow },
  } as const;
}

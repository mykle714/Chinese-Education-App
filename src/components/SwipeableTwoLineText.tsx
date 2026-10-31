import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import useEdgeRubberBand from '../hooks/useEdgeRubberBand';

/**
 * SwipeableTwoLineText — a list of segments (a word's glosses) shown on AT MOST TWO lines,
 * swiped sideways only when two lines are not enough (owner's spec 2026-10-29, the
 * Dictionary eip's header gloss). The two-line sibling of SwipeableTextLine.
 *
 * ── The three layouts, chosen by measuring ────────────────────────────────────
 *   1. ONE LINE   — everything fits on one line.
 *   2. WRAPPED    — it does not, but it fits on two: line 1 takes as many segments as fit
 *                   (greedy, like ordinary wrapping), line 2 the rest. Nothing scrolls.
 *   3. SWIPING    — even two lines overflow. The two lines become ONE horizontal scroller
 *                   and move together, as if conjoined, with the same clipped edges and
 *                   rubber band as SwipeableTextLine.
 *
 * Why layout 3 re-splits instead of keeping layout 2's break: once the box scrolls, line 1
 * is no longer capped at the box width, so the greedy break would leave line 1 at the box
 * width and dump everything else on a very long line 2 — most of the swipe would scroll
 * past an empty first line. So in layout 3 the break is re-chosen to EQUALIZE the two
 * lines (minimize the longer one), which also minimizes how far the learner has to swipe.
 *
 * Lines only ever break BETWEEN segments, so a separator never dangles at a line's end or
 * start. A single segment too long for one line falls back to breaking between its words.
 *
 * Measurement is DOM-based, in the line's own font (a hidden nowrap probe inside the
 * component), re-run when the segments change, when the box resizes, and once web fonts
 * finish loading. The box's width never depends on its content (callers give it
 * `flex: 1; min-width: 0`), so re-measuring cannot feed back into itself.
 *
 * ── Decorated segments ────────────────────────────────────────────────────────
 * A segment may be a plain string or a `TwoLineSegment`: its text is wrapped in its own
 * span (so the caller can style that ONE gloss, e.g. underline it via `className`), and
 * optional `leading` / `trailing` nodes (e.g. a star icon) are drawn right before / after
 * it, glued to it so a line never breaks between them. The probe measures text only, so
 * each node declares its own width (`leadingWidth` / `trailingWidth`), which is added to
 * every width that includes it. The
 * layout is therefore stored as unit RANGES, not joined strings — rendering needs to know
 * which segment each piece of a line belongs to.
 *
 * Alignment while it fits (`align="center"`): auto side margins on the lines block, and
 * each line centered within it — never `text-align` on the scroller, which in Blink pushes
 * overflow off the unscrollable left edge (see SwipeableTextLine). An overflowing block
 * starts at its start (auto margins resolve to 0 when there is no free space), lines
 * left-aligned.
 *
 * Layer: shared component (`src/components/`). Used by:
 * features/flashcards/FlashcardsLearnPage/EipEntryHeader.tsx (`showAllDefinitions`, and
 * the per-sense list with its underlined pick + starred default).
 * Docs: docs/SHELF_REDESIGN.md § 7b ("The Dictionary eip shows every meaning");
 * docs/DEFINITION_CLUSTERS.md (eip header sense list).
 */

/** A segment with its own span class and/or a node drawn right after its text. */
export interface TwoLineSegment {
    text: string;
    /** Extra class on this segment's text span — the caller styles it through `sx`. */
    className?: string;
    /** Drawn immediately before the text (e.g. a star icon); never wraps away from it. */
    leading?: ReactNode;
    /** Rendered width of `leading` INCLUDING its trailing gap, in px. Required to fit it. */
    leadingWidth?: number;
    /** Drawn immediately after the text; never wraps away from it. */
    trailing?: ReactNode;
    /** Rendered width of `trailing` INCLUDING its leading gap, in px. Required to fit it. */
    trailingWidth?: number;
}

interface SwipeableTwoLineTextProps {
    segments: readonly (string | TwoLineSegment)[];
    /** Placed between segments on a line, never at a line break. */
    separator: string;
    className?: string;
    /** Typography for the text (font, size, colour, line height). */
    sx?: SxProps<Theme>;
    align?: 'start' | 'center';
    touchAction?: 'pan-x' | 'pan-x pan-y';
}

interface Layout {
    /** Each line as a half-open [from, to) range over the units (see `units` below). */
    lines: [number, number][];
    /** True when the longer line is wider than the box — layout 3. */
    overflows: boolean;
}

/** Sub-pixel rounding: treat a line this close to the box width as fitting. */
const FIT_EPSILON_PX = 0.5;

function SwipeableTwoLineText({ segments, separator, className, sx, align = 'start', touchAction = 'pan-x' }: SwipeableTwoLineTextProps) {
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLSpanElement | null>(null);
    const probeRef = useRef<HTMLSpanElement | null>(null);
    // Plain strings normalized to segments, so measuring and rendering have one shape.
    const items = useMemo<TwoLineSegment[]>(
        () => segments.map((seg) => (typeof seg === 'string' ? { text: seg } : seg)),
        [segments],
    );
    // The units a line may break between: the segments, or — for one long segment — its
    // words. In word mode the lone segment's decoration covers every word on a line, its
    // leading node rides before the FIRST word and its trailing node after the LAST.
    const wordMode = items.length < 2;
    const units = useMemo(
        () => (wordMode ? (items[0]?.text ?? '').split(' ').filter(Boolean) : items.map((it) => it.text)),
        [items, wordMode],
    );
    // [0, Infinity) until the first measure: `slice` clamps it, so it renders everything.
    const [layout, setLayout] = useState<Layout>(() => ({ lines: [[0, Infinity]], overflows: false }));
    useEdgeRubberBand(scrollerRef, contentRef, true);

    const measure = useCallback(() => {
        const scroller = scrollerRef.current;
        const probe = probeRef.current;
        if (!scroller || !probe) return;
        const boxWidth = scroller.clientWidth;
        const joiner = wordMode ? ' ' : separator;
        // Leading/trailing nodes are not in the probe's text, so their declared widths are
        // added for every segment (segment mode), or the first/last word (word mode), the
        // range covers.
        const decorationIn = (from: number, to: number) => {
            if (wordMode) {
                return (from === 0 ? (items[0]?.leadingWidth ?? 0) : 0)
                    + (to === units.length ? (items[0]?.trailingWidth ?? 0) : 0);
            }
            let total = 0;
            for (let i = from; i < to; i += 1) total += (items[i]?.leadingWidth ?? 0) + (items[i]?.trailingWidth ?? 0);
            return total;
        };
        const widthOf = (from: number, to: number) => {
            probe.textContent = units.slice(from, to).join(joiner);
            return probe.getBoundingClientRect().width + decorationIn(from, to);
        };
        const fits = (from: number, to: number) => widthOf(from, to) <= boxWidth + FIT_EPSILON_PX;
        const n = units.length;

        let next: Layout;
        if (n < 2 || fits(0, n)) {
            // Layout 1 (or a single unbreakable unit, which can only swipe on one line).
            next = { lines: [[0, n]], overflows: !fits(0, n) };
        } else {
            // Layout 2: greedy — line 1 takes as many units as fit.
            let greedy = 0;
            while (greedy < n - 1 && fits(0, greedy + 1)) greedy += 1;
            if (greedy > 0 && fits(greedy, n)) {
                next = { lines: [[0, greedy], [greedy, n]], overflows: false };
            } else {
                // Layout 3: the break that equalizes the lines. Ties keep line 1 the
                // longer, so the eye's first line carries more.
                let best = 1;
                let bestMax = Infinity;
                for (let k = 1; k < n; k += 1) {
                    const longer = Math.max(widthOf(0, k), widthOf(k, n));
                    if (longer < bestMax - FIT_EPSILON_PX) {
                        bestMax = longer;
                        best = k;
                    }
                }
                next = { lines: [[0, best], [best, n]], overflows: bestMax > boxWidth + FIT_EPSILON_PX };
            }
        }
        probe.textContent = '';
        setLayout((prev) =>
            prev.overflows === next.overflows
            && prev.lines.length === next.lines.length
            && prev.lines.every(([from, to], i) => from === next.lines[i][0] && to === next.lines[i][1])
                ? prev
                : next,
        );
    }, [items, units, wordMode, separator]);

    useLayoutEffect(() => {
        measure();
        const scroller = scrollerRef.current;
        if (!scroller) return;
        // A re-layout puts the scroll back at the start, so a new word never opens mid-line.
        scroller.scrollLeft = 0;
        let cancelled = false;
        document.fonts?.ready.then(() => { if (!cancelled) measure(); }).catch(() => {});
        if (typeof ResizeObserver === 'undefined') return () => { cancelled = true; };
        const observer = new ResizeObserver(() => measure());
        observer.observe(scroller);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [measure]);

    const lineAlign = align === 'center' && !layout.overflows ? 'center' : 'left';

    // One line's content. Segment mode: each segment in its own span, its leading/trailing
    // nodes glued around it, the separator only BETWEEN segments. Word mode: the lone
    // segment's span holds the line's words; its leading node starts the line holding the
    // first word and its trailing node ends the line holding the last.
    const renderLine = (from: number, to: number) => {
        const end = Math.min(to, units.length);
        if (wordMode) {
            const seg = items[0];
            return (
                <>
                    {from === 0 && seg?.leading}
                    <span className={seg?.className}>{units.slice(from, end).join(' ')}</span>
                    {end === units.length && seg?.trailing}
                </>
            );
        }
        return items.slice(from, end).map((seg, i) => (
            <Fragment key={from + i}>
                {i > 0 && separator}
                {seg.leading}
                <span className={seg.className}>{seg.text}</span>
                {seg.trailing}
            </Fragment>
        ));
    };

    return (
        <Typography
            component="div"
            ref={scrollerRef}
            className={['swipeable-two-line-text', className].filter(Boolean).join(' ')}
            sx={[
                ...(Array.isArray(sx) ? sx : [sx]),
                {
                    position: 'relative',
                    display: 'flex',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    touchAction,
                    overscrollBehaviorX: 'none',
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                },
            ]}
        >
            {/* The two lines as one block: the rubber band translates it, so they move together. */}
            <Box
                component="span"
                ref={contentRef}
                className="swipeable-two-line-text__lines"
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    flexShrink: 0,
                    marginInline: align === 'center' ? 'auto' : 0,
                    textAlign: lineAlign,
                }}
            >
                {layout.lines.map(([from, to], i) => (
                    <span key={i} className="swipeable-two-line-text__line" style={{ whiteSpace: 'nowrap' }}>
                        {renderLine(from, to)}
                    </span>
                ))}
            </Box>
            {/* Width probe: same font, never painted, out of flow so it adds no scroll width. */}
            <span
                ref={probeRef}
                aria-hidden
                className="swipeable-two-line-text__probe"
                style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none' }}
            />
        </Typography>
    );
}

export default SwipeableTwoLineText;

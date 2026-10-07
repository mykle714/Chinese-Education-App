import { useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { Box } from "@mui/material";
import ShadowCell from "./ShadowCell";
import SheetCloseX from "../../../components/sheet/SheetCloseX";
import { MORPH_EASING, PROJECTION_MORPH_MS } from "../../../components/handwriting/useProjectionMorph";
import type { StrokeAid } from "./strokeAid";
import { NOTEBOOK_CELL_BORDER, WORD_BAR_CELLS_PER_ROW, notebookGeometry } from "./notebookLayout";
import { COLORS } from "../../../theme/colors";

/**
 * NotebookWordBar — the sheet's word, drawn under the Writing Notebook's header
 * (docs/WRITING_NOTEBOOK.md § "Page anatomy") as its WRITING SHADOWS — each character's
 * stroke shape in a replica sheet cell (`ShadowCell`), no pinyin.
 *
 * The shadow grid spans EXACTLY THE SHEET'S WIDTH: it reads the same `notebookGeometry`
 * off the same full page width, so its outer edges line up with the practice grid's
 * below. Inside that span it is TWO CELLS PER ROW (CELLS_PER_ROW), each half the grid's
 * width — one or two characters make one row, three or four a large 2×2 (the bar grows
 * to hold them; a lone third cell is centred under the pair above it).
 *
 * Each cell is its own STROKE-AID TOGGLE: tapping a shadow cycles that cell's help
 * off → numbers → colored strokes + numbers (`StrokeAid`). The state is keyed by the
 * character's INDEX in the word and owned by the page (WritingNotebookPage `strokeAids`),
 * so the two 谢 of 谢谢 cycle independently.
 * Choosing a different word and the sheet's counter live in the page header
 * (WritingNotebookPage's `rightContent`), not here.
 *
 * The bar has TWO sizes: one row (1–2 characters) and the 2×2 (3–4). COMPACT form
 * (`compact`) holds a 3–4 character word at the one-row size: the bar is exactly one
 * FULL-size cell tall (a cell of the two-per-row layout), with every character on a
 * single small row centred in it (a quarter of the grid for four). Tapping a small cell
 * EXPANDS it to full size in place of the row — the bar is already that tall, so it never
 * resizes — with the panel ✕ (`SheetCloseX`) in the bar's corner to go back to the row;
 * a tap anywhere else in the bar (off the full-size cell) goes back too. Every tap the
 * bar acts on stops propagating; an EMPTY tap on the small row bubbles, and the cell
 * editor treats it as tap-out (NotebookCellEditor `topBar`).
 * While expanded, tapping the cell cycles its stroke aid as usual. The switch ANIMATES
 * both ways: the tapped cell FLIPs between its row slot and the centred full-size slot
 * (`useExpandMorph` below; the canvas morph's duration + easing), while the other
 * characters and the ✕ fade out / in. A 1–2 character word is
 * already one row of full-size cells, so `compact` changes nothing for it
 * (`wordBarCompacts`, notebookLayout.ts). NotebookCellEditor draws this form at the top of its overlay while
 * a cell is open, so the canvas gets the height the 2×2 would take
 * (docs/WRITING_NOTEBOOK.md § "Canvas").
 *
 * Only the WIDTH is measured, so the height the cells produce never feeds back into
 * their own size. Renders nothing until a word is chosen.
 */
interface NotebookWordBarProps {
    word: string | null;
    /** Each position's stroke-order help, by character index; no entry is `"off"`. */
    strokeAids: ReadonlyMap<number, StrokeAid>;
    onCycleStrokeAid: (index: number) => void;
    /** Force the one-row size — the form drawn above the open cell editor. */
    compact?: boolean;
}

/** Shadow cells per row: two, so a 3–4 character word makes a 2×2. */
const CELLS_PER_ROW = WORD_BAR_CELLS_PER_ROW;
/** Spoken state for the cell's aria-label (a 3-state cycle has no `aria-pressed`). */
const STROKE_AID_LABEL: Record<StrokeAid, string> = {
    off: "hidden",
    numbers: "numbered",
    colored: "numbered and colored",
};

/** Space above and below the shadow grid (px) — the sheet's own top pad is 12. */
const BAR_PAD_Y = 12;

const prefersReducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The compact bar's expand / collapse motion, run on the DOM (Web Animations) after the
 * state switch has rendered:
 *   • FLIP the moving cell — it is rendered at its NEW size and place, then animated from
 *     the rect it was tapped at (`fromRect`) back to where it now sits. It always renders
 *     at its true size, so the stroke numbers are never a scaled-up blur at rest.
 *   • Fade everything else (`fadeEls`): the elements going away fade out, the ones arriving
 *     fade in — on expand the other characters go and the ✕ arrives; on collapse the other
 *     characters return. Resting opacity is set by render; this only animates to it.
 * `fromRect` is consumed (one switch, one animation).
 */
function useExpandMorph(
    expanded: number | null,
    fromRectRef: MutableRefObject<DOMRect | null>,
    movingRef: MutableRefObject<HTMLElement | null>,
    fadeEls: () => { outgoing: HTMLElement[]; incoming: HTMLElement[] },
) {
    const firstRender = useRef(true);
    useLayoutEffect(() => {
        if (firstRender.current) { firstRender.current = false; return; }
        const from = fromRectRef.current;
        fromRectRef.current = null;
        const moving = movingRef.current;
        if (!from || !moving || prefersReducedMotion()) return;
        const to = moving.getBoundingClientRect();
        if (to.width === 0) return;
        const timing = { duration: PROJECTION_MORPH_MS, easing: MORPH_EASING };
        moving.animate(
            [
                { transformOrigin: "0 0", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})` },
                { transformOrigin: "0 0", transform: "none" },
            ],
            timing,
        );
        const { outgoing, incoming } = fadeEls();
        const fade = { duration: PROJECTION_MORPH_MS, easing: "ease-out" };
        for (const el of outgoing) el.animate([{ opacity: 1 }, { opacity: 0 }], fade);
        for (const el of incoming) el.animate([{ opacity: 0 }, { opacity: 1 }], fade);
        // Only the switch itself drives this; the refs are read fresh each time.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expanded]);
}

export default function NotebookWordBar({ word, strokeAids, onCycleStrokeAid, compact = false }: NotebookWordBarProps) {
    const barRef = useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);
    // Compact only: the position blown up to full size, or null for the small row. Local
    // state — the compact bar mounts with the cell editor, so every open starts on the row.
    const [expanded, setExpanded] = useState<number | null>(null);
    // Expand / collapse motion (useExpandMorph): each row cell's element by position, the
    // full-size cell, the ✕, the rect the moving cell starts from, and which position
    // collapsed last (it lands back in its row slot and is the one cell that does not fade).
    const rowCellEls = useRef(new Map<number, HTMLElement>());
    const expandedEl = useRef<HTMLElement | null>(null);
    const closeEl = useRef<HTMLElement | null>(null);
    const fromRect = useRef<DOMRect | null>(null);
    const movingEl = useRef<HTMLElement | null>(null);
    const collapsedFrom = useRef<number | null>(null);

    useExpandMorph(expanded, fromRect, movingEl, () => {
        // Every row cell but the one moving (the expanded one, or the one landing back).
        const others = [...rowCellEls.current].filter(([c]) => c !== (expanded ?? collapsedFrom.current)).map(([, el]) => el);
        // Expand: the others go, the ✕ arrives. Collapse: the others return (the ✕ has
        // already unmounted).
        return expanded !== null
            ? { outgoing: others, incoming: closeEl.current ? [closeEl.current] : [] }
            : { outgoing: [], incoming: others };
    });

    useLayoutEffect(() => {
        const el = barRef.current;
        if (!el) return;
        const measure = () => setWidth(el.clientWidth);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
        // Re-attach when the bar mounts (it renders nothing until a word is chosen).
    }, [word === null]);

    if (!word) return null;
    const chars = [...word];
    const { gridWidth, gridLeft } = notebookGeometry(width);
    // N touching cells span N·size − (N − 1)·border; the size that makes N span the grid width.
    const sizeFor = (perRow: number) => Math.floor((gridWidth + (perRow - 1) * NOTEBOOK_CELL_BORDER) / perRow);
    // FULL size: a cell of the two-per-row layout. The compact bar is always exactly this
    // tall, so expanding a cell to it never resizes the bar.
    const fullSize = sizeFor(CELLS_PER_ROW);
    // Compact puts the whole word on one row (never fewer than two per row, so a 1–2
    // character word is the same either way).
    const perRow = compact ? Math.max(CELLS_PER_ROW, chars.length) : CELLS_PER_ROW;
    const cellSize = sizeFor(perRow);
    const rows: string[][] = [];
    for (let i = 0; i < chars.length; i += perRow) rows.push(chars.slice(i, i + perRow));
    // A compact row narrower than full size: its cells expand on tap instead of cycling.
    const tapExpands = compact && cellSize < fullSize;
    const expandedChar = tapExpands && expanded !== null ? chars[expanded] : undefined;
    const isExpanded = expandedChar !== undefined;

    /** Expand position `c`, growing from `from` (the tapped row cell's element). */
    const expand = (c: number, from: HTMLElement) => {
        fromRect.current = from.getBoundingClientRect();
        movingEl.current = null; // set by the full-size cell's ref when it mounts
        collapsedFrom.current = null;
        setExpanded(c);
    };
    const collapse = () => {
        fromRect.current = expandedEl.current?.getBoundingClientRect() ?? null;
        collapsedFrom.current = expanded;
        movingEl.current = expanded !== null ? rowCellEls.current.get(expanded) ?? null : null;
        setExpanded(null);
    };

    /** One tappable shadow: cycles its stroke aid, or (small compact cell) expands it. */
    const renderCell = (
        c: number,
        char: string,
        size: number,
        marginLeft: number,
        expands: boolean,
        opts: { ref?: (el: HTMLElement | null) => void; hidden?: boolean } = {},
    ) => {
        const aid = strokeAids.get(c) ?? "off";
        const tap = (el: HTMLElement) => (expands ? expand(c, el) : onCycleStrokeAid(c));
        return (
            <Box
                key={`${c}-${char}`}
                ref={opts.ref}
                className={expands ? "notebook-word-bar__shadow-expand" : "notebook-word-bar__shadow-toggle"}
                role="button"
                tabIndex={opts.hidden ? -1 : 0}
                aria-hidden={opts.hidden || undefined}
                aria-label={expands
                    ? `Enlarge ${char}`
                    : `Stroke order for ${char}: ${STROKE_AID_LABEL[aid]}. Tap to change.`}
                // Claimed: the cell editor's top-bar slot treats an unclaimed tap as tap-out.
                onClick={(e) => { e.stopPropagation(); tap(e.currentTarget); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(e.currentTarget); } }}
                // Touching cells share one hairline, as on the sheet. A hidden row cell
                // (another cell is expanded over the bar) is invisible and untappable.
                sx={{
                    display: "flex",
                    cursor: "pointer",
                    marginLeft: marginLeft ? `-${marginLeft}px` : 0,
                    ...(opts.hidden ? { opacity: 0, pointerEvents: "none" } : {}),
                }}
            >
                <ShadowCell char={char} size={size} aid={aid} />
            </Box>
        );
    };

    return (
        <Box
            ref={barRef}
            className={compact ? "notebook-word-bar notebook-word-bar--compact" : "notebook-word-bar"}
            // Expanded: a tap anywhere in the bar off the full-size cell dismisses it, like the
            // ✕ (the hidden row cells are pointer-transparent, so those taps land here too) —
            // and is claimed, so it does not also close the canvas. On the small row an empty
            // tap is left to bubble: NotebookCellEditor reads it as tap-out.
            onClick={isExpanded ? (e) => { e.stopPropagation(); collapse(); } : undefined}
            // Full page width, no side padding: notebookGeometry applies the gutter itself,
            // exactly as it does for the sheet's scroller. Opaque ground: the compact form
            // sits over the full bar inside the cell editor's overlay.
            sx={{ display: "flex", padding: `${BAR_PAD_Y}px 0`, borderBottom: `1px solid ${COLORS.rowBorder}`, flexShrink: 0, bgcolor: COLORS.background }}
        >
            {width > 0 && (
                <Box
                    className="notebook-word-bar__shadows"
                    // A column of rows exactly the sheet's grid width, at the sheet's left edge.
                    // Compact: held at full-cell height, the small row centred in it.
                    sx={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        width: `${gridWidth}px`,
                        marginLeft: `${gridLeft}px`,
                        ...(compact ? { height: `${fullSize}px` } : {}),
                    }}
                >
                    {/* The row stays mounted while a cell is expanded (hidden), so its cells
                        can fade out from where they sit and back in to it. */}
                    {rows.map((row, r) => (
                        <Box
                            key={r}
                            className="notebook-word-bar__shadow-row"
                            // Rows share one hairline like the sheet's; a lone third cell centres.
                            sx={{ display: "flex", justifyContent: "center", marginTop: r > 0 ? `-${NOTEBOOK_CELL_BORDER}px` : 0 }}
                        >
                            {row.map((char, k) => {
                                const c = r * perRow + k;
                                return renderCell(c, char, cellSize, k > 0 ? NOTEBOOK_CELL_BORDER : 0, tapExpands, {
                                    ref: tapExpands ? (el) => { if (el) rowCellEls.current.set(c, el); else rowCellEls.current.delete(c); } : undefined,
                                    hidden: isExpanded,
                                });
                            })}
                        </Box>
                    ))}
                    {isExpanded && expanded !== null && (
                        <>
                            {/* The full-size cell, centred over the bar (a lone cell centres in
                                the one-row layout too). */}
                            <Box className="notebook-word-bar__expanded" sx={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "none", "& > *": { pointerEvents: "auto" } }}>
                                {renderCell(expanded, expandedChar, fullSize, 0, false, {
                                    ref: (el) => { expandedEl.current = el; if (el && !movingEl.current) movingEl.current = el; },
                                })}
                            </Box>
                            {/* Back to the small row — the app's one panel ✕, in the bar's corner. */}
                            {/* Stops its tap here: the bar's own tap-out would collapse a second time. */}
                            <Box ref={closeEl} className="notebook-word-bar__collapse" onClick={(e) => e.stopPropagation()} sx={{ position: "absolute", top: 0, right: 0 }}>
                                <SheetCloseX ariaLabel={`Shrink ${expandedChar}`} onClick={collapse} />
                            </Box>
                        </>
                    )}
                </Box>
            )}
        </Box>
    );
}

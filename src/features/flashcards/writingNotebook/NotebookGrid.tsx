import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Box } from "@mui/material";
import Icon from "../../../components/Icon";
import NotebookCell from "./NotebookCell";
import type { NotebookSheet } from "./useNotebookSheet";
import {
    easeInOutCubic,
    isPageFull,
    jumpDurationMs,
    jumpScrollTop,
    mountedRows,
    notebookGeometry,
    pageOfRow,
    pageRange,
    pagesForRows,
    rowAt,
    rowCountFor,
    rowTop,
    currentPage,
    colLeft,
    NOTEBOOK_TOP_PAD,
} from "./notebookLayout";
import { NOTEBOOK_COLUMNS } from "../../../../server/contracts/writingNotebook";
import { COLORS } from "../../../theme/colors";
import { SHADOW } from "../../../theme/shadows";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * NotebookGrid — the endless, virtualised practice sheet (docs/WRITING_NOTEBOOK.md
 * § "Scrolling, pages and the jump").
 *
 * ── Virtualisation ───────────────────────────────────────────────────────────
 * Every row has the same pitch (notebookLayout), so the scroller's content is one tall
 * spacer and only the rows near the viewport mount (`mountedRows`). The spacer always
 * reaches a page past the deepest row seen (`rowCountFor`), so scrolling down never hits
 * an end. Pages (NOTEBOOK_PAGE_ROWS rows) are fetched as their rows come into view.
 *
 * ── The jump ─────────────────────────────────────────────────────────────────
 * When the page the learner is on (the one under the viewport's middle) is fetched and
 * FULL, a "Next empty" button appears. It asks the server for the lowest empty cell at or
 * after that page's first cell (so holes left further up stay where they are), then
 * animates a real scroll to that index — landing with two rows above the target row
 * (`jumpScrollTop`). Because the scroll is real, the cell index the learner lands on IS
 * the cell whose history the grid shows. Fetching is paused during the flight, so the
 * rows flown past are never requested; the target's pages are requested at take-off so
 * they are usually there on landing, and the rows skipped over load as soon as the
 * learner scrolls back up into them.
 *
 * A touch, wheel or key press during the flight hands the scroll back to the learner.
 */
interface NotebookGridProps {
    sheet: NotebookSheet;
    onOpenCell: (cellIndex: number, element: HTMLElement) => void;
}

export default function NotebookGrid({ sheet, onOpenCell }: NotebookGridProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [scrollTop, setScrollTop] = useState(0);
    const [deepestRow, setDeepestRow] = useState(0);
    // The jump's flight: true while it animates, null'd by an interrupt. State (for
    // render) plus a ref (for the rAF loop and the interrupt listeners).
    const [flying, setFlying] = useState(false);
    const flightRef = useRef<number | null>(null);
    const [seeking, setSeeking] = useState(false);

    // Measure the scroller (width → cell size; height → viewport). Width is the BORDER
    // box (`offsetWidth`), not `clientWidth`: a classic (non-overlay) scrollbar must sit
    // inside the right NOTEBOOK_SIDE_GUTTER rather than shrink the cells and re-centre
    // the grid — which would also misalign it from the word bar's shadow grid, measured
    // on the full page width. `scrollbarWidth: "thin"` below keeps it narrower than the
    // gutter. Height stays `clientHeight` (the visible viewport).
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const measure = () => setSize({ width: el.offsetWidth, height: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const { cellSize, pitch, gridLeft } = notebookGeometry(size.width);
    const rowCount = rowCountFor(deepestRow);
    const { first, last } = mountedRows(scrollTop, size.height, pitch, rowCount);

    // Scroll → state, at most once a frame.
    const scrollFrame = useRef<number | null>(null);
    const handleScroll = () => {
        if (scrollFrame.current !== null) return;
        scrollFrame.current = requestAnimationFrame(() => {
            scrollFrame.current = null;
            const el = scrollRef.current;
            if (!el) return;
            setScrollTop(el.scrollTop);
            setDeepestRow((d) => Math.max(d, rowAt(el.scrollTop + el.clientHeight, pitch)));
        });
    };
    useEffect(() => () => {
        if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
        if (flightRef.current !== null) cancelAnimationFrame(flightRef.current);
    }, []);

    // Fetch the pages under the mounted rows — but never mid-flight, so a jump does not
    // request every page it flies past.
    const { ensurePages } = sheet;
    useEffect(() => {
        if (size.width === 0 || flying) return;
        ensurePages(pagesForRows(first, last));
    }, [first, last, flying, size.width, ensurePages]);

    // The "Next empty" button: the current page is fetched and every cell of it is filled.
    const filled = useMemo(() => new Set(sheet.cells.keys()), [sheet.cells]);
    const page = currentPage(scrollTop, size.height, pitch);
    const showJump = !flying && !seeking && sheet.loadedPages.has(page) && isPageFull(page, filled);

    // Hand the scroll back to the learner the moment they touch it mid-flight.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !flying) return;
        const interrupt = () => {
            if (flightRef.current !== null) cancelAnimationFrame(flightRef.current);
            flightRef.current = null;
            setFlying(false);
        };
        el.addEventListener("wheel", interrupt, { passive: true });
        el.addEventListener("touchstart", interrupt, { passive: true });
        el.addEventListener("pointerdown", interrupt);
        window.addEventListener("keydown", interrupt);
        return () => {
            el.removeEventListener("wheel", interrupt);
            el.removeEventListener("touchstart", interrupt);
            el.removeEventListener("pointerdown", interrupt);
            window.removeEventListener("keydown", interrupt);
        };
    }, [flying]);

    const { findNextEmpty } = sheet;
    const jump = useCallback(async () => {
        const el = scrollRef.current;
        if (!el || seeking) return;
        setSeeking(true);
        let target: number;
        try {
            target = await findNextEmpty(pageRange(page).from);
        } catch (err) {
            console.error("Writing Notebook: next-empty lookup failed", err);
            setSeeking(false);
            return;
        }
        setSeeking(false);
        const { row, scrollTop: dest } = jumpScrollTop(target, pitch);
        // Grow the spacer to hold the destination before scrolling there, and request the
        // landing pages now so they are in flight during the animation.
        const viewRows = Math.ceil(el.clientHeight / pitch);
        setDeepestRow((d) => Math.max(d, row + viewRows));
        ensurePages(pagesForRows(Math.max(0, row - 2), row + viewRows));

        const from = el.scrollTop;
        const distance = dest - from;
        const duration = jumpDurationMs(distance);
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        // The spacer grows on the next render; wait one frame so `dest` is reachable.
        requestAnimationFrame(() => {
            if (reduceMotion || distance === 0) {
                el.scrollTop = dest;
                return;
            }
            setFlying(true);
            const start = performance.now();
            const step = (now: number) => {
                const t = Math.min(1, (now - start) / duration);
                el.scrollTop = from + distance * easeInOutCubic(t);
                if (t < 1) {
                    flightRef.current = requestAnimationFrame(step);
                } else {
                    flightRef.current = null;
                    setFlying(false);
                }
            };
            flightRef.current = requestAnimationFrame(step);
        });
    }, [seeking, findNextEmpty, page, pitch, ensurePages]);

    // Only the mounted rows render; everything else is spacer.
    const cellsOut: ReactElement[] = [];
    if (size.width > 0) {
        for (let r = first; r <= last; r++) {
            const loaded = sheet.loadedPages.has(pageOfRow(r));
            for (let c = 0; c < NOTEBOOK_COLUMNS; c++) {
                const index = r * NOTEBOOK_COLUMNS + c;
                cellsOut.push(
                    <NotebookCell
                        key={index}
                        cellIndex={index}
                        size={cellSize}
                        left={gridLeft + colLeft(c, pitch)}
                        top={rowTop(r, pitch)}
                        ink={sheet.cells.get(index)}
                        loaded={loaded}
                        onOpen={onOpenCell}
                    />
                );
            }
        }
    }

    return (
        <Box className="notebook-grid" sx={{ position: "relative", flex: 1, minHeight: 0 }}>
            <Box
                ref={scrollRef}
                className="notebook-grid__scroller"
                onScroll={handleScroll}
                sx={{
                    position: "absolute",
                    inset: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    overscrollBehavior: "contain",
                    // Thin (~11px) so a classic scrollbar fits inside the 16px right
                    // gutter it borrows (see the measure effect above).
                    scrollbarWidth: "thin",
                    // Scrolling is opt-in per page (CLAUDE.md "Touch & Scroll"): this is
                    // the notebook's one scroll area.
                    touchAction: "pan-y",
                }}
            >
                <Box
                    className="notebook-grid__spacer"
                    sx={{ position: "relative", height: rowTop(rowCount, pitch) + NOTEBOOK_TOP_PAD }}
                >
                    {cellsOut}
                </Box>
            </Box>

            {(showJump || seeking) && (
                <Box
                    component="button"
                    type="button"
                    className="notebook-grid__jump"
                    onClick={jump}
                    disabled={seeking}
                    sx={{
                        position: "absolute",
                        left: "50%",
                        bottom: "max(20px, env(safe-area-inset-bottom))",
                        transform: "translateX(-50%)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        height: 40,
                        padding: "0 16px 0 12px",
                        borderRadius: "999px",
                        border: `1px solid ${COLORS.border}`,
                        backgroundColor: COLORS.white,
                        // A control floating over content (theme/shadows).
                        boxShadow: SHADOW.float,
                        color: COLORS.onSurface,
                        fontFamily: FONTS.sans,
                        fontSize: 14,
                        fontWeight: WEIGHT.semibold,
                        cursor: seeking ? "default" : "pointer",
                        whiteSpace: "nowrap",
                        animation: "notebookJumpIn 180ms ease-out",
                        "@keyframes notebookJumpIn": {
                            from: { opacity: 0, transform: "translate(-50%, 8px)" },
                            to: { opacity: 1, transform: "translate(-50%, 0)" },
                        },
                    }}
                >
                    <Icon name="keyboard_double_arrow_down" size={20} sx={{ color: COLORS.onSurface }} />
                    Next empty
                </Box>
            )}
        </Box>
    );
}

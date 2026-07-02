import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Popper, Typography } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { stripParentheses } from "../../utils/definitionUtils";
import { FONTS } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";
import { COLORS } from "../../theme/colors";
import { CELL_SIZE, CELL_GAP, GRID_MARGIN, DISC_EXTRA_OFFSET_Y_FRAC } from "./constants";
import type { Coord, GridCell, PlacedWord } from "./types";

/** Imperative handle so the page can clear an in-progress selection (e.g. on a
 *  background tap). */
export interface WordSearchGridHandle {
    clearSelection: () => void;
}

interface WordSearchGridProps {
    grid: GridCell[][];
    words: PlacedWord[];
    /** entryKeys already found — drives locked highlights + remaining targets. */
    found: Set<string>;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** First cell of the currently-hinted word (pulsed until found), or null. */
    hintCell: Coord | null;
    /** A target's path was traced correctly. */
    onFound: (word: PlacedWord) => void;
    /** Fired on the player's first interaction, to start the timer. */
    onFirstInteraction?: () => void;
}

const key = (r: number, c: number) => `${r},${c}`;
const eq = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
const adjacent = (a: Coord, b: Coord) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

/** Two ordered paths are equal iff same length and every coord matches. */
function pathsEqual(p: Coord[], q: Coord[]): boolean {
    return p.length === q.length && p.every((c, i) => eq(c, q[i]));
}

const ORTHOGONAL_STEPS: Coord[] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
];

/**
 * BFS shortest orthogonal path from `from` to `to`, treating every cell
 * already in `blocked` (the in-progress selection) as impassable so the
 * bridge can't cross or reuse the existing trail. Used to recover when a fast
 * pointer move skips past `elementFromPoint` hits for the intervening cells —
 * without this the highlight just stalls at the last cell it caught. Returns
 * the bridging cells excluding `from` but including `to`, or null if `to` is
 * unreachable (e.g. walled off by the trail itself).
 */
function shortestOrthogonalPath(
    from: Coord,
    to: Coord,
    blocked: Coord[],
    rows: number,
    cols: number
): Coord[] | null {
    const blockedKeys = new Set(blocked.map(([r, c]) => key(r, c)));
    const targetKey = key(to[0], to[1]);
    const cameFrom = new Map<string, string>();
    const visited = new Set<string>([key(from[0], from[1])]);
    const queue: Coord[] = [from];
    for (let qi = 0; qi < queue.length; qi++) {
        const [r, c] = queue[qi];
        if (key(r, c) === targetKey) break;
        for (const [dr, dc] of ORTHOGONAL_STEPS) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            const nk = key(nr, nc);
            if (visited.has(nk) || (blockedKeys.has(nk) && nk !== targetKey)) continue;
            visited.add(nk);
            cameFrom.set(nk, key(r, c));
            queue.push([nr, nc]);
        }
    }
    if (!visited.has(targetKey)) return null;
    const path: Coord[] = [];
    for (let cur = targetKey; cur !== key(from[0], from[1]); ) {
        const [r, c] = cur.split(",").map(Number) as [number, number];
        path.push([r, c]);
        const prev = cameFrom.get(cur);
        if (!prev) return null;
        cur = prev;
    }
    return path.reverse();
}

/**
 * Scale a natural-size element down to fit its container (never up past 1×).
 * Lets the grid render at the real `sm` cpcd size while still fitting the play
 * area on short screens — CSS transforms don't affect elementFromPoint hit-
 * testing, so drag selection keeps working. See docs/WORD_SEARCH_GAME.md §3.
 */
function useFitScale(
    containerRef: React.RefObject<HTMLElement | null>,
    innerRef: React.RefObject<HTMLElement | null>,
    deps: unknown[],
    inset = 0
): number {
    const [scale, setScale] = useState(1);
    useLayoutEffect(() => {
        const container = containerRef.current;
        const inner = innerRef.current;
        if (!container || !inner) return;
        const measure = () => {
            // offsetWidth/Height are layout sizes, unaffected by our transform.
            const natW = inner.offsetWidth;
            const natH = inner.offsetHeight;
            if (natW === 0 || natH === 0) return;
            // Reserve `inset` px on every side so the fitted (centered) grid never
            // touches the container edges — margin the grid can't create itself,
            // since offsetHeight excludes margin and overflow:hidden would clip it.
            const availW = container.clientWidth - inset * 2;
            const availH = container.clientHeight - inset * 2;
            setScale(Math.min(availW / natW, availH / natH, 1));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(container);
        ro.observe(inner);
        return () => ro.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return scale;
}

/**
 * The rounded-rect play grid. Renders every cell as a cpcd character and owns the
 * word-selection interaction: the player drags a finger through orthogonally-
 * adjacent cells to trace a path (a lone tap is a one-cell path). On release the
 * traced path is checked against the remaining targets and the selection is
 * cleared. See doc §4.
 */
const WordSearchGrid = forwardRef<WordSearchGridHandle, WordSearchGridProps>(({
    grid,
    words,
    found,
    showPinyin,
    showPinyinColor,
    hintCell,
    onFound,
    onFirstInteraction,
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const scale = useFitScale(containerRef, innerRef, [grid, showPinyin], GRID_MARGIN);

    // Current in-progress selection path. Mirrored to a ref so the pointer
    // handlers (which close over stale state otherwise) read the latest value.
    const [path, setPath] = useState<Coord[]>([]);
    const pathRef = useRef<Coord[]>([]);
    const setPathBoth = useCallback((next: Coord[]) => {
        pathRef.current = next;
        setPath(next);
    }, []);

    // Whether a pointer drag is in progress (pointer down on the grid). A lone
    // tap is just a drag whose path never grew past its starting cell.
    const draggingRef = useRef(false);
    const interactedRef = useRef(false);

    // A found word whose English gloss popup is currently open (tap a found word
    // to review its meaning — mirrors the example-sentence segment popup). Anchor
    // is the viewport rect of the word's topmost row, recomputed on scale change.
    const [popupWord, setPopupWord] = useState<PlacedWord | null>(null);
    const [popupAnchorRect, setPopupAnchorRect] = useState<DOMRect | null>(null);

    // Let the page clear an in-progress selection on a background tap. Also closes
    // any open found-word popup.
    const clearSelection = useCallback(() => {
        setPathBoth([]);
        draggingRef.current = false;
        setPopupWord(null);
    }, [setPathBoth]);
    useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

    // Cells locked as part of a found word (disjoint — words never overlap), plus
    // a reverse index from a locked cell back to its word so a tap can resolve
    // which found word (and thus which English gloss) it belongs to.
    const foundCells = new Set<string>();
    const foundWordByCell = useMemo(() => {
        const map = new Map<string, PlacedWord>();
        for (const w of words) {
            if (found.has(w.entryKey)) w.cells.forEach(([r, c]) => map.set(key(r, c), w));
        }
        return map;
    }, [words, found]);
    for (const w of words) {
        if (found.has(w.entryKey)) w.cells.forEach(([r, c]) => foundCells.add(key(r, c)));
    }

    // DOM refs for each cell, keyed the same as `key()`, so bridge geometry can be
    // measured from actual layout (cell size varies with pinyin/font — see
    // useFitScale above) rather than assumed from constants.
    const cellElRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const setCellEl = useCallback(
        (k: string) => (el: HTMLDivElement | null) => {
            if (el) cellElRef.current.set(k, el);
            else cellElRef.current.delete(k);
        },
        []
    );

    // Diameter (px, in the inner grid's unscaled coordinate space) of the circular
    // per-cell highlight disc. Derived from the smaller of a cell's width/height —
    // cells aren't always square (pinyin adds a row, making cells taller than
    // wide), so sizing off `min()` and centering the disc keeps it a true circle
    // instead of stretching into an ellipse. All cells share one grid track size,
    // so a single sample is representative of every cell.
    const [cellDiameter, setCellDiameter] = useState(0);

    // Vertical correction (px) so the highlight disc centers on the character
    // glyph itself rather than the char+pinyin block. With pinyin on, the small
    // pinyin line sits above the character, so the block's geometric center
    // (what flex centering gives us for free) sits above the glyph's own visual
    // center — this nudges the disc down to match. Zero when pinyin is off.
    const [discOffsetY, setDiscOffsetY] = useState(0);

    // Row track height (px), forced equal to `columnWidth + CELL_GAP` so the
    // vertical distance between adjacent rows' character centers matches the
    // horizontal distance between adjacent columns'. Pinyin makes a cell's own
    // content taller than that pitch, so rows are deliberately packed tighter
    // than their natural content height — adjacent rows' char/pinyin content
    // overlaps slightly rather than spacing characters unevenly. `null` until
    // measured (renders with normal auto row sizing for that first pass).
    const [rowPitchPx, setRowPitchPx] = useState<number | null>(null);

    // "Bridge" bars connecting consecutive cells of a multi-cell highlight (the
    // in-progress yellow drag, and each found/reviewing green word) so the circular
    // per-cell highlights read as one continuous shape rather than disconnected
    // dots. Measured in the inner grid's own (unscaled) coordinate space via
    // offsetLeft/Top/Width/Height, which — unlike getBoundingClientRect — ignore
    // the CSS `scale()` transform, so no rescaling is needed here.
    const [bridgeRects, setBridgeRects] = useState<
        { key: string; left: number; top: number; width: number; height: number; radius: number; color: string }[]
    >([]);

    // Invisible per-cell hit targets that extend half of `CELL_GAP` into the
    // gutter on each side (rows are already flush — see `rowPitchPx` — so no
    // vertical extension is needed). Adjacent cells' extensions meet exactly at
    // the gutter's midpoint, so together they physically claim the whole gap
    // with no seam left un-owned by any element — the gap only ever *looks*
    // empty. Same measured-DOM approach as `bridgeRects` below, kept as a
    // separate overlay so the visible per-cell box (and everything measured off
    // its offsetWidth/Left — row pitch, disc diameter, bridge geometry) is
    // untouched.
    const [hitboxRects, setHitboxRects] = useState<
        { key: string; row: number; col: number; left: number; top: number; width: number; height: number }[]
    >([]);

    useLayoutEffect(() => {
        const sample = cellElRef.current.get(key(0, 0));
        if (!sample) return;

        // Pass 1: measure the natural column width (an axis the row-pitch change
        // never touches) and lock the row track to match + CELL_GAP. Bail out and
        // let the re-render with the new fixed row height land before measuring
        // anything that depends on it (diameter, disc offset, bridge geometry).
        const columnWidth = sample.offsetWidth;
        const targetPitch = columnWidth + CELL_GAP;
        if (rowPitchPx === null || Math.abs(rowPitchPx - targetPitch) > 0.5) {
            setRowPitchPx(targetPitch);
            return;
        }

        const cellBox = (r: number, c: number) => {
            const el = cellElRef.current.get(key(r, c));
            if (!el) return null;
            return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
        };

        const rowHeight = sample.offsetHeight;
        const diameter = Math.min(columnWidth, rowHeight) * 1.72;
        setCellDiameter(diameter);
        const thickness = diameter;

        let offsetY = 0;
        const cellRect = sample.getBoundingClientRect();
        const charEl = sample.querySelector<HTMLElement>(".char-pinyin-display__character");
        if (charEl && cellRect.height > 0) {
            const charRect = charEl.getBoundingClientRect();
            const charCenterFrac = (charRect.top + charRect.height / 2 - cellRect.top) / cellRect.height;
            offsetY = (charCenterFrac - 0.5) * rowHeight;
        }
        // Bridges connect disc centers, so they share the same total offset
        // (glyph-centering + the extra tunable nudge) as the discs themselves.
        offsetY += diameter * DISC_EXTRA_OFFSET_Y_FRAC;
        setDiscOffsetY(offsetY);

        const rects: { key: string; left: number; top: number; width: number; height: number; radius: number; color: string }[] = [];
        const addBridges = (coords: Coord[], color: string, groupKey: string) => {
            for (let i = 0; i < coords.length - 1; i++) {
                const a = cellBox(coords[i][0], coords[i][1]);
                const b = cellBox(coords[i + 1][0], coords[i + 1][1]);
                if (!a || !b) continue;
                const acx = a.left + a.width / 2;
                const acy = a.top + a.height / 2 + offsetY;
                const bcx = b.left + b.width / 2;
                const bcy = b.top + b.height / 2 + offsetY;
                const rect =
                    acy === bcy
                        ? { left: Math.min(acx, bcx), top: acy - thickness / 2, width: Math.abs(bcx - acx), height: thickness }
                        : { left: acx - thickness / 2, top: Math.min(acy, bcy), width: thickness, height: Math.abs(bcy - acy) };
                // Square corners, not a stadium (radius: thickness/2) — the discs
                // at each end (painted on top, see the per-cell disc above) already
                // supply the rounded caps, so the bridge itself only needs to fill
                // the straight-sided connector between them. A fully-rounded bridge
                // at this thickness (== disc diameter) reads as just another circle
                // rather than a tube.
                rects.push({ key: `${groupKey}-${i}`, ...rect, radius: 0, color });
            }
        };
        addBridges(path, COLORS.yellowAccent, "sel");
        for (const w of words) {
            if (!found.has(w.entryKey)) continue;
            const reviewing = popupWord?.entryKey === w.entryKey;
            addBridges(w.cells, reviewing ? "#A5D6A7" : "#C8E6C9", `found-${w.entryKey}`);
        }
        setBridgeRects(rects);

        const halfGap = CELL_GAP / 2;
        const hitboxes: { key: string; row: number; col: number; left: number; top: number; width: number; height: number }[] = [];
        for (let r = 0; r < grid.length; r++) {
            for (let c = 0; c < grid[r].length; c++) {
                const box = cellBox(r, c);
                if (!box) continue;
                hitboxes.push({
                    key: key(r, c),
                    row: r,
                    col: c,
                    left: box.left - halfGap,
                    top: box.top,
                    width: box.width + halfGap * 2,
                    height: box.height,
                });
            }
        }
        setHitboxRects(hitboxes);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, words, found, popupWord, scale, grid, showPinyin, rowPitchPx]);

    const markInteracted = useCallback(() => {
        if (interactedRef.current) return;
        interactedRef.current = true;
        onFirstInteraction?.();
    }, [onFirstInteraction]);

    // Resolve the grid cell under a viewport point (works through the CSS scale).
    // Hits the invisible `hitboxRects` overlay (see above) in the gutters between
    // cells, and the visible cell itself everywhere else — either way it's a
    // `[data-cell="1"]` element, so a single lookup covers both.
    const cellFromPoint = (x: number, y: number): Coord | null => {
        const el = document.elementFromPoint(x, y)?.closest('[data-cell="1"]');
        if (!el) return null;
        const r = Number(el.getAttribute("data-row"));
        const c = Number(el.getAttribute("data-col"));
        return Number.isFinite(r) && Number.isFinite(c) ? [r, c] : null;
    };

    // Viewport rect anchoring a found word's popup: the union of the word's cells
    // on its topmost row (so a snaking/multi-row word still anchors its popup over
    // the first line). getBoundingClientRect already reflects the CSS scale, so the
    // Popper lands correctly over the shrunk grid.
    const anchorRectForWord = useCallback((word: PlacedWord): DOMRect | null => {
        const inner = innerRef.current;
        if (!inner) return null;
        const rects = word.cells
            .map(([r, c]) => inner.querySelector(`[data-row="${r}"][data-col="${c}"]`))
            .filter((el): el is Element => el != null)
            .map((el) => el.getBoundingClientRect());
        if (rects.length === 0) return null;
        const minTop = Math.min(...rects.map((r) => r.top));
        const topRow = rects.filter((r) => Math.abs(r.top - minTop) <= 1);
        const left = Math.min(...topRow.map((r) => r.left));
        const right = Math.max(...topRow.map((r) => r.right));
        const top = Math.min(...topRow.map((r) => r.top));
        const bottom = Math.max(...topRow.map((r) => r.bottom));
        return new DOMRect(left, top, right - left, bottom - top);
    }, []);

    // Tap a found word to toggle its English gloss popup (tapping the open one, or
    // any other found word, closes/switches it — same feel as est segment taps).
    const toggleWordPopup = useCallback((word: PlacedWord) => {
        setPopupWord((prev) => (prev && prev.entryKey === word.entryKey ? null : word));
    }, []);

    // Keep the popup anchor in sync with the open word and the current fit scale
    // (a resize re-scales the grid, moving every cell's viewport rect).
    useLayoutEffect(() => {
        setPopupAnchorRect(popupWord ? anchorRectForWord(popupWord) : null);
    }, [popupWord, scale, anchorRectForWord]);

    // Popper takes a "virtual element" anchor (an object exposing
    // getBoundingClientRect); rebuild it whenever the rect changes so Popper reflows.
    const popperAnchorEl = useMemo(
        () => (popupAnchorRect ? { getBoundingClientRect: () => popupAnchorRect, nodeType: 1 } : null),
        [popupAnchorRect]
    );

    // Client-side check against the working set: does this path trace a not-yet-
    // found target (exact path or its reverse)? Works at ANY length, so single-
    // character target words register too. On a hit → onFound + clear + idle.
    // Returns whether a target was matched.
    const tryFoundTarget = useCallback(
        (selection: Coord[]): boolean => {
            for (const w of words) {
                if (found.has(w.entryKey)) continue;
                if (pathsEqual(selection, w.cells) || pathsEqual(selection, [...w.cells].reverse())) {
                    onFound(w);
                    clearSelection();
                    return true;
                }
            }
            return false;
        },
        [words, found, onFound, clearSelection]
    );

    // Finalize a selection on pointer release. Check the working set client-side
    // (any length — so single-character targets register too); a matched target
    // clears + idles inside tryFoundTarget. Anything else just clears the trail.
    // A lone tap counts as a one-character query.
    const submit = useCallback(
        (selection: Coord[]) => {
            if (selection.length === 0) return;
            if (tryFoundTarget(selection)) return;
            clearSelection();
        },
        [tryFoundTarget, clearSelection]
    );

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (!cell) return;
            // A tap on a cell locked by an already-found word never contributes to
            // a new find (words are disjoint), so treat it as a review tap: toggle
            // that word's English gloss popup and skip the drag entirely.
            const fw = foundWordByCell.get(key(cell[0], cell[1]));
            if (fw) {
                toggleWordPopup(fw);
                return;
            }
            // Any other pointer-down dismisses an open popup and begins a drag; a
            // release without movement leaves a one-cell path.
            setPopupWord(null);
            markInteracted();
            draggingRef.current = true;
            setPathBoth([cell]);
            (e.target as Element).setPointerCapture?.(e.pointerId);
        },
        [markInteracted, setPathBoth, foundWordByCell, toggleWordPopup]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!draggingRef.current) return;
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (!cell) return;
            const cur = pathRef.current;
            const last = cur[cur.length - 1];
            if (!last || eq(cell, last)) return;

            // Backtrack onto an earlier cell already in the path → shrink back to
            // it. Checking the whole path (not just the second-to-last cell)
            // covers a fast pointer move that skips straight past several cells
            // of an existing trail on its way back.
            const backIdx = cur.findIndex((c) => eq(c, cell));
            if (backIdx !== -1) {
                setPathBoth(cur.slice(0, backIdx + 1));
                return;
            }
            // Extend to an orthogonal neighbor.
            if (adjacent(cell, last)) {
                setPathBoth([...cur, cell]);
                return;
            }
            // The pointer jumped to a non-adjacent cell (fast swipe outrunning
            // elementFromPoint sampling) — bridge the gap with the shortest
            // orthogonal path from the last selected cell instead of letting the
            // highlight stall. Cells already in the path are treated as blocked
            // so the bridge can't cross/reuse the existing trail.
            const bridge = shortestOrthogonalPath(last, cell, cur, grid.length, grid[0]?.length ?? 0);
            if (bridge) setPathBoth([...cur, ...bridge]);
        },
        [setPathBoth, grid]
    );

    // Releasing (or lifting after a single tap) submits the traced path as a
    // query, then clears the selection regardless of the outcome.
    const onPointerUp = useCallback(() => {
        if (!draggingRef.current) return;
        submit(pathRef.current);
    }, [submit]);

    // Clear any in-progress selection whenever a find changes the board (so a
    // stale trail doesn't linger over newly-locked cells).
    useEffect(() => {
        clearSelection();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [found]);

    const inPath = (r: number, c: number) => path.some((p) => eq(p, [r, c]));

    return (
        <Box
            ref={containerRef}
            className="word-search__grid-container"
            sx={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
            }}
        >
            <Box
                ref={innerRef}
                className="word-search__grid"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ transform: `scale(${scale})` }}
                sx={{
                    position: "relative",
                    transformOrigin: "center center",
                    display: "grid",
                    gridTemplateColumns: `repeat(${grid[0]?.length ?? 0}, 1fr)`,
                    gridTemplateRows: rowPitchPx != null ? `repeat(${grid.length}, ${rowPitchPx}px)` : undefined,
                    columnGap: `${CELL_GAP}px`,
                    rowGap: 0,
                    p: 1.5,
                    borderRadius: "24px",
                    backgroundColor: COLORS.background,
                    border: "2px solid #000000",
                    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.04)",
                    // The grid owns all touch gestures (no native scroll/zoom).
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                }}
            >
                {/* Bridge bars connecting consecutive cells of a multi-cell highlight.
                    Absolutely positioned within the grid's padding box, so its
                    coordinate space matches each cell's offsetLeft/Top exactly. Grid
                    items with a z-index (all our cells set one below) always paint
                    above absolutely-positioned siblings per the CSS Grid painting
                    order, so no extra stacking-context work is needed here. */}
                <Box
                    aria-hidden
                    sx={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}
                >
                    {bridgeRects.map((b) => (
                        <Box
                            key={b.key}
                            sx={{
                                position: "absolute",
                                left: b.left,
                                top: b.top,
                                width: b.width,
                                height: b.height,
                                borderRadius: `${b.radius}px`,
                                backgroundColor: b.color,
                            }}
                        />
                    ))}
                </Box>

                {/* Invisible hit-target overlay: one `[data-cell="1"]` box per grid
                    cell, positioned to extend into the gutters on either side (see
                    `hitboxRects` above) so `cellFromPoint`'s elementFromPoint lookup
                    always resolves to a cell, never the bare grid background, even
                    when the point falls in what visually reads as a gap. Sits below
                    the real cells (zIndex 0 vs. 1) so a point inside an actual cell
                    still resolves to that cell first; only in the unclaimed gutter
                    space does this layer end up on top. */}
                {hitboxRects.map((h) => (
                    <Box
                        key={`hit-${h.key}`}
                        data-cell="1"
                        data-row={h.row}
                        data-col={h.col}
                        aria-hidden
                        sx={{
                            position: "absolute",
                            left: h.left,
                            top: h.top,
                            width: h.width,
                            height: h.height,
                            zIndex: 0,
                            pointerEvents: "auto",
                        }}
                    />
                ))}

                {grid.map((row, r) =>
                    row.map((cell, c) => {
                        const selected = inPath(r, c);
                        const isFound = foundCells.has(key(r, c));
                        // Cells of the found word whose gloss popup is open — ringed
                        // so it reads as the actively-reviewed word.
                        const isPopup = !!popupWord && popupWord.entryKey === foundWordByCell.get(key(r, c))?.entryKey;
                        // Pulse the hinted cell until it's traced/found (a found
                        // or in-progress highlight takes visual precedence).
                        const isHint = !isFound && !selected && !!hintCell && hintCell[0] === r && hintCell[1] === c;
                        // Selected/found/reviewing highlights render as a fixed-size
                        // circular disc (sized off the cell's smaller dimension, see
                        // `cellDiameter` above) so they stay true circles even when
                        // pinyin makes cells taller than wide, and read as beads
                        // strung along the bridge bars.
                        const isCircle = selected || isFound;
                        const circleColor = selected ? COLORS.yellowAccent : isPopup ? "#A5D6A7" : isFound ? "#C8E6C9" : undefined;
                        return (
                            <Box
                                key={key(r, c)}
                                ref={setCellEl(key(r, c))}
                                data-cell="1"
                                data-row={r}
                                data-col={c}
                                className={`word-search__cell${selected ? " word-search__cell--selected" : ""}${isFound ? " word-search__cell--found" : ""}${isPopup ? " word-search__cell--reviewing" : ""}${isHint ? " word-search__cell--hint" : ""}`}
                                sx={{
                                    position: "relative",
                                    zIndex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: "8px",
                                    backgroundColor: isHint ? "#FFE0B2" : "transparent",
                                    // Amber ring pulse draws the eye to the hinted cell.
                                    "@keyframes wsHintPulse": {
                                        "0%, 100%": { boxShadow: "0 0 0 0 rgba(255,167,38,0.55)" },
                                        "50%": { boxShadow: "0 0 0 7px rgba(255,167,38,0)" },
                                    },
                                    animation: isHint ? "wsHintPulse 1.25s ease-in-out infinite" : "none",
                                }}
                            >
                                {isCircle && (
                                    <Box
                                        aria-hidden
                                        sx={{
                                            position: "absolute",
                                            // left/top 50% + translate(-50%, -50%) is a more
                                            // reliable centering technique here than
                                            // inset:0 + margin:auto — the latter needs the
                                            // browser to solve an over-constrained/auto-margin
                                            // system for a flex child that's out of flow, which
                                            // was resolving asymmetrically on the horizontal
                                            // axis in testing (disc centered vertically but
                                            // pinned to the cell's left edge horizontally).
                                            left: "50%",
                                            top: "50%",
                                            width: cellDiameter,
                                            height: cellDiameter,
                                            // Shift down onto the character glyph's own
                                            // center (see `discOffsetY` above) rather
                                            // than the char+pinyin block's center.
                                            transform: `translate(-50%, calc(-50% + ${discOffsetY}px))`,
                                            borderRadius: "50%",
                                            backgroundColor: circleColor,
                                            transition: "background-color 0.12s ease",
                                            // Negative z-index within this cell's own
                                            // stacking context (the cell is a grid item
                                            // with z-index set, so it establishes one)
                                            // paints the disc behind the char/pinyin
                                            // text but still above the bridge overlay.
                                            zIndex: -1,
                                        }}
                                    />
                                )}
                                <ForeignText
                                    size={CELL_SIZE}
                                    justifyContent="center"
                                    text={cell.char}
                                    pronunciation={cell.pinyin}
                                    showPinyin={showPinyin}
                                    useToneColor={showPinyinColor}
                                />
                            </Box>
                        );
                    })
                )}
            </Box>

            {/* English-gloss popup for the tapped found word. Rendered through a
                Popper portal (like the est segment popup) so it escapes the grid
                container's overflow:hidden and is never clipped. */}
            <Popper
                open={!!popupWord && !!popupWord.definition && !!popupAnchorRect}
                anchorEl={popperAnchorEl}
                placement="top"
                modifiers={[
                    { name: "offset", options: { offset: [0, 6] } },
                    { name: "preventOverflow", options: { boundary: "viewport", padding: 8 } },
                    { name: "flip", options: { fallbackPlacements: ["bottom"] } },
                ]}
                sx={{ zIndex: 1300 }}
            >
                <Box
                    className="word-search__gloss-popup"
                    sx={{
                        backgroundColor: "#FFFFFF",
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: "8px",
                        boxShadow: 2,
                        px: 1.25,
                        py: 0.75,
                        maxWidth: "220px",
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: SIZE.caption,
                            lineHeight: 1.3,
                            color: "text.primary",
                            fontFamily: FONTS.sans,
                            textAlign: "center",
                            wordBreak: "break-word",
                        }}
                    >
                        {popupWord?.definition ? stripParentheses(popupWord.definition) : ""}
                    </Typography>
                </Box>
            </Popper>
        </Box>
    );
});

WordSearchGrid.displayName = "WordSearchGrid";

export default WordSearchGrid;

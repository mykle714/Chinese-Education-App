import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { apiGet } from "../../api/http";
import type { DictionaryEntry } from "../hooks/useDictionaryEntries";
import { CELL_SIZE, MIN_LOOKUP_LENGTH } from "./constants";
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
    /** A target's path was traced correctly. */
    onFound: (word: PlacedWord) => void;
    /** A valid non-target dictionary word was selected (bonus discovery). */
    onDiscover: (entry: DictionaryEntry) => void;
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

/**
 * Scale a natural-size element down to fit its container (never up past 1×).
 * Lets the grid render at the real `sm` cpcd size while still fitting the play
 * area on short screens — CSS transforms don't affect elementFromPoint hit-
 * testing, so drag selection keeps working. See docs/WORD_SEARCH_GAME.md §3.
 */
function useFitScale(
    containerRef: React.RefObject<HTMLElement | null>,
    innerRef: React.RefObject<HTMLElement | null>,
    deps: unknown[]
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
            const availW = container.clientWidth;
            const availH = container.clientHeight;
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
 * word-selection interaction — both drag-through-cells and tap-cell-by-cell,
 * sharing one path-building model (orthogonal steps only). On each completed
 * selection it checks the traced path against the remaining targets, and
 * otherwise looks the joined characters up in the dictionary so a valid
 * multi-character word pops the discovery info-card. See doc §4.
 */
const WordSearchGrid = forwardRef<WordSearchGridHandle, WordSearchGridProps>(({
    grid,
    words,
    found,
    showPinyin,
    showPinyinColor,
    onFound,
    onDiscover,
    onFirstInteraction,
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const scale = useFitScale(containerRef, innerRef, [grid, showPinyin]);

    // Current in-progress selection path. Mirrored to a ref so the pointer
    // handlers (which close over stale state otherwise) read the latest value.
    const [path, setPath] = useState<Coord[]>([]);
    const pathRef = useRef<Coord[]>([]);
    const setPathBoth = useCallback((next: Coord[]) => {
        pathRef.current = next;
        setPath(next);
    }, []);

    // Interaction mode. 'dragging' = pointer is down and we're extending by drag;
    // 'tapping' = a path is being built one discrete tap at a time.
    const modeRef = useRef<"idle" | "dragging" | "tapping">("idle");
    const didMoveRef = useRef(false);
    const interactedRef = useRef(false);

    // Let the page clear an in-progress selection on a background tap.
    const clearSelection = useCallback(() => {
        setPathBoth([]);
        modeRef.current = "idle";
    }, [setPathBoth]);
    useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

    // Cells locked as part of a found word (disjoint — words never overlap).
    const foundCells = new Set<string>();
    for (const w of words) {
        if (found.has(w.entryKey)) w.cells.forEach(([r, c]) => foundCells.add(key(r, c)));
    }

    const markInteracted = useCallback(() => {
        if (interactedRef.current) return;
        interactedRef.current = true;
        onFirstInteraction?.();
    }, [onFirstInteraction]);

    // Resolve the grid cell under a viewport point (works through the CSS scale).
    const cellFromPoint = (x: number, y: number): Coord | null => {
        const el = document.elementFromPoint(x, y)?.closest('[data-cell="1"]');
        if (!el) return null;
        const r = Number(el.getAttribute("data-row"));
        const c = Number(el.getAttribute("data-col"));
        return Number.isFinite(r) && Number.isFinite(c) ? [r, c] : null;
    };

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
                    setPathBoth([]);
                    modeRef.current = "idle";
                    return true;
                }
            }
            return false;
        },
        [words, found, onFound, setPathBoth]
    );

    // Finalize a selection: try the working set first (client-side, any length),
    // otherwise look MULTI-character selections up in the dictionary so a real
    // word pops the info-card. Single-character non-targets do nothing — too noisy
    // to look up. `fromDrag` controls the miss behavior: a failed drag clears, but
    // tap-building keeps the path so the player can extend toward a longer word.
    const submit = useCallback(
        (selection: Coord[], fromDrag: boolean) => {
            if (tryFoundTarget(selection)) return;
            if (selection.length < MIN_LOOKUP_LENGTH) return;

            const term = selection.map(([r, c]) => grid[r][c].char).join("");
            apiGet<DictionaryEntry>(`/api/dictionary/lookup/${encodeURIComponent(term)}`)
                .then((entry) => {
                    onDiscover(entry);
                    setPathBoth([]);
                    modeRef.current = "idle";
                })
                .catch(() => {
                    // Not a real word. Drag attempts clear; tap-building persists.
                    if (fromDrag) {
                        setPathBoth([]);
                        modeRef.current = "idle";
                    }
                });
        },
        [tryFoundTarget, grid, onDiscover, setPathBoth]
    );

    // A discrete tap while in tapping mode: extend / undo / restart the path.
    const handleTap = useCallback(
        (cell: Coord) => {
            const cur = pathRef.current;
            if (cur.length === 0) {
                setPathBoth([cell]);
                return;
            }
            const last = cur[cur.length - 1];
            const secondLast = cur.length >= 2 ? cur[cur.length - 2] : null;

            if (secondLast && eq(cell, secondLast)) {
                // Tap the previous cell → undo the last step.
                setPathBoth(cur.slice(0, -1));
                return;
            }
            if (eq(cell, last)) {
                // Re-tap the tip → re-check the current path.
                submit(cur, false);
                return;
            }
            if (adjacent(cell, last) && !cur.some((c) => eq(c, cell))) {
                const next = [...cur, cell];
                setPathBoth(next);
                submit(next, false);
                return;
            }
            // Non-adjacent / already-used cell → register it if it's a single-char
            // target, otherwise start a fresh path here.
            if (!tryFoundTarget([cell])) setPathBoth([cell]);
        },
        [setPathBoth, submit, tryFoundTarget]
    );

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (!cell) return;
            markInteracted();

            if (modeRef.current === "tapping") {
                handleTap(cell);
                return;
            }
            // Begin a drag candidate (becomes a single-cell tap if no movement).
            modeRef.current = "dragging";
            didMoveRef.current = false;
            setPathBoth([cell]);
            (e.target as Element).setPointerCapture?.(e.pointerId);
        },
        [handleTap, markInteracted, setPathBoth]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (modeRef.current !== "dragging") return;
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (!cell) return;
            const cur = pathRef.current;
            const last = cur[cur.length - 1];
            if (!last || eq(cell, last)) return;

            // Backtrack onto the previous cell → shrink the path.
            if (cur.length >= 2 && eq(cell, cur[cur.length - 2])) {
                didMoveRef.current = true;
                setPathBoth(cur.slice(0, -1));
                return;
            }
            // Extend to an orthogonal, unused neighbor.
            if (adjacent(cell, last) && !cur.some((c) => eq(c, cell))) {
                didMoveRef.current = true;
                setPathBoth([...cur, cell]);
            }
        },
        [setPathBoth]
    );

    const onPointerUp = useCallback(() => {
        if (modeRef.current !== "dragging") return;
        if (didMoveRef.current && pathRef.current.length >= 2) {
            submit(pathRef.current, true);
        } else {
            // A stationary press on a single cell: register it immediately if it's
            // a single-char target, otherwise switch to tap-building from here.
            if (!tryFoundTarget(pathRef.current)) modeRef.current = "tapping";
        }
    }, [submit, tryFoundTarget]);

    // Clear any in-progress selection whenever a find changes the board (so a
    // stale trail doesn't linger over newly-locked cells).
    useEffect(() => {
        setPathBoth([]);
        modeRef.current = "idle";
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
                    transformOrigin: "center center",
                    display: "grid",
                    gridTemplateColumns: `repeat(${grid[0]?.length ?? 0}, 1fr)`,
                    gap: 0,
                    p: 1.5,
                    borderRadius: "24px",
                    backgroundColor: "#F4F7FF",
                    border: "2px solid #DCE6FB",
                    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.04)",
                    // The grid owns all touch gestures (no native scroll/zoom).
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                }}
            >
                {grid.map((row, r) =>
                    row.map((cell, c) => {
                        const selected = inPath(r, c);
                        const isFound = foundCells.has(key(r, c));
                        return (
                            <Box
                                key={key(r, c)}
                                data-cell="1"
                                data-row={r}
                                data-col={c}
                                className={`word-search__cell${selected ? " word-search__cell--selected" : ""}${isFound ? " word-search__cell--found" : ""}`}
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: "8px",
                                    transition: "background-color 0.12s ease",
                                    backgroundColor: selected
                                        ? "#FFD666"
                                        : isFound
                                          ? "#C8E6C9"
                                          : "transparent",
                                }}
                            >
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
        </Box>
    );
});

WordSearchGrid.displayName = "WordSearchGrid";

export default WordSearchGrid;

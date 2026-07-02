import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Popper, Typography } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { stripParentheses } from "../../utils/definitionUtils";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { COLORS } from "../../theme/colors";
import {
    CELL_SIZE,
    CELL_GAP,
    GRID_MARGIN,
    SELECTION_EXTRA_OFFSET_Y_FRAC,
    SELECTION_EXTRA_OFFSET_Y_FRAC_NO_PINYIN,
    MISS_FLASH_MS,
} from "./constants";
import type { BonusWord, Coord, GridCell, PlacedWord } from "./types";

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
    /**
     * Every det headword composed exclusively of characters somewhere on this
     * grid (not necessarily a target, not guaranteed traceable — see
     * `types.ts`). A miss that spells one of these is a "bonus" find: it
     * flashes blue instead of red and reveals the word's definition in a
     * popup, instead of the plain red miss shake.
     */
    bonusWords: BonusWord[];
    showPinyin: boolean;
    showPinyinColor: boolean;
    /**
     * Once a hint has fully spelled out a word's pinyin (see WordSearchHintRow)
     * and the player presses hint again anyway, its cells are revealed here in
     * yellow — persistently, until the word is found — instead of advancing to
     * a different word. Null when no word is in that "location revealed" state.
     */
    hintedWord: PlacedWord | null;
    /** Bumped each time hint is pressed while `hintedWord` is already showing,
     *  to retrigger the nag shake on its cells (nonce trick, see `invalid`). */
    hintShakeNonce: number;
    /** A target's path was traced correctly. */
    onFound: (word: PlacedWord) => void;
    /** A multi-character bonus word was traced (the "blue match" — see
     *  `isMultiCharBonus`). Not fired for the colorless single-character
     *  bonus case. */
    onBonusFound?: (bonus: BonusWord) => void;
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
    bonusWords,
    showPinyin,
    showPinyinColor,
    hintedWord,
    hintShakeNonce,
    onFound,
    onBonusFound,
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

    // Lookup from a word's Chinese text to its bonus-word record, so `submit`
    // can check a traced-but-non-target path's spelled-out characters in O(1).
    const bonusWordMap = useMemo(() => new Map(bonusWords.map((w) => [w.entryKey, w])), [bonusWords]);

    // A just-submitted query that traced no target. Kept alive (path isn't
    // cleared yet) so the traced cells can show feedback before the selection
    // resets. `nonce` restarts the CSS shake animation on back-to-back wrong
    // guesses. `bonus` is set when the traced (non-target) path still spells a
    // real det word (see `bonusWords`):
    //   - length >= 2: the flash turns blue instead of red, shakes the same as
    //     a miss, and the word's definition appears in the review-popup style.
    //   - length === 1: no color change and no shake (a single character is a
    //     much smaller "find" than a whole word) — just the definition popup.
    // Either way a bonus match has NO auto-dismiss timer (unlike a true miss,
    // which auto-clears after MISS_FLASH_MS): it stays up until the player
    // taps elsewhere, handled by `onPointerDown`/`clearSelection` below.
    const [invalid, setInvalid] = useState<{ nonce: number; bonus: BonusWord | null } | null>(null);
    const invalidTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Whether the current bonus match is 2+ characters — the only case that
    // gets the blue/shake "miss-flash" treatment (a single character just
    // shows its popup with no highlight change).
    const isMultiCharBonus = (bonus: BonusWord | null): boolean => !!bonus && [...bonus.entryKey].length > 1;

    // Let the page clear an in-progress selection on a background tap. Also closes
    // any open found-word popup.
    const clearSelection = useCallback(() => {
        if (invalidTimeoutRef.current) {
            clearTimeout(invalidTimeoutRef.current);
            invalidTimeoutRef.current = null;
        }
        setPathBoth([]);
        draggingRef.current = false;
        setPopupWord(null);
        setInvalid(null);
    }, [setPathBoth]);
    useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

    // Any pending invalid-flash timeout must not fire after unmount.
    useEffect(() => {
        return () => {
            if (invalidTimeoutRef.current) clearTimeout(invalidTimeoutRef.current);
        };
    }, []);

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

    // Cells of the hint's revealed-location word (see `hintedWord` above), for
    // the per-cell shake below. Empty once the word is found.
    const hintedCells = useMemo(() => {
        const set = new Set<string>();
        if (hintedWord && !found.has(hintedWord.entryKey)) {
            hintedWord.cells.forEach(([r, c]) => set.add(key(r, c)));
        }
        return set;
    }, [hintedWord, found]);

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

    // Row track height (px), forced equal to `columnWidth + CELL_GAP` so the
    // vertical distance between adjacent rows' character centers matches the
    // horizontal distance between adjacent columns'. Pinyin makes a cell's own
    // content taller than that pitch, so rows are deliberately packed tighter
    // than their natural content height — adjacent rows' char/pinyin content
    // overlaps slightly rather than spacing characters unevenly. `null` until
    // measured (renders with normal auto row sizing for that first pass).
    const [rowPitchPx, setRowPitchPx] = useState<number | null>(null);

    // Selection shapes: one continuous stadium (a rounded rectangle whose corner
    // radius is half its cross-axis thickness, so the ends read as full
    // semicircles) per consecutive pair of cells in a highlight (the in-progress
    // yellow drag, and each found/reviewing green word), plus a single circular
    // node (radius = half the diameter) for a one-cell highlight, which has no
    // pair to connect. Consecutive stadiums overlap fully at their shared cell so
    // a multi-cell highlight — including a snaking, multi-turn one — reads as one
    // unbroken shape with no separate cap/connector elements. Measured in the
    // inner grid's own (unscaled) coordinate space via offsetLeft/Top/Width/Height,
    // which — unlike getBoundingClientRect — ignore the CSS `scale()` transform,
    // so no rescaling is needed here.
    const [selectionRects, setSelectionRects] = useState<
        { key: string; left: number; top: number; width: number; height: number; radius: number; color: string }[]
    >([]);

    // Invisible per-cell hit targets that extend half of `CELL_GAP` into the
    // gutter on each side (rows are already flush — see `rowPitchPx` — so no
    // vertical extension is needed). Adjacent cells' extensions meet exactly at
    // the gutter's midpoint, so together they physically claim the whole gap
    // with no seam left un-owned by any element — the gap only ever *looks*
    // empty. Same measured-DOM approach as `selectionRects` below, kept as a
    // separate overlay so the visible per-cell box (and everything measured off
    // its offsetWidth/Left — row pitch, selection geometry) is untouched.
    const [hitboxRects, setHitboxRects] = useState<
        { key: string; row: number; col: number; left: number; top: number; width: number; height: number }[]
    >([]);

    useLayoutEffect(() => {
        const sample = cellElRef.current.get(key(0, 0));
        if (!sample) return;

        // Pass 1: measure the natural column width (an axis the row-pitch change
        // never touches) and lock the row track to match + CELL_GAP. Bail out and
        // let the re-render with the new fixed row height land before measuring
        // anything that depends on it (diameter, center offset, selection geometry).
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
        const thickness = diameter;

        let offsetY = 0;
        const cellRect = sample.getBoundingClientRect();
        const charEl = sample.querySelector<HTMLElement>(".char-pinyin-display__character");
        if (charEl && cellRect.height > 0) {
            const charRect = charEl.getBoundingClientRect();
            const charCenterFrac = (charRect.top + charRect.height / 2 - cellRect.top) / cellRect.height;
            offsetY = (charCenterFrac - 0.5) * rowHeight;
        }
        // Every selection shape is centered on cell centers, so they share the
        // same total offset (glyph-centering + the extra tunable nudge).
        offsetY += diameter * (showPinyin ? SELECTION_EXTRA_OFFSET_Y_FRAC : SELECTION_EXTRA_OFFSET_Y_FRAC_NO_PINYIN);

        const rects: { key: string; left: number; top: number; width: number; height: number; radius: number; color: string }[] = [];
        const addSelectionShapes = (coords: Coord[], color: string, groupKey: string) => {
            if (coords.length === 1) {
                // No pair to connect — draw a standalone circular node (a stadium
                // degenerates to a circle when its length is zero).
                const box = cellBox(coords[0][0], coords[0][1]);
                if (!box) return;
                const cx = box.left + box.width / 2;
                const cy = box.top + box.height / 2 + offsetY;
                rects.push({
                    key: `${groupKey}-0`,
                    left: cx - diameter / 2,
                    top: cy - diameter / 2,
                    width: diameter,
                    height: diameter,
                    radius: diameter / 2,
                    color,
                });
                return;
            }
            for (let i = 0; i < coords.length - 1; i++) {
                const a = cellBox(coords[i][0], coords[i][1]);
                const b = cellBox(coords[i + 1][0], coords[i + 1][1]);
                if (!a || !b) continue;
                const acx = a.left + a.width / 2;
                const acy = a.top + a.height / 2 + offsetY;
                const bcx = b.left + b.width / 2;
                const bcy = b.top + b.height / 2 + offsetY;
                // The box extends `thickness / 2` past each cell center on the
                // long axis (not just center-to-center) — a stadium's semicircle
                // caps stick out beyond its straight flat sides, so rounding a box
                // that stops exactly at the centers would pinch the corners inward
                // instead of bulging them outward into full semicircles there.
                const rect =
                    acy === bcy
                        ? {
                              left: Math.min(acx, bcx) - thickness / 2,
                              top: acy - thickness / 2,
                              width: Math.abs(bcx - acx) + thickness,
                              height: thickness,
                          }
                        : {
                              left: acx - thickness / 2,
                              top: Math.min(acy, bcy) - thickness / 2,
                              width: thickness,
                              height: Math.abs(bcy - acy) + thickness,
                          };
                // Fully rounded (radius = half the cross-axis thickness) — a
                // stadium whose semicircular ends sit exactly at the two cell
                // centers. Consecutive segments' end-caps coincide at their shared
                // cell, so a snaking multi-cell path reads as one unbroken tube
                // with no separate cap elements needed.
                rects.push({ key: `${groupKey}-${i}`, ...rect, radius: thickness / 2, color });
            }
        };
        // A single-character bonus match shows no highlight at all — not even
        // the normal yellow in-progress color — just its definition popup.
        const selectionColor = invalid
            ? invalid.bonus
                ? (isMultiCharBonus(invalid.bonus) ? COLORS.blueAccent : null)
                : COLORS.redAccent
            : COLORS.yellowAccent;
        if (selectionColor) addSelectionShapes(path, selectionColor, "sel");
        for (const w of words) {
            if (!found.has(w.entryKey)) continue;
            const reviewing = popupWord?.entryKey === w.entryKey;
            addSelectionShapes(w.cells, reviewing ? "#A5D6A7" : "#C8E6C9", `found-${w.entryKey}`);
        }
        // A hint that's already fully spelled out its word's pinyin and got
        // pressed again reveals the word's actual path — persistently, until
        // found — instead of moving on to a different word (see WordSearchPage's
        // `useHint`). Drawn under the same yellow as an in-progress selection.
        if (hintedWord && !found.has(hintedWord.entryKey)) {
            addSelectionShapes(hintedWord.cells, COLORS.yellowAccent, `hint-${hintedWord.entryKey}`);
        }
        setSelectionRects(rects);

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
    }, [path, words, found, popupWord, scale, grid, showPinyin, rowPitchPx, invalid, hintedWord]);

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

    // Viewport rect anchoring a popup over a set of cells: the union of the
    // topmost row among them (so a snaking/multi-row word still anchors its
    // popup over the first line). getBoundingClientRect already reflects the
    // CSS scale, so the Popper lands correctly over the shrunk grid. Shared by
    // the found-word review popup and the bonus-word miss popup.
    const anchorRectForCells = useCallback((cells: Coord[]): DOMRect | null => {
        const inner = innerRef.current;
        if (!inner) return null;
        const rects = cells
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
        setPopupAnchorRect(popupWord ? anchorRectForCells(popupWord.cells) : null);
    }, [popupWord, scale, anchorRectForCells]);

    // Anchor for the bonus-word miss popup — mirrors the found-word popup above,
    // but keyed off the traced path (`invalid.bonus`) instead of a found word.
    const [bonusAnchorRect, setBonusAnchorRect] = useState<DOMRect | null>(null);
    useLayoutEffect(() => {
        setBonusAnchorRect(invalid?.bonus ? anchorRectForCells(path) : null);
        // `path` is intentionally excluded: a bonus match has no auto-dismiss
        // timer, so `path` and `invalid` are always cleared together in the same
        // tick (`onPointerDown` / `clearSelection`) — re-running this effect off
        // `path` too would just re-measure the identical rect on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invalid, scale, anchorRectForCells]);

    // The single review popup shown at a time: either a tapped found word, or a
    // just-missed bonus word — both render through the same Popper/style below.
    // `entryKey` is carried through and prepended in the correct reading order
    // (§4) because the grid's snaking path can visually read in any direction —
    // up/down/backwards — so the on-grid glyphs alone don't reliably show the
    // word in order.
    const activePopup = popupWord
        ? { rect: popupAnchorRect, entryKey: popupWord.entryKey, definition: popupWord.definition }
        : invalid?.bonus
        ? { rect: bonusAnchorRect, entryKey: invalid.bonus.entryKey, definition: invalid.bonus.definition }
        : null;

    // Popper takes a "virtual element" anchor (an object exposing
    // getBoundingClientRect); rebuild it whenever the rect changes so Popper reflows.
    const popperAnchorEl = useMemo(
        () => (activePopup?.rect ? { getBoundingClientRect: () => activePopup.rect!, nodeType: 1 } : null),
        [activePopup]
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
    // clears + idles inside tryFoundTarget. Anything else holds the traced path
    // visible instead of resetting silently — a true miss auto-clears (red +
    // shake) after MISS_FLASH_MS, while a bonus-word match (see `bonusWords`)
    // has no timer at all: it stays up, with its definition popup, until the
    // player dismisses it by tapping elsewhere. A lone tap counts as a
    // one-character query, so a single character that's itself a headword
    // resolves here too (as a no-shake, no-color-change bonus match).
    const submit = useCallback(
        (selection: Coord[]) => {
            if (selection.length === 0) return;
            if (tryFoundTarget(selection)) return;
            draggingRef.current = false;
            const forward = selection.map(([r, c]) => grid[r]?.[c]?.char ?? "").join("");
            const reversed = [...forward].reverse().join("");
            const bonus = bonusWordMap.get(forward) ?? bonusWordMap.get(reversed) ?? null;
            setInvalid((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, bonus }));
            if (bonus) {
                if (isMultiCharBonus(bonus)) onBonusFound?.(bonus);
                return; // no auto-dismiss — stays until the player taps elsewhere
            }
            invalidTimeoutRef.current = setTimeout(() => {
                invalidTimeoutRef.current = null;
                clearSelection();
            }, MISS_FLASH_MS);
        },
        [tryFoundTarget, clearSelection, grid, bonusWordMap, onBonusFound]
    );

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (!cell) return;
            // Any new interaction dismisses a still-showing miss/bonus flash first
            // — checked before the found-word branch below so tapping a locked
            // word while a bonus popup is open (which has no auto-dismiss timer)
            // still clears the stale trail instead of leaving it drawn underneath.
            if (invalidTimeoutRef.current) {
                clearTimeout(invalidTimeoutRef.current);
                invalidTimeoutRef.current = null;
            }
            if (invalid) {
                setInvalid(null);
                setPathBoth([]);
            }
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
        [markInteracted, setPathBoth, foundWordByCell, toggleWordPopup, invalid]
    );

    // Extend the in-progress path to `cell` — shared by `onPointerMove` (each
    // intermediate sample) and `onPointerUp` (one final sample at release, see
    // below). Returns the extended path without committing it to state, so the
    // caller can decide whether to set it or submit it directly.
    const extendPathTo = useCallback(
        (cur: Coord[], cell: Coord): Coord[] => {
            const last = cur[cur.length - 1];
            if (!last || eq(cell, last)) return cur;

            // Backtrack onto an earlier cell already in the path → shrink back to
            // it. Checking the whole path (not just the second-to-last cell)
            // covers a fast pointer move that skips straight past several cells
            // of an existing trail on its way back.
            const backIdx = cur.findIndex((c) => eq(c, cell));
            if (backIdx !== -1) return cur.slice(0, backIdx + 1);

            // Cells locked by an already-found word are off-limits to a new
            // selection (words are disjoint, so re-tracing one can never
            // contribute to a find) — ignore the sample instead of extending
            // onto it.
            if (foundCells.has(key(cell[0], cell[1]))) return cur;

            // Extend to an orthogonal neighbor.
            if (adjacent(cell, last)) return [...cur, cell];

            // The pointer jumped to a non-adjacent cell (fast swipe outrunning
            // elementFromPoint sampling) — bridge the gap with the shortest
            // orthogonal path from the last selected cell instead of letting the
            // highlight stall. Cells already in the path, as well as found-word
            // cells, are treated as blocked so the bridge can't cross/reuse the
            // existing trail or pass through a locked word.
            const foundCoords: Coord[] = [...foundCells].map((k) => k.split(",").map(Number) as Coord);
            const bridge = shortestOrthogonalPath(last, cell, [...cur, ...foundCoords], grid.length, grid[0]?.length ?? 0);
            return bridge ? [...cur, ...bridge] : cur;
        },
        [grid, foundCells]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!draggingRef.current) return;
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (!cell) return;
            const cur = pathRef.current;
            const extended = extendPathTo(cur, cell);
            if (extended !== cur) setPathBoth(extended);
        },
        [setPathBoth, extendPathTo]
    );

    // Releasing (or lifting after a single tap) submits the traced path as a
    // query, then clears the selection regardless of the outcome. A very fast
    // drag can outrun pointermove sampling entirely — zero move events fire
    // between down and up — leaving `pathRef.current` stuck at just the
    // starting cell even though the finger crossed several more. Pointerup
    // carries the release coordinates, so take one last sample here and extend
    // the path to it (same adjacent/backtrack/bridge logic as a move event)
    // before submitting, instead of submitting the stale one-cell path.
    const onPointerUp = useCallback(
        (e: React.PointerEvent) => {
            if (!draggingRef.current) return;
            const cell = cellFromPoint(e.clientX, e.clientY);
            const cur = pathRef.current;
            const final = cell ? extendPathTo(cur, cell) : cur;
            submit(final);
        },
        [submit, extendPathTo]
    );

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
                {/* Selection stadiums/nodes (see `selectionRects` above) — the single
                    shape type covering both in-progress drags and found/reviewing
                    words. Absolutely positioned within the grid's padding box, so its
                    coordinate space matches each cell's offsetLeft/Top exactly. Grid
                    items with a z-index (all our cells set one below) always paint
                    above absolutely-positioned siblings per the CSS Grid painting
                    order, so no extra stacking-context work is needed here. */}
                <Box
                    aria-hidden
                    sx={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}
                >
                    {selectionRects.map((r) => (
                        <Box
                            key={r.key}
                            sx={{
                                position: "absolute",
                                left: r.left,
                                top: r.top,
                                width: r.width,
                                height: r.height,
                                borderRadius: `${r.radius}px`,
                                backgroundColor: r.color,
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
                        // Selected/found/reviewing highlights are painted entirely by
                        // the `selectionRects` stadium/node overlay below the cells
                        // (see above) — this cell only needs to know whether it's
                        // mid-flash for the shake animation. A single-character bonus
                        // match is deliberately excluded (see `invalid` above): no
                        // shake, just its definition popup.
                        const isInvalidCell = selected && !!invalid && (!invalid.bonus || isMultiCharBonus(invalid.bonus));
                        // Nonce-keyed keyframe name so back-to-back wrong guesses restart
                        // the shake cleanly (same trick as fie/flp's shake — see
                        // CardIconCanvas.tsx / FlashCardSection.tsx cardShake) — but at a
                        // much smaller amplitude, since this shakes a handful of cells
                        // rather than the whole card.
                        const invalidShakeName = isInvalidCell ? `wsInvalidShake-${invalid!.nonce}` : "";
                        // The hint's revealed-location cells (see `hintedCells` above).
                        // Same nonce trick as the miss shake, but re-fires every time
                        // hint is pressed again on an already-fully-spelled-out word
                        // (`hintShakeNonce` in WordSearchPage's `useHint`) — the yellow
                        // fill itself (painted by the stadium overlay) stays put the
                        // whole time; only the shake replays.
                        const isHintCell = hintedCells.has(key(r, c));
                        const hintShakeName = isHintCell && hintShakeNonce > 0 ? `wsHintShake-${hintShakeNonce}` : "";
                        return (
                            <Box
                                key={key(r, c)}
                                ref={setCellEl(key(r, c))}
                                data-cell="1"
                                data-row={r}
                                data-col={c}
                                className={`word-search__cell${selected ? " word-search__cell--selected" : ""}${isFound ? " word-search__cell--found" : ""}${isPopup ? " word-search__cell--reviewing" : ""}${isInvalidCell ? " word-search__cell--invalid" : ""}${isHintCell ? " word-search__cell--hint-reveal" : ""}`}
                                sx={{
                                    position: "relative",
                                    zIndex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: "8px",
                                    backgroundColor: "transparent",
                                    ...(isInvalidCell && {
                                        [`@keyframes ${invalidShakeName}`]: {
                                            "0%, 100%": { transform: "translate(0, 0) rotate(0deg)" },
                                            "25%": { transform: "translate(-4px, 0) rotate(-0.5deg)" },
                                            "50%": { transform: "translate(4px, 0) rotate(0.5deg)" },
                                            "75%": { transform: "translate(-2px, 0) rotate(-0.25deg)" },
                                        },
                                    }),
                                    ...(hintShakeName && {
                                        [`@keyframes ${hintShakeName}`]: {
                                            "0%, 100%": { transform: "translate(0, 0) rotate(0deg)" },
                                            "25%": { transform: "translate(-4px, 0) rotate(-0.5deg)" },
                                            "50%": { transform: "translate(4px, 0) rotate(0.5deg)" },
                                            "75%": { transform: "translate(-2px, 0) rotate(-0.25deg)" },
                                        },
                                    }),
                                    animation: isInvalidCell
                                        ? `${invalidShakeName} 0.32s ease-in-out`
                                        : hintShakeName
                                        ? `${hintShakeName} 0.32s ease-in-out`
                                        : "none",
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

            {/* English-gloss popup — either a tapped found word (review) or a just-
                missed bonus word's definition (see `activePopup`). Rendered
                through a Popper portal (like the est segment popup) so it
                escapes the grid container's overflow:hidden and is never
                clipped. */}
            <Popper
                open={!!activePopup && !!activePopup.definition && !!activePopup.rect}
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
                        {activePopup?.entryKey && (
                            <Box
                                component="span"
                                className="word-search__gloss-popup-entry-key"
                                sx={{ fontWeight: WEIGHT.bold }}
                            >
                                {activePopup.entryKey}
                                {/* Two non-breaking spaces — plain " " would collapse to one
                                    under normal CSS whitespace handling. */}
                                {"  "}
                            </Box>
                        )}
                        {activePopup?.definition ? stripParentheses(activePopup.definition) : ""}
                    </Typography>
                </Box>
            </Popper>
        </Box>
    );
});

WordSearchGrid.displayName = "WordSearchGrid";

export default WordSearchGrid;

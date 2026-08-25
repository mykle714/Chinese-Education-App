import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Popper, Typography } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { cpcdNaturalSize } from "../../components/CPCDRow";
import { stripParentheses } from "../../utils/definitionUtils";
import { getToneColor } from "../../utils/toneColors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { COLORS } from "../../theme/colors";
import {
    CELL_SIZE,
    CELL_GAP,
    GRID_MARGIN,
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
    /**
     * Play a word's narration. Called to (a) replay a found target's audio when
     * the player taps its locked cells, and (b) speak a multi-character bonus
     * word the moment it's traced (the "blue match") — the underlying provider
     * fetches from the server on first play and caches the decoded buffer for
     * the rest of the game, so repeats are instant.
     */
    speak?: (entryKey: string, pinyin: string) => void;
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
    speak,
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    /**
     * Side (px) of one square board tile, BEFORE `useFitScale`'s transform.
     *
     * Derived from the cpcd cell's own natural box rather than from
     * `aspect-ratio: 1` on the tile. A cpcd cell is much taller than it is wide
     * (a 32px `sm` column under a ~57px glyph+pinyin stack), so `aspect-ratio`
     * asked the browser to square a box whose width came from content-width and
     * whose height came from content-height — and inside a `repeat(N, 1fr)`
     * track the two engines disagreed about which one sizes the track. Safari
     * laid the grid box out at the narrow (content-width) figure while painting
     * tracks at the tall one: the board overflowed the play panel to the right,
     * every tile past column 5 was clipped, and `useFitScale` — which measures
     * the BOX (`offsetWidth`), not the tracks — saw a board that fit and left
     * the scale at 1. Explicit px tracks make the box and the tracks the same
     * number in every engine, which is also what makes the fit-scaler's input
     * honest. See docs/WORD_SEARCH_GAME.md §3.
     *
     * `bigPinyin` follows `showPinyin` exactly as the cell below passes it; the
     * pinyin BAND is reserved in both modes (No Pinyin hides the syllable but
     * keeps its space), so `reservePinyin` stays true.
     */
    const cellSide = useMemo(() => {
        const natural = cpcdNaturalSize(CELL_SIZE, { bigPinyin: showPinyin, reservePinyin: true });
        return Math.ceil(Math.max(natural.width, natural.height));
    }, [showPinyin]);

    const scale = useFitScale(containerRef, innerRef, [grid, showPinyin, cellSide], GRID_MARGIN);

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

    // A single target-word character whose context-correct definition popup is open
    // (see `submit`). Target cells carry `definition` = the ddt of that character's
    // det cluster for the sense it has IN THIS WORD (server-resolved at grid build),
    // so a lone tap shows the character's meaning here rather than its generic gloss.
    // Filler cells have no `definition`, so they never open this popup.
    const [charPopup, setCharPopup] = useState<{ char: string; pinyin: string; definition: string; cells: Coord[] } | null>(null);
    const [charAnchorRect, setCharAnchorRect] = useState<DOMRect | null>(null);

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
        setCharPopup(null);
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


    // Invisible per-cell hit targets that extend half of `CELL_GAP` into the
    // gutter on each side, and the same again above and below. Adjacent cells'
    // extensions meet exactly at the gutter's midpoint, so together they
    // physically claim the whole gap with no seam left un-owned by any element —
    // the gap only ever *looks* empty. Kept as a separate overlay so the visible
    // per-cell box is untouched by hit-testing concerns.
    const [hitboxRects, setHitboxRects] = useState<
        { key: string; row: number; col: number; left: number; top: number; width: number; height: number }[]
    >([]);

    useLayoutEffect(() => {
        if (!cellElRef.current.get(key(0, 0))) return;

        const cellBox = (r: number, c: number) => {
            const el = cellElRef.current.get(key(r, c));
            if (!el) return null;
            return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
        };

        // Half the gutter on all four sides. Cells are square now, so the two
        // axes are symmetric and one value covers both — the old code only
        // widened horizontally because rows were packed flush against each other.
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
                    top: box.top - halfGap,
                    width: box.width + halfGap * 2,
                    height: box.height + halfGap * 2,
                });
            }
        }
        setHitboxRects(hitboxes);
        // `showPinyin` is a real dependency even though nothing here reads it: it
        // changes a cell's content height, and until aspect-ratio settles that is a
        // re-layout the boxes must be re-measured after.
    }, [scale, grid, showPinyin]);

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

    // Anchor for the single-character definition popup — same measurement as the
    // others, keyed off the tapped cell.
    useLayoutEffect(() => {
        setCharAnchorRect(charPopup ? anchorRectForCells(charPopup.cells) : null);
    }, [charPopup, scale, anchorRectForCells]);

    // The single review popup shown at a time: a tapped found word, a tapped
    // target-word character (its context-correct sense gloss), or a just-missed
    // bonus word — all render through the same Popper/style below. `entryKey` is
    // carried through and prepended in the correct reading order (§4) because the
    // grid's snaking path can visually read in any direction — up/down/backwards —
    // so the on-grid glyphs alone don't reliably show the word in order. (A single
    // character has no reading-order ambiguity, so it passes its own glyph.)
    const activePopup = popupWord
        ? { rect: popupAnchorRect, entryKey: popupWord.entryKey, pinyin: popupWord.pinyin, definition: popupWord.definition }
        : charPopup
        ? { rect: charAnchorRect, entryKey: charPopup.char, pinyin: charPopup.pinyin, definition: charPopup.definition }
        : invalid?.bonus
        ? { rect: bonusAnchorRect, entryKey: invalid.bonus.entryKey, pinyin: invalid.bonus.pinyin, definition: invalid.bonus.definition }
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

            // A lone tap on a character that belongs to a target word (carries a
            // server-resolved `definition` = its sense IN THIS WORD) shows that
            // character's definition popup, taking precedence over the generic
            // single-character "bonus headword" popup below. This helps the player
            // learn the word by seeing each character's contextual meaning. Filler
            // cells have no `definition`, so they fall through to the bonus/miss path.
            if (selection.length === 1) {
                const [r, c] = selection[0];
                const cell = grid[r]?.[c];
                if (cell?.definition) {
                    setInvalid(null);
                    setPathBoth([]); // a definition tap leaves no highlight (like the single-char bonus)
                    setCharPopup({ char: cell.char, pinyin: cell.pinyin, definition: cell.definition, cells: [selection[0]] });
                    return;
                }
            }

            const forward = selection.map(([r, c]) => grid[r]?.[c]?.char ?? "").join("");
            const reversed = [...forward].reverse().join("");
            const bonus = bonusWordMap.get(forward) ?? bonusWordMap.get(reversed) ?? null;
            setInvalid((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, bonus }));
            if (bonus) {
                if (isMultiCharBonus(bonus)) {
                    onBonusFound?.(bonus);
                    // Blue match: fetch the bonus word's audio from the server,
                    // play it, and cache the decoded buffer for the rest of the
                    // game (handled by the TTS provider's buffer cache).
                    speak?.(bonus.entryKey, bonus.pinyin);
                }
                return; // no auto-dismiss — stays until the player taps elsewhere
            }
            invalidTimeoutRef.current = setTimeout(() => {
                invalidTimeoutRef.current = null;
                clearSelection();
            }, MISS_FLASH_MS);
        },
        [tryFoundTarget, clearSelection, grid, bonusWordMap, onBonusFound, speak]
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
                // Replay the found word's audio on every review tap (cached from
                // the initial find, so this is instant).
                speak?.(fw.entryKey, fw.pinyin);
                toggleWordPopup(fw);
                return;
            }
            // Any other pointer-down dismisses an open popup and begins a drag; a
            // release without movement leaves a one-cell path.
            setPopupWord(null);
            setCharPopup(null);
            markInteracted();
            draggingRef.current = true;
            setPathBoth([cell]);
            (e.target as Element).setPointerCapture?.(e.pointerId);
        },
        [markInteracted, setPathBoth, foundWordByCell, toggleWordPopup, invalid, speak]
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
                    gridTemplateColumns: `repeat(${grid[0]?.length ?? 0}, ${cellSide}px)`,
                    gridAutoRows: `${cellSide}px`,
                    // Both axes are the SAME explicit px track (`cellSide`), so every
                    // tile is square by construction and the grid's own box width is
                    // the width it paints. The board used to force a measured row
                    // track so that a stadium drawn between two character CENTERS had
                    // equal pitch on both axes; with the highlight painted on the
                    // cells themselves, the cell IS the unit and a square cell is all
                    // the evenness the board needs.
                    gap: `${CELL_GAP}px`,
                    p: "4px",
                    // NO BOARD GROUND (2026-08-24). The cells sit DIRECTLY on the white
                    // `.play` panel — the grid box draws nothing at all.
                    //
                    // The grey container it replaces existed for one reason: a paper cell
                    // on the white panel is ~1.03:1, so the tiles dissolved and the board
                    // stopped reading as a board. That is still true, and the fix moved to
                    // the CELLS — every one of them now carries the palette's `markOutline`
                    // inset ring (see the cell's `boxShadow`), which is the app's own
                    // device for making a near-invisible fill read as a shape. Drawing the
                    // edge on the tile rather than behind it also keeps the LIT states at
                    // full strength: a pastel fill on paper is a value step, where a pastel
                    // fill on grey was the same value as its ground.
                    //
                    // The 4px padding is only so the outer ring of tiles' shadows are not
                    // clipped by `overflow: hidden` on the scaler above.
                    // The grid owns all touch gestures (no native scroll/zoom).
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                }}
            >
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
                        // A single-character bonus match is deliberately excluded
                        // (see `invalid` above): no shake and no color change, just
                        // its definition popup.
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
                        // (`hintShakeNonce` in WordSearchPage's `useHint`) — the
                        // reveal fill stays put the whole time; only the shake replays.
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
                                    // `.wsg span` — a square tile. Squareness is what
                                    // lets a traced path read as a path: on a board of
                                    // squares the run of lit cells has the same visual
                                    // weight going down as going across, so a word that
                                    // turns a corner still looks like one word.
                                    //
                                    // The square comes from the grid's equal px tracks
                                    // (`cellSide`), which the cell stretches into — NOT
                                    // from `aspect-ratio: 1`, which cost the board a
                                    // Safari-only right-overflow (see `cellSide`).
                                    borderRadius: "8px",
                                    // THE SELECTION SYSTEM. Every highlight — resting,
                                    // tracing, found, hinted, missed — is a fill on the
                                    // CELL, from the design's `.wsg span` / `.hit` /
                                    // `.now` (docs/SHELF_REDESIGN.md, artboard 13).
                                    //
                                    // It replaces an overlay that drew each highlight as
                                    // one continuous "stadium" tube on a layer beneath
                                    // the cells. The tube was a prettier shape, but it
                                    // cost a measured row pitch, a measured glyph-center
                                    // offset and two hand-tuned nudge constants, all so a
                                    // shape drawn between character centers would line up
                                    // with cells whose height depended on whether pinyin
                                    // was showing. A cell fill needs none of that, and the
                                    // board tells the player the same three things.
                                    //
                                    // Order matters: a miss is transient and outranks the
                                    // found/hint fills underneath it.
                                    backgroundColor: isInvalidCell
                                        ? COLORS.red                  // wrong trace — flashes, then clears
                                        : selected && invalid?.bonus
                                        ? COLORS.blu                  // traced a real word that wasn't a target
                                        : selected
                                        ? COLORS.org                  // `.now` — tracing right now
                                        : isFound
                                        ? COLORS.grn                  // `.hit` — locked in
                                        : isHintCell
                                        ? COLORS.org                  // hint reveal: "trace THESE" — same meaning as `.now`
                                        : COLORS.background,          // resting paper tile
                                    // EVERY cell carries the palette's inset ring
                                    // (`COLORS.markOutline`) — this is what lets the board
                                    // stand on the bare white panel with no container
                                    // behind it. A pastel or paper fill at ~1.15:1 is not a
                                    // shape until something draws its boundary; that is the
                                    // rule the palette states for every pastel in the app,
                                    // and the board is now one more caller of it.
                                    //
                                    // The reviewed word (its gloss popup is open) REPLACES
                                    // the ring with the hue's own ink at 1.5px, rather than
                                    // stacking a second one — the palette's way of making a
                                    // pastel a distinct state without inventing a second
                                    // green.
                                    boxShadow: isPopup
                                        ? `inset 0 0 0 1.5px ${COLORS.grnA}`
                                        : `inset 0 0 0 1px ${COLORS.markOutline}`,
                                    // A lit cell darkens its glyph to full ink so the
                                    // character stays the loudest thing in its own tile.
                                    // It does NOT bold: the design's `.wsg span.hit`
                                    // does, but at this size a weight change reflows the
                                    // glyph inside its tile, so a traced word visibly
                                    // twitches as the path grows — and the fill has
                                    // already said everything the weight would.
                                    //
                                    // The color has to be reached through a descendant
                                    // selector: the glyph is a cpcd element that sets its
                                    // OWN color, so an inherited value on the cell would
                                    // be silently overridden and the state would
                                    // half-apply.
                                    ...((selected || isFound || isHintCell) && {
                                        "& .char-pinyin-display__character": {
                                            color: COLORS.onSurface,
                                        },
                                    }),
                                    transition: "background-color 120ms linear, box-shadow 120ms linear",
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
                                    // The Pinyin board renders big pinyin (see
                                    // CPCDRow.bigPinyin): at `sm` the default 13px
                                    // syllable is too small to scan mid-drag. Gated on
                                    // `showPinyin` rather than passed unconditionally
                                    // because the reserved pinyin band is kept even when
                                    // the syllable is hidden — enlarging it in No Pinyin
                                    // mode would push every glyph up for nothing.
                                    bigPinyin={showPinyin}
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
                // The gloss popup is display-only (no buttons/links), so it must
                // never swallow a tap: `pointerEvents: none` lets the signal fall
                // through to the grid cell painted behind it, so tapping "through"
                // the popup selects/reviews whatever is under it as if the popup
                // weren't there.
                sx={{ zIndex: 1300, pointerEvents: "none" }}
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
                        component="div"
                        sx={{
                            fontSize: SIZE.caption,
                            lineHeight: 1.3,
                            color: "text.primary",
                            fontFamily: FONTS.sans,
                            textAlign: "center",
                            wordBreak: "break-word",
                        }}
                    >
                        {/* First line: Chinese chars + tone-marked pinyin (bold). The
                            entryKey is carried through in correct reading order (§4). */}
                        {activePopup?.entryKey && (
                            <Box
                                component="div"
                                className="word-search__gloss-popup-headword"
                                sx={{ fontWeight: WEIGHT.bold }}
                            >
                                {activePopup.entryKey}
                                {/* In no-pinyin (reading) mode the whole point is to
                                    hide pinyin — so suppress it in the review popup too,
                                    including single-character target taps. */}
                                {showPinyin && activePopup.pinyin && (
                                    <Box
                                        component="span"
                                        className="word-search__gloss-popup-pinyin"
                                    >
                                {/* Two non-breaking spaces — plain " " would collapse to one
                                    under normal CSS whitespace handling. */}
                                {"  "}
                                        {/* Per-syllable tone coloring, matching cpcd/pinyin
                                            elsewhere. `pinyin` is space-separated tone-marked. */}
                                        {activePopup.pinyin.split(/\s+/).filter(Boolean).map((syllable, si) => (
                                            <React.Fragment key={si}>
                                                {si > 0 && " "}
                                                <Box component="span" sx={{ color: getToneColor(syllable) }}>
                                                    {syllable}
                                                </Box>
                                            </React.Fragment>
                                        ))}
                                    </Box>
                                )}
                            </Box>
                        )}
                        {/* Second line: English gloss. */}
                        <Box component="div" className="word-search__gloss-popup-english">
                            {activePopup?.definition ? stripParentheses(activePopup.definition) : ""}
                        </Box>
                    </Typography>
                </Box>
            </Popper>
        </Box>
    );
});

WordSearchGrid.displayName = "WordSearchGrid";

export default WordSearchGrid;

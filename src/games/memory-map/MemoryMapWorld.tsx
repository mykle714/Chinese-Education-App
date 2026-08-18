import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useGesture } from "@use-gesture/react";
import { connectedIslands, mapBounds, touchedSidesForAll, wordBoxSize, type MapBox } from "../../../server/services/memoryMapSpawn";
import MemoryMapWord from "./MemoryMapWord";
import MemoryMapIslandCompass, { type OffscreenIsland } from "./MemoryMapIslandCompass";
import type { MemoryMapWord as MemoryMapWordData } from "../../api/memoryMap";
import type { Camera, WordOutcome } from "./types";
import {
    FIT_PADDING,
    MAX_ZOOM,
    MIN_ZOOM,
    GRID,
    PIXELS_PER_WORLD_UNIT,
} from "./constants";
import { COLORS } from "../../theme/colors";

/** How far inside the viewport edge an off-screen-island marker sits, in px. */
const COMPASS_INSET_PX = GRID * 5;

/**
 * The pan/zoom world layer (docs/MEMORY_MAP_GAME.md § 6, § 7).
 *
 * ── DOM + A CSS TRANSFORM. NO rAF LOOP, NO PIXI ──────────────────────────────
 * The camera is one `transform` on one div; the words are absolutely-positioned
 * children that never move relative to it. The 100-word cap (MEMORY_MAP_CAPACITY) is
 * what makes this safe — at that size there is nothing to cull and no scene graph to
 * justify. A game that genuinely needed one should borrow the night market's Pixi host
 * rather than growing a second one here.
 *
 * ── THE CAMERA MODEL ─────────────────────────────────────────────────────────
 * `camera` is the WORLD COORDINATE AT THE CENTRE OF THE VIEWPORT, plus a zoom. Stored
 * that way rather than as a translation offset because it is resolution-independent:
 * a run saved on a phone and resumed on a rotated screen looks at the same place,
 * which a stored pixel offset could not promise.
 *
 * ── EMPTY SPACE IS THE PAN GESTURE ───────────────────────────────────────────
 * A drag anywhere that is not a word pans (§ 3.3). Words stop their own taps from
 * reaching here, so tapping a word is never also a tiny pan, and tapping the
 * background is never a wrong answer.
 */

interface MemoryMapWorldProps {
    words: MemoryMapWordData[];
    outcomes: Record<number, WordOutcome>;
    /** The failed target, which pulses until tapped. */
    pulsingId: number | null;
    flashing: number[];
    fading: number[];
    camera: Camera | null;
    onCameraChange: (camera: Camera) => void;
    onTapWord: (word: MemoryMapWordData) => void;
}

/** The boxes as placed, for fitting the camera to the map. */
function boxesOf(words: MemoryMapWordData[]): MapBox[] {
    return words.map((word) => ({
        x: word.x,
        y: word.y,
        ...wordBoxSize(word.entryKey, word.scale, word.language),
    }));
}

const MemoryMapWorld: React.FC<MemoryMapWorldProps> = ({
    words,
    outcomes,
    pulsingId,
    flashing,
    fading,
    camera,
    onCameraChange,
    onTapWord,
}) => {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });

    // ── THE CAMERA REF IS THE GESTURE'S SOURCE OF TRUTH, NOT THE PROP ────────
    //
    // The gesture handlers are created once and read the camera through a ref, so they
    // do not have to re-bind every frame. The subtlety is WHEN that ref may be
    // overwritten from the prop, and getting it wrong is what made panning feel like
    // it changed sensitivity mid-drag (reported 2026-08-18).
    //
    // `touchmove` fires faster than React commits — 120 Hz sampling against 60 Hz
    // rendering on a modern phone — and React 18 batches state updates even inside the
    // native listeners @use-gesture attaches. So several drag events land between two
    // renders. When the ref was refreshed from the prop on every render and each
    // handler read the prop's value, every event in a batch computed its new camera
    // from the SAME stale one: the last write won and the earlier deltas were simply
    // dropped. The map then moved a fraction of the finger's distance, and the
    // fraction varied with how many events happened to fall in each frame — a pan that
    // feels warped and inconsistent rather than one that is plainly broken.
    //
    // The fix is that `commit` advances the ref SYNCHRONOUSLY, so consecutive events
    // within one frame accumulate. The prop is adopted only when it carries a camera
    // this component did not produce (the initial fit, a restart, a resumed run) —
    // otherwise a render replaying an already-superseded value would undo the
    // accumulation and reintroduce the same drop.
    const cameraRef = useRef<Camera | null>(camera);
    const ownCameraRef = useRef<Camera | null>(null);
    if (camera !== ownCameraRef.current) cameraRef.current = camera;

    /** Move the camera: ref first (so the next event in this frame sees it), then state. */
    const commit = useCallback(
        (next: Camera) => {
            cameraRef.current = next;
            ownCameraRef.current = next;
            onCameraChange(next);
        },
        [onCameraChange]
    );

    // Track the viewport so "fit the map" has real dimensions to fit into. Measured
    // rather than assumed because the game renders inside the mobile demo frame on
    // desktop, which is not the window size.
    useLayoutEffect(() => {
        const node = viewportRef.current;
        if (!node) return;
        const measure = () =>
            setViewport({ width: node.clientWidth, height: node.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    /**
     * Frame the whole map: centre it, and pick the zoom that fits its longer axis.
     *
     * Used only when there is no saved camera (a fresh run). A resumed run restores
     * where the player was looking instead — re-framing on resume would throw away the
     * one piece of context that makes a 100-word map navigable.
     */
    const fitToMap = useCallback((): Camera | null => {
        const bounds = mapBounds(boxesOf(words));
        if (!bounds || viewport.width === 0) return null;

        const worldWidth = bounds.maxX - bounds.minX + FIT_PADDING * 2;
        const worldHeight = bounds.maxY - bounds.minY + FIT_PADDING * 2;
        const zoom = Math.min(
            viewport.width / (worldWidth * PIXELS_PER_WORLD_UNIT),
            viewport.height / (worldHeight * PIXELS_PER_WORLD_UNIT)
        );
        return {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
            zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
        };
    }, [words, viewport]);

    useEffect(() => {
        if (camera || viewport.width === 0 || words.length === 0) return;
        const fitted = fitToMap();
        if (fitted) onCameraChange(fitted);
    }, [camera, viewport, words, fitToMap, onCameraChange]);

    /** Pan by a screen-pixel delta, converted into world units at the current zoom. */
    const panBy = useCallback(
        (dxPx: number, dyPx: number) => {
            // Fall back to the identity camera rather than returning: before the fit
            // effect has run (a viewport that has not been measured yet) the map still
            // renders at zoom 1 around the origin, and a pan that silently did nothing
            // in that window would read as the game being broken.
            const current = cameraRef.current ?? { x: 0, y: 0, zoom: 1 };
            const scale = current.zoom * PIXELS_PER_WORLD_UNIT;
            commit({
                ...current,
                // Dragging right moves the WORLD right, i.e. the camera left.
                x: current.x - dxPx / scale,
                y: current.y - dyPx / scale,
            });
        },
        [commit]
    );

    // Bound via `target` (the viewport node) rather than by spreading `bind()` onto the
    // Box, and that is REQUIRED, not stylistic — see the config block below.
    useGesture(
        {
            onDrag: ({ delta: [dx, dy], pinching, touches }) => {
                // A stray second finger belongs to the pinch, not to a pan — without
                // this the map lurches sideways every time a zoom starts.
                if (pinching || touches >= 2) return;
                panBy(dx, dy);
            },
            onPinch: ({ offset: [scale], memo }) => {
                const start = (memo as number | undefined) ?? cameraRef.current?.zoom ?? 1;
                const current = cameraRef.current;
                if (current) {
                    commit({
                        ...current,
                        zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start * scale)),
                    });
                }
                return start;
            },
            // Desktop affordance only; the game is designed for touch.
            onWheel: ({ delta: [, dy] }) => {
                const current = cameraRef.current;
                if (!current) return;
                commit({
                    ...current,
                    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * (1 - dy / 500))),
                });
            },
        },
        {
            // ── WHY `target` AND NOT `{...bind()}` ──────────────────────────────
            // `eventOptions.passive: false` is needed so pinch/wheel can preventDefault
            // the browser's own zoom. React's synthetic listeners are ALWAYS passive and
            // cannot honour that, so @use-gesture requires the `target` option whenever
            // non-passive events are asked for; spreading `bind()` instead silently
            // produces a half-bound gesture.
            //
            // It also makes the listeners NATIVE and attached once to the node, instead
            // of a fresh set of React handler props on every render. That is what fixes
            // the reported bug: marking a word wrong re-renders this component twice in
            // quick succession (the red flash sets, then clears 500 ms later), and each
            // re-render swapped the spread handlers out from under the gesture — after
            // which panning was dead until the page was reopened (2026-08-18).
            target: viewportRef,
            eventOptions: { passive: false },
            drag: {
                // `pointer.touch: true` makes the drag listen to TOUCH events rather
                // than pointer events, and it is REQUIRED here rather than stylistic:
                // with pinch bound alongside drag, the pointer-event stream gets
                // cancelled on touch devices as soon as the browser starts arbitrating
                // between the two, and the pan silently dies. The symptom is precise —
                // panning works with a mouse and does nothing at all on a phone
                // (2026-08-18). `useDrag` on its own (SortCardsPage) does not need this
                // because nothing competes with it.
                pointer: { touch: true },
                // A tap must not register as a zero-distance pan, so that tapping a word
                // and dragging the map stay cleanly separate gestures.
                filterTaps: true,
            },
            // `from` resets the pinch offset each gesture so zooms compose rather than
            // snapping back to an absolute scale from the start of the session.
            pinch: { from: () => [1, 0] },
        }
    );

    const zoom = camera?.zoom ?? 1;
    const centreX = camera?.x ?? 0;
    const centreY = camera?.y ?? 0;

    // ── Off-screen island markers ────────────────────────────────────────────
    //
    // Split into two memos ON PURPOSE, and the split is a performance requirement
    // rather than tidiness. `connectedIslands` is an O(n²) scan (10,000 comparisons at
    // MEMORY_MAP_CAPACITY), but it depends only on the GEOMETRY — which changes when a
    // word spawns or graduates, not when the camera moves. Recomputing it inside the
    // camera-dependent memo would run that scan on every frame of every pan.
    const boxes = useMemo(() => boxesOf(words), [words]);
    // Which edges each word shares with a neighbour, for its fences. Memoized on the
    // GEOMETRY alone — it does not change when the camera moves, and it is another
    // O(n²) scan that must not run per pan frame.
    const borders = useMemo(() => touchedSidesForAll(boxes), [boxes]);
    const islands = useMemo(
        () =>
            connectedIslands(boxes).map((indices) => ({
                indices,
                // The smallest vet id is a stable key: it does not change as the island
                // grows, so a marker does not remount when a neighbour spawns.
                key: Math.min(...indices.map((i) => words[i].vocabEntryId)),
            })),
        [boxes, words]
    );

    const offscreenIslands = useMemo<OffscreenIsland[]>(() => {
        if (viewport.width === 0 || islands.length < 2) return [];
        const scale = zoom * PIXELS_PER_WORLD_UNIT;
        const toScreenX = (wx: number) => (wx - centreX) * scale + viewport.width / 2;
        const toScreenY = (wy: number) => (wy - centreY) * scale + viewport.height / 2;

        const markers: OffscreenIsland[] = [];
        for (const island of islands) {
            let visible = false;
            let sumX = 0;
            let sumY = 0;

            for (const i of island.indices) {
                const box = boxes[i];
                const sx = toScreenX(box.x);
                const sy = toScreenY(box.y);
                sumX += sx;
                sumY += sy;
                const halfW = (box.width / 2) * scale;
                const halfH = (box.height / 2) * scale;
                if (
                    sx + halfW > 0 &&
                    sx - halfW < viewport.width &&
                    sy + halfH > 0 &&
                    sy - halfH < viewport.height
                ) {
                    visible = true;
                    break; // one visible word is enough — the island is on screen
                }
            }
            if (visible) continue;

            const cx = sumX / island.indices.length;
            const cy = sumY / island.indices.length;
            const angle = Math.atan2(cy - viewport.height / 2, cx - viewport.width / 2);

            markers.push({
                key: island.key,
                // Clamped into the viewport so the marker rides the edge nearest the
                // island rather than sitting off screen with it.
                x: Math.min(Math.max(cx, COMPASS_INSET_PX), viewport.width - COMPASS_INSET_PX),
                y: Math.min(Math.max(cy, COMPASS_INSET_PX), viewport.height - COMPASS_INSET_PX),
                angle,
                count: island.indices.length,
            });
        }
        return markers;
    }, [islands, boxes, viewport, zoom, centreX, centreY]);

    return (
        <Box
            className="memory-map-world"
            ref={viewportRef}
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                // Water. The map is an archipelago — tangent boxes are land, the gaps
                // between islands are sea — and a blue ground is what makes that read at
                // a glance instead of looking like words scattered on a page. It also
                // gives the off-screen compass chips something to sit against.
                //
                // `blueAccent` is the existing pastel token, light enough that the
                // default dark glyph colour and all three outcome hues stay legible on
                // it. Deliberately not a new token: this is the accent family's blue
                // doing an ordinary job, not a new semantic colour.
                backgroundColor: COLORS.blueAccent,
                // The map owns every gesture inside it (CLAUDE.md § Touch & Scroll).
                touchAction: "none",
            }}
        >
            <Box
                className="memory-map-world__layer"
                sx={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    // Read right-to-left: shift the camera's world point to the origin,
                    // scale, then move the origin to the middle of the viewport.
                    transform: `translate(${viewport.width / 2}px, ${viewport.height / 2}px) scale(${zoom}) translate(${-centreX * PIXELS_PER_WORLD_UNIT}px, ${-centreY * PIXELS_PER_WORLD_UNIT}px)`,
                    transformOrigin: "0 0",
                    // Non-zero so absolutely-positioned children resolve against it.
                    width: 0,
                    height: 0,
                }}
            >
                {words.map((word, index) => (
                    <MemoryMapWord
                        key={word.vocabEntryId}
                        word={word}
                        borders={borders[index]}
                        outcome={outcomes[word.vocabEntryId]}
                        pulsing={pulsingId === word.vocabEntryId}
                        flashing={flashing.includes(word.vocabEntryId)}
                        fading={fading.includes(word.vocabEntryId)}
                        onTap={onTapWord}
                    />
                ))}
            </Box>

            {/* Outside the world layer on purpose: an edge marker must stay pinned to
                the screen, not pan and scale with the map it points at. */}
            <MemoryMapIslandCompass islands={offscreenIslands} />
        </Box>
    );
};

export default MemoryMapWorld;

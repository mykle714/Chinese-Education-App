import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useGesture } from "@use-gesture/react";
import {
    allParts,
    estimatedShape,
    islandsOf,
    layoutMap,
    mapBounds,
    type LaidSlot,
    type ShapeOf,
} from "../../../server/services/memoryMapLayout";
import { shapeFromMeasure, useGlyphShapes, type MeasuredWord } from "./glyphShapes";
import MemoryMapWord from "./MemoryMapWord";
import MemoryMapIslandCompass, { type OffscreenIsland } from "./MemoryMapIslandCompass";
import { useTapGesture } from "./useTapGesture";
import { clampCameraToMap } from "./cameraBounds";
import type { MemoryMapSlot, MemoryMapWord as MemoryMapWordData } from "../../api/memoryMap";
import type { Camera, WordOutcome } from "./types";
import {
    FIT_PADDING,
    FIT_ZOOM_BOOST,
    MAX_ZOOM,
    MIN_ZOOM,
    PIXELS_PER_WORLD_UNIT,
} from "./constants";
import { COLORS } from "../../theme/colors";

/**
 * How far inside the viewport edge an off-screen-island marker sits, in px.
 *
 * Three grid cells, up from 20px when the game moved to the 8px grid. The marker sits
 * 4px further inside the viewport than it used to, which is if anything the safer way
 * to round: the inset exists to keep it clear of the edge.
 */
const COMPASS_INSET_PX = 24;

/**
 * The pan/zoom world layer (docs/MEMORY_MAP_GAME.md § 6, § 7).
 *
 * ── DOM + A CSS TRANSFORM. NO rAF LOOP, NO PIXI ──────────────────────────────
 * The camera is one `transform` on one div; the words are absolutely-positioned
 * children that never move relative to it. The 50-slot cap (MEMORY_MAP_CAPACITY) is
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
    /**
     * Fixed chrome floated over the map, in VIEWPORT space (it does not pan or zoom) —
     * the run counter (§ 6). Rendered above the compass; the caller positions it and
     * must keep it `pointerEvents: none`, because the whole viewport is the pan surface.
     */
    overlay?: React.ReactNode;
    /** The map's slot tree, empty slots included — the geometry (§ 2.4). */
    slots: MemoryMapSlot[];
    /** Occupants, keyed to slots by `slotId`. A mid-fade graduate is still here. */
    words: MemoryMapWordData[];
    /** The map's language — sizes an EMPTY slot, which has no word to take it from. */
    language: string;
    /**
     * The account's Chinese typeface id (`users."chineseFont"`). The glyphs are
     * re-measured when it changes, because ink — and therefore every touching
     * distance — differs face by face.
     */
    fontKey: string | undefined;
    outcomes: Record<number, WordOutcome>;
    /** The failed target, which pulses until tapped. */
    pulsingId: number | null;
    /** The word armed by a first tap and awaiting its confirming tap (§ 3.3a). */
    selectedId: number | null;
    flashing: number[];
    fading: number[];
    camera: Camera | null;
    onCameraChange: (camera: Camera) => void;
    onTapWord: (word: MemoryMapWordData) => void;
    /** A tap that landed on open water — the map's "never mind" (§ 3.3a). */
    onTapWater: () => void;
}

/**
 * Lay the slot tree out with the shared `layoutMap`, using each word's MEASURED glyph
 * shape in the current face (glyphShapes.ts). Positions are never sent over the wire —
 * this is the only place the client gets them (§ 2.4). An empty slot, or a word whose
 * measurement has not arrived yet (a refill mid-run, for one render), falls back to the
 * server's font-free estimate.
 */
function layOut(
    slots: MemoryMapSlot[],
    wordBySlot: Map<number, MemoryMapWordData>,
    measured: Map<string, MeasuredWord>,
    language: string
): LaidSlot[] {
    const shapeOf: ShapeOf = (slot) => {
        const glyphs = slot.entryKey ? measured.get(slot.entryKey) : undefined;
        return glyphs ? shapeFromMeasure(glyphs, slot.scale) : estimatedShape(slot.entryKey, slot.scale, slot.language);
    };
    return layoutMap(
        slots.map((slot) => ({
            slotId: slot.slotId,
            parentSlotId: slot.parentSlotId,
            link: slot.link,
            angle: slot.angle,
            tilt: slot.tilt,
            bow: slot.bow,
            scale: slot.scale,
            entryKey: wordBySlot.get(slot.slotId)?.entryKey ?? null,
            language: wordBySlot.get(slot.slotId)?.language ?? language,
        })),
        shapeOf
    );
}

const MemoryMapWorld: React.FC<MemoryMapWorldProps> = ({
    overlay,
    slots,
    words,
    language,
    fontKey,
    outcomes,
    pulsingId,
    selectedId,
    flashing,
    fading,
    camera,
    onCameraChange,
    onTapWord,
    onTapWater,
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

    // The geometry. Recomputed only when the tree or an occupant changes (a spawn, a
    // graduation swap) — never per camera frame. `laid` is in `slots` order.
    const wordBySlot = useMemo(() => new Map(words.map((word) => [word.slotId, word])), [words]);
    // Null until the face's glyphs have loaded and been measured. The map is not drawn
    // before then: laying it out with guessed shapes would make every word jump the
    // moment the real ones arrived.
    const measured = useGlyphShapes(
        useMemo(() => words.map((word) => word.entryKey), [words]),
        language,
        fontKey
    );
    const laid = useMemo(
        () => (measured ? layOut(slots, wordBySlot, measured, language) : []),
        [slots, wordBySlot, measured, language]
    );
    const bounds = useMemo(() => mapBounds(allParts(laid)), [laid]);

    // Read through refs by `commit`, for the same reason the camera is: the gesture
    // handlers are bound once, and must see the CURRENT map and viewport, not the ones
    // captured when they were created.
    const boundsRef = useRef(bounds);
    boundsRef.current = bounds;
    const viewportSizeRef = useRef(viewport);
    viewportSizeRef.current = viewport;

    /**
     * Move the camera: clamp it to the map (`clampCameraToMap`, § 6), then ref first
     * (so the next event in this frame sees it), then state. Every pan, pinch and wheel
     * goes through here, so the limit cannot be bypassed by any one gesture.
     */
    const commit = useCallback(
        (requested: Camera) => {
            const next = clampCameraToMap(requested, boundsRef.current, viewportSizeRef.current);
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
     * one piece of context that makes a 50-word map navigable.
     */
    const fitToMap = useCallback((): Camera | null => {
        if (!bounds || viewport.width === 0) return null;

        const worldWidth = bounds.maxX - bounds.minX + FIT_PADDING * 2;
        const worldHeight = bounds.maxY - bounds.minY + FIT_PADDING * 2;
        const zoom = FIT_ZOOM_BOOST * Math.min(
            viewport.width / (worldWidth * PIXELS_PER_WORLD_UNIT),
            viewport.height / (worldHeight * PIXELS_PER_WORLD_UNIT)
        );
        return {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
            zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
        };
    }, [bounds, viewport]);

    useEffect(() => {
        if (camera || viewport.width === 0 || words.length === 0) return;
        const fitted = fitToMap();
        if (fitted) onCameraChange(fitted);
    }, [camera, viewport, words, fitToMap, onCameraChange]);

    // Re-clamp when the LIMIT moves rather than the camera: a graduation can shrink the
    // map out from under the view, a rotation changes the viewport, and a resumed run
    // restores a camera saved against a different screen. Without this the player could
    // start a run already stranded in open water. A no-op when the camera is in range
    // (`clampCameraToMap` returns the same object), so it cannot loop.
    useEffect(() => {
        const current = cameraRef.current;
        if (!current) return;
        if (clampCameraToMap(current, bounds, viewport) !== current) commit(current);
    }, [bounds, viewport, camera, commit]);

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

    const waterTap = useTapGesture(onTapWater);

    const zoom = camera?.zoom ?? 1;
    const centreX = camera?.x ?? 0;
    const centreY = camera?.y ?? 0;

    // ── Off-screen island markers ────────────────────────────────────────────
    //
    // Islands come straight off the tree (`islandsOf` groups by island root), memoized
    // on the geometry so the grouping never re-runs per pan frame.
    const islands = useMemo(
        () =>
            islandsOf(laid).map(({ rootSlotId, indices }) => ({
                indices,
                // The root's slot id is a stable key: a slot outlives its words, so the
                // marker does not remount when the island grows or a word graduates.
                key: rootSlotId,
            })),
        [laid]
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
                const slot = laid[i];
                sumX += toScreenX(slot.x);
                sumY += toScreenY(slot.y);
                // The word's character boxes, by their rotated bounding rect — generous
                // by a corner at most, which only ever errs toward "visible" and so
                // toward fewer markers.
                const box = mapBounds(slot.parts);
                if (
                    box &&
                    toScreenX(box.maxX) > 0 &&
                    toScreenX(box.minX) < viewport.width &&
                    toScreenY(box.maxY) > 0 &&
                    toScreenY(box.minY) < viewport.height
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
    }, [islands, laid, viewport, zoom, centreX, centreY]);

    return (
        <Box
            className="memory-map-world"
            ref={viewportRef}
            // ── TAPPING WATER CANCELS A SELECTION ───────────────────────────
            // The armed word is the only state a player can get stuck in, so open water
            // is its escape hatch: a tap that hits no word disarms (§ 3.3a). A word's
            // own tap stops propagating before it gets here, and a drag that merely ENDS
            // over water fails the same slop test the words apply, so panning never
            // disarms anything.
            //
            // React handlers, not the @use-gesture binding on this same node: that
            // binding listens to TOUCH events for the pan and cannot see the words'
            // POINTER events, so it has no way to know a tap was already consumed.
            {...waterTap}
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                // Water. The map is an archipelago — touching words make islands, the gaps
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
                {measured &&
                    slots.map((slot, index) => {
                        const placed = laid[index];
                        const word = wordBySlot.get(slot.slotId);
                        // An EMPTY slot (its card was deleted, or a refill found nothing
                        // to lend) keeps its place in the tree — its estimated shape
                        // still holds its children apart — but draws nothing: with no
                        // tiles there is no "bare land" to show. The next load fills it.
                        if (!word || !placed) return null;
                        const glyphs = measured.get(word.entryKey);
                        if (!glyphs) return null; // a refill, measured on the next render
                        return (
                            <MemoryMapWord
                                // Keyed by WORD, not slot: a graduation swap must unmount
                                // the faded word and mount its replacement fresh.
                                key={word.vocabEntryId}
                                word={word}
                                x={placed.x}
                                y={placed.y}
                                tilt={placed.tilt}
                                bow={slot.bow}
                                scale={slot.scale}
                                measured={glyphs}
                                outcome={outcomes[word.vocabEntryId]}
                                pulsing={pulsingId === word.vocabEntryId}
                                selected={selectedId === word.vocabEntryId}
                                flashing={flashing.includes(word.vocabEntryId)}
                                fading={fading.includes(word.vocabEntryId)}
                                onTap={onTapWord}
                            />
                        );
                    })}
            </Box>

            {/* Outside the world layer on purpose: an edge marker must stay pinned to
                the screen, not pan and scale with the map it points at. */}
            <MemoryMapIslandCompass islands={offscreenIslands} />
            {overlay}
        </Box>
    );
};

export default MemoryMapWorld;

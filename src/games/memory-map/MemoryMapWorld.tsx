import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import {
    allParts,
    estimatedShape,
    layoutMap,
    mapBounds,
    type LaidSlot,
    type ShapeOf,
} from "../../../server/services/memoryMapLayout";
import { shapeFromMeasure, useGlyphShapes, type MeasuredWord } from "./glyphShapes";
import MemoryMapWord from "./MemoryMapWord";
import { useTapGesture } from "./useTapGesture";
import type { MemoryMapSlot, MemoryMapWord as MemoryMapWordData } from "../../api/memoryMap";
import type { WordOutcome } from "./types";
import { FIT_PADDING, MAX_ZOOM, PIXELS_PER_WORLD_UNIT } from "./constants";
import { COLORS } from "../../theme/colors";

/** The game viewport's measured size, in CSS px. */
export interface ViewportSize {
    width: number;
    height: number;
}

/**
 * The two render passes, bottom first: every word's highlight ring, then every word's
 * characters on top (MemoryMapWord.tsx → THE TWO LAYERS).
 */
const WORD_LAYERS = ["ring", "ink"] as const;

/**
 * The world layer (docs/MEMORY_MAP_GAME.md § 6, § 7).
 *
 * ── DOM + A CSS TRANSFORM. NO rAF LOOP, NO PIXI ──────────────────────────────
 * The camera is one `transform` on one div; the words are absolutely-positioned
 * children that never move relative to it. The 50-slot cap (MEMORY_MAP_CAPACITY) is
 * what makes this safe — at that size there is nothing to cull and no scene graph to
 * justify. A game that genuinely needed one should borrow the night market's Pixi host
 * rather than growing a second one here.
 *
 * ── THE CAMERA IS FIXED (owner, 2026-11-04) ──────────────────────────────────
 * No pan, no pinch, no wheel. The camera is DERIVED, never stored: centre the map and
 * scale it until its limiting dimension meets the viewport (`fitCamera`). It is
 * recomputed whenever the map or the viewport changes — a graduate's longer replacement,
 * a rotation — so the whole map is on screen at all times. The server packs the map for
 * the shape of this viewport (the frame, § 2.4b), which is what keeps the fit large.
 *
 * Until then the map was a pannable, pinch-zoomable world with a saved camera, a pan
 * limit (`cameraBounds.ts`) and an off-screen island compass (`MemoryMapIslandCompass`);
 * all of it went with the gestures.
 *
 * ── EVERY TAP IS A WORD OR WATER ─────────────────────────────────────────────
 * Words stop their own taps from reaching here, so tapping a word is never also a
 * water tap, and tapping the background is never a wrong answer (§ 3.3a).
 */

interface MemoryMapWorldProps {
    /** The map's slot tree, empty slots included — the geometry (§ 2.4). */
    slots: MemoryMapSlot[];
    /** Occupants, keyed to slots by `slotId`. A mid-fade graduate is still here. */
    words: MemoryMapWordData[];
    /** The map's language — sizes an EMPTY slot, which has no word to take it from. */
    language: string;
    /**
     * The app's Chinese typeface id (`DEFAULT_CHINESE_FONT_ID`). The glyphs are
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
    /**
     * The word finder's text (§ 3.7). Non-empty: every word whose `entryKey` does NOT
     * contain it is dimmed (whole words, substring match). Empty: nothing is dimmed.
     */
    finderQuery: string;
    onTapWord: (word: MemoryMapWordData) => void;
    /** A tap that landed on open water — the map's "never mind" (§ 3.3a). */
    onTapWater: () => void;
    /**
     * The game viewport's size, reported on every change. The Stage needs it before
     * the map exists (the first load sends its aspect — the frame, § 2.4b) and to
     * compare against the stored frame (the mismatch dialog, § 6a). The world can be
     * mounted with no slots precisely so this can be measured during loading.
     */
    onViewportChange?: (size: ViewportSize) => void;
}

/** The fixed camera: the world point at the viewport's centre, plus a zoom. */
interface FittedCamera {
    x: number;
    y: number;
    zoom: number;
}

/**
 * Fit the whole map into the viewport: centre its bounds and take the zoom that makes
 * the LIMITING dimension (width or height, whichever runs out first) meet the edge,
 * with `FIT_PADDING` world units of water around it. Capped at `MAX_ZOOM` so a tiny
 * map is not blown up to three giant characters; there is no floor.
 */
function fitCamera(
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
    viewport: ViewportSize
): FittedCamera {
    if (!bounds || viewport.width === 0 || viewport.height === 0) return { x: 0, y: 0, zoom: 1 };
    const worldWidth = bounds.maxX - bounds.minX + FIT_PADDING * 2;
    const worldHeight = bounds.maxY - bounds.minY + FIT_PADDING * 2;
    const zoom = Math.min(
        viewport.width / (worldWidth * PIXELS_PER_WORLD_UNIT),
        viewport.height / (worldHeight * PIXELS_PER_WORLD_UNIT)
    );
    return {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
        zoom: Math.min(MAX_ZOOM, zoom),
    };
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
    slots,
    words,
    language,
    fontKey,
    outcomes,
    pulsingId,
    selectedId,
    flashing,
    fading,
    finderQuery,
    onTapWord,
    onTapWater,
    onViewportChange,
}) => {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
    // Latest-ref, so the ResizeObserver below is bound once and never re-subscribes.
    const onViewportChangeRef = useRef(onViewportChange);
    onViewportChangeRef.current = onViewportChange;

    // The geometry. Recomputed only when the tree or an occupant changes (a spawn, a
    // graduation swap). `laid` is in `slots` order.
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

    // Track the viewport so the fit has real dimensions to fit into. Measured rather
    // than assumed because the game renders inside the mobile demo frame on desktop,
    // which is not the window size.
    useLayoutEffect(() => {
        const node = viewportRef.current;
        if (!node) return;
        const measure = () => {
            const size = { width: node.clientWidth, height: node.clientHeight };
            setViewport((prev) => (prev.width === size.width && prev.height === size.height ? prev : size));
            onViewportChangeRef.current?.(size);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const camera = useMemo(() => fitCamera(bounds, viewport), [bounds, viewport]);

    // The finder's match test (§ 3.7): whole words, substring. Trimmed so a stray space
    // from a keyboard commit does not dim the whole map.
    const query = finderQuery.trim();

    const waterTap = useTapGesture(onTapWater);

    const { zoom, x: centreX, y: centreY } = camera;

    return (
        <Box
            className="memory-map-world"
            ref={viewportRef}
            // ── TAPPING WATER CANCELS A SELECTION ───────────────────────────
            // The armed word is the only state a player can get stuck in, so open water
            // is its escape hatch: a tap that hits no word disarms (§ 3.3a). A word's
            // own tap stops propagating before it gets here.
            {...waterTap}
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                // Water. The map is an archipelago — touching words make islands, the gaps
                // between islands are sea — and a blue ground is what makes that read at
                // a glance instead of looking like words scattered on a page.
                //
                // `blueAccent` is the existing pastel token, light enough that the
                // default dark glyph colour and all three outcome hues stay legible on
                // it. Deliberately not a new token: this is the accent family's blue
                // doing an ordinary job, not a new semantic colour.
                backgroundColor: COLORS.blueAccent,
                // Nothing inside scrolls or pans; touches are taps only (CLAUDE.md §
                // Touch & Scroll — components default to `touchAction: "none"`).
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
                {/* ── TWO PASSES: EVERY RING, THEN EVERY INK ─────────────────────
                    The highlight ring (HIGHLIGHT_PX) is wider than the collision margin
                    the layout packs words at, so it overlaps neighbours. Each pass is its
                    own stacking context (zIndex on a positioned box), so the whole ink
                    pass sits above the whole ring pass: a ring can cover water and other
                    rings, never characters. See MemoryMapWord.tsx → THE TWO LAYERS. */}
                {WORD_LAYERS.map((layer) => (
                    <Box
                        key={layer}
                        className={`memory-map-world__${layer}-layer`}
                        sx={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: 0,
                            height: 0,
                            zIndex: layer === "ink" ? 1 : 0,
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
                                        dimmed={query !== "" && !word.entryKey.includes(query)}
                                        onTap={onTapWord}
                                        layer={layer}
                                    />
                                );
                            })}
                    </Box>
                ))}
            </Box>

        </Box>
    );
};

export default MemoryMapWorld;

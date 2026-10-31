import React from "react";
import { Box } from "@mui/material";
import { ISO } from "./iso";

/**
 * StarField — the night sky's stars: two tiled layers of different tile sizes (so the
 * repeat is hard to spot). One definition, so the Deck Tower's and the Sort Cards page's
 * stars cannot differ (docs/DECK_TOWER.md § "Sky → space",
 * docs/SORT_CARDS_REQUIREMENTS.md § 4.9).
 *
 * Layer: feature component (feature module `src/features/deckTower`), also mounted by
 * features/discover/SortCardsPage.tsx. Fills its nearest positioned ancestor.
 *
 * On the tower, SpaceBackdrop writes opacity and parallax straight to the DOM through
 * `fieldRef` / `layerRefs`, because they change on every scroll frame. A page that does
 * not scroll just passes `opacity`.
 *
 * Depends on: iso/palette.ts (`ISO.star`). Depended on by: SpaceBackdrop.tsx,
 * features/discover/SortCardsPage.tsx.
 */

/** Each layer drifts at its own fraction of the scroll: slow parallax, so space reads as far away. */
export const STAR_LAYERS = [
    { tile: 233, count: 9, rMin: 0.5, rMax: 0.9, parallax: 0.004, seed: 7 },
    { tile: 317, count: 7, rMin: 0.9, rMax: 1.5, parallax: 0.008, seed: 23 },
] as const;

/** A small deterministic PRNG (mulberry32), so the star field is the same on every visit. */
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let r = Math.imul(a ^ (a >>> 15), 1 | a);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * One star tile as an SVG data URI: `count` round stars of radius rMin–rMax at random
 * brightness. Flat dots, no glow — the iso style has no gradients.
 */
function starTile(tile: number, count: number, rMin: number, rMax: number, seed: number): string {
    const rand = seededRandom(seed);
    let dots = "";
    for (let i = 0; i < count; i++) {
        const x = (rand() * tile).toFixed(1);
        const y = (rand() * tile).toFixed(1);
        const r = (rMin + rand() * (rMax - rMin)).toFixed(2);
        const o = (0.55 + rand() * 0.45).toFixed(2);
        dots += `<circle cx="${x}" cy="${y}" r="${r}" fill="${ISO.star}" fill-opacity="${o}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">${dots}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Built once at module load: the tiles never change. One image per layer. */
const STAR_IMAGES = STAR_LAYERS.map((l) => starTile(l.tile, l.count, l.rMin, l.rMax, l.seed));

/**
 * A star layer's parallax as a vertical TRANSFORM, not a `background-position`: moving a
 * background repaints the whole full-screen layer on every scroll frame, while a transform
 * on its own compositor layer (`will-change`) just moves the already-painted pixels. The
 * tile repeats every `tile` px, so the offset is taken modulo it, and the layer extends one
 * tile above the field so a shift of up to a tile never uncovers its top.
 */
export const starLayerTransform = (climbed: number, layer: (typeof STAR_LAYERS)[number]) =>
    `translate3d(0, ${((climbed * layer.parallax) % layer.tile).toFixed(1)}px, 0)`;

interface StarFieldProps {
    /** The field's opacity. On the tower this is only the first paint; `fieldRef` takes over. */
    opacity: number;
    fieldRef?: React.Ref<HTMLDivElement>;
    /** Filled with one element per STAR_LAYERS entry, for scroll-driven parallax. */
    layerRefs?: React.MutableRefObject<(HTMLDivElement | null)[]>;
}

const StarField: React.FC<StarFieldProps> = ({ opacity, fieldRef, layerRefs }) => (
    <Box ref={fieldRef} className="star-field" sx={{ position: "absolute", inset: 0, opacity, overflow: "hidden" }}>
        {STAR_LAYERS.map((l, i) => (
            <Box
                key={l.seed}
                ref={(el: HTMLDivElement | null) => {
                    if (layerRefs) layerRefs.current[i] = el;
                }}
                className="star-field__layer"
                sx={{
                    position: "absolute",
                    top: -l.tile,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundImage: STAR_IMAGES[i],
                    backgroundSize: `${l.tile}px ${l.tile}px`,
                    backgroundRepeat: "repeat",
                    willChange: "transform",
                }}
            />
        ))}
    </Box>
);

export default StarField;

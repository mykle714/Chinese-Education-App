import React, { useLayoutEffect, useRef } from "react";
import { Box } from "@mui/material";
import { ISO, mixHex } from "./iso";

/**
 * SpaceBackdrop — the Deck Tower's sky, which darkens into star-filled space as the
 * learner scrolls up a tall tower (docs/DECK_TOWER.md § "Sky → space").
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It is NOT part
 * of the iso framework: it is drawn in SCREEN space, behind the svg, and never projected.
 *
 * How it works:
 *   - The page hands it the SPACE BAND as two viewBox y's: `yFrom`, where the darkening
 *     starts (lower on screen), and `yTo`, where it is complete. Both are points on the
 *     tower's axis (cards 450 and 650 today, `SPACE_BAND_CARDS` in DeckTowerPage).
 *   - On every scroll it finds the viewBox y at the MIDDLE of the visible scroller and
 *     turns it into `t`, 0 below the band → 1 above it. The background colour blends
 *     the world's sky → space (`palette`) on a smoothstep of `t`, and the stars fade in on the last
 *     part of it (`STARS_FADE_FROM`), so they never show on a still-light sky.
 *   - It is altitude, not a timer: scrolling back down brings the sky back.
 *   - `palette` changes every frame during a world pan (useWorldPan blends one world's
 *     colours into the next); each change re-applies at once, without a scroll.
 *
 * ⚡ Scroll handling writes the styles directly to the DOM (rAF-throttled), NOT through
 * React state. A state update per scroll frame would re-render the whole scene (tower,
 * pawn, clouds, wind) at 60 fps for a colour change.
 *
 * It sits BESIDE the scroller with the same box (top of the screen → footer bar) and the
 * same z-index, but earlier in the DOM, so the scroller (and the svg in it) paints over
 * it, and whatever covers the scroller covers it too.
 *
 * Depends on: iso/palette.ts (`ISO.star`, `mixHex`); towerWorlds.ts (the palettes, via the page).
 * Depended on by: DeckTowerPage.tsx. Docs: docs/DECK_TOWER.md § "Sky → space".
 */

/** The space band in the scene's viewBox coordinates (see the header comment). */
export interface SpaceBand {
    /** The viewBox's top edge and width — to map the rendered svg back to viewBox units. */
    viewBoxMinY: number;
    viewBoxWidth: number;
    /** viewBox y where the darkening starts (the lower, larger y). */
    yFrom: number;
    /** viewBox y where it is complete (the higher, smaller y). */
    yTo: number;
}

interface SpaceBackdropProps {
    /** The page's scroll surface. Its one direct `<svg>` child is the scene (other children, e.g. a `<style>`, are skipped). */
    scrollerRef: React.RefObject<HTMLDivElement | null>;
    band: SpaceBand;
    /** The current world's sky and the space above it (blending mid-pan). */
    palette: { sky: string; space: string };
    /** The backdrop's bottom edge (the footer bar's height), matching the scroller's. */
    bottom: number | string;
}

/** Stars only start to show once the blend is this far along, so they never sit on a light sky. */
const STARS_FADE_FROM = 0.35;

/**
 * The star field: two tiled layers of different tile sizes (so the repeat is hard to
 * spot) that drift at different fractions of the scroll — slow parallax, so space reads
 * as far away rather than as a wallpaper glued to the screen.
 */
const STAR_LAYERS = [
    { tile: 233, count: 9, rMin: 0.5, rMax: 0.9, parallax: 0.004, seed: 7 },
    { tile: 317, count: 7, rMin: 0.9, rMax: 1.5, parallax: 0.008, seed: 23 },
] as const;

/** Hermite smoothstep of `x` between `edge0` and `edge1`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
    const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return u * u * (3 - 2 * u);
}

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

/** Built once at module load: the tiles never change. */
const STAR_IMAGES = STAR_LAYERS.map((l) => starTile(l.tile, l.count, l.rMin, l.rMax, l.seed)).join(", ");
const STAR_SIZES = STAR_LAYERS.map((l) => `${l.tile}px ${l.tile}px`).join(", ");

const SpaceBackdrop: React.FC<SpaceBackdropProps> = ({ scrollerRef, band, palette, bottom }) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const starsRef = useRef<HTMLDivElement>(null);
    // Read by `apply` through refs: the palette changes per frame during a pan, and
    // re-subscribing the scroll listener that often would be wasted work.
    const paletteRef = useRef(palette);
    paletteRef.current = palette;
    const applyRef = useRef<(() => void) | null>(null);

    // Re-subscribes when the band changes (the deck count arriving refits the viewBox).
    // A LAYOUT effect, so the colour is set before the first paint. (It runs BEFORE the
    // page's scroll-to-bottom layout effect — children first — but that jump fires a
    // scroll event, which re-applies in the same frame.)
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        const backdrop = backdropRef.current;
        const stars = starsRef.current;
        if (!scroller || !backdrop || !stars) return;

        const apply = () => {
            // The scene's svg, found by tag rather than position: the scroller also holds a
            // <style> (DeckTowerPage's falling-shadow rule), whose empty rect would read as
            // "not laid out yet" and silently freeze the sky.
            const svg = scroller.querySelector(":scope > svg");
            if (!svg) return;
            const svgRect = svg.getBoundingClientRect();
            const scrollerRect = scroller.getBoundingClientRect();
            if (svgRect.width <= 0 || band.viewBoxWidth <= 0) return;
            // Rendered px per viewBox unit (the svg is full-width; its height follows).
            const scale = svgRect.width / band.viewBoxWidth;
            const midY = band.viewBoxMinY + (scrollerRect.top + scrollerRect.height / 2 - svgRect.top) / scale;
            const t = (band.yFrom - midY) / (band.yFrom - band.yTo);
            backdrop.style.backgroundColor = mixHex(paletteRef.current.sky, paletteRef.current.space, smoothstep(0, 1, t));
            stars.style.opacity = String(smoothstep(STARS_FADE_FROM, 1, t));
            // Parallax: how far the learner has scrolled UP from the bottom. Content moves
            // down the screen as they climb; each star layer follows at its own fraction.
            const climbed = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
            stars.style.backgroundPosition = STAR_LAYERS.map((l) => `0px ${(climbed * l.parallax).toFixed(1)}px`).join(", ");
        };

        let frame = 0;
        const schedule = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                apply();
            });
        };
        applyRef.current = apply;
        apply();
        scroller.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        return () => {
            applyRef.current = null;
            cancelAnimationFrame(frame);
            scroller.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
        };
    }, [scrollerRef, band]);

    // A new palette (a world pan's colour blend) repaints straight away.
    useLayoutEffect(() => {
        applyRef.current?.();
    }, [palette.sky, palette.space]);

    return (
        <Box
            ref={backdropRef}
            className="deck-tower-page__space-backdrop"
            sx={{ position: "absolute", zIndex: 1, top: 0, left: 0, right: 0, bottom, backgroundColor: palette.sky, pointerEvents: "none" }}
        >
            <Box
                ref={starsRef}
                className="deck-tower-page__space-stars"
                sx={{ position: "absolute", inset: 0, opacity: 0, backgroundImage: STAR_IMAGES, backgroundSize: STAR_SIZES, backgroundRepeat: "repeat" }}
            />
        </Box>
    );
};

export default SpaceBackdrop;

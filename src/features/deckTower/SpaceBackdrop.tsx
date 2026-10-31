import React, { useLayoutEffect, useRef } from "react";
import { Box } from "@mui/material";
import { mixHex, shadeHex } from "./iso";
import { setFooterCastShadow } from "../../components/footerCastShadow";
import ShootingStars from "./ShootingStars";
import StarField, { STAR_LAYERS, starLayerTransform } from "./StarField";

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
 *   - The time of day (timeOfDay.ts) arrives through `palette.sky` (the world's sky at
 *     this hour) and `groundStars` (night's faint stars from the ground). At night it
 *     also hosts the ShootingStars layer (`shootingStars`), over the star field.
 *   - `palette` changes every frame during a world pan (useWorldPan blends one world's
 *     colours into the next); each change re-applies at once, without a scroll.
 *   - `altitudeY` OVERRIDES the scroll: while the tower is being studied
 *     (docs/DECK_TOWER.md § "Studying the tower") the camera has left the scroll behind
 *     and stands over the tower's top card, so the page hands in the altitude it is at —
 *     a viewBox y on the tower's axis in the same frame as `band` — and the sky follows
 *     it: studying down a tall tower brings the sky back from space, card by card.
 *
 * ⚡ Scroll handling writes the styles directly to the DOM (rAF-throttled), NOT through
 * React state. A state update per scroll frame would re-render the whole scene (tower,
 * pawn, clouds, wind) at 60 fps for a colour change.
 *
 * It sits BESIDE the scroller with the same box (top of the screen → footer bar) and the
 * same z-index, but earlier in the DOM, so the scroller (and the svg in it) paints over
 * it, and whatever covers the scroller covers it too.
 *
 * Depends on: iso/palette.ts (`mixHex`); StarField.tsx; ShootingStars.tsx; towerWorlds.ts (the palettes, via the page).
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
    /**
     * The star field's opacity on the ground — above 0 at night (timeOfDay.ts
     * `groundStars`), so stars show over a night sky before any climb. The climb's own
     * fade-in takes over wherever it is stronger.
     */
    groundStars?: number;
    /** Fire occasional meteors over the sky (timeOfDay.ts `shootingStars`: night). */
    shootingStars?: boolean;
    /** The backdrop's bottom edge (the footer bar's height), matching the scroller's. */
    bottom: number | string;
    /** The altitude to show instead of the scroll's (see the header), or null to follow the scroll. */
    altitudeY?: number | null;
    /**
     * Px at the scroller's bottom hidden behind the footer bar: the scroller runs to the
     * screen's bottom edge (so a study session's scene can fill it), and its last
     * `scrollerBottomInset` px are a spacer under the footer — not part of the view whose
     * middle is the altitude.
     */
    scrollerBottomInset?: number;
}

/** Stars only start to show once the blend is this far along, so they never sit on a light sky. */
const STARS_FADE_FROM = 0.35;

/** Hermite smoothstep of `x` between `edge0` and `edge1`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
    const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return u * u * (3 - 2 * u);
}

const SpaceBackdrop: React.FC<SpaceBackdropProps> = ({ scrollerRef, band, palette, bottom, altitudeY = null, scrollerBottomInset = 0, groundStars = 0, shootingStars = false }) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const starsRef = useRef<HTMLDivElement>(null);
    const starLayerRefs = useRef<(HTMLDivElement | null)[]>([]);
    // Read by `apply` through refs: the palette changes per frame during a pan, and
    // re-subscribing the scroll listener that often would be wasted work.
    const paletteRef = useRef(palette);
    paletteRef.current = palette;
    const groundStarsRef = useRef(groundStars);
    groundStarsRef.current = groundStars;
    const altitudeRef = useRef(altitudeY);
    altitudeRef.current = altitudeY;
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

        // What `apply` last wrote, so a scroll frame that changes nothing writes nothing (a
        // style write invalidates even when the value is the same).
        let lastSky = "";
        let lastStarsOpacity = "";
        const lastStarTransforms: string[] = [];
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
            const viewHeight = scrollerRect.height - scrollerBottomInset;
            const midY = altitudeRef.current ?? band.viewBoxMinY + (scrollerRect.top + viewHeight / 2 - svgRect.top) / scale;
            const t = (band.yFrom - midY) / (band.yFrom - band.yTo);
            const skyNow = mixHex(paletteRef.current.sky, paletteRef.current.space, smoothstep(0, 1, t));
            if (skyNow !== lastSky) {
                lastSky = skyNow;
                backdrop.style.backgroundColor = skyNow;
            }
            // The floating slab footer stands on this sky and casts its shadow onto it: the
            // sky one iso step darker (the design's `shade(sky, .1)`), following the sky into
            // space as the tower is climbed. See components/footerCastShadow.ts.
            setFooterCastShadow(shadeHex(skyNow, 0.1));
            const starsOpacity = Math.max(groundStarsRef.current, smoothstep(STARS_FADE_FROM, 1, t)).toFixed(3);
            if (starsOpacity !== lastStarsOpacity) {
                lastStarsOpacity = starsOpacity;
                stars.style.opacity = starsOpacity;
            }
            // Parallax: how far the learner has scrolled UP from the bottom. Content moves
            // down the screen as they climb; each star layer follows at its own fraction
            // (starLayerTransform).
            const climbed = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
            STAR_LAYERS.forEach((l, i) => {
                const el = starLayerRefs.current[i];
                const transform = starLayerTransform(climbed, l);
                if (!el || transform === lastStarTransforms[i]) return;
                lastStarTransforms[i] = transform;
                el.style.transform = transform;
            });
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
            setFooterCastShadow(null);
            scroller.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
        };
    }, [scrollerRef, band, scrollerBottomInset]);

    // A new palette (a world pan's colour blend), or a new study altitude, repaints straight away.
    useLayoutEffect(() => {
        applyRef.current?.();
    }, [palette.sky, palette.space, altitudeY, groundStars]);

    return (
        <Box
            ref={backdropRef}
            className="deck-tower-page__space-backdrop"
            sx={{ position: "absolute", zIndex: 1, top: 0, left: 0, right: 0, bottom, backgroundColor: palette.sky, pointerEvents: "none" }}
        >
            <StarField fieldRef={starsRef} layerRefs={starLayerRefs} opacity={0} />
            <ShootingStars active={shootingStars} />
        </Box>
    );
};

export default SpaceBackdrop;

import React, { useEffect, useRef } from "react";
import type { WorldRect } from "./geometry";
import { openFloorSpot, type FloorSolid } from "./openFloor";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { prefersReducedMotion } from "./skyTraffic";

/**
 * IsoSnow — snow falling IN FRONT of what stands on a platform and settling on it
 * (docs/ISO_ART_FRAMEWORK.md § "IsoSnow"; docs/TOWER_SNOW.md § "Falling snow").
 *
 * The snow counterpart of IsoRain, for the same reason: the sky's snow
 * (src/features/deckTower/WeatherLayer.tsx) is a canvas BEHIND the scene's svg, so the
 * platform and the tower hide it and no flake ever reaches the floor. Every flake here has
 * a LANDING POINT on open floor or on a standing solid's top (openFloor.ts → the same rule
 * as IsoRain's), sways down onto it — the sway easing out over its last stretch so it
 * lands where it was aimed — and then lies there a moment, fading, instead of splashing.
 *
 * Drawing: flat `ISO.snow` dots at the sky's flake opacity (NOT washed, like the sky's, so
 * the two layers read as one snowfall). Three <path>s of round-capped zero-length strokes,
 * rewritten from one rAF loop by direct attribute writes (no React state per frame): small
 * flakes, large flakes (a path has one stroke width, so radii are bucketed in two), and
 * settled flakes fading out. Sizes and speeds are CSS px, converted to viewBox units every
 * frame from the svg's screen matrix, which carries the scroll, the bob and a pan's slide.
 *
 * Only what is on screen is simulated, and the flake COUNT follows the visible column
 * (density × platform width × column height), as IsoRain's drops do.
 *
 * `prefers-reduced-motion`: draws nothing (as the sky's snow).
 *
 * Depends on: openFloor.ts, palette.ts (`ISO.snow`), sceneContext.ts, skyTraffic.ts.
 * Depended on by: src/features/deckTower/DeckTowerPlatform.tsx (fed by DeckTowerPage from
 * towerWeather.ts → `weatherEffect` and the shared `SNOW_*` flake look).
 */

/** The snow's look, in CSS px (towerWeather.ts `SNOW_*`, shared with the sky's snow). */
export interface IsoSnowFall {
    /** Flakes per 100,000 CSS px² of the platform's column. */
    density: number;
    alpha: number;
    /** Radius range, CSS px. */
    radius: readonly [number, number];
    /** Fall speed range, CSS px/s. */
    speed: readonly [number, number];
    /** Sway amplitude, CSS px, and its phase speed (rad/s). */
    sway: number;
    swayRate: number;
}

interface IsoSnowProps {
    rect: WorldRect;
    floorZ: number;
    fall: IsoSnowFall;
    solids?: FloorSolid[];
    /** The highest viewBox y snow starts from (IsoRain `ceilingY`). */
    ceilingY?: number;
}

/** Share of the backdrop's density used here (IsoRain's reason: the column overlaps open sky). */
const FRONT_SHARE = 0.75;
const MAX_FLAKES = 220;
/** How long a landed flake lies before it has faded (s). */
const SETTLE_S = 0.9;
/** The last stretch of fall (CSS px) over which the sway eases out, so a flake lands on its spot. */
const SWAY_EASE_PX = 36;
/** Flakes at or over this radius (CSS px) draw in the large bucket. */
const LARGE_FROM_PX = 1.85;
const RIM_INSET = 0.25;

interface Flake {
    landX: number;
    landY: number;
    y: number;
    speed: number;
    large: boolean;
    phase: number;
}

interface Settled {
    x: number;
    y: number;
    large: boolean;
    age: number;
}

const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);

const IsoSnow: React.FC<IsoSnowProps> = ({ rect, floorZ, fall, solids = [], ceilingY }) => {
    const proj = useIsoProjector();
    const groupRef = useRef<SVGGElement>(null);
    const smallRef = useRef<SVGPathElement>(null);
    const largeRef = useRef<SVGPathElement>(null);
    const settledSmallRef = useRef<SVGPathElement>(null);
    const settledLargeRef = useRef<SVGPathElement>(null);
    const reducedMotion = prefersReducedMotion();

    // Read by the loop through a ref: the tower's height changes, and restarting the loop
    // for it would drop every flake in the air.
    const sceneRef = useRef({ rect, floorZ, solids, ceilingY, proj });
    sceneRef.current = { rect, floorZ, solids, ceilingY, proj };

    const { density, alpha, radius, speed, sway, swayRate } = fall;
    // The two buckets' radii: the mean of each side of the split.
    const smallR = (radius[0] + Math.min(radius[1], LARGE_FROM_PX)) / 2;
    const largeR = (Math.max(radius[0], LARGE_FROM_PX) + radius[1]) / 2;

    useEffect(() => {
        const group = groupRef.current;
        const paths = [smallRef.current, largeRef.current, settledSmallRef.current, settledLargeRef.current];
        if (!group || paths.some((p) => !p) || reducedMotion || density <= 0) return;
        const [small, large, settledSmall, settledLarge] = paths as SVGPathElement[];

        const flakes: Flake[] = [];
        let settled: Settled[] = [];

        const land = (): { x: number; y: number } | null => {
            const { rect: r, floorZ: z0, solids: ss, proj: p } = sceneRef.current;
            const spot = openFloorSpot(r, ss, { inset: RIM_INSET, onSolids: true });
            return spot ? p.project(spot.at.x, spot.at.y, spot.on ? spot.on.zTop : z0) : null;
        };
        const platformWidth = () => {
            const { rect: r, floorZ: z0, proj: p } = sceneRef.current;
            return Math.abs(p.project(r.x + r.w, r.y, z0).x - p.project(r.x, r.y + r.d, z0).x);
        };

        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;

            const ctm = group.getScreenCTM();
            if (!ctm || ctm.a <= 0 || ctm.d <= 0) return;
            const k = 1 / ctm.a; // viewBox units per CSS px
            const winTop = (0 - ctm.f) / ctm.d;
            const winBottom = (window.innerHeight - ctm.f) / ctm.d;
            const ceiling = sceneRef.current.ceilingY;
            const top = ceiling === undefined ? winTop : Math.max(winTop, ceiling);

            const { rect: r, floorZ: z0, proj: p0 } = sceneRef.current;
            const floorY = p0.project(r.x + r.w, r.y + r.d, z0).y;
            const column = Math.max(0, Math.min(winBottom, floorY) - top);
            const target = Math.min(MAX_FLAKES, Math.round((density * FRONT_SHARE * (platformWidth() / k) * (column / k)) / 100_000));
            while (flakes.length > target) flakes.pop();
            while (flakes.length < target) {
                const at = land();
                if (!at) break;
                flakes.push({
                    landX: at.x,
                    landY: at.y,
                    y: top + Math.random() * Math.max(0, at.y - top),
                    speed: between(speed),
                    large: between(radius) >= LARGE_FROM_PX,
                    phase: Math.random() * Math.PI * 2,
                });
            }

            const swayLen = sway * k;
            const easeLen = SWAY_EASE_PX * k;
            let dSmall = "";
            let dLarge = "";
            for (const f of flakes) {
                f.y += f.speed * k * dt;
                f.phase += swayRate * dt;
                const landed = f.y >= f.landY;
                const gone = !landed && f.y > winBottom + 4 * k;
                if (landed || gone) {
                    if (landed && f.landY >= winTop && f.landY <= winBottom) settled.push({ x: f.landX, y: f.landY, large: f.large, age: 0 });
                    const at = land();
                    if (at) {
                        f.landX = at.x;
                        f.landY = at.y;
                    }
                    f.y = top - Math.random() * 20 * k;
                    continue;
                }
                if (f.y < winTop - 4 * k || f.y > winBottom + 4 * k) continue;
                // Full sway up high, easing to none over the last stretch above the landing.
                const ease = Math.min(1, Math.max(0, (f.landY - f.y) / easeLen));
                const x = f.landX + Math.sin(f.phase) * swayLen * ease;
                const seg = `M${x.toFixed(1)} ${f.y.toFixed(1)}h0.01`;
                if (f.large) dLarge += seg;
                else dSmall += seg;
            }
            small.setAttribute("d", dSmall);
            large.setAttribute("d", dLarge);
            small.setAttribute("stroke-width", (2 * smallR * k).toFixed(2));
            large.setAttribute("stroke-width", (2 * largeR * k).toFixed(2));

            // Landed flakes lie where they fell and fade. Opacity per path, so they are drawn
            // at the bucket's mean age — cheap, and at a second's life the difference is lost.
            settled = settled.filter((s) => (s.age += dt) < SETTLE_S);
            let sSmall = "";
            let sLarge = "";
            let ageSum = 0;
            for (const s of settled) {
                ageSum += s.age;
                const seg = `M${s.x.toFixed(1)} ${s.y.toFixed(1)}h0.01`;
                if (s.large) sLarge += seg;
                else sSmall += seg;
            }
            const fade = settled.length ? Math.max(0, 1 - ageSum / settled.length / SETTLE_S) : 0;
            settledSmall.setAttribute("d", sSmall);
            settledLarge.setAttribute("d", sLarge);
            settledSmall.setAttribute("opacity", (alpha * fade).toFixed(3));
            settledLarge.setAttribute("opacity", (alpha * fade).toFixed(3));
            settledSmall.setAttribute("stroke-width", (2 * smallR * k).toFixed(2));
            settledLarge.setAttribute("stroke-width", (2 * largeR * k).toFixed(2));
        };
        frame = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(frame);
            for (const p of paths) p?.setAttribute("d", "");
        };
    }, [density, alpha, radius, speed, sway, swayRate, smallR, largeR, reducedMotion]);

    if (reducedMotion) return null;
    const dot = { fill: "none", stroke: ISO.snow, strokeLinecap: "round" as const };
    return (
        <g ref={groupRef} className="iso-snow-fall" pointerEvents="none">
            <path ref={settledSmallRef} className="iso-snow-fall__settled iso-snow-fall__settled--small" {...dot} />
            <path ref={settledLargeRef} className="iso-snow-fall__settled iso-snow-fall__settled--large" {...dot} />
            <path ref={smallRef} className="iso-snow-fall__flakes iso-snow-fall__flakes--small" {...dot} opacity={alpha} />
            <path ref={largeRef} className="iso-snow-fall__flakes iso-snow-fall__flakes--large" {...dot} opacity={alpha} />
        </g>
    );
};

export default IsoSnow;

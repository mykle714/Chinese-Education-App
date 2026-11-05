import React, { useEffect, useMemo, useRef } from "react";
import type { WorldRect } from "./geometry";
import { openFloorSpot, type FloorSolid } from "./openFloor";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { prefersReducedMotion } from "./skyTraffic";

/**
 * IsoRain — rain falling IN FRONT of what stands on a platform and splashing on it
 * (docs/ISO_ART_FRAMEWORK.md § "IsoRain"; the Deck Tower's drizzle / rain / storm,
 * docs/DECK_TOWER.md § "Weather").
 *
 * ── Why a second rain layer ───────────────────────────────────────────────────
 * The sky's rain (src/features/deckTower/WeatherLayer.tsx) is a canvas BEHIND the scene's
 * svg, so the platform and the tower hide it: no drop ever reached the floor or passed in
 * front of the tower. This component draws exactly the drops that layer cannot: those whose
 * column the platform or the tower would otherwise cover. Every drop here has a LANDING
 * POINT on something solid — the floor, or the top of a standing `solid` (the tower's top
 * card) — falls straight down the screen onto it, and splashes there.
 *
 * ── Which landing points ──────────────────────────────────────────────────────
 * Landings are sampled over the floor (inset slightly from the rim). A point of floor that
 * a solid hides — behind it (world x and y both short of its front faces) and inside its
 * screen-x span — is REJECTED: the column above it is the solid's own face, and above the
 * solid's top it is sky, where WeatherLayer's rain already shows. A point inside a solid's
 * footprint lands on that solid's top instead. With no solids, the whole floor is open.
 * The pawn and the lever are not solids — a drop can fall over them (accepted: both are
 * small and move or sit low).
 *
 * ── Drawing ───────────────────────────────────────────────────────────────────
 * Flat white `ISO.rain` like every other weather mark — the SAME colour and opacity as the
 * sky's rain (not washed by the time of day), so the two layers read as one rain. Five
 * <path>s, rewritten from one rAF loop by direct attribute writes (no React state per frame):
 * the streaks, then each splash age bucket's ring and droplets (a path has one opacity, so
 * fading splashes are bucketed — young and old — rather than faded one by one).
 *   - A SPLASH is a flat ring on the surface (a world circle, so an iso ellipse) that grows
 *     and fades, plus two droplets hopping out to either side.
 *   - Streak length, speed and stroke are CSS px (as the sky's are), converted to viewBox
 *     units every frame from the svg's screen matrix — which also carries the scroll, the
 *     platform's bob and a world pan's slide, so nothing here re-reads layout on events.
 *
 * ── Only what is on screen ────────────────────────────────────────────────────
 * Drops are simulated only inside the visible window (its top and bottom mapped into this
 * group's coordinates each frame): they spawn at the window's top (or `ceilingY`, whichever
 * is lower) and, when their landing is below the window, are recycled as they leave it. The
 * drop COUNT follows the visible column (density × platform width × column height), so a
 * tall, climbed tower neither thins out nor simulates rain nobody sees.
 *
 * `prefers-reduced-motion`: draws nothing (as the sky's rain).
 *
 * Depends on: openFloor.ts (`openFloorSpot`, `FloorSolid` — the landing rule), palette.ts
 * (`ISO.rain`), sceneContext.ts (`useIsoProjector`), skyTraffic.ts (`prefersReducedMotion`).
 * Depended on by: src/features/deckTower/DeckTowerPlatform.tsx (fed by DeckTowerPage from
 * towerWeather.ts → `weatherEffect`).
 */

/** The rain's look, in CSS px (as towerWeather.ts `WeatherEffect` gives it). */
export interface IsoRainFall {
    /** Drops per 100,000 CSS px² of the platform's column. */
    density: number;
    /** Fall speed, CSS px/s. */
    speed: number;
    /** Streak length, CSS px. */
    length: number;
    /** Streak lean: CSS px sideways per px of fall (shared with the sky's rain). */
    lean: number;
    /** Streak and splash opacity (shared with the sky's rain). */
    alpha: number;
    /** Streak width, CSS px. */
    strokePx: number;
}

/** Something standing on the floor that rain lands on and hides the floor behind (openFloor.ts). */
export type IsoRainSolid = FloorSolid;

interface IsoRainProps {
    /** The platform the rain lands on (its floor is `floorZ`). */
    rect: WorldRect;
    floorZ: number;
    fall: IsoRainFall;
    /** Solids standing on the floor (see the header's "Which landing points"). */
    solids?: IsoRainSolid[];
    /**
     * The highest viewBox y rain starts from (rain has a cloud base). Undefined: the top of
     * the window. The Deck Tower sets it inside its sky → space band, where the sky's own
     * weather has faded out.
     */
    ceilingY?: number;
}

/**
 * Share of the backdrop's density used here. The columns above the floor run up into open
 * sky above the tower, where the backdrop's rain also falls, so full density would visibly
 * double the rain over the platform.
 */
const FRONT_SHARE = 0.75;
/** Hard cap on live drops, whatever the screen. */
const MAX_DROPS = 260;
/** A splash's life (s), and the world radius its ring grows from and to at the reference length. */
const SPLASH_S = 0.3;
const RING_R = [0.06, 0.34] as const;
/** The streak length (CSS px) splashes are sized for; shorter drizzle splashes smaller. */
const SPLASH_REF_LENGTH = 16;
/** Droplet hop height (CSS px at the reference length) and dot size (CSS px). */
const HOP_PX = 7;
const DROPLET_PX = 1.8;
/** Splash buckets' opacity, relative to the rain's: young (first half of life) and old. */
const YOUNG_ALPHA = 1.35;
const OLD_ALPHA = 0.6;
/** How far the floor sampling stays off the platform's edge (world units). */
const RIM_INSET = 0.25;

/** One drop: where it lands (viewBox), and its head's current height. */
interface Drop {
    landX: number;
    landY: number;
    y: number;
    /** Speed jitter, as a factor of `fall.speed`. */
    speedK: number;
}

interface Splash {
    x: number;
    y: number;
    age: number;
}

const IsoRain: React.FC<IsoRainProps> = ({ rect, floorZ, fall, solids = [], ceilingY }) => {
    const proj = useIsoProjector();
    const groupRef = useRef<SVGGElement>(null);
    const streaksRef = useRef<SVGPathElement>(null);
    const youngRingsRef = useRef<SVGPathElement>(null);
    const youngDropletsRef = useRef<SVGPathElement>(null);
    const oldRingsRef = useRef<SVGPathElement>(null);
    const oldDropletsRef = useRef<SVGPathElement>(null);
    const reducedMotion = prefersReducedMotion();

    // Read by the loop through a ref: the tower's height (`solids`) changes as it grows,
    // and restarting the loop for it would drop every drop in the air.
    const sceneRef = useRef({ rect, floorZ, solids, ceilingY, proj });
    sceneRef.current = { rect, floorZ, solids, ceilingY, proj };

    // A world circle of radius 1 on the floor projects to an ellipse with these radii.
    const ringAxes = useMemo(() => {
        const o = proj.project(0, 0, 0);
        const e = proj.project(1, 0, 0);
        return { rx: Math.SQRT2 * Math.abs(e.x - o.x), ry: Math.SQRT2 * Math.abs(e.y - o.y) };
    }, [proj]);

    const { density, speed, length, lean, alpha, strokePx } = fall;

    useEffect(() => {
        const group = groupRef.current;
        const paths = [streaksRef.current, youngRingsRef.current, youngDropletsRef.current, oldRingsRef.current, oldDropletsRef.current];
        if (!group || paths.some((p) => !p) || reducedMotion || density <= 0) return;
        const [streaks, youngRings, youngDroplets, oldRings, oldDroplets] = paths as SVGPathElement[];

        const drops: Drop[] = [];
        let splashes: Splash[] = [];
        const splashScale = Math.min(1, length / SPLASH_REF_LENGTH);

        // A fresh landing point, in viewBox coordinates, or null if none was found.
        const land = (): { x: number; y: number } | null => {
            const { rect: r, floorZ: z0, solids: ss, proj: p } = sceneRef.current;
            const spot = openFloorSpot(r, ss, { inset: RIM_INSET, onSolids: true });
            return spot ? p.project(spot.at.x, spot.at.y, spot.on ? spot.on.zTop : z0) : null;
        };

        // The platform's screen width (viewBox units), for the drop count.
        const platformWidth = () => {
            const { rect: r, floorZ: z0, proj: p } = sceneRef.current;
            const left = p.project(r.x, r.y + r.d, z0).x;
            const right = p.project(r.x + r.w, r.y, z0).x;
            return Math.abs(right - left);
        };

        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            // Clamp the step: returning to a backgrounded tab must not teleport every drop.
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;

            // The window in this group's coordinates. Read before any write this frame, so
            // the read finds layout clean. `a` is CSS px per viewBox unit (uniform scale).
            const ctm = group.getScreenCTM();
            if (!ctm || ctm.a <= 0 || ctm.d <= 0) return;
            const k = 1 / ctm.a; // viewBox units per CSS px
            const winTop = (0 - ctm.f) / ctm.d;
            const winBottom = (window.innerHeight - ctm.f) / ctm.d;
            const ceiling = sceneRef.current.ceilingY;
            const top = ceiling === undefined ? winTop : Math.max(winTop, ceiling);

            const len = length * k;
            const leanLen = len * lean;
            const fallSpeed = speed * k;

            // Hold the count to the visible column: the rain's density over the platform's
            // width, from the spawn line down to the floor's front corner (or the window's bottom).
            const { rect: r, floorZ: z0, proj: p0 } = sceneRef.current;
            const floorY = p0.project(r.x + r.w, r.y + r.d, z0).y;
            const column = Math.max(0, Math.min(winBottom, floorY) - top);
            const target = Math.min(
                MAX_DROPS,
                Math.round((density * FRONT_SHARE * (platformWidth() / k) * (column / k)) / 100_000),
            );
            while (drops.length > target) drops.pop();
            while (drops.length < target) {
                const at = land();
                if (!at) break;
                // Spread new drops down their column, so a resize doesn't arrive as one sheet.
                drops.push({ landX: at.x, landY: at.y, y: top + Math.random() * Math.max(0, at.y - top), speedK: 0.8 + Math.random() * 0.4 });
            }

            // ── Streaks ──
            let d = "";
            for (const p of drops) {
                p.y += fallSpeed * p.speedK * dt;
                const landed = p.y >= p.landY;
                // Off the bottom of the window above its landing: recycle without a splash.
                const gone = !landed && p.y - len > winBottom;
                if (landed || gone) {
                    if (landed && p.landY >= winTop && p.landY <= winBottom) splashes.push({ x: p.landX, y: p.landY, age: 0 });
                    const at = land();
                    if (at) {
                        p.landX = at.x;
                        p.landY = at.y;
                    }
                    p.y = top - Math.random() * len * 2;
                    continue;
                }
                if (p.y < winTop || p.y - len > winBottom) continue;
                // The streak leans: its head is `landY − y` of fall short of the landing.
                const hx = p.landX - (p.landY - p.y) * lean;
                d += `M${hx.toFixed(1)} ${p.y.toFixed(1)}l${(-leanLen).toFixed(1)} ${(-len).toFixed(1)}`;
            }
            streaks.setAttribute("d", d);
            streaks.setAttribute("stroke-width", (strokePx * k).toFixed(2));

            // ── Splashes ──
            let ringsYoung = "";
            let ringsOld = "";
            let dotsYoung = "";
            let dotsOld = "";
            const hop = HOP_PX * k * splashScale;
            splashes = splashes.filter((s) => (s.age += dt) < SPLASH_S);
            for (const s of splashes) {
                const u = s.age / SPLASH_S; // 0 → 1 over the splash's life
                const ease = 1 - (1 - u) * (1 - u); // fast out, slowing
                const r = (RING_R[0] + (RING_R[1] - RING_R[0]) * ease) * splashScale;
                const rx = ringAxes.rx * r;
                const ry = ringAxes.ry * r;
                const ring = `M${(s.x - rx).toFixed(1)} ${s.y.toFixed(1)}a${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(2 * rx).toFixed(1)} 0a${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(-2 * rx).toFixed(1)} 0`;
                // Two droplets thrown out to either side on a parabola, landing as the ring fades.
                const dx = rx * 1.15 * ease;
                const dy = -hop * 4 * u * (1 - u);
                const dots = `M${(s.x - dx).toFixed(1)} ${(s.y + dy).toFixed(1)}h0.01M${(s.x + dx).toFixed(1)} ${(s.y + dy * 0.8).toFixed(1)}h0.01`;
                if (u < 0.5) {
                    ringsYoung += ring;
                    dotsYoung += dots;
                } else {
                    ringsOld += ring;
                    dotsOld += dots;
                }
            }
            youngRings.setAttribute("d", ringsYoung);
            oldRings.setAttribute("d", ringsOld);
            youngDroplets.setAttribute("d", dotsYoung);
            oldDroplets.setAttribute("d", dotsOld);
            const ringW = (strokePx * k).toFixed(2);
            const dotW = (DROPLET_PX * k).toFixed(2);
            youngRings.setAttribute("stroke-width", ringW);
            oldRings.setAttribute("stroke-width", ringW);
            youngDroplets.setAttribute("stroke-width", dotW);
            oldDroplets.setAttribute("stroke-width", dotW);
        };
        frame = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(frame);
            for (const p of paths) p?.setAttribute("d", "");
        };
    }, [density, speed, length, lean, strokePx, reducedMotion, ringAxes]);

    if (reducedMotion) return null;
    const youngAlpha = Math.min(1, alpha * YOUNG_ALPHA);
    const oldAlpha = alpha * OLD_ALPHA;
    // Shared stroke look: flat white, round ends (a round-capped zero-length line is a dot).
    const line = { fill: "none", stroke: ISO.rain, strokeLinecap: "round" as const };
    return (
        <g ref={groupRef} className="iso-rain" pointerEvents="none">
            <path ref={streaksRef} className="iso-rain__streaks" {...line} opacity={alpha} />
            <path ref={oldRingsRef} className="iso-rain__splash-rings iso-rain__splash-rings--old" {...line} opacity={oldAlpha} />
            <path ref={oldDropletsRef} className="iso-rain__splash-droplets iso-rain__splash-droplets--old" {...line} opacity={oldAlpha} />
            <path ref={youngRingsRef} className="iso-rain__splash-rings iso-rain__splash-rings--young" {...line} opacity={youngAlpha} />
            <path ref={youngDropletsRef} className="iso-rain__splash-droplets iso-rain__splash-droplets--young" {...line} opacity={youngAlpha} />
        </g>
    );
};

export default IsoRain;

import React, { useMemo } from "react";
import type { Pt } from "./geometry";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { seededRandom } from "./seededRandom";
import { prefersReducedMotion } from "./skyTraffic";

/**
 * IsoLightningBolt — one lightning strike coming down onto a floor point
 * (docs/ISO_ART_FRAMEWORK.md § "IsoLightningBolt"; the Deck Tower's strikes,
 * docs/DECK_TOWER.md § "Weather" → "Lightning strikes").
 *
 * A jagged flat-white stroke from far above the screen straight down to `at`, with one
 * short fork, and a flat ring on the floor where it hits. It plays once on mount (a CSS
 * double-strike flicker, the same rhythm as the sky's flash) and calls `onDone` when it has
 * gone, so the caller can unmount it. The caller keys it per strike.
 *
 * Drawn IN FRONT of everything on the floor: the strike point is always visible floor
 * (openFloor.ts), so the bolt's column passes in front of the tower, never behind it.
 *
 * Flat `ISO.lightning` (white), unwashed like the sky's flash. Under prefers-reduced-motion
 * it draws nothing and reports done at once (the burn mark still appears).
 *
 * Depends on: palette.ts (`ISO.lightning`), sceneContext.ts, skyTraffic.ts
 * (`prefersReducedMotion`). Depended on by: src/features/deckTower/DeckTowerPlatform.tsx.
 */

interface IsoLightningBoltProps {
    /** World point it strikes. */
    at: Pt;
    /** World z of the floor there. */
    z: number;
    /** Fixes the zig-zag (one per strike). */
    seed: number;
    onDone?: () => void;
}

/** How far up the bolt reaches, in world units of height (well past the top of the screen). */
const BOLT_HEIGHT = 90;
/** Zig-zag kinks, and their sideways swing in world units of floor. */
const KINKS = 14;
const SWING = 0.9;
/** Stroke widths (world units): the bolt and its fork. */
const BOLT_W = 0.22;
const FORK_W = 0.12;
/** The impact ring's world radius. */
const RING_R = 0.7;
const BOLT_MS = 520;

const BOLT_CSS = `
@keyframes iso-lightning-bolt {
    0% { opacity: 1; }
    12% { opacity: 0.2; }
    24% { opacity: 1; }
    100% { opacity: 0; }
}
.iso-lightning-bolt { animation: iso-lightning-bolt ${BOLT_MS}ms ease-out both; }
`;


const IsoLightningBolt: React.FC<IsoLightningBoltProps> = ({ at, z, seed, onDone }) => {
    const proj = useIsoProjector();
    const reduced = prefersReducedMotion();
    const shape = useMemo(() => {
        const rnd = seededRandom(seed);
        const hit = proj.project(at.x, at.y, z);
        const top = hit.y - BOLT_HEIGHT * proj.heightUnit;
        const swing = SWING * proj.unit;
        // Kinks bunch toward the bottom (squared spacing), where the bolt is on screen.
        const pts = Array.from({ length: KINKS + 1 }, (_, i) => {
            const u = i / KINKS;
            const y = top + (hit.y - top) * (1 - (1 - u) * (1 - u));
            const x = i === KINKS ? hit.x : hit.x + (rnd() - 0.5) * 2 * swing;
            return { x, y };
        });
        const bolt = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
        // The fork leaves a kink two-thirds of the way down and stops short of the floor.
        const from = pts[Math.round(KINKS * 0.7)];
        const side = rnd() < 0.5 ? -1 : 1;
        const fork = `M${from.x.toFixed(1)} ${from.y.toFixed(1)}l${(side * swing * 0.9).toFixed(1)} ${((hit.y - from.y) * 0.35).toFixed(1)}l${(-side * swing * 0.3).toFixed(1)} ${((hit.y - from.y) * 0.25).toFixed(1)}`;
        // The ring: a world circle on the floor, so an iso ellipse.
        const o = proj.project(0, 0, 0);
        const e = proj.project(1, 0, 0);
        const rx = Math.SQRT2 * Math.abs(e.x - o.x) * RING_R;
        const ry = Math.SQRT2 * Math.abs(e.y - o.y) * RING_R;
        return { bolt, fork, hit, rx, ry };
    }, [proj, at.x, at.y, z, seed]);

    // Reduced motion: no flash at all — report done straight away.
    React.useEffect(() => {
        if (reduced) onDone?.();
    }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
    if (reduced) return null;

    const line = { fill: "none", stroke: ISO.lightning, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    return (
        <g className="iso-lightning-bolt" pointerEvents="none" onAnimationEnd={() => onDone?.()}>
            <style>{BOLT_CSS}</style>
            <path className="iso-lightning-bolt__fork" d={shape.fork} {...line} strokeWidth={FORK_W * proj.unit} />
            <path className="iso-lightning-bolt__bolt" d={shape.bolt} {...line} strokeWidth={BOLT_W * proj.unit} />
            <ellipse className="iso-lightning-bolt__ring" cx={shape.hit.x} cy={shape.hit.y} rx={shape.rx} ry={shape.ry} {...line} strokeWidth={FORK_W * proj.unit} />
        </g>
    );
};

export default IsoLightningBolt;

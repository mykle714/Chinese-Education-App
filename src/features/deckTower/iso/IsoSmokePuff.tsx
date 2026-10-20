import React, { useMemo } from "react";
import { roundedRectWorld, type WorldRect } from "./geometry";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoSmokePuff — the burst of dust where something heavy lands (docs/ISO_ART_FRAMEWORK.md
 * § "IsoSmokePuff"): a ring of round white puffs around the lander's footprint at the
 * landing height, each swelling, drifting outward and up, and fading.
 *
 * Puffs on the footprint's BACK half are hidden by the thing that landed and those on its
 * FRONT half are drawn over it, so a scene draws it twice — `side="behind"` before the
 * lander, `side="front"` after. Flat discs, no walls: a puff is gone in well under a
 * second, and the cartoon look wants soft round shapes rather than bevelled boxes.
 *
 * CSS-animated from mount (after `delayMs`), so mount it ahead of the landing with the
 * delay to the impact, and key it per landing. It plays once and stays invisible.
 * Under prefers-reduced-motion it draws nothing.
 */
interface IsoSmokePuffProps {
    /** The footprint of what landed. */
    rect: WorldRect;
    /** World z of the landing (the lander's underside). */
    z: number;
    side: "behind" | "front";
    /** Ms after mount that it bursts. */
    delayMs?: number;
}

/** Puffs round the whole ring (both sides together). */
const PUFF_COUNT = 14;
/** World units a puff drifts out from the footprint, and rises. */
const PUFF_REACH = 1.6;
const PUFF_RISE = 0.5;
/** World-unit radius range of a puff at full size. */
const PUFF_R_MIN = 0.45;
const PUFF_R_MAX = 0.8;
const PUFF_MS = 700;

const PUFF_CSS = `
@keyframes iso-smoke-puff {
    0%   { opacity: 0; transform: translate(0, 0) scale(0.25); }
    12%  { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--puff-dx), var(--puff-dy)) scale(1); }
}
.iso-smoke-puff__puff { transform-box: fill-box; transform-origin: center; opacity: 0; }
@media (prefers-reduced-motion: reduce) { .iso-smoke-puff { display: none; } }
`;

/**
 * `count` points evenly spaced by arc length round a closed outline. (`roundedRectWorld`
 * only lists its corner arcs' points — the straight edges are implicit — so indexing into
 * it would bunch the puffs at the corners.)
 */
function perimeterSamples(outline: { x: number; y: number }[], count: number): { x: number; y: number }[] {
    const seg = outline.map((p, i) => {
        const q = outline[(i + 1) % outline.length];
        return { p, q, len: Math.hypot(q.x - p.x, q.y - p.y) };
    });
    const total = seg.reduce((s, e) => s + e.len, 0);
    const out: { x: number; y: number }[] = [];
    let k = 0;
    let walked = 0;
    for (let i = 0; i < count; i++) {
        const at = (i / count) * total;
        while (k < seg.length - 1 && walked + seg[k].len < at) walked += seg[k++].len;
        const u = seg[k].len > 0 ? (at - walked) / seg[k].len : 0;
        out.push({ x: seg[k].p.x + (seg[k].q.x - seg[k].p.x) * u, y: seg[k].p.y + (seg[k].q.y - seg[k].p.y) * u });
    }
    return out;
}

const IsoSmokePuff: React.FC<IsoSmokePuffProps> = ({ rect, z, side, delayMs = 0 }) => {
    const proj = useIsoProjector();
    const puffs = useMemo(() => {
        const outline = perimeterSamples(roundedRectWorld(rect), PUFF_COUNT);
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.d / 2;
        const out: { x: number; y: number; r: number; dx: number; dy: number; delay: number }[] = [];
        for (let i = 0; i < PUFF_COUNT; i++) {
            const p = outline[i];
            // Back half: toward the viewer's upper side of the screen (world x + y smaller than the centre's).
            const behind = p.x - cx + (p.y - cy) < 0;
            if (behind !== (side === "behind")) continue;
            // Outward along the footprint's own radial direction, so the ring opens evenly.
            const len = Math.hypot(p.x - cx, p.y - cy) || 1;
            const ux = (p.x - cx) / len;
            const uy = (p.y - cy) / len;
            const from = proj.project(p.x, p.y, z);
            const to = proj.project(p.x + ux * PUFF_REACH, p.y + uy * PUFF_REACH, z + PUFF_RISE);
            // A fixed size wobble by index — deterministic, so every landing looks the same.
            const wobble = (Math.sin(i * 12.9898) * 43758.5453) % 1;
            out.push({
                x: from.x,
                y: from.y,
                r: (PUFF_R_MIN + Math.abs(wobble) * (PUFF_R_MAX - PUFF_R_MIN)) * proj.unit,
                dx: to.x - from.x,
                dy: to.y - from.y,
                delay: delayMs + Math.abs(wobble) * 60,
            });
        }
        return out;
    }, [proj, rect, z, side, delayMs]);

    return (
        <g className={`iso-smoke-puff iso-smoke-puff--${side}`} pointerEvents="none">
            <style>{PUFF_CSS}</style>
            {puffs.map((p, i) => (
                <circle
                    key={i}
                    className="iso-smoke-puff__puff"
                    cx={p.x}
                    cy={p.y}
                    r={p.r}
                    fill={ISO.smoke}
                    style={
                        {
                            "--puff-dx": `${p.dx.toFixed(2)}px`,
                            "--puff-dy": `${p.dy.toFixed(2)}px`,
                            animation: `iso-smoke-puff ${PUFF_MS}ms ease-out ${p.delay.toFixed(0)}ms both`,
                        } as React.CSSProperties
                    }
                />
            ))}
        </g>
    );
};

export default IsoSmokePuff;

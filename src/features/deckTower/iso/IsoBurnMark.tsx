import React, { useMemo } from "react";
import type { Pt } from "./geometry";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { seededRandom } from "./seededRandom";

/**
 * IsoBurnMark — the scorch a lightning strike leaves on a floor (docs/ISO_ART_FRAMEWORK.md
 * § "IsoBurnMark"; the Deck Tower's strikes, docs/DECK_TOWER.md § "Weather" → "Lightning
 * strikes").
 *
 * A floor DECAL: flat, lying in the world XY plane at `z`, drawn with the floor's other
 * decals (under everything standing on it). Two flat ink shapes, no gradient:
 *   - a ragged star splash (`SPIKES` points whose outer radii jitter), faint;
 *   - a round-ish core over it, darker.
 * The jitter comes from `seed`, so a mark keeps its exact shape across re-renders and
 * remounts (the Deck Tower remounts its platform per world).
 *
 * Ink is the palette's (`useIsoPalette().ink`, washed for the time of day) at the mark's own
 * opacities, so a scorch is a darkening of whatever floor colour it lands on.
 *
 * Depends on: geometry.ts (`Pt`), sceneContext.ts. Depended on by:
 * src/features/deckTower/DeckTowerPlatform.tsx (`burns`).
 */

interface IsoBurnMarkProps {
    /** World point of the strike. */
    at: Pt;
    /** World z of the floor it lies on. */
    z: number;
    /** Fixes the ragged outline (any integer; one per strike). */
    seed: number;
}

/** The splash's points, its outer radius range and inner (valley) radius, world units. */
const SPIKES = 11;
const SPIKE_R = [0.5, 0.95] as const;
/**
 * The farthest any part of a mark reaches from its centre (world units) — what a caller
 * keeps clear of objects on the floor so a scorch never runs under one (the Deck Tower:
 * towerLightning.ts → `pickStrikePoint`).
 */
export const BURN_MARK_RADIUS = SPIKE_R[1];
const VALLEY_R = 0.32;
/** The core's radius and its wobble, world units. */
const CORE_R = 0.3;
const CORE_WOBBLE = 0.08;
const CORE_POINTS = 9;
/** Opacities of the splash and the core (the core sits over the splash, so it reads darker still). */
const SPLASH_ALPHA = 0.28;
const CORE_ALPHA = 0.5;


const IsoBurnMark: React.FC<IsoBurnMarkProps> = ({ at, z, seed }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const { splash, core } = useMemo(() => {
        const rnd = seededRandom(seed);
        const turn = rnd() * Math.PI * 2;
        // A closed polygon of world points round `at`, projected onto the floor.
        const ring = (count: number, radius: (i: number) => number) =>
            Array.from({ length: count }, (_, i) => {
                const a = turn + (i / count) * Math.PI * 2;
                const r = radius(i);
                const p = proj.project(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, z);
                return `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
            }).join("") + "Z";
        return {
            // Alternating spike tips and valleys.
            splash: ring(SPIKES * 2, (i) => (i % 2 === 0 ? SPIKE_R[0] + rnd() * (SPIKE_R[1] - SPIKE_R[0]) : VALLEY_R * (0.8 + rnd() * 0.4))),
            core: ring(CORE_POINTS, () => CORE_R + (rnd() - 0.5) * 2 * CORE_WOBBLE),
        };
    }, [proj, at.x, at.y, z, seed]);
    return (
        <g className="iso-burn-mark" pointerEvents="none">
            <path className="iso-burn-mark__splash" d={splash} fill={palette.ink} opacity={SPLASH_ALPHA} />
            <path className="iso-burn-mark__core" d={core} fill={palette.ink} opacity={CORE_ALPHA} />
        </g>
    );
};

export default IsoBurnMark;

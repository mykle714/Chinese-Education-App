import React from "react";
import { flatPath } from "./geometry";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { PAWN_FOOT_RADIUS, type PawnAirRing as PawnAirRingSpot } from "./usePawnMotion";

/**
 * PawnAirRing — the double ring a pawn kicks off from on a MID-AIR jump (a poke chained
 * while its feet are still up): a little platform in the air, two concentric light-blue
 * rings lying flat at the feet's height, which swell outward a little and fade
 * (docs/ISO_ART_FRAMEWORK.md § IsoPawn → "Air ring"). The look descends from the Deck
 * Tower rain's splash ring (IsoRain): a flat iso circle, not a screen-space circle, so it
 * reads as lying in the air's floor plane.
 *
 * Stays where it was kicked off (it does not follow the pawn). One per mid-air jump; the
 * caller unmounts it on `onDone` (the outer ring's animation end).
 *
 * Layer: iso framework presentation. Drawn by IsoPawn (behind the figure) from
 * usePawnMotion's `airRings`. Colour: `ISO.airRing` (COLORS.blueAccent).
 */

/** The rings' radii at the start of the swell, in world units (the pawn's foot radius is 0.45). */
const INNER_R = PAWN_FOOT_RADIUS * 1.5;
const OUTER_R = PAWN_FOOT_RADIUS * 2.4;
/** How long a ring lives, and the outer ring's lag behind the inner one (a ripple, not one stamp). */
export const AIR_RING_MS = 520;
const OUTER_LAG_MS = 70;

/**
 * Swell "lightly" (owner): from 80% to 115% of the radius on a sine ease-out — it drifts out
 * rather than bursting — fading in over the first 15% and out from there.
 */
const AIR_RING_CSS = `
@keyframes iso-pawn-air-ring {
    0% { transform: scale(0.8); opacity: 0; animation-timing-function: linear; }
    15% { opacity: 0.95; animation-timing-function: cubic-bezier(0.39, 0.575, 0.565, 1); }
    100% { transform: scale(1.15); opacity: 0; }
}
.iso-pawn__air-ring-line {
    transform-box: fill-box;
    transform-origin: center;
    animation: iso-pawn-air-ring ${AIR_RING_MS}ms both;
}
@media (prefers-reduced-motion: reduce) {
    .iso-pawn__air-ring-line { animation: none; opacity: 0; }
}
`;

const PawnAirRing: React.FC<{ ring: PawnAirRingSpot; onDone: () => void }> = ({ ring, onDone }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    // A footprint with corner radius = half its side is a circle (as IsoShadow's round one).
    const circle = (r: number) => flatPath(proj, { x: ring.x - r, y: ring.y - r, w: 2 * r, d: 2 * r, r }, ring.z);
    return (
        <g className="iso-pawn__air-ring" fill="none" stroke={palette.airRing} strokeLinecap="round">
            <style>{AIR_RING_CSS}</style>
            <path className="iso-pawn__air-ring-line iso-pawn__air-ring-line--inner" d={circle(INNER_R)} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            <path
                className="iso-pawn__air-ring-line iso-pawn__air-ring-line--outer"
                d={circle(OUTER_R)}
                strokeWidth={1.75}
                vectorEffect="non-scaling-stroke"
                style={{ animationDelay: `${OUTER_LAG_MS}ms` }}
                onAnimationEnd={onDone}
            />
        </g>
    );
};

export default PawnAirRing;

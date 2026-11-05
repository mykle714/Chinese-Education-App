import React, { useMemo, useRef } from "react";
import IsoSolid from "./IsoSolid";
import { prism } from "./geometry";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { useDriftGeometry, useDriftMotion } from "./cloudDriftMotion";
import type { CloudDrift } from "./useCloudDrifts";

/**
 * IsoCloud — one cloud drifting past the tower (docs/ISO_ART_FRAMEWORK.md § "IsoCloud").
 *
 * A cluster of low PILL prisms (a rounded rect whose radius is half its short side) — a
 * raised crown over a few base lobes — each painted with IsoSolid in the cloud material:
 * a white top and two shaded walls, the same three-tone rule as every other solid, so
 * it reads as a chunky toy cloud rather than a flat sticker. The puffs come pre-sorted
 * back-to-front (useCloudDrifts → orientPuffs), so the painter's order is just theirs.
 *
 * It is drawn ONCE at its starting position and slid by its own
 * requestAnimationFrame loop (cloudDriftMotion.ts → `useDriftMotion`): the projection is
 * affine, so translating by a projected world delta moves the drawing exactly as redrawing
 * it there would. It also fades in — a safety net only: every moving cloud starts off
 * screen (useCloudDrifts), so the fade is normally over before it comes into view.
 *
 * Its shadow is NOT drawn here: it falls on the floor and the ground, which sit elsewhere
 * in the draw order, so each surface draws an IsoCloudShadow for the same drift.
 *
 * Under prefers-reduced-motion it is drawn fully opaque where it starts and never moves.
 *
 * Mounted per drift by the caller (keyed on `drift.id`) and unmounted when the drift's
 * time is up, so it never needs to reset.
 */
interface IsoCloudProps {
    drift: CloudDrift;
}

const IsoCloud: React.FC<IsoCloudProps> = ({ drift }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const groupRef = useRef<SVGGElement>(null);
    const { ox, oy, dx, dy } = useDriftGeometry(proj, drift);
    const initialOpacity = useDriftMotion(groupRef, drift.durationMs, dx, dy);

    const puffs = useMemo(
        () =>
            drift.puffs.map((p) => {
                const rect = { x: ox + p.x, y: oy + p.y, w: p.w, d: p.d, r: Math.min(p.w, p.d) / 2 };
                return prism(proj, rect, drift.z + p.z, drift.z + p.z + p.h);
            }),
        [proj, drift, ox, oy]
    );

    return (
        <g className="iso-cloud" ref={groupRef} style={{ opacity: initialOpacity }}>
            {puffs.map((geometry, i) => (
                <IsoSolid key={i} geometry={geometry} material={palette.cloud} className="iso-cloud__puff" />
            ))}
        </g>
    );
};

export default IsoCloud;

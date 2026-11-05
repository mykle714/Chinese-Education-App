import React, { useId, useMemo, useRef } from "react";
import IsoShadow from "./IsoShadow";
import { flatPath, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { useDriftGeometry, useDriftMotion } from "./cloudDriftMotion";
import type { CloudDrift } from "./useCloudDrifts";

/**
 * IsoCloudShadow — a drifting cloud's shadow on ONE surface (docs/ISO_ART_FRAMEWORK.md
 * § "IsoCloud" → "Shadow").
 *
 * The union of the cloud's puff footprints, each slid along the light by the CLOUD skew
 * (light.ts → `cloudShadowFootprint`: the scene's one light direction, a much shorter
 * slide, so the shadow sits just off the point straight under its cloud and the two are on
 * screen together). Drawn by IsoShadow as a see-through ink glaze, so floor print and
 * decals stay readable under it, and slid along with the cloud by the same rAF loop
 * (cloudDriftMotion.ts).
 *
 * A surface with edges (the platform's floor) passes `clip`: the shadow is clipped to that
 * outline at the receiver's height, so the part past the edge does not hang in the air.
 * The ground passes none, and the platform slab drawn over it hides the part under it.
 *
 * Shadows land only on horizontal surfaces: the tower's visible walls face away from the
 * light, so under the one-light rule a cloud never shades them.
 */
interface IsoCloudShadowProps {
    drift: CloudDrift;
    receiver: IsoSurface;
    /** The receiving surface's outline, at `receiver.z`, to clip to. Undefined: unbounded. */
    clip?: WorldRect;
}

const IsoCloudShadow: React.FC<IsoCloudShadowProps> = ({ drift, receiver, clip }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const groupRef = useRef<SVGGElement>(null);
    const clipId = `iso-cloud-shadow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const { ox, oy, dx, dy } = useDriftGeometry(proj, drift);
    const initialOpacity = useDriftMotion(groupRef, drift.durationMs, dx, dy);

    // Each puff's underside, at the drift's starting position.
    const cloudPuffs = useMemo(
        () =>
            drift.puffs.map((p) => ({
                footprint: { x: ox + p.x, y: oy + p.y, w: p.w, d: p.d, r: Math.min(p.w, p.d) / 2 },
                casterZ: drift.z + p.z,
            })),
        [drift, ox, oy]
    );
    const clipPath = useMemo(() => (clip ? flatPath(proj, clip, receiver.z) : null), [proj, clip, receiver.z]);

    // The clip stays still while the inner group slides: it belongs to the surface, not the cloud.
    return (
        <g className="iso-cloud-shadow" clipPath={clipPath ? `url(#${clipId})` : undefined} pointerEvents="none">
            {clipPath && (
                <clipPath id={clipId}>
                    <path d={clipPath} />
                </clipPath>
            )}
            <g className="iso-cloud-shadow__drift" ref={groupRef} style={{ opacity: initialOpacity }}>
                <IsoShadow cloudPuffs={cloudPuffs} receiver={receiver} glaze={palette.ink} className="iso-cloud-shadow__shape" />
            </g>
        </g>
    );
};

export default IsoCloudShadow;

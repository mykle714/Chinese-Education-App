import React from "react";
import { convexHull, flatPath, toPath, type Pt3, type WorldRect } from "./geometry";
import { shadowFootprint, shadowSlide, shadowTone, type IsoSurface } from "./light";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoShadow — the ONLY way a shadow is drawn in the iso framework
 * (docs/ISO_ART_FRAMEWORK.md § "Light and shadows").
 *
 * Given what casts it (a footprint and the height of its underside) and what it falls
 * on, it applies light.ts's one rule: slide the footprint along the light, lay it flat
 * on the receiver, and paint it in the receiver's colour one shadow step darker. Hard
 * edged, never blurred — the style never blurs.
 *
 * A caster that is NOT level (a platform swung open on its hinge) passes `solid` instead
 * of a footprint: its vertices in world space. Each vertex slides by the same rule for its
 * own height, and the shadow is the hull of where they land — the same rule, applied per
 * point, which reduces to the footprint case when every vertex is at one height.
 *
 * Every object that stands on something renders one of these first, so the object
 * itself covers the part of its shadow that would be hidden.
 */
type IsoShadowProps = {
    /** The surface the shadow falls on. */
    receiver: IsoSurface;
    className?: string;
} & (
    | {
          /** The caster's underside outline, in world units. */
          footprint: WorldRect;
          /** World z of the caster's underside. */
          casterZ: number;
          solid?: never;
      }
    | {
          /** A convex caster's vertices (any orientation), in world units. */
          solid: Pt3[];
          footprint?: never;
          casterZ?: never;
      }
);

const IsoShadow: React.FC<IsoShadowProps> = (props) => {
    const proj = useIsoProjector();
    const { receiver, className } = props;
    let d: string;
    if (props.solid) {
        const landed = props.solid.map((p) => {
            const slide = shadowSlide(p.z, receiver.z);
            return proj.project(p.x + slide.x, p.y + slide.y, receiver.z);
        });
        d = toPath(convexHull(landed));
    } else {
        d = flatPath(proj, shadowFootprint(props.footprint, props.casterZ, receiver), receiver.z);
    }
    return <path className={className ?? "iso-shadow"} d={d} fill={shadowTone(receiver.color)} />;
};

export default IsoShadow;

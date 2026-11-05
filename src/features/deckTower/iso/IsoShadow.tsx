import React from "react";
import { convexHull, flatPath, toPath, type Pt3, type WorldRect } from "./geometry";
import { SHADOW_GLAZE_OPACITY, cloudShadowFootprint, shadowFootprint, shadowSlide, shadowSpread, shadowTone, type IsoSurface } from "./light";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoShadow — the ONLY way a shadow is drawn in the iso framework
 * (docs/ISO_ART_FRAMEWORK.md § "Light and shadows").
 *
 * Given what casts it (a footprint and the height of its underside) and what it falls
 * on, it applies light.ts's one rule: slide the footprint along the light, lay it flat
 * on the receiver stretched on its front edges (light.ts → `shadowSpread`), and paint it in the
 * receiver's colour one shadow step darker. Hard edged, never blurred — the style never
 * blurs.
 *
 * A caster that is NOT level (a platform swung open on its hinge) passes `solid` instead
 * of a footprint: its vertices in world space. Each vertex slides by the same rule for its
 * own height, and the shadow is the hull of where they land — the same rule, applied per
 * point, which reduces to the footprint case when every vertex is at one height.
 *
 * A CLOUD passes `cloudPuffs` instead: one footprint per puff, each at its own underside
 * height, slid by the cloud skew (light.ts → `cloudShadowFootprint`: the same direction, a
 * much shorter slide). The puffs are drawn as ONE path — every outline is projected with
 * the same winding, so under the nonzero fill rule their overlaps fill once and a glaze
 * does not double-darken where two puffs cross.
 *
 * Every object that stands on something renders one of these first, so the object
 * itself covers the part of its shadow that would be hidden.
 */
type IsoShadowProps = {
    /** The surface the shadow falls on. */
    receiver: IsoSurface;
    className?: string;
    /**
     * Paint it as a see-through glaze of this colour rather than the opaque tone, for a
     * receiver with something printed on it (the top card's label and count). The pawn's
     * floor shadow keeps the decal copy instead: a floor decal has a shaded version to draw.
     */
    glaze?: string;
} & (
    | {
          /** The caster's underside outline, in world units. */
          footprint: WorldRect;
          /** World z of the caster's underside. */
          casterZ: number;
          /**
           * The caster's own height. Optional: a very short caster passes it so its contact
           * sliver shrinks to match (light.ts → `contactLift`); without it, the full sliver.
           */
          casterHeight?: number;
          solid?: never;
          cloudPuffs?: never;
      }
    | {
          /** A convex caster's vertices (any orientation), in world units. */
          solid: Pt3[];
          footprint?: never;
          casterZ?: never;
          cloudPuffs?: never;
      }
    | {
          /** A cloud's puffs: each one's underside outline and the world z of that underside. */
          cloudPuffs: { footprint: WorldRect; casterZ: number }[];
          footprint?: never;
          casterZ?: never;
          solid?: never;
      }
);

const IsoShadow: React.FC<IsoShadowProps> = (props) => {
    const proj = useIsoProjector();
    const { receiver, className, glaze } = props;
    let d: string;
    if (props.solid) {
        // Slide each vertex for its own height, then stretch the landing's front edges by
        // the same spread a footprint gets (light.ts → `shadowSpread`): every point past the
        // landing's centre on +x is pushed `spread.x` further along x, and likewise on +y.
        // For a level box that is exactly the footprint case's stretched rect (corner
        // rounding aside), so a door swinging shut hands over without a jump.
        const slid = props.solid.map((p) => {
            const slide = shadowSlide(p.z, receiver.z);
            return { x: p.x + slide.x, y: p.y + slide.y };
        });
        const cx = slid.reduce((s, p) => s + p.x, 0) / slid.length;
        const cy = slid.reduce((s, p) => s + p.y, 0) / slid.length;
        const spread = shadowSpread();
        const landed = slid.map((p) =>
            proj.project(p.x > cx ? p.x + spread.x : p.x, p.y > cy ? p.y + spread.y : p.y, receiver.z)
        );
        d = toPath(convexHull(landed));
    } else if (props.cloudPuffs) {
        d = props.cloudPuffs.map((p) => flatPath(proj, cloudShadowFootprint(p.footprint, p.casterZ, receiver), receiver.z)).join("");
    } else {
        d = flatPath(proj, shadowFootprint(props.footprint, props.casterZ, receiver, props.casterHeight), receiver.z);
    }
    return (
        <path
            className={className ?? "iso-shadow"}
            d={d}
            fill={glaze ?? shadowTone(receiver.color)}
            fillOpacity={glaze ? SHADOW_GLAZE_OPACITY : undefined}
        />
    );
};

export default IsoShadow;

import React, { useMemo, useRef } from "react";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { useDriftGeometry, useDriftMotion } from "./cloudDriftMotion";
import { BALLOON_RADIUS, type CloudDrift } from "./useCloudDrifts";

/**
 * IsoBalloon — the rare red balloon that drifts by in place of a cloud
 * (docs/ISO_ART_FRAMEWORK.md § "IsoBalloon").
 *
 * A drift of `kind: "balloon"` (useCloudDrifts → `BALLOON_CHANCE`, 1 in 100). It moves
 * exactly as a cloud does (cloudDriftMotion.ts: drawn once, slid by its own rAF loop) and
 * casts its shadow the same way (IsoCloudShadow reads its one bounding-box puff), but it
 * flies lower, in the sky's `balloonBand`.
 *
 * Shape. Like the pawn's head, the body is a TRUE ROUND solid rather than an extruded
 * rounded rect — the kit's other exception to rule 1 (a sphere reads the same from every
 * angle). Its outline is centred on the projected sphere centre and sized by
 * `facingScaleAt`, stretched a little taller than wide (`BODY_STRETCH`) so it reads as a
 * balloon, not a ball. It is kept as FLAT as the rest of the kit (2026-11-10: a stepped
 * three-ring version with a glint read as more depth than any other object has): the
 * lit `ISO.balloon.top` tone, with one thin crescent of its `left` tone showing on the
 * lower right, away from the upper-left light — the single shade step a solid's wall
 * gets. No glint, no gradient. Below it: a little knot (the same shade tone) and a thin
 * `ink` string with a gentle S, hanging `STRING_LENGTH` world units.
 *
 * Under prefers-reduced-motion it is drawn fully opaque where it starts and never moves
 * (a parked drift, like a cloud's).
 *
 * Mounted per drift by SkyTraffic.tsx → `SkyTrafficLayer` (keyed on `drift.id`) and
 * unmounted when the drift's time is up.
 */
interface IsoBalloonProps {
    drift: CloudDrift;
}

/** The body's height over its width. */
const BODY_STRETCH = 1.14;
/** How far the string hangs below the knot, in world units. */
const STRING_LENGTH = 3;
/**
 * The lit face over the shaded body, as fractions of the body's radii: its scale, and how
 * far its centre is stepped toward the upper left. Chosen so it stays inside the body
 * (step·√2 + scale ≤ 1), leaving a crescent of shade on the lower right.
 */
const LIT_FACE = { scale: 0.9, step: 0.07 };

const IsoBalloon: React.FC<IsoBalloonProps> = ({ drift }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const groupRef = useRef<SVGGElement>(null);
    const { ox, oy, dx, dy } = useDriftGeometry(proj, drift);
    const initialOpacity = useDriftMotion(groupRef, drift.durationMs, dx, dy);

    const shape = useMemo(() => {
        // The sphere sits on the drift's origin corner of its 2r bounding box (the puff the
        // shadow reads), its bottom at `drift.z`.
        const wx = ox + BALLOON_RADIUS;
        const wy = oy + BALLOON_RADIUS;
        const wz = drift.z + BALLOON_RADIUS;
        const centre = proj.project(wx, wy, wz);
        const rx = BALLOON_RADIUS * proj.facingScaleAt(wx, wy, wz);
        const ry = rx * BODY_STRETCH;
        // The stretch grows UPWARD: the bottom stays where the sphere's would be.
        const bottom = centre.y + rx;
        const cx = centre.x;
        const cy = bottom - ry;
        // The knot: a small wedge under the body, its point tucked into it.
        const knotW = rx * 0.14;
        const knotH = rx * 0.18;
        const knot = `M ${cx - knotW} ${bottom + knotH} L ${cx + knotW} ${bottom + knotH} L ${cx} ${bottom - rx * 0.04} Z`;
        // The string: from the knot straight down in world z, with a lazy S across it.
        const end = proj.project(wx, wy, drift.z - STRING_LENGTH);
        const top = bottom + knotH;
        const sway = rx * 0.3;
        const string = `M ${cx} ${top} C ${cx + sway} ${top + (end.y - top) * 0.35}, ${end.x - sway} ${top + (end.y - top) * 0.65}, ${end.x} ${end.y}`;
        return {
            body: { cx, cy, rx, ry },
            lit: { cx: cx - LIT_FACE.step * rx, cy: cy - LIT_FACE.step * ry, rx: rx * LIT_FACE.scale, ry: ry * LIT_FACE.scale },
            knot,
            string,
            stringWidth: rx * 0.07,
        };
    }, [proj, drift.z, ox, oy]);

    const m = palette.balloon;
    return (
        <g className="iso-balloon" ref={groupRef} style={{ opacity: initialOpacity }}>
            {/* String first: the knot and body sit over its top end. */}
            <path
                className="iso-balloon__string"
                d={shape.string}
                fill="none"
                stroke={palette.ink}
                strokeOpacity={0.55}
                strokeWidth={shape.stringWidth}
                strokeLinecap="round"
            />
            <path className="iso-balloon__knot" d={shape.knot} fill={m.left} />
            <ellipse className="iso-balloon__body" {...shape.body} fill={m.left} />
            <ellipse className="iso-balloon__body-lit" {...shape.lit} fill={m.top} />
        </g>
    );
};

export default IsoBalloon;

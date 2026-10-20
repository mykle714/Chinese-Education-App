import React, { useId, useMemo } from "react";
import IsoShadow from "./IsoShadow";
import IsoSolid from "./IsoSolid";
import { convexHull, flatPath, insetRect, prism, projectOutline, roundedRectWorld, toPath, type WorldRect } from "./geometry";
import { LEVER_HOLE, leverFootprint } from "./leverGeometry";
import type { IsoSurface } from "./light";
import { ISO, mixHex, shadeHex } from "./palette";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoLever — a floor lever standing in a hatch (docs/ISO_ART_FRAMEWORK.md § "IsoLever").
 *
 * A cream base box, an ink stick pivoting on the base's top centre in the world x–z plane,
 * and a plain red ball on its tip. It lives in a square HATCH in the floor: two
 * trapdoor flaps hinged on the hole's two x edges, and a LIFT — a floor-coloured slab
 * filling the hole that the lever stands on. Risen, the lift's top is flush with the
 * floor, so the floor under a standing lever is solid and unbroken (no seam; the hanging
 * flaps hidden beneath it); the lift rides down with the lever when it sinks. Three numbers drive it, all animated by the caller
 * (the Deck Tower's `useLeverMotion`):
 *
 *   pull   0 = at rest, the stick leaning back (tip toward world −x, screen up-left);
 *          1 = pulled toward the viewer (tip toward +x, screen down-right). May overshoot.
 *   sink   0 = risen, the lift flush with the floor; 1 = sunk wholly below it. Clamped to
 *          [0, 1] — the lift never rises proud of the floor.
 *   hatch  0 = both flaps shut flush with the floor (the hatch reads as a seamed floor
 *          tile); 1 = both hanging straight down inside the hole.
 *
 * The parts of the lever below the floor are hidden by a clip: the hole's opening swept
 * straight up the screen. Anything under the floor projects BELOW the opening's outline
 * (world −z is screen +y), so it is cut off, while what is seen through the open hole and
 * everything standing above the floor stays visible. The clip applies only while the
 * lever is partly sunk, and the stick stands upright while it passes through the hole —
 * standing, the leaning ball overhangs the hole's column and would otherwise be cut.
 *
 * Draw it as an obstacle among the platform's standing things (it occludes pawns behind it).
 */

/** The base box: footprint side and height. */
const BASE_SIDE = 0.78;
const BASE_HEIGHT = 0.3;
/** The stick, from the base's top centre to the ball's centre. */
const STICK_LENGTH = 1.2;
const STICK_WIDTH = 0.2;
const KNOB_RADIUS = 0.36;
/** The stick's lean at rest and fully pulled, in radians from vertical. */
const REST_LEAN = -0.6;
const PULLED_LEAN = 0.6;
/** The lift: a floor-coloured slab filling the hole, the lever standing on it. */
const LIFT_THICKNESS = 0.25;
/** How far the lever drops when fully sunk: the lift, its whole height and the ball. */
const SINK_DEPTH = LIFT_THICKNESS + BASE_HEIGHT + STICK_LENGTH + KNOB_RADIUS + 0.2;

interface IsoLeverProps {
    /** The hatch's centre on the floor. */
    at: { x: number; y: number };
    /** The floor it stands in. */
    surface: IsoSurface;
    pull: number;
    sink: number;
    hatch: number;
}

const IsoLever: React.FC<IsoLeverProps> = ({ at, surface, pull, sink, hatch }) => {
    const proj = useIsoProjector();
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const clipId = `iso-lever-clip-${uid}`;
    const holeClipId = `iso-lever-hole-${uid}`;
    const floorZ = surface.z;
    const hole = useMemo(() => leverFootprint(at), [at]);

    // The opening swept up the screen: the visible region for the sinking lever.
    const sweep = useMemo(() => {
        const outline = projectOutline(proj, roundedRectWorld(hole), floorZ);
        return toPath(convexHull([...outline, ...outline.map((p) => ({ x: p.x, y: p.y - 4000 }))]));
    }, [proj, hole, floorZ]);

    // The lift's top is flush with the floor at sink 0 — the lever stands on solid floor.
    const drop = Math.min(1, Math.max(0, sink)) * SINK_DEPTH;
    const liftTop = floorZ - drop;
    const liftGeometry = prism(proj, hole, liftTop - LIFT_THICKNESS, liftTop);
    const liftMaterial = { top: surface.color, left: shadeHex(surface.color, 0.1), right: shadeHex(surface.color, 0.18) };
    const baseBottom = liftTop;
    const baseTop = baseBottom + BASE_HEIGHT;
    const base: WorldRect = { x: at.x - BASE_SIDE / 2, y: at.y - BASE_SIDE / 2, w: BASE_SIDE, d: BASE_SIDE, r: 0.12 };
    const baseGeometry = prism(proj, base, baseBottom, baseTop);

    // The stick leans out past the hole's column (the ball overhangs it by ~0.6 units), so
    // it stands up straight while passing through the hole: fully upright from a third of
    // the way down, so a sinking or rising ball stays inside the clip's column.
    const upright = Math.min(1, Math.max(0, sink * 3));
    const lean = (REST_LEAN + (PULLED_LEAN - REST_LEAN) * pull) * (1 - upright);
    const pivot = proj.project(at.x, at.y, baseTop);
    const tip = proj.project(at.x + Math.sin(lean) * STICK_LENGTH, at.y, baseTop + Math.cos(lean) * STICK_LENGTH);

    // A flap hinged on the hole's x edge `hingeX`, its free edge reaching `dir` (±1) toward
    // the middle. Swung by `angle` from flat (0) to hanging (π/2).
    const flapAngle = (Math.min(1, Math.max(0, hatch)) * Math.PI) / 2;
    const flap = (hingeX: number, dir: 1 | -1) => {
        const half = LEVER_HOLE / 2;
        const freeX = hingeX + dir * half * Math.cos(flapAngle);
        const freeZ = floorZ - half * Math.sin(flapAngle);
        const y0 = hole.y;
        const y1 = hole.y + hole.d;
        return toPath([
            proj.project(hingeX, y0, floorZ),
            proj.project(hingeX, y1, floorZ),
            proj.project(freeX, y1, freeZ),
            proj.project(freeX, y0, freeZ),
        ]);
    };
    // Flat, a flap is the floor; hanging, it turns its underside to the light — darker.
    const flapFill = mixHex(surface.color, shadeHex(surface.color, 0.22), Math.sin(flapAngle));
    const seam = shadeHex(surface.color, 0.12);
    const holeFill = shadeHex(surface.color, 0.4);
    const standing = sink < 0.02;

    return (
        <g className="iso-lever">
            <defs>
                <clipPath id={clipId}>
                    <path d={sweep} />
                </clipPath>
                {/* A flap is never above the floor, so it shows only through the opening:
                    the near flap hanging down is hidden under the floor's front edge. */}
                <clipPath id={holeClipId}>
                    <path d={flatPath(proj, hole, floorZ)} />
                </clipPath>
            </defs>
            {/* The open hole (unseen under shut flaps). */}
            {hatch > 0.01 && <path className="iso-lever__hole" d={flatPath(proj, hole, floorZ)} fill={holeFill} />}
            {/* The far flap (hinged on the back x edge) hangs behind the lever. */}
            <path className="iso-lever__flap iso-lever__flap--far" clipPath={`url(#${holeClipId})`} d={flap(hole.x, 1)} fill={flapFill} stroke={seam} strokeWidth={1} strokeLinejoin="round" />
            {/* The near flap (hinged on the front x edge) hangs against the hole's near wall, hidden under the floor's front edge; mid-swing it only moves while the lift is down. */}
            <path className="iso-lever__flap iso-lever__flap--near" clipPath={`url(#${holeClipId})`} d={flap(hole.x + hole.w, -1)} fill={flapFill} stroke={seam} strokeWidth={1} strokeLinejoin="round" />
            {/* The lift: at rest its top IS the floor — no seam, it melts into the platform —
                covering the hanging flaps. Moving, it is below the floor, so clipped. Flush,
                only its top is drawn, unclipped and a hair larger than the hole, in the
                floor's own colour, so no anti-aliased edge of wall, hole or clip shows a seam. */}
            {sink > 0 && sink < 0.999 && (
                <g className="iso-lever__lift-group" clipPath={`url(#${clipId})`}>
                    <IsoSolid className="iso-lever__lift" geometry={liftGeometry} material={liftMaterial} />
                </g>
            )}
            {sink <= 0 && <path className="iso-lever__lift-top" d={flatPath(proj, insetRect(hole, -0.03), floorZ)} fill={surface.color} />}
            {sink < 0.999 && (
                // Clipped only while it is partly below the floor: standing, the leaning ball
                // reaches outside the hole's column and must not be cut.
                <g className="iso-lever__body" clipPath={sink > 0.001 ? `url(#${clipId})` : undefined}>
                    {standing && <IsoShadow footprint={base} casterZ={floorZ} receiver={surface} />}
                    <IsoSolid className="iso-lever__base" geometry={baseGeometry} material={ISO.leverBase} />
                    {/* The slot the stick pivots in, cut into the base's top. */}
                    <path
                        className="iso-lever__slot"
                        d={toPath([
                            proj.project(at.x - BASE_SIDE * 0.3, at.y - STICK_WIDTH * 0.9, baseTop),
                            proj.project(at.x + BASE_SIDE * 0.3, at.y - STICK_WIDTH * 0.9, baseTop),
                            proj.project(at.x + BASE_SIDE * 0.3, at.y + STICK_WIDTH * 0.9, baseTop),
                            proj.project(at.x - BASE_SIDE * 0.3, at.y + STICK_WIDTH * 0.9, baseTop),
                        ])}
                        fill={ISO.ink}
                        opacity={0.55}
                    />
                    <line
                        className="iso-lever__stick"
                        x1={pivot.x}
                        y1={pivot.y}
                        x2={tip.x}
                        y2={tip.y}
                        stroke={ISO.ink}
                        strokeWidth={STICK_WIDTH * proj.unit}
                        strokeLinecap="round"
                    />
                    {/* The knob: a plain red ball. */}
                    <circle className="iso-lever__knob" cx={tip.x} cy={tip.y} r={KNOB_RADIUS * proj.unit} fill={ISO.leverKnob} />
                </g>
            )}
        </g>
    );
};

export default IsoLever;

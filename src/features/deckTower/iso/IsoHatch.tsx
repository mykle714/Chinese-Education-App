import React, { useId, useMemo } from "react";
import IsoShadow from "./IsoShadow";
import IsoSolid from "./IsoSolid";
import { flatPath, insetRect, prism, toPath, type WorldRect } from "./geometry";
import { hatchFootprint, openingSweepPath } from "./hatchGeometry";
import type { IsoSurface } from "./light";
import { floorSlabMaterial, holeTone, mixHex, shadeHex, type Material } from "./palette";
import type { PawnEntranceFrame } from "./pawnEntrances";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoHatch — a rectangular trapdoor in a floor that a fixture rises out of and sinks back into
 * (docs/ISO_ART_FRAMEWORK.md § "IsoHatch"). It draws the hatch and frames the fixture; the
 * fixture's own body is the caller's `children`. Used by IsoLever (the focus lever) and
 * IsoModeSwitch (a mode switch; currently unused).
 *
 * Two trapdoor flaps hinged on the hole's two x edges, and a LIFT — a floor-coloured slab
 * filling the hole that the fixture stands on. Risen, the lift's top is flush with the
 * floor, so the floor under a standing fixture is solid and unbroken (no seam; the hanging
 * flaps hidden beneath it); the lift rides down with the fixture when it sinks. Two numbers
 * drive it, both animated by the caller (the Deck Tower's `usePopUpMotion`):
 *
 *   sink   0 = risen, the lift flush with the floor; 1 = sunk `sinkDepth` below it, the
 *          fixture wholly out of sight. Clamped to [0, 1] — the lift never rises proud of
 *          the floor.
 *   hatch  0 = both flaps shut flush with the floor; 1 = both hanging straight down inside
 *          the hole. At exactly 0 the hatch draws NOTHING — no flaps, no seams — so a
 *          sunk fixture leaves the floor unbroken; the flaps exist only while they swing (a
 *          shut's spring overshoots below 0, which still draws them, flat).
 *
 * `children(standZ)` draws the fixture standing at world z `standZ` (the lift's top).
 *
 * `air` poses a STANDING fixture in mid-entrance (a pawn entrance's frame, pawnEntrances.ts —
 * the Deck Tower drops it from the sky on FALL_FROM_SKY): its body is lifted `hop` units
 * and squashed / stretched about its feet, and its shadow (`shadowFootprint`, cast on the
 * floor) stays under the landing spot, scaled and faded by the frame like the pawn's. The
 * hatch is not drawn at all meanwhile (its floor may still be moving under it), so it lands
 * on plain floor.
 *
 * The parts of the fixture below the floor are hidden by a clip: the hole's opening swept
 * straight up the screen (hatchGeometry.ts → `openingSweepPath`). Anything under the floor projects BELOW the opening's outline
 * (world −z is screen +y), so it is cut off, while what is seen through the open hole and
 * everything standing above the floor stays visible. The clip applies only while the
 * fixture is partly sunk — standing, a fixture may overhang the hole's column (the lever's
 * leaning ball does) and must not be cut. A fixture that overhangs must pull itself in
 * while it passes through the hole (IsoLever stands its stick upright).
 *
 * Class names a scene may target (the Deck Tower hides the hatch and the shadow of a
 * fixture falling away with its floor): `iso-hatch__hole`, `iso-hatch__flap`,
 * `iso-hatch__lift-top`, `iso-hatch__shadow`.
 */

/** The lift's slab under the fixture. */
const LIFT_THICKNESS = 0.25;

interface IsoHatchProps {
    /** The hatch's centre on the floor. */
    at: { x: number; y: number };
    /** The opening's extent across world x (hatchGeometry.ts). */
    w: number;
    /** Its extent along world y; omitted = square (`w`). */
    d?: number;
    /** The floor it is set in. */
    surface: IsoSurface;
    /** The body under the floor (palette.ts → `insideMaterial`): the hole and the lift's walls take its tones. */
    inside?: Material;
    sink: number;
    hatch: number;
    /** How far the fixture's feet drop at sink 1: enough to take its whole height out of sight. */
    sinkDepth: number;
    /** The fixture's footprint, for its contact shadow while it stands. */
    shadowFootprint: WorldRect;
    /** A standing fixture's mid-entrance pose (lifted, squashed); omitted = resting on its lift. */
    air?: PawnEntranceFrame;
    /** The root group's class (the fixture's own name). */
    className?: string;
    /** The fixture, standing at world z `standZ`. */
    children: (standZ: number) => React.ReactNode;
}

const IsoHatch: React.FC<IsoHatchProps> = ({ at, w, d = w, surface, inside, sink, hatch, sinkDepth, shadowFootprint, air, className, children }) => {
    const proj = useIsoProjector();
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const clipId = `iso-hatch-clip-${uid}`;
    const holeClipId = `iso-hatch-hole-${uid}`;
    const floorZ = surface.z;
    const hole = useMemo(() => hatchFootprint(at, w, d), [at, w, d]);

    // The opening swept up the screen: the visible region for the sinking fixture.
    const sweep = useMemo(() => openingSweepPath(proj, hole, floorZ), [proj, hole, floorZ]);

    // The lift's top is flush with the floor at sink 0 — the fixture stands on solid floor.
    const drop = Math.min(1, Math.max(0, sink)) * (sinkDepth + LIFT_THICKNESS);
    const liftTop = floorZ - drop;
    const liftGeometry = prism(proj, hole, liftTop - LIFT_THICKNESS, liftTop);
    const liftMaterial = floorSlabMaterial(surface.color, inside);

    // A flap hinged on the hole's x edge `hingeX`, its free edge reaching `dir` (±1) toward
    // the middle. Swung by `angle` from flat (0) to hanging (π/2).
    const flapAngle = (Math.min(1, Math.max(0, hatch)) * Math.PI) / 2;
    const flap = (hingeX: number, dir: 1 | -1) => {
        const half = w / 2;
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
    const holeFill = holeTone(surface.color, inside);
    const standing = sink < 0.02;
    // Flaps resting shut are just floor: draw them only while the hatch is (or springs) open.
    // Mid-entrance (`air`), no part of the hatch is drawn: the floor it sits in may still be
    // swinging (the Deck Tower's trap door shuts as the fixture lands), and a hatch drawn at
    // the shut floor's height would float there as a pale patch. It lands on plain floor.
    const hatchShown = !air;
    const flapsShown = hatchShown && hatch !== 0;
    // The entrance pose: lifted `hop` units (straight up the screen) and scaled about the feet.
    const feet = proj.project(at.x, at.y, floorZ);
    const airTransform = air
        ? `translate(${feet.x.toFixed(2)} ${(feet.y - air.hop * proj.unit).toFixed(2)}) scale(${air.sx.toFixed(4)} ${air.sy.toFixed(4)}) translate(${(-feet.x).toFixed(2)} ${(-feet.y).toFixed(2)})`
        : undefined;
    // Its floor shadow stays under the landing spot, shrunk and faded while it is high.
    const shadowStyle: React.CSSProperties | undefined = air
        ? { transformBox: "fill-box", transformOrigin: "center", transform: `scale(${air.shadowScale.toFixed(4)})`, opacity: air.shadowOpacity }
        : undefined;

    return (
        <g className={className ? `iso-hatch ${className}` : "iso-hatch"}>
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
            {hatchShown && hatch > 0.01 && <path className="iso-hatch__hole" d={flatPath(proj, hole, floorZ)} fill={holeFill} />}
            {flapsShown && (
                <>
                    {/* The far flap (hinged on the back x edge) hangs behind the fixture. */}
                    <path className="iso-hatch__flap iso-hatch__flap--far" clipPath={`url(#${holeClipId})`} d={flap(hole.x, 1)} fill={flapFill} stroke={seam} strokeWidth={1} strokeLinejoin="round" />
                    {/* The near flap (hinged on the front x edge) hangs against the hole's near wall, hidden under the floor's front edge; mid-swing it only moves while the lift is down. */}
                    <path className="iso-hatch__flap iso-hatch__flap--near" clipPath={`url(#${holeClipId})`} d={flap(hole.x + hole.w, -1)} fill={flapFill} stroke={seam} strokeWidth={1} strokeLinejoin="round" />
                </>
            )}
            {/* The lift: at rest its top IS the floor — no seam, it melts into the platform —
                covering the hanging flaps. Moving, it is below the floor, so clipped. Flush,
                only its top is drawn, unclipped and a hair larger than the hole, in the
                floor's own colour, so no anti-aliased edge of wall, hole or clip shows a seam. */}
            {sink > 0 && sink < 0.999 && (
                <g className="iso-hatch__lift-group" clipPath={`url(#${clipId})`}>
                    <IsoSolid className="iso-hatch__lift" geometry={liftGeometry} material={liftMaterial} />
                </g>
            )}
            {hatchShown && sink <= 0 && <path className="iso-hatch__lift-top" d={flatPath(proj, insetRect(hole, -0.03), floorZ)} fill={surface.color} />}
            {sink < 0.999 && (
                <g className="iso-hatch__body" clipPath={sink > 0.001 ? `url(#${clipId})` : undefined}>
                    {standing && (
                        <g className="iso-hatch__shadow-group" style={shadowStyle}>
                            <IsoShadow footprint={shadowFootprint} casterZ={floorZ} receiver={surface} className="iso-hatch__shadow" />
                        </g>
                    )}
                    <g className="iso-hatch__pose" transform={airTransform}>
                        {children(liftTop)}
                    </g>
                </g>
            )}
        </g>
    );
};

export default IsoHatch;

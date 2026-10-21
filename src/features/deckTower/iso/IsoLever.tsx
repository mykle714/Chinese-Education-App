import React from "react";
import IsoHatch from "./IsoHatch";
import IsoSolid from "./IsoSolid";
import { prism, toPath, type WorldRect } from "./geometry";
import { LEVER_HOLE } from "./hatchGeometry";
import type { IsoSurface } from "./light";
import { ISO } from "./palette";
import type { PawnEntranceFrame } from "./pawnEntrances";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoLever — a floor lever standing in a hatch (docs/ISO_ART_FRAMEWORK.md § "IsoLever").
 *
 * A cream base box, an ink stick pivoting on the base's top centre in the world x–z plane,
 * and a plain ball on its tip (red by default; `knob` recolours it per world). It lives in an IsoHatch — the trapdoor flaps, the lift it
 * stands on, the clip that hides it below the floor and the mid-entrance `air` pose are all
 * the hatch's. Three numbers drive it, all animated by the caller (the Deck Tower's
 * `useLeverMotion`):
 *
 *   pull   0 = at rest, the stick leaning back (tip toward world −x, screen up-left);
 *          1 = pulled toward the viewer (tip toward +x, screen down-right). May overshoot.
 *   sink   IsoHatch `sink`: 0 = risen, 1 = sunk wholly below the floor.
 *   hatch  IsoHatch `hatch`: 0 = flaps shut (drawing nothing), 1 = hanging open.
 *
 * Standing, the leaning ball overhangs the hole's column, which the hatch's clip would cut
 * while the lever is partly sunk — so the stick stands upright while it passes through.
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
/** How far the lever drops when fully sunk: its whole height and the ball. */
const SINK_DEPTH = BASE_HEIGHT + STICK_LENGTH + KNOB_RADIUS + 0.2;

interface IsoLeverProps {
    /** The hatch's centre on the floor. */
    at: { x: number; y: number };
    /** The floor it stands in. */
    surface: IsoSurface;
    pull: number;
    sink: number;
    hatch: number;
    /** A standing lever's mid-entrance pose (lifted, squashed); omitted = resting on its lift. */
    air?: PawnEntranceFrame;
    /** The ball's colour; omitted = `ISO.leverKnob` (red). A world whose sky is red passes a contrasting one. */
    knob?: string;
}

const IsoLever: React.FC<IsoLeverProps> = ({ at, surface, pull, sink, hatch, air, knob = ISO.leverKnob }) => {
    const proj = useIsoProjector();
    const base: WorldRect = { x: at.x - BASE_SIDE / 2, y: at.y - BASE_SIDE / 2, w: BASE_SIDE, d: BASE_SIDE, r: 0.12 };

    // The stick leans out past the hole's column (the ball overhangs it by ~0.6 units), so
    // it stands up straight while passing through the hole: fully upright from a third of
    // the way down, so a sinking or rising ball stays inside the clip's column.
    const upright = Math.min(1, Math.max(0, sink * 3));
    const lean = (REST_LEAN + (PULLED_LEAN - REST_LEAN) * pull) * (1 - upright);

    return (
        <IsoHatch
            className="iso-lever"
            at={at}
            w={LEVER_HOLE}
            surface={surface}
            sink={sink}
            hatch={hatch}
            sinkDepth={SINK_DEPTH}
            shadowFootprint={base}
            air={air}
        >
            {(standZ) => {
                const baseTop = standZ + BASE_HEIGHT;
                const pivot = proj.project(at.x, at.y, baseTop);
                const tip = proj.project(at.x + Math.sin(lean) * STICK_LENGTH, at.y, baseTop + Math.cos(lean) * STICK_LENGTH);
                return (
                    <>
                        <IsoSolid className="iso-lever__base" geometry={prism(proj, base, standZ, baseTop)} material={ISO.leverBase} />
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
                        {/* The knob: a plain ball in the world's knob colour. */}
                        <circle className="iso-lever__knob" cx={tip.x} cy={tip.y} r={KNOB_RADIUS * proj.unit} fill={knob} />
                    </>
                );
            }}
        </IsoHatch>
    );
};

export default IsoLever;

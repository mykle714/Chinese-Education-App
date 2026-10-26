import React, { useId, useMemo } from "react";
import IsoSolid from "./IsoSolid";
import { flatPath, prism, type WorldRect } from "./geometry";
import { openingSweepPath } from "./hatchGeometry";
import type { IsoSurface } from "./light";
import { floorSlabMaterial, holeTone, type Material } from "./palette";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoFloorRecess — a hole in a floor, cut to the shape of something that sinks into it, with
 * a PLUG in the hole whose top the caller moves (docs/ISO_ART_FRAMEWORK.md § "IsoFloorRecess").
 * The Deck Tower uses it to sink the floor plate out of sight at the start of a study dive and
 * fill the hole back in with floor (docs/DECK_TOWER.md § "Studying the tower" → "The floor
 * fixtures").
 *
 * Unlike IsoHatch it has no trapdoor flaps and no fixed lift: the opening is the plug's own
 * footprint, and the plug is whatever the caller draws in `children(standZ)` — the fixture
 * itself (a raised IsoFloorLabel standing at `standZ`) or, with `floorPlug`, a solid block of
 * floor whose top IS `standZ`. Swapping one plug for the other while both sit at the same
 * depth is invisible, so a fixture can go down and floor come up in its place with nothing
 * standing on it ever jumping (a pawn riding it stays on the same, continuous height).
 *
 *   plugTop  the plug's top, in world units above the floor (≤ 0 while sunk). The hole's dark
 *            and the below-floor clip are drawn whenever the plug's base is under the floor.
 *
 * Draw it where the fixture's flat self would go (a floor decal: before anything standing on
 * the floor). At `plugTop` 0 with `floorPlug` it draws only the plug's flush top, in the
 * floor's colour — the floor looks unbroken — so a caller at rest can just stop drawing it.
 */

/** A floor plug's depth below its top: deep enough that its walls never end inside the visible hole. */
const FLOOR_PLUG_DEPTH = 1.5;

interface IsoFloorRecessProps {
    /** The opening (the plug's footprint). */
    rect: WorldRect;
    /** The floor it is cut in. */
    surface: IsoSurface;
    /** The body under the floor (palette.ts → `insideMaterial`): the hole is lined with its wall tones, and so is a floor plug. */
    inside?: Material;
    /** World units the plug's top stands above the floor (negative = sunk). */
    plugTop: number;
    /**
     * The plug's base, in world units above the floor — the fixture's own bottom (a raised
     * plate's is `plugTop − RAISED_HEIGHT`). Omitted for a floor plug, which is solid all the
     * way down.
     */
    plugBase?: number;
    /** Draw the plug as a block of floor (`children` ignored). */
    floorPlug?: boolean;
    className?: string;
    /** The fixture plug, standing at world z `standZ` (its base). */
    children?: (standZ: number) => React.ReactNode;
}

const IsoFloorRecess: React.FC<IsoFloorRecessProps> = ({ rect, surface, inside, plugTop, plugBase, floorPlug = false, className, children }) => {
    const proj = useIsoProjector();
    const clipId = `iso-floor-recess-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const floorZ = surface.z;
    const sweep = useMemo(() => openingSweepPath(proj, rect, floorZ), [proj, rect, floorZ]);
    const topZ = floorZ + plugTop;
    // The floor plug reaches far below the floor; a fixture plug is as tall as it is.
    const baseZ = floorPlug ? topZ - FLOOR_PLUG_DEPTH : floorZ + (plugBase ?? plugTop);
    // The hole shows once anything of the plug is below the floor. A floor plug flush with
    // the floor is drawn as just its top — no hole round it, no clip edge to anti-alias.
    const open = floorPlug ? plugTop < -1e-4 : baseZ < floorZ - 1e-4;
    return (
        <g className={className ? `iso-floor-recess ${className}` : "iso-floor-recess"}>
            <defs>
                <clipPath id={clipId}>
                    <path d={sweep} />
                </clipPath>
            </defs>
            {open && <path className="iso-floor-recess__hole" d={flatPath(proj, rect, floorZ)} fill={holeTone(surface.color, inside)} />}
            <g className="iso-floor-recess__plug" clipPath={open ? `url(#${clipId})` : undefined}>
                {floorPlug ? (
                    open ? (
                        <IsoSolid className="iso-floor-recess__floor-plug" geometry={prism(proj, rect, baseZ, topZ)} material={floorSlabMaterial(surface.color, inside)} />
                    ) : (
                        <path className="iso-floor-recess__floor-plug-top" d={flatPath(proj, rect, floorZ)} fill={surface.color} />
                    )
                ) : (
                    children?.(baseZ)
                )}
            </g>
        </g>
    );
};

export default IsoFloorRecess;

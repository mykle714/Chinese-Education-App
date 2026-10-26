import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import IsoShadow from "./IsoShadow";
import IsoLevitate from "./IsoLevitate";
import { flatPath, hingedOutline, hingedPlaneTransform, hingedPrism, insetRect, type Hinge, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import type { PlatformTone } from "./palette";
import { IsoDeckHingeContext, useIsoPalette, useIsoProjector } from "./sceneContext";

/**
 * IsoPlatform — the slab a scene's objects stand on (docs/ISO_ART_FRAMEWORK.md
 * § "IsoPlatform").
 *
 * Its top surface — the FLOOR — is at z = 0 and it extends DOWN to −thickness. Drawn back
 * to front:
 *   1. its shadow on the `ground` (IsoShadow — the slab's footprint cast from its
 *      underside);
 *   2. the slab (IsoSolid), its top painted in the lighter RIM tone;
 *   3. the top again, inset by `RIM_WIDTH`, in the true floor tone — leaving the rim as a
 *      thin light bevel line round the edge;
 *   4. `decals` — flat things printed on the floor (floor labels), which belong to it;
 *   5. `children` — whatever stands on the floor (carpets, then the objects on them);
 *   6. `overlay` — drawn over everything, and left out of `fadeStyle` (below).
 *
 * With `floating`, steps 2–6 go through IsoLevitate: the slab and everything on it bob
 * together, and the shadow breathes in step. `bodyClassName` / `bodyStyle` reach the group
 * that holds steps 2–6, so a scene can animate the whole loaded slab on top of the bob — the
 * Deck Tower sinks it briefly when a tower lands on it (docs/DECK_TOWER.md § "Tower
 * resizes"). `fadeStyle` fades steps 1–5 but NOT the overlay: a group's opacity cannot be
 * undone by a child, so what must stay opaque through a fade is drawn after the faded group
 * instead (the Deck Tower keeps its deck: docs/DECK_TOWER.md § "Hiding the
 * platform").
 *
 * `hingeAngle` swings the slab open like a TRAP DOOR on its back-left top edge (the
 * upper-left edge on screen; geometry.ts → `Hinge`). Steps 3–4 swing with it — they are
 * flat, so one `hingedPlaneTransform` carries them — and a veil of the right-wall tone
 * shades the top as it turns to face the same way the right walls do, and the ground shadow
 * fades out before the door can swing down through the ground it falls on. A decal with height
 * (a raised IsoFloorLabel) is not flat, so the open hinge is also handed down
 * (`IsoDeckHingeContext`) for it to draw itself on the door properly. `children` do NOT
 * swing: they stand ON the door, so it is the scene's job to make them fall
 * (docs/DECK_TOWER_TRANSITIONS.md § "Trap door").
 */
interface IsoPlatformProps {
    rect: WorldRect;
    /** Slab thickness in world units. */
    thickness: number;
    /** The surface far below that the platform's shadow falls on. */
    ground: IsoSurface;
    /** Bob up and down (IsoLevitate). */
    floating?: boolean;
    /** Radians the slab has swung open on its back-left top edge. 0 (default) = shut. */
    hingeAngle?: number;
    /** Flat things printed on the floor. They swing with the slab when it opens. */
    decals?: React.ReactNode;
    /** Things standing on the floor; they ride along when it floats. */
    children?: React.ReactNode;
    /** Extra class / style on the group holding the slab and everything on it (e.g. a landing sink). */
    bodyClassName?: string;
    bodyStyle?: React.CSSProperties;
    /** The slab's colours (`platformTone`). Defaults to the gold `ISO.platform`. */
    tone?: PlatformTone;
    /** Freeze a `floating` platform's bob where it is (IsoLevitate `paused`). */
    bobPaused?: boolean;
    /** Style for a fade of the shadow, the slab and `children` — not `overlay` (e.g. `{ opacity }`). */
    fadeStyle?: React.CSSProperties;
    /** Drawn last, over `children`: rides the bob and `bodyStyle`, but not `fadeStyle`. */
    overlay?: React.ReactNode;
}

/** World-unit width of the light bevel line round the top edge. Exported so a scene can keep things off it (towerPlatforms.ts → each layout's `roam`). */
export const RIM_WIDTH = 0.16;

/** How far the swung top's veil goes toward the right-wall tone, at π/2 (see the veil below). */
const SWING_SHADE_MAX = 0.7;

const IsoPlatform: React.FC<IsoPlatformProps> = ({ rect, thickness, ground, floating = false, hingeAngle = 0, decals, children, tone, bodyClassName, bodyStyle, bobPaused = false, fadeStyle, overlay }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const slabTone = tone ?? { material: palette.platform, rim: palette.platformRim };
    const open = hingeAngle > 1e-4;
    const hinge: Hinge = useMemo(() => ({ x: rect.x, z: 0, angle: hingeAngle }), [rect.x, hingeAngle]);
    const slab = useMemo(() => hingedPrism(proj, rect, -thickness, 0, hinge), [proj, rect, thickness, hinge]);

    // The ground is only a few units below the underside, and a door swinging open hangs far
    // deeper than that — it would plunge through the very surface its shadow is painted on.
    // So the shadow fades as the door's lowest point descends toward the ground, gone by the
    // time it would touch: it reads as the door leaving its shadow behind rather than falling
    // into a floor. Closing brings it back in the same way.
    const swungShadow = useMemo(() => {
        if (!open) return null;
        const solid = [...hingedOutline(rect, 0, hinge), ...hingedOutline(rect, -thickness, hinge)];
        const lowestZ = Math.min(...solid.map((p) => p.z));
        const gap = -thickness - ground.z;
        const drop = -thickness - lowestZ;
        const opacity = gap > 0 ? Math.min(1, Math.max(0, 1 - drop / gap)) : 0;
        return { solid, opacity };
    }, [open, rect, thickness, hinge, ground.z]);

    const shadow = (
        <g className="iso-platform__fade" style={fadeStyle}>
            {swungShadow ? (
                swungShadow.opacity > 0 ? (
                    <g className="iso-platform__shadow-fade" opacity={swungShadow.opacity}>
                        <IsoShadow solid={swungShadow.solid} receiver={ground} className="iso-platform__shadow" />
                    </g>
                ) : null
            ) : (
                <IsoShadow footprint={rect} casterZ={-thickness} receiver={ground} className="iso-platform__shadow" />
            )}
        </g>
    );
    const body = (
        <g className={bodyClassName ? `iso-platform ${bodyClassName}` : "iso-platform"} style={bodyStyle}>
            <g className="iso-platform__fade" style={fadeStyle}>
                <IsoSolid geometry={slab} material={{ ...slabTone.material, top: slabTone.rim }} className="iso-platform__slab">
                    <g className="iso-platform__deck" transform={open ? hingedPlaneTransform(proj, 0, hinge) : undefined}>
                        <path className="iso-platform__floor" d={flatPath(proj, insetRect(rect, RIM_WIDTH), 0)} fill={slabTone.material.top} />
                        <IsoDeckHingeContext.Provider value={open ? hinge : null}>{decals}</IsoDeckHingeContext.Provider>
                    </g>
                    {/* The swung top turns toward +x — the way the RIGHT walls face — so it
                        darkens toward their tone: at π/2 it faces exactly as they do. A veil over
                        floor and decals alike keeps the print shaded with the floor it is on; it
                        stops at SWING_SHADE_MAX rather than 1, because a full veil would erase
                        the print instead of shading it. */}
                    {open && (
                        <path
                            className="iso-platform__swing-shade"
                            d={slab.top}
                            fill={slabTone.material.right}
                            opacity={SWING_SHADE_MAX * Math.min(1, Math.max(0, Math.sin(hingeAngle)))}
                            pointerEvents="none"
                        />
                    )}
                </IsoSolid>
                {children}
            </g>
            {overlay}
        </g>
    );

    return floating ? (
        <IsoLevitate shadow={shadow} paused={bobPaused}>
            {body}
        </IsoLevitate>
    ) : (
        <>
            {shadow}
            {body}
        </>
    );
};

export default IsoPlatform;

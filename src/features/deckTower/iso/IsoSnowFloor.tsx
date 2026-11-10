import React, { useMemo } from "react";
import { prism, type WorldRect } from "./geometry";
import IsoShadow from "./IsoShadow";
import type { IsoSurface } from "./light";
import { IsoSnowShed, SHED_FLAKE_R, SnowSlab, type SnowCover } from "./IsoSnowCap";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import type { SnowTrail } from "./snowTrail";

/**
 * Snow lying on a platform's floor, and the channel the pawns plough through it
 * (docs/ISO_ART_FRAMEWORK.md § "Snow"; docs/TOWER_SNOW.md § "The floor", § "The pawn's trail").
 *
 * IsoFloorSnow is a slab of the washed snow (SnowSlab, `FLOOR_SNOW_DEPTH` thick) over the
 * WHOLE floor, out to the platform's outer edge: the snow's walls rise flush from the
 * platform's own, burying the rim bevel (owner's call 2026-11-09 — a sheet stopping inside
 * the rim left the bevel and a step of floor showing round it). A FLOOR DECAL: pass it in
 * IsoPlatform `decals`, so it swings with a trap door. `slide` (0 → 1) slides it off the
 * swinging door toward its free edge (+x) and fades it — the Deck Tower drives it from the
 * door's angle.
 *
 * ── The channel ──
 * Given a `trail` (recorded by the caller's useSnowTrailRecorder from the pawns'
 * `floorSpot`), the sheet ploughs it as a CHANNEL (SnowSlab `trail`, snowChannel.ts). The
 * drift over a buried raised region (`drift`, the Deck Tower's plate) is the same snow
 * lifted by `rise` and ploughs the same trail by the same code, its channel bottoming out
 * on the region's top — the pawn steps up onto the plate under the snow (usePawnMotion
 * `steps`). The tower's top cap ploughs its own trail the same way (IsoCardSnow `trail`).
 *
 * Depended on by: src/features/deckTower/DeckTowerPlatform.tsx.
 */

/**
 * World thickness of the floor's snow (~8 px at the Deck Tower's scale). Deeper than the
 * deck plate stands (IsoFloorLabel `RAISED_HEIGHT`), so the plate is buried under it. What
 * stands on the floor still stands at the floor's own z: the pawn sinks in (IsoPawn
 * `snowDepth` clips its bottom), and the corner objects are buried by an IsoSnowSkirt.
 */
export const FLOOR_SNOW_DEPTH = 0.4;

/** How far, as a share of the platform's width, the sheet has slid off at `slide` = 1. */
const SLIDE_DISTANCE = 1.1;

interface IsoFloorSnowProps {
    /** The platform's footprint. */
    rect: WorldRect;
    /** Floor z. */
    z: number;
    /** 0 = lying; 1 = slid off the door and gone. */
    slide?: number;
    /** The channel's store (recorded by the caller). Undefined: no channel. */
    trail?: SnowTrail;
    /**
     * The snow over something raised that lies buried under the sheet (the Deck Tower's
     * deck plate): `rise` world units tall, so the snow over it stands as a DRIFT that much
     * proud of the sheet, offset from the floor's snow as the plate is from the floor.
     *   cover lying     the drift, on the sheet's top.
     *   cover shedding  a hole dug through the sheet, and the drift and the snow under it
     *                   playing the brush-off over it (IsoSnowShed, as the corner fixtures').
     *   no cover        the hole, showing what lies under it.
     */
    drift?: { rect: WorldRect; rise: number; cover?: SnowCover };
}

export const IsoFloorSnow: React.FC<IsoFloorSnowProps> = ({ rect, z, slide = 0, trail, drift }) => {
    const proj = useIsoProjector();
    const driftLying = drift?.cover !== undefined && !drift.cover.shed;
    const holeRect = drift && !driftLying ? drift.rect : undefined;
    const holes = useMemo(() => (holeRect ? [holeRect] : undefined), [holeRect]);

    // Slide along world +x (away from the trap door's back-left hinge, down the swung slope),
    // in the floor plane's own screen coordinates — the decal transform swings it after.
    // Accelerating (squared), as snow lets go and then slides.
    const s = Math.min(1, Math.max(0, slide));
    const d = s * s * SLIDE_DISTANCE * rect.w;
    const o = proj.project(0, 0, z);
    const p = proj.project(d, 0, z);
    if (s >= 1) return null;
    return (
        <g
            className="iso-floor-snow"
            transform={s > 0 ? `translate(${(p.x - o.x).toFixed(2)} ${(p.y - o.y).toFixed(2)})` : undefined}
            opacity={1 - s}
            pointerEvents="none"
        >
            <SnowSlab className="iso-floor-snow__sheet" rect={rect} z={z} depth={FLOOR_SNOW_DEPTH} trail={trail} holes={holes} />
            {drift && driftLying && drift.rise > 0 && (
                <SnowSlab
                    className="iso-floor-snow__drift"
                    rect={drift.rect}
                    z={z + FLOOR_SNOW_DEPTH}
                    depth={drift.rise}
                    // The same trail: its channel bottoms out on the plate's top.
                    trail={trail}
                    channelFloorZ={z + Math.max(0, drift.rise)}
                />
            )}
            {drift?.cover?.shed && <DriftShed rect={drift.rect} z={z} depth={FLOOR_SNOW_DEPTH + Math.max(0, drift.rise)} cover={drift.cover} />}
        </g>
    );
};

/** A drift as it is brushed off: the drift and the sheet under it hopping off their hole. */
const DriftShed: React.FC<{ rect: WorldRect; z: number; depth: number; cover: SnowCover }> = ({ rect, z, depth, cover }) => {
    const proj = useIsoProjector();
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.d / 2;
    const top = z + depth;
    const scale = proj.scaleAt(cx, cy, top);
    return (
        <IsoSnowShed cover={cover} burstAt={proj.project(cx, cy, top)} burstRadius={Math.max(rect.w, rect.d) * 0.6 * scale} flakeR={SHED_FLAKE_R * scale}>
            <SnowSlab className="iso-floor-snow__drift-shed" rect={rect} z={z} depth={depth} />
        </IsoSnowShed>
    );
};

interface IsoSnowSkirtProps {
    /** The standing object's footprint. */
    rect: WorldRect;
    /** Floor z (the object's base). */
    z: number;
    /** The object's height above the floor (live, as it builds up). */
    height: number;
    /** Draw the object's shadow on the snow round its base (`IsoShadow` with `casterHeight`). */
    shadow?: boolean;
    casterHeight?: number;
}

/**
 * IsoSnowSkirt — the floor's snow banked round the base of an object standing in it
 * (docs/ISO_ART_FRAMEWORK.md § "Snow"; docs/TOWER_SNOW.md § "The floor"). The object stands
 * at the floor's own z and the sheet (IsoFloorSnow) is a decal under it, so without this
 * its walls would run down through the snow to the floor. The skirt paints the walls'
 * lowest `FLOOR_SNOW_DEPTH` (or the whole object, if it is shorter) in the snow's top tone:
 * the band between the footprint's front outline at the snow's top and at its base, which
 * is exactly the snow lying in front of those walls. Drawn right AFTER the object.
 *
 * Its shadow: the object's own shadow lies on the snow's top (the caller passes the snow's
 * top as its receiver), and the part of it that falls inside this band is painted again
 * here, over the band, clipped to it — otherwise the band would paint it out.
 */
export const IsoSnowSkirt: React.FC<IsoSnowSkirtProps> = ({ rect, z, height, shadow = false, casterHeight }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const top = z + Math.min(FLOOR_SNOW_DEPTH, Math.max(0, height));
    // The band: the prism's silhouette minus its top face (even-odd), i.e. its two walls.
    const band = useMemo(() => {
        const g = prism(proj, rect, z, top);
        return `${g.hull}${g.top}`;
    }, [proj, rect, z, top]);
    if (top <= z) return null;
    const snowTop: IsoSurface = { z: z + FLOOR_SNOW_DEPTH, color: palette.snow };
    return (
        <g className="iso-snow-skirt" pointerEvents="none">
            <path className="iso-snow-skirt__band" d={band} fillRule="evenodd" fill={palette.snow} />
            {/* Only an object standing out of the snow casts a shadow on its top. */}
            {shadow && height > FLOOR_SNOW_DEPTH && (
                <>
                    <clipPath id={`iso-snow-skirt-${uid}`}>
                        <path d={band} clipRule="evenodd" />
                    </clipPath>
                    <g className="iso-snow-skirt__shadow" clipPath={`url(#iso-snow-skirt-${uid})`}>
                        <IsoShadow footprint={rect} casterZ={z} casterHeight={casterHeight} receiver={snowTop} />
                    </g>
                </>
            )}
        </g>
    );
};

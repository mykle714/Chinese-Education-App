import React, { useId, useMemo } from "react";
import IsoSolid from "./IsoSolid";
import { flatPath, insetRect, prism, type Pt, type WorldRect } from "./geometry";
import { shadowTone } from "./light";
import { snowMaterial } from "./palette";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { useSnowChannel } from "./snowChannel";
import type { SnowTrail } from "./snowTrail";

/**
 * Settled snow on a scene's objects (docs/ISO_ART_FRAMEWORK.md § "Snow";
 * docs/TOWER_SNOW.md): the parts every snowable object draws its snow with.
 *
 *   IsoSnowShed  the wrapper every snow cover is drawn in. It draws its children while
 *                the cover is on, and plays the BRUSH-OFF once when the cover carries a
 *                `shed`: the snow hops up, drops and fades while a few flakes spray out.
 *   SnowSlab     a slab of snow with thickness, optionally with a CHANNEL ploughed
 *                through it and HOLES dug through it — the base of every flat cover, and
 *                of the floor's snow (IsoSnowFloor.tsx), whose channel is the pawns' trail
 *                and whose hole is the brushed-off deck plate.
 *   IsoSnowCap   a slab of snow lying on a rounded-rect top face (the sort platform,
 *                the notebook's top sheet, a fully covered card).
 *   IsoCardSnow  a card's snow: a full cap, hiding the print.
 *   IsoBallSnow  a cap of snow on a ball (the focus lever's knob), in screen space.
 *
 * Colours: the scene's washed `snow` (palette.ts `ISO.snow`, `COLORS.white`) on top and
 * `snowMaterial`'s stepped walls — lit for the time of day like the object it
 * lies on.
 *
 * A PART, not an object: no shadow (the snow sits inside its object's own silhouette). The
 * object draws it last, after its own top face.
 *
 * Depended on by: IsoCardStack, IsoSortPlatform, IsoPaperStack, IsoLever,
 * src/features/deckTower/TowerCoverCard.tsx.
 */

/** A snow cover as an object is handed it. Present = snowy. */
export interface SnowCover {
    /**
     * Set while the snow is being brushed off: the cover plays its exit once (keyed by `id`,
     * so a new brush replays it) after `delayMs`, then draws nothing. Null / absent = lying.
     */
    shed?: { id: number; delayMs: number } | null;
}

/** World thickness of a snow cap (~6 px at the Deck Tower's scale): a slab, not a coat of paint. */
export const SNOW_CAP_DEPTH = 0.3;
/** The brush-off's length. The page drops the cover once `delayMs + SNOW_SHED_MS` has passed. */
export const SNOW_SHED_MS = 520;
/** Flakes sprayed by a brush-off, and their world radius. */
const SHED_FLAKES = 8;
export const SHED_FLAKE_R = 0.06;

const SHED_CSS = `
@keyframes iso-snow-shed {
    0%   { opacity: 1; transform: translate(0, 0); }
    25%  { opacity: 1; transform: translate(0, calc(-0.5 * var(--shed-hop))); }
    100% { opacity: 0; transform: translate(0, var(--shed-hop)); }
}
@keyframes iso-snow-flake {
    0%   { opacity: 0; transform: translate(0, 0); }
    12%  { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--flake-dx), var(--flake-dy)); }
}
.iso-snow--shed .iso-snow__cover { animation: iso-snow-shed var(--shed-ms) ease-in var(--shed-delay) both; }
.iso-snow__flake { opacity: 0; animation: iso-snow-flake var(--shed-ms) cubic-bezier(0.2, 0.6, 0.4, 1) var(--shed-delay) both; }
@media (prefers-reduced-motion: reduce) {
    .iso-snow--shed { display: none; }
}
`;

/**
 * Draws a cover's snow, and plays its brush-off. `burstAt` is where the flakes spray from
 * (viewBox coordinates) and `burstRadius` how far they fly (viewBox units).
 */
export const IsoSnowShed: React.FC<{ cover: SnowCover; burstAt: Pt; burstRadius: number; flakeR: number; children: React.ReactNode }> = ({
    cover,
    burstAt,
    burstRadius,
    flakeR,
    children,
}) => {
    const palette = useIsoPalette();
    const shed = cover.shed ?? null;
    const flakes = useMemo(() => {
        if (!shed) return null;
        // Evenly round the upper half (out and up), then gravity pulls each down past its
        // start — the spray of a brushed-off cap. Fixed angles, so it needs no randomness.
        return Array.from({ length: SHED_FLAKES }, (_, i) => {
            const a = Math.PI * (0.08 + (0.84 * i) / (SHED_FLAKES - 1));
            return { dx: -Math.cos(a) * burstRadius, dy: -Math.sin(a) * burstRadius * 0.5 + burstRadius * 0.35 };
        });
    }, [shed, burstRadius]);
    if (!shed) {
        return (
            <g className="iso-snow">
                <g className="iso-snow__cover">{children}</g>
            </g>
        );
    }
    const vars = {
        "--shed-ms": `${SNOW_SHED_MS}ms`,
        "--shed-delay": `${Math.max(0, shed.delayMs).toFixed(0)}ms`,
        "--shed-hop": `${(burstRadius * 0.25).toFixed(2)}px`,
    } as React.CSSProperties;
    return (
        // Keyed by the brush, so each one plays its keyframes from the start.
        <g key={`shed-${shed.id}`} className="iso-snow iso-snow--shed" style={vars} pointerEvents="none">
            <style>{SHED_CSS}</style>
            <g className="iso-snow__cover">{children}</g>
            {flakes?.map((f, i) => (
                <circle
                    key={i}
                    className="iso-snow__flake"
                    cx={burstAt.x}
                    cy={burstAt.y}
                    r={flakeR}
                    fill={palette.snow}
                    style={{ "--flake-dx": `${f.dx.toFixed(2)}px`, "--flake-dy": `${f.dy.toFixed(2)}px` } as React.CSSProperties}
                />
            ))}
        </g>
    );
};

interface SnowSlabProps {
    /** The slab's own outline (world). */
    rect: WorldRect;
    /** World z of the snow's base and its thickness. */
    z: number;
    depth: number;
    className: string;
    /**
     * The pawns' trail to plough through it as a CHANNEL (snowChannel.ts → `useSnowChannel`).
     * Drawn over the slab: the channel's outline at the snow's top, in the snow's wall tone,
     * is its far wall, and its outline at `channelFloorZ` over that (clipped to the top
     * outline) is its floor — packed snow in the snow's shadow tone, not what lies under it.
     * The near wall faces away, unseen.
     */
    trail?: SnowTrail;
    /** Where the channel bottoms out (default: the slab's base, `z`). The drift over the deck plate sits on the floor's sheet, but its channel goes down to the plate's top. */
    channelFloorZ?: number;
    /**
     * Rounded rects (world) dug clean through the slab: a MASK opens the snow there, so
     * whatever was painted under the slab shows (the floor's deck plate once its snow is
     * brushed off). The rest of each hole's outline at the snow's top is its far wall, in
     * the lit wall tone; the near wall faces away, unseen.
     */
    holes?: WorldRect[];
    children?: React.ReactNode;
}

/**
 * A slab of snow with thickness — an IsoSolid in `snowMaterial` — optionally with a channel
 * ploughed through it (`trail`) and holes dug clean through it
 * (`holes`). The channel is clipped to the slab's top face, so a run that strays onto the
 * rim never draws past the snow. `children` print on the snow's top (IsoSolid's children).
 */
export const SnowSlab: React.FC<SnowSlabProps> = ({ rect, z, depth, className, trail, channelFloorZ, holes, children }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    // useId gives "«r1»"-style ids; strip the punctuation so url(#…) always resolves.
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const geometry = useMemo(() => prism(proj, rect, z, z + depth), [proj, rect, z, depth]);
    const mat = snowMaterial(palette.snow);
    // Called unconditionally (a hook); with no trail its refs are simply never mounted.
    const channel = useSnowChannel(trail, rect, channelFloorZ ?? z, z + depth);
    // Each hole's outline at the snow's top (the far wall, and the mask's clip) and at its
    // base: the snow is open where the two overlap.
    const holePaths = useMemo(
        () => (holes ?? []).map((h) => ({ top: flatPath(proj, h, z + depth), bottom: flatPath(proj, h, z) })),
        [holes, proj, z, depth]
    );
    const body = (
        <>
            <IsoSolid className={`${className}__solid`} geometry={geometry} material={mat} roundedEdge={palette.edgeLight}>
                {children}
            </IsoSolid>
            {trail && (
                <>
                    <defs>
                        <clipPath id={`snow-slab-top-${uid}`}>
                            <path d={geometry.top} />
                        </clipPath>
                        <clipPath id={`snow-channel-top-${uid}`}>
                            <path ref={channel.clip} />
                        </clipPath>
                    </defs>
                    <g className={`${className}__channel`} clipPath={`url(#snow-slab-top-${uid})`}>
                        {/* The far wall: the part of the top outline the channel's floor does not reach. */}
                        <path ref={channel.wall} className={`${className}__channel-wall`} fill={mat.left} />
                        {/* The channel's floor: packed snow, a shadow step down from the snow's top. */}
                        <path ref={channel.floor} className={`${className}__channel-floor`} fill={shadowTone(palette.snow)} clipPath={`url(#snow-channel-top-${uid})`} />
                    </g>
                </>
            )}
            {holePaths.map((h, i) => (
                <path key={i} className={`${className}__hole-wall`} d={h.top} fill={mat.left} />
            ))}
        </>
    );
    if (holePaths.length === 0) return <g className={className}>{body}</g>;
    const { minX, minY, maxX, maxY } = geometry.bounds;
    const pad = 4;
    const box = { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
    return (
        <g className={className}>
            <defs>
                {holePaths.map((h, i) => (
                    <clipPath key={i} id={`snow-hole-top-${uid}-${i}`}>
                        <path d={h.top} />
                    </clipPath>
                ))}
                <mask id={`snow-holes-${uid}`} maskUnits="userSpaceOnUse" {...box}>
                    <rect {...box} fill="white" />
                    {holePaths.map((h, i) => (
                        <path key={i} d={h.bottom} fill="black" clipPath={`url(#snow-hole-top-${uid}-${i})`} />
                    ))}
                </mask>
            </defs>
            <g className={`${className}__body`} mask={`url(#snow-holes-${uid})`}>
                {body}
            </g>
        </g>
    );
};

interface IsoSnowCapProps {
    /** The top face the snow lies on. */
    rect: WorldRect;
    /** World z of that face. */
    z: number;
    cover: SnowCover;
    /** How far the snow stops short of the face's edge (world units). */
    inset?: number;
    depth?: number;
    /** The pawns' trail across it (SnowSlab `trail`): the tower's top, which a pawn wanders. */
    trail?: SnowTrail;
}

/** A slab of snow on a rounded-rect top face. */
export const IsoSnowCap: React.FC<IsoSnowCapProps> = ({ rect, z, cover, inset = 0.05, depth = SNOW_CAP_DEPTH, trail }) => {
    const proj = useIsoProjector();
    const inner = useMemo(() => insetRect(rect, inset), [rect, inset]);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.d / 2;
    const scale = proj.scaleAt(cx, cy, z + depth);
    return (
        <IsoSnowShed cover={cover} burstAt={proj.project(cx, cy, z + depth)} burstRadius={Math.max(rect.w, rect.d) * 0.6 * scale} flakeR={SHED_FLAKE_R * scale}>
            <SnowSlab className="iso-snow-cap" rect={inner} z={z} depth={depth} trail={trail} />
        </IsoSnowShed>
    );
};

/** A card's snow: a full cap over the top card, hiding its print — ploughed by `trail` (the tower's top). */
export const IsoCardSnow: React.FC<{ rect: WorldRect; z: number; cover: SnowCover; trail?: SnowTrail }> = ({ rect, z, cover, trail }) => (
    <IsoSnowCap rect={rect} z={z} cover={cover} inset={0.03} trail={trail} />
);

/**
 * A cap of snow on a ball of screen radius `r` centred at (`cx`, `cy`) (viewBox units): a
 * dome standing well proud of the ball's top, its lower edge scalloped where it clings.
 * Its thickness is a LIP — the same outline dropped a little, in the snow's wall tone —
 * showing under the dome's scallops, as a slab's wall shows under its top.
 */
export const IsoBallSnow: React.FC<{ cx: number; cy: number; r: number; cover: SnowCover }> = ({ cx, cy, r, cover }) => {
    const palette = useIsoPalette();
    // The dome: an arc of a larger circle, raised, from 195° round the top to 345° (SVG
    // angles, y down — the top is 270°).
    const R = r * 1.1;
    const oy = cy - r * 0.3;
    const at = (deg: number) => ({ x: cx + R * Math.cos((deg * Math.PI) / 180), y: oy + R * Math.sin((deg * Math.PI) / 180) });
    const start = at(195);
    const end = at(345);
    // Back from the right end to the left in three scallops, each sagging toward the ball's middle.
    const scallops = 3;
    const edgeY = cy - r * 0.2;
    let d = `M${start.x.toFixed(2)} ${start.y.toFixed(2)}A${R.toFixed(2)} ${R.toFixed(2)} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    for (let i = 1; i <= scallops; i++) {
        const x0 = end.x + ((start.x - end.x) * (i - 1)) / scallops;
        const x1 = end.x + ((start.x - end.x) * i) / scallops;
        const y1 = i === scallops ? start.y : edgeY;
        d += `Q${((x0 + x1) / 2).toFixed(2)} ${(edgeY + r * 0.32).toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    }
    d += "Z";
    const lip = r * 0.18;
    return (
        <IsoSnowShed cover={cover} burstAt={{ x: cx, y: oy - r * 0.7 }} burstRadius={r * 2.4} flakeR={r * 0.16}>
            <path className="iso-ball-snow__lip" d={d} transform={`translate(0 ${lip.toFixed(2)})`} fill={snowMaterial(palette.snow).right} />
            <path className="iso-ball-snow" d={d} fill={palette.snow} />
        </IsoSnowShed>
    );
};

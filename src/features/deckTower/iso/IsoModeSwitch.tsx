import React, { useId } from "react";
import IsoHatch from "./IsoHatch";
import IsoSolid from "./IsoSolid";
import {
    affineFrom3,
    affineToSvg,
    boundsOf,
    convexHull,
    flatPath,
    prism,
    roundedRectWorld,
    toPath,
    type PrismGeometry,
    type Projector,
    type WorldRect,
} from "./geometry";
import { MODE_SWITCH_HOLE } from "./hatchGeometry";
import type { IsoSurface } from "./light";
import { ISO, shadeHex, type Material } from "./palette";
import type { PawnEntranceFrame } from "./pawnEntrances";
import { useIsoProjector } from "./sceneContext";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoModeSwitch — a two-position light switch standing in a floor hatch
 * (docs/ISO_ART_FRAMEWORK.md § "IsoModeSwitch"). CURRENTLY UNUSED: it was the Deck Tower's
 * Mix / Review switch until that was dropped (2026-10-22), and is kept in the kit. It rises
 * out of the floor and sinks away (or falls with a trap door) exactly like the focus lever —
 * the hatch, the lift, the clip and the mid-entrance `air` pose are IsoHatch's.
 *
 * A solid grey BODY (the switch's plate, as a block) with one solid rocker PADDLE seated in
 * it, both long along world y and sharing a centre. The body is the paddle's plan plus an
 * even `RIM` all round, and a dark SLOT (the opening the paddle sits in, `SLOT_GAP` wider
 * than it) is printed on the body's top under the paddle.
 *
 * The paddle is a V-shaped block: a flat underside sunk `PADDLE_SKIRT` into the body (so no
 * daylight shows under its raised end), and a top of two faces meeting in a valley — the
 * CREASE, a line along world x across its middle — each rising `V_ANGLE` toward its end. It
 * rocks on the crease by the same `V_ANGLE`, so the pressed half's face lies level and the
 * raised half's face stands at twice the angle.
 *
 *   flip   0 = the +y end (screen lower left) pressed; 1 = the −y end (upper right).
 *          Animated by the caller; may overshoot (a spring), rocking it a hair past its stop.
 *   labels [flip 0's, flip 1's]. Only the CURRENT position's name is printed, centred on the
 *          crease and folded over both faces of the V, reading along −y (screen left →
 *          right); it fades out and back in as the paddle passes level, swapping to the
 *          other name there.
 *   colors [flip 0's band, flip 1's band]: the paddle is painted in the nearer position's
 *          (in the platform's wall steps), switching with the label; the body stays grey
 *          (`ISO.switchBase`).
 *
 * The V is not convex, so the paddle is drawn as its two convex HALVES, each like a prism
 * (`halfGeometry`: the hull of its top face and of where its walls meet the body's top,
 * then its top face), the far (−y) half first. Cutting the walls at the body's top — in the
 * world, not on screen — is what seats it: the skirt inside the body is never drawn. The
 * label is printed once per face through the affine map onto that face (`facePlane`,
 * measured along the surface from the crease, so the two prints meet at the fold), each
 * clipped to its own side of the crease.
 *
 * Draw it as an obstacle among the platform's standing things (it occludes pawns behind it).
 */

/** The paddle: width, length, and its thickness at the crease (the V's bottom). */
const PADDLE_W = 0.95;
const PADDLE_L = 2.0;
const CREASE_T = 0.2;
/** The plate round the paddle on every side, and the dark gap of its slot. */
const RIM = 0.2;
const SLOT_GAP = 0.05;
/** The body: the paddle plus the rim (MODE_SWITCH_HOLE leaves 0.125 – 0.15 round it), and its height. */
const BODY_W = PADDLE_W + 2 * RIM;
const BODY_L = PADDLE_L + 2 * RIM;
const BODY_H = 0.5;
/**
 * How far the paddle's underside reaches below the crease's base, into the body: deeper than
 * its raised end lifts (2 · CREASE_LIFT), so its walls always run down into the body's top.
 */
const PADDLE_SKIRT = 0.5;
/**
 * Each face's rise toward its end — and how far the paddle rocks either way (radians).
 * ≈6.7°, so the raised face stands at ≈13.3° (2 · V_ANGLE); eased down from 0.16 (≈18.3°
 * raised), which read too steep, 2026-10-20.
 */
const V_ANGLE = 0.116;
/** The paddle's thickness at its ends (the V's rims). */
const END_T = CREASE_T + (PADDLE_L / 2) * Math.tan(V_ANGLE);
/** The crease's base above the body: the pressed end's base line then meets the body's top. */
const CREASE_LIFT = (PADDLE_L / 2) * Math.sin(V_ANGLE);
/** How far it drops when fully sunk: the body, the raised end and some to spare. */
const SINK_DEPTH = BODY_H + 2 * CREASE_LIFT + END_T + 0.3;
/** Sized so "REVIEW" (~1.7 units wide) fits across the two faces with a margin each end. */
const LABEL_FONT = 0.4;

/** A band colour's three tones, the same steps as the platform's walls. */
const bandMaterial = (band: string): Material => ({ top: band, left: shadeHex(band, 0.07), right: shadeHex(band, 0.15) });

/**
 * The paddle's pose: its centre `at`, the base of its crease (CREASE_T below the valley) at
 * height `creaseZ`, rocked by `angle` (+ raises the +y end), seated in a body whose top is
 * at `seatZ`.
 */
interface Paddle {
    at: { x: number; y: number };
    creaseZ: number;
    angle: number;
    seatZ: number;
}

/** A point of the paddle in its own frame — s along it (+y) from the crease, h up from the crease's base — in the world. */
function paddlePoint(p: Paddle, x: number, s: number, h: number) {
    const c = Math.cos(p.angle);
    const sn = Math.sin(p.angle);
    return { x, y: p.at.y + s * c - h * sn, z: p.creaseZ + s * sn + h * c };
}

/** The top face's height over the crease's base at s: the V. */
const topH = (s: number) => CREASE_T + Math.abs(s) * Math.tan(V_ANGLE);

/** The paddle's rounded plan outline in (x, s); roundedRectWorld returns it as { x, y = s }. */
const paddlePlan = (at: { x: number }): WorldRect => ({ x: at.x - PADDLE_W / 2, y: -PADDLE_L / 2, w: PADDLE_W, d: PADDLE_L, r: 0.14 });

/**
 * One half of the paddle — from the crease out to its +y end (`side` +1) or −y end (−1) — as
 * a PrismGeometry, cut at the body's top. Its outline is the plan's points on that side plus
 * the crease's two ends; each runs a straight wall edge from the skirt's bottom up to the V
 * top, and the edge is cut where it crosses `seatZ` (the top always stands above it, the
 * bottom always below). The hull of the tops and the cut points is the visible solid —
 * convex, since a convex half cut by a plane stays convex.
 */
function halfGeometry(proj: Projector, p: Paddle, side: 1 | -1): PrismGeometry {
    const plan = paddlePlan(p.at);
    const outline = [...roundedRectWorld(plan).filter((q) => side * q.y > 0), { x: plan.x, y: 0 }, { x: plan.x + plan.w, y: 0 }];
    const project = (w: { x: number; y: number; z: number }) => proj.project(w.x, w.y, w.z);
    const topPts = convexHull(outline.map((q) => project(paddlePoint(p, q.x, q.y, topH(q.y)))));
    const seatPts = outline.map((q) => {
        const top = paddlePoint(p, q.x, q.y, topH(q.y));
        const bottom = paddlePoint(p, q.x, q.y, -PADDLE_SKIRT);
        // paddlePoint is affine in h, so the cut is a straight interpolation along the edge.
        const t = Math.min(1, Math.max(0, (p.seatZ - bottom.z) / (top.z - bottom.z)));
        return project({ x: bottom.x, y: bottom.y + t * (top.y - bottom.y), z: bottom.z + t * (top.z - bottom.z) });
    });
    const hullPts = convexHull([...topPts, ...seatPts]);
    // The front corner (where the two visible walls meet): the top's high-x, high-y corner.
    const frontS = side > 0 ? PADDLE_L / 2 : 0;
    return {
        top: toPath(topPts),
        hull: toPath(hullPts),
        frontX: project(paddlePoint(p, plan.x + plan.w, frontS, topH(frontS))).x,
        bevelHalfWidth: Math.max(1, plan.r * proj.unit * 0.9),
        bounds: boundsOf(hullPts),
    };
}

/**
 * The map from a flat print to the screen on one face of the V. Print coordinates (u, v): u
 * runs along −y (screen left → right, so text reads forwards), measured ALONG THE SURFACE
 * from the crease, so the two faces' prints meet at the fold; v = world x. The +y face
 * (`side` +1) carries u ≤ 0, the −y face u ≥ 0.
 */
function facePlane(proj: Projector, p: Paddle, side: 1 | -1) {
    const at = (u: number, v: number) => {
        // Distance out along this face from the crease, then the face point there.
        const d = -side * u;
        const q = paddlePoint(p, v, side * d * Math.cos(V_ANGLE), CREASE_T + d * Math.sin(V_ANGLE));
        return proj.project(q.x, q.y, q.z);
    };
    return affineFrom3(at(0, 0), at(1, 0), at(0, 1));
}

interface IsoModeSwitchProps {
    /** The hatch's centre on the floor (the paddle's crease is across it). */
    at: { x: number; y: number };
    /** The floor it stands in. */
    surface: IsoSurface;
    flip: number;
    /** [the name shown at flip 0, the name shown at flip 1]. */
    labels: readonly [string, string];
    /** [flip 0's band, flip 1's band]. */
    colors: readonly [string, string];
    sink: number;
    hatch: number;
    /** A standing switch's mid-entrance pose (lifted, squashed); omitted = resting on its lift. */
    air?: PawnEntranceFrame;
}

const IsoModeSwitch: React.FC<IsoModeSwitchProps> = ({ at, surface, flip, labels, colors, sink, hatch, air }) => {
    const proj = useIsoProjector();
    const uid = `iso-mode-switch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const body: WorldRect = { x: at.x - BODY_W / 2, y: at.y - BODY_L / 2, w: BODY_W, d: BODY_L, r: 0.2 };
    const slot: WorldRect = {
        x: at.x - PADDLE_W / 2 - SLOT_GAP,
        y: at.y - PADDLE_L / 2 - SLOT_GAP,
        w: PADDLE_W + 2 * SLOT_GAP,
        d: PADDLE_L + 2 * SLOT_GAP,
        r: 0.16,
    };
    // flip 0 presses the +y end (angle −V_ANGLE, its face level), flip 1 the −y end.
    const angle = V_ANGLE * (2 * flip - 1);
    // One name at a time: the nearer position's, faded out as the paddle passes level; the
    // paddle's colour swaps with it.
    const nearer = flip < 0.5 ? 0 : 1;
    const label = labels[nearer];
    const inkOpacity = Math.min(1, Math.abs(2 * flip - 1) * 1.6);

    return (
        <IsoHatch
            className="iso-mode-switch"
            at={at}
            w={MODE_SWITCH_HOLE.w}
            d={MODE_SWITCH_HOLE.d}
            surface={surface}
            sink={sink}
            hatch={hatch}
            sinkDepth={SINK_DEPTH}
            shadowFootprint={body}
            air={air}
        >
            {(standZ) => {
                const bodyTop = standZ + BODY_H;
                const paddle: Paddle = { at, creaseZ: bodyTop + CREASE_LIFT, angle, seatZ: bodyTop };
                const material = bandMaterial(colors[nearer]);
                // The far (−y) half first: the near (+y) one is in front of it.
                const halves = [
                    { key: "far", side: -1 as const },
                    { key: "near", side: 1 as const },
                ];
                return (
                    <>
                        <IsoSolid className="iso-mode-switch__body" geometry={prism(proj, body, standZ, bodyTop)} material={ISO.switchBase} />
                        <path className="iso-mode-switch__slot" d={flatPath(proj, slot, bodyTop)} fill={shadeHex(ISO.switchBase.top, 0.4)} />
                        {halves.map(({ key, side }) => {
                            const clipId = `${uid}-${key}`;
                            return (
                                <IsoSolid
                                    key={key}
                                    className={`iso-mode-switch__paddle iso-mode-switch__paddle--${key}`}
                                    geometry={halfGeometry(proj, paddle, side)}
                                    material={material}
                                >
                                    <g className="iso-mode-switch__print" transform={affineToSvg(facePlane(proj, paddle, side))} fontFamily={FONTS.sans}>
                                        {/* This face's side of the fold, in print coordinates. */}
                                        <clipPath id={clipId}>
                                            <rect x={side > 0 ? -PADDLE_L : 0} y={at.x - PADDLE_W} width={PADDLE_L} height={2 * PADDLE_W} />
                                        </clipPath>
                                        <text
                                            className="iso-mode-switch__label"
                                            clipPath={`url(#${clipId})`}
                                            x={0}
                                            y={at.x}
                                            fontSize={LABEL_FONT}
                                            fontWeight={WEIGHT.bold}
                                            letterSpacing={0.03}
                                            textAnchor="middle"
                                            dominantBaseline="central"
                                            fill={ISO.ink}
                                            opacity={inkOpacity}
                                        >
                                            {label}
                                        </text>
                                    </g>
                                </IsoSolid>
                            );
                        })}
                    </>
                );
            }}
        </IsoHatch>
    );
};

export default IsoModeSwitch;

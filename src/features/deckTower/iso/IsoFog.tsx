import React, { useId, useMemo } from "react";
import { flatPath, prism, toPath, type WorldRect } from "./geometry";
import type { FogCloud } from "./fogClouds";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { prefersReducedMotion } from "./skyTraffic";

/**
 * IsoFog — fog clouds rolling through a scene, lying flat in the world XY plane and
 * travelling across the whole screen width (over the platform and the sky either side of
 * it) the way clouds cross the sky (docs/ISO_ART_FRAMEWORK.md § "IsoFog"; the Deck Tower's
 * fog weather, docs/DECK_TOWER.md § "Weather").
 *
 * WHAT and WHERE is planned by fogClouds.ts (`planFogClouds` → `FogCloud[]`): each cloud is
 * 2–4 skinny staggered pills (units) side by side, joined by flat bridges where their
 * straight runs overlap (each bridge end a concave fillet of the units' radius). This
 * component only draws that plan: per cloud, its units (rounded rects, radius half their
 * width) and its bridges (pre-sampled world outlines, projected point by point) as flat
 * paths in `ISO.fog` (white). No gradients.
 *
 * Opacity is set ONCE per height level (the level's group), not per shape: inside a group
 * the shapes composite first and the group fades as a whole, so a bridge overlapping its
 * units reads as one even silhouette instead of darker seams.
 *
 * ── Depth ─────────────────────────────────────────────────────────────────────
 * The caller draws it AFTER everything standing on the floor, so fog veils the floor, the
 * lever and the base of the tower in front of it. A flat layer at height h cannot be one
 * painter's-order layer against a solid that pierces it, though: the solid ABOVE h is
 * nearer the camera than the fog behind it. So each `piercer` (a footprint and its top z)
 * is cut out of every height LEVEL it rises above: an SVG mask removes the screen hull of
 * that footprint's prism from the level's z up to its top, so a tall tower rises crisply
 * out of the fog. A piercer whose top is at or below a level is NOT cut — it sits wholly
 * under that level (a short tower is in the fog).
 * Pawns are not piercers (they move every frame); a pawn's head can pick up a faint veil
 * from fog behind it — accepted (owner's choice 2026-11-04).
 *
 * ── Motion ────────────────────────────────────────────────────────────────────
 * Every cloud crosses its lane from `x0` (fully outside the covered box) to `x1` (fully
 * outside on the far side) as ONE group, fading in over the first `FADE_SHARE` of the
 * crossing and out over the last, then starts again — a loop, so no scheduler is needed.
 * The projection is affine, so a world crossing is a fixed screen translate: one linear CSS
 * animation per cloud (no JS per frame). Each cloud starts at its own `phase` of the loop
 * (a negative animation-delay), so the screen is already foggy when fog switches on. The
 * mask sits on the LEVEL's group, outside the moving clouds, so the cut-out stays on the
 * tower while the fog rolls under it. Under prefers-reduced-motion each cloud is parked,
 * fully opaque, at its `phase`.
 *
 * Depends on: fogClouds.ts (`FogCloud`), geometry.ts (`flatPath`, `prism`), palette.ts
 * (`ISO.fog`), skyTraffic.ts (`prefersReducedMotion`).
 * Depended on by: src/features/deckTower/DeckTowerPlatform.tsx.
 */

export interface IsoFogPiercer {
    /** The solid's footprint. */
    rect: WorldRect;
    /** World z of its top. */
    zTop: number;
}

interface IsoFogProps {
    /** The field to draw (fogClouds.ts → `planFogClouds`). Memoise it: a new array rebuilds every path. */
    clouds: FogCloud[];
    /** The fog's opacity, 0–1 (per height level). 0 draws nothing. */
    opacity: number;
    /** Solids that rise up through the fog (see the header's Depth note). */
    piercers?: IsoFogPiercer[];
}

/** The share of a crossing spent fading in at its start (and out at its end). */
const FADE_SHARE = 0.12;

/** Shared empty default, so an omitted `piercers` doesn't rebuild the geometry every render. */
const NO_PIERCERS: IsoFogPiercer[] = [];

const FOG_CSS = `
@keyframes iso-fog-roll {
    0%   { transform: translate(0px, 0px); opacity: 0; }
    ${FADE_SHARE * 100}%  { opacity: 1; }
    ${(1 - FADE_SHARE) * 100}%  { opacity: 1; }
    100% { transform: translate(var(--fog-dx), var(--fog-dy)); opacity: 0; }
}
`;

const IsoFog: React.FC<IsoFogProps> = ({ clouds, opacity, piercers = NO_PIERCERS }) => {
    const proj = useIsoProjector();
    const reduced = prefersReducedMotion();
    // useId gives "«r1»"-style ids; strip the punctuation so url(#…) always resolves (as IsoSolid does).
    const idBase = `iso-fog-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

    // Clouds grouped by height: each height gets one mask (its own tower cut-out) and one opacity.
    const levels = useMemo(() => {
        const byZ = new Map<number, FogCloud[]>();
        for (const c of clouds) byZ.set(c.z, [...(byZ.get(c.z) ?? []), c]);
        return [...byZ.entries()]
            .sort(([a], [b]) => a - b)
            .map(([z, group], level) => ({
                key: level,
                clouds: group.map((c, i) => {
                    const w = c.unitWidth;
                    // Units and bridges drawn at the START of the crossing (origin x0); the
                    // animation slides the whole cloud to x1.
                    const units = c.units.map((u) => flatPath(proj, { x: c.x0 + u.dx, y: c.y + u.dy - w / 2, w: u.length, d: w, r: w / 2 }, z));
                    const bridges = c.bridges.map((b) => toPath(b.outline.map((p) => proj.project(c.x0 + p.dx, c.y + p.dy, z))));
                    // The crossing's screen vector: the projection is affine, so it is a fixed translate.
                    const from = proj.project(c.x0, c.y, z);
                    const to = proj.project(c.x1, c.y, z);
                    return { key: i, unitsPath: units.join(""), bridgesPath: bridges.join(""), dx: to.x - from.x, dy: to.y - from.y, periodS: c.periodS, phase: c.phase };
                }),
                // Only solids that rise above this height are cut out of it.
                cuts: piercers.filter((pc) => pc.zTop > z).map((pc) => prism(proj, pc.rect, z, pc.zTop).hull),
                maskId: `${idBase}-${level}`,
            }));
    }, [proj, clouds, piercers, idBase]);

    if (opacity <= 0 || clouds.length === 0) return null;

    return (
        <g className="iso-fog" pointerEvents="none">
            <style>{FOG_CSS}</style>
            {levels.map((lv) => (
                <g key={lv.key} className="iso-fog__level" opacity={opacity} mask={lv.cuts.length ? `url(#${lv.maskId})` : undefined}>
                    {lv.cuts.length > 0 && (
                        // userSpaceOnUse over a huge rect: the default mask box is the masked
                        // group's bbox, which the rolling clouds keep changing.
                        <mask id={lv.maskId} className="iso-fog__cut" maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
                            <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="white" />
                            {lv.cuts.map((hull, j) => (
                                <path key={j} d={hull} fill="black" />
                            ))}
                        </mask>
                    )}
                    {lv.clouds.map((c) => (
                        <g
                            key={c.key}
                            className="iso-fog__roll"
                            style={
                                reduced
                                    ? { transform: `translate(${(c.dx * c.phase).toFixed(2)}px, ${(c.dy * c.phase).toFixed(2)}px)` }
                                    : ({
                                          "--fog-dx": `${c.dx.toFixed(2)}px`,
                                          "--fog-dy": `${c.dy.toFixed(2)}px`,
                                          // Linear, like a cloud's crossing; the negative delay starts it mid-loop.
                                          animation: `iso-fog-roll ${c.periodS.toFixed(1)}s linear ${(-c.phase * c.periodS).toFixed(2)}s infinite`,
                                      } as React.CSSProperties)
                            }
                        >
                            {/* Units in one path (nonzero fill unions them — flatPath winds them all
                                the same way); bridges in another, since their outlines may wind the
                                other way and would punch holes in the units if they shared a path.
                                Both are opaque inside the level's group, so they still read as one. */}
                            <path className="iso-fog__units" d={c.unitsPath} fill={ISO.fog} />
                            {c.bridgesPath && <path className="iso-fog__bridges" d={c.bridgesPath} fill={ISO.fog} />}
                        </g>
                    ))}
                </g>
            ))}
        </g>
    );
};

export default IsoFog;

import React, { useId, useMemo } from "react";
import IsoShadow from "./IsoShadow";
import IsoCard from "./IsoCard";
import { CARD_THICKNESS, seamHeights } from "./cardStackMetrics";
import { GHOST_FADE_MS, GHOST_WIRE_FADE_MS, LAND_HOP, LAND_HOP_MS, shadowLandTiming, type CardCollapsePlan } from "./cardCollapse";
import { flatPath, frontContour, prism, toOpenPath, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { useIsoPalette, useIsoProjector } from "./sceneContext";

/**
 * IsoCardRuns — a card stack COLLAPSING: some of its cards ghost out, and the rest drop
 * into the gaps under gravity (docs/ISO_ART_FRAMEWORK.md § "IsoCardRuns"). It plays one
 * `CardCollapsePlan` (cardCollapse.ts) from the moment it mounts, then stands as the
 * settled stack of `plan.remaining` cards — exactly what an IsoCardStack of that count
 * draws, so the caller can swap one in when the plan's `durationMs` is up.
 *
 * Why not IsoCardStack: that is ONE solid with seams, because a deck runs to hundreds of
 * cards. Gaps need the column cut into separate solids — the kept RUNS and the GHOST
 * chunks — so this draws one per piece, bottom to top (the painter's order for a column
 * of one footprint). All pieces share one footprint, so their front corners line up and
 * ONE wall gradient serves them all.
 *
 * A ghost leaves a light WIREFRAME where it stood — the chunk's top and bottom outlines,
 * one at each drawn seam inside it, and the chunk's silhouette, drawn just under its solid so it shows as the solid fades. It is
 * the ghost's second stage: it holds a beat, then fades at its chunk's own
 * `wireFadeDelayMs`, so the wireframes go in the order the chunks were picked, and the
 * last has gone before gravity turns on.
 *
 * The whole animation is CSS, timed by the plan: a ghost fades (and lifts a hair) after
 * its own delay; every run is drawn where it will LAND and starts translated up by its
 * drop, falls on a t² curve (cubic-bezier(1/3, 0, 2/3, 1/3) is exactly y = x²: free fall
 * from rest) and hops as it lands. So a 600-card tower never re-renders while it
 * collapses — only the top card's `figure` changes, and the pieces are memoised apart
 * from it. Remounting restarts the animation; key it per plan.
 */
interface IsoCardRunsProps {
    rect: WorldRect;
    surface: IsoSurface;
    plan: CardCollapsePlan;
    /** The top card's print. */
    label?: string;
    bandColor?: string;
    /** The figure on the top card (the caller counts it down, cardCollapse.ts → `cardsShowingAt`). */
    figure: number;
}

/** How far a ghost lifts as it fades, in world units. */
const GHOST_LIFT = 0.25;
/** A ghost's wireframe: its stroke opacity while it stands. */
const WIRE_OPACITY = 0.6;
/** y = x²: a fall from rest. */
const FREE_FALL = "cubic-bezier(0.333, 0, 0.667, 0.333)";

const RUNS_CSS = `
@keyframes iso-card-runs-ghost { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(calc(-1 * var(--ghost-lift))); } }
@keyframes iso-card-runs-fall { from { transform: translateY(calc(-1 * var(--drop))); } to { transform: translateY(0); } }
@keyframes iso-card-runs-shadow-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes iso-card-runs-shadow-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes iso-card-runs-wire-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes iso-card-runs-hop { 0%, 100% { transform: translateY(0); } 45% { transform: translateY(calc(-1 * var(--hop))); } }
`;

const IsoCardRuns: React.FC<IsoCardRunsProps> = ({ rect, surface, plan, label, bandColor, figure }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const gradientId = `iso-card-runs-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const baseZ = surface.z;
    const t = CARD_THICKNESS;

    // One solid of `cards` card thicknesses with its underside at z, its seams and (when it
    // holds the lid) the body under the lid only — the lid is drawn by the caller after it.
    const pieces = useMemo(() => {
        const solid = (z: number, cards: number, lid: boolean) => {
            const body = lid ? cards - 1 : cards;
            // Evenly spaced seams (cardStackMetrics.ts → `seamHeights`, by LANDED position and
            // phased by `plan.remaining`, so they match the settled IsoCardStack once the runs land) plus the piece's own
            // boundaries: its base when it is off the floor, so two runs that land on each
            // other still read as separate, and the lid's underside. One path per piece.
            const firstCard = Math.round((z - baseZ) / t);
            const seamCards = new Set(seamHeights(firstCard, firstCard + body, plan.remaining));
            if (firstCard > 0) seamCards.add(firstCard);
            if (lid) seamCards.add(firstCard + body);
            const seams = [...seamCards].map((h) => toOpenPath(frontContour(proj, rect, baseZ + h * t)));
            const geometry = body > 0 ? prism(proj, rect, z, z + body * t) : null;
            return (
                <>
                    {geometry && <path className="iso-card-runs__walls" d={geometry.hull} fill={`url(#${gradientId})`} />}
                    {geometry && <path className="iso-card-runs__top" d={geometry.top} fill={palette.card.top} />}
                    {seams.length > 0 && (
                        <path className="iso-card-runs__seams" d={seams.join(" ")} fill="none" stroke={palette.cardSeam} strokeWidth={1} strokeLinecap="round" />
                    )}
                </>
            );
        };
        // Bottom to top by ORIGINAL position: runs only ever fall into gaps that ghosts have
        // already left, so the order holds for the whole collapse.
        const all = [
            ...plan.runs.map((r) => ({ kind: "run" as const, from: r.from, run: r })),
            ...plan.ghosts.map((g) => ({ kind: "ghost" as const, from: g.from, ghost: g })),
        ].sort((a, b) => a.from - b.from);
        return all.map((p) => {
            if (p.kind === "ghost") {
                const g = p.ghost;
                // The wireframe: the chunk's top and bottom outlines and one at each drawn seam
                // inside it (every 2.5 cards) (full outlines, back edges too — the gap is open once the solid has
                // gone), plus the chunk's silhouette for its vertical edges. Not one per card:
                // at CARD_THICKNESS they would be ~2px apart and merge into a white slab.
                const z0 = baseZ + g.from * t;
                const wire = [prism(proj, rect, z0, z0 + g.count * t).hull];
                const wireCards = new Set([g.from, g.from + g.count, ...seamHeights(g.from, g.from + g.count, plan.remaining)]);
                for (const h of wireCards) wire.push(flatPath(proj, rect, baseZ + h * t));
                return {
                    key: `g${g.from}`,
                    wire: wire.join(" "),
                    wireStyle: {
                        animation: `iso-card-runs-wire-out ${GHOST_WIRE_FADE_MS}ms ease-in ${g.wireFadeDelayMs.toFixed(0)}ms both`,
                    } as React.CSSProperties,
                    lidZ: g.hasLid ? baseZ + (g.from + g.count - 1) * t : null,
                    className: "iso-card-runs__ghost",
                    style: {
                        "--ghost-lift": `${GHOST_LIFT * proj.heightUnit}px`,
                        animation: `iso-card-runs-ghost ${GHOST_FADE_MS}ms ease-in ${g.fadeDelayMs.toFixed(0)}ms both`,
                    } as React.CSSProperties,
                    body: solid(baseZ + g.from * t, g.count, g.hasLid),
                };
            }
            const r = p.run;
            // Drawn where it LANDS; the fall animation starts it up at its old height.
            const landZ = baseZ + (r.from - r.dropCards) * t;
            const falls = r.dropCards > 0;
            return {
                key: `r${r.from}`,
                wire: null,
                wireStyle: undefined,
                lidZ: r.hasLid ? landZ + (r.count - 1) * t : null,
                className: "iso-card-runs__run",
                style: falls
                    ? ({
                          "--drop": `${(r.dropCards * t * proj.heightUnit).toFixed(2)}px`,
                          "--hop": `${(LAND_HOP * proj.heightUnit).toFixed(2)}px`,
                          animation:
                              `iso-card-runs-fall ${r.fallMs.toFixed(0)}ms ${FREE_FALL} ${plan.fallStartMs.toFixed(0)}ms both, ` +
                              `iso-card-runs-hop ${LAND_HOP_MS}ms ease-out ${(plan.fallStartMs + r.fallMs).toFixed(0)}ms`,
                      } as React.CSSProperties)
                    : undefined,
                body: solid(landZ, r.count, r.hasLid),
            };
        });
    }, [proj, rect, baseZ, t, plan, gradientId, palette.card.top, palette.cardSeam]);

    const front = prism(proj, rect, baseZ, baseZ + t);
    // The floor shadow is cast by the BOTTOM card. When that card is a ghost the shadow
    // fades with it, leaving the runs above floating; it comes back as the lowest run
    // lands on the floor (none when nothing is kept). Two animations on one property: the
    // fade-in is listed last and fills only forwards, so it takes over from the fade-out's
    // held 0 once it starts.
    const bottomGhost = plan.ghosts.find((g) => g.from === 0);
    let shadowStyle: React.CSSProperties | undefined;
    if (bottomGhost) {
        const out = `iso-card-runs-shadow-out ${GHOST_FADE_MS}ms ease-in ${bottomGhost.fadeDelayMs.toFixed(0)}ms both`;
        const lowest = plan.runs[0];
        if (lowest) {
            const back = shadowLandTiming(plan.fallStartMs + lowest.fallMs);
            shadowStyle = { animation: `${out}, iso-card-runs-shadow-in ${back.durationMs.toFixed(0)}ms ease-out ${back.delayMs.toFixed(0)}ms forwards` };
        } else {
            shadowStyle = { animation: out };
        }
    }

    return (
        <g className="iso-card-runs">
            <style>{RUNS_CSS}</style>
            <defs>
                <linearGradient
                    id={gradientId}
                    gradientUnits="userSpaceOnUse"
                    x1={front.frontX - front.bevelHalfWidth}
                    y1={0}
                    x2={front.frontX + front.bevelHalfWidth}
                    y2={0}
                >
                    <stop offset="0" stopColor={palette.card.left} />
                    <stop offset="1" stopColor={palette.card.right} />
                </linearGradient>
            </defs>
            <g className="iso-card-runs__shadow" style={shadowStyle}>
                <IsoShadow footprint={rect} casterZ={baseZ} receiver={surface} />
            </g>
            {pieces.map((p) => (
                <React.Fragment key={p.key}>
                    {p.wire !== null && (
                        // Static (it does not lift with the ghost). One path, so where the
                        // outlines cross the stroke's opacity does not double up.
                        <g className="iso-card-runs__wire" style={p.wireStyle}>
                            <path
                                d={p.wire}
                                fill="none"
                                stroke={palette.ghostWire}
                                strokeOpacity={WIRE_OPACITY}
                                strokeWidth={1}
                                strokeLinejoin="round"
                            />
                        </g>
                    )}
                    <g className={p.className} style={p.style}>
                        {p.body}
                        {p.lidZ !== null && (
                            <IsoCard
                                rect={rect}
                                z={p.lidZ}
                                thickness={t}
                                label={label}
                                bandColor={bandColor}
                                figure={String(figure)}
                                caption={figure === 1 ? "card" : "cards"}
                            />
                        )}
                    </g>
                </React.Fragment>
            ))}
        </g>
    );
};

export default IsoCardRuns;

import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import IsoShadow from "./IsoShadow";
import IsoCard from "./IsoCard";
import { CARD_THICKNESS, cardStackMetrics, seamHeights } from "./cardStackMetrics";
import { frontContour, prism, toOpenPath, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { useIsoPalette, useIsoProjector } from "./sceneContext";

/**
 * IsoCardStack — a deck of N cards stacked into a tower (docs/ISO_ART_FRAMEWORK.md
 * § "IsoCardStack").
 *
 * One solid for the body of the deck plus a full IsoCard on top. The body is NOT N card
 * solids: a deck can run to several hundred cards, and drawing each as two filled paths
 * would cost hundreds of nodes for walls nobody can tell apart. The individual cards are
 * suggested instead by SEAMS — the front contour of the footprint stroked under every
 * 2.5 cards (`seamHeights`), plus one under the top card. Cards keep one fixed thickness (cardStackMetrics.ts), so a big deck grows tall
 * rather than thin.
 */
interface IsoCardStackProps {
    rect: WorldRect;
    /** Cards in the deck. 0 draws nothing. */
    count: number;
    /** The surface the stack stands on. */
    surface: IsoSurface;
    /**
     * 0 → 1 build-up. The body grows to its full height and the top card rides up on
     * it; the printed figure counts up with it. 1 = settled.
     */
    progress?: number;
    /** Printed in the top card's head band. */
    label?: string;
    /** The top card's head band fill (IsoCard's `bandColor`). */
    bandColor?: string;
    /**
     * The figure printed on the top card, when it is not this stack's own count — a stack
     * dropping onto another names the total it makes (docs/DECK_TOWER.md § "Tower
     * resizes"). Shown as-is, not counted up by `progress`.
     */
    figure?: number;
    /** The top card's print opacity (IsoCard `printOpacity`). Default 1. */
    printOpacity?: number;
}

const IsoCardStack: React.FC<IsoCardStackProps> = ({ rect, count, surface, progress = 1, label, bandColor, figure, printOpacity }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const metrics = useMemo(() => cardStackMetrics(count), [count]);
    const baseZ = surface.z;
    const bodyHeight = metrics.bodyHeight * progress;

    const body = useMemo(
        () => (bodyHeight > 0.001 ? prism(proj, rect, baseZ, baseZ + bodyHeight) : null),
        [proj, rect, bodyHeight, baseZ]
    );

    // Seams sit on a fixed, evenly spaced grid (cardStackMetrics.ts → `seamHeights`,
    // phased by the SETTLED count so the top card's seam lands on it), so during the
    // build-up the placed seams stay where they are and new ones appear as the body grows upward. One extra seam
    // always sits at the top card's underside — without it the top card merges with the
    // body and reads as one thick card. A base-anchored seam within a quarter card of that one is
    // dropped, so the topmost, still-arriving card never shows a doubled line. The base
    // itself (z = 0) gets no seam: that edge is where the stack meets its surface. All
    // seams are ONE path (subpaths), so the cost does not grow with the deck.
    const seams = useMemo(() => {
        if (bodyHeight <= 0.001) return null;
        const out: string[] = [];
        for (const h of seamHeights(0, bodyHeight / CARD_THICKNESS - 0.25, count)) {
            out.push(toOpenPath(frontContour(proj, rect, baseZ + h * CARD_THICKNESS)));
        }
        out.push(toOpenPath(frontContour(proj, rect, baseZ + bodyHeight)));
        return out.join(" ");
    }, [proj, rect, bodyHeight, baseZ, count]);

    if (count <= 0) return null;
    const shown = figure ?? Math.round(count * progress);

    return (
        <g className="iso-card-stack">
            <IsoShadow footprint={rect} casterZ={baseZ} receiver={surface} className="iso-card-stack__shadow" />
            {body && (
                <IsoSolid geometry={body} material={palette.card} className="iso-card-stack__body">
                    {seams && (
                        <path
                            className="iso-card-stack__seams"
                            d={seams}
                            fill="none"
                            stroke={palette.cardSeam}
                            strokeWidth={1}
                            strokeLinecap="round"
                        />
                    )}
                </IsoSolid>
            )}
            <IsoCard
                rect={rect}
                z={baseZ + bodyHeight}
                thickness={metrics.topThickness}
                label={label}
                bandColor={bandColor}
                figure={String(shown)}
                caption={shown === 1 ? "card" : "cards"}
                printOpacity={printOpacity}
            />
        </g>
    );
};

export default IsoCardStack;

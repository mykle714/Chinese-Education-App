import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import IsoShadow from "./IsoShadow";
import { frontContour, prism, toOpenPath, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { PAPER_SHEET_THICKNESS, paperStackHeight } from "./paperStackMetrics";

/**
 * IsoPaperStack — a stack of notebook paper (docs/ISO_ART_FRAMEWORK.md § "IsoPaperStack").
 *
 * The Deck Tower draws one on the writing world's platform as the Writing Notebook's
 * button (docs/DECK_TOWER.md § "The notebook stack").
 *
 * Built like IsoCardStack, at paper scale: ONE solid for the whole ream (never a solid
 * per sheet — a busy notebook runs to hundreds), its sheets suggested by seams stroked
 * every `SEAM_EVERY_SHEETS` sheets, and the top sheet's face printed as ruled notebook
 * paper: sky-blue rules across the page and a red margin line down its left side. The
 * page's HEAD is its low-y edge (the upper-right edge on screen), the same as IsoCard's,
 * so the rules run along world x like a line of text and the margin runs along y.
 *
 * Unlike IsoCardStack there is no print on the face (no figure, no band): the stack is
 * a button, and its height alone shows the total.
 *
 * `progress` builds it up the way IsoCardStack's does: the top sheet is always there and
 * rides up as the sheets under it grow in. Its shadow carries `iso-paper-stack__shadow`,
 * which the Deck Tower hides on every rule that hides the tower's (`iso-card-stack__shadow`).
 */

/** A seam on the walls every this many sheets (~5px apart, like the card tower's). */
const SEAM_EVERY_SHEETS = 5;

/** The ruled face, in world units on the sheet's own plane. */
const RULE_TOP_GAP = 0.45; // the blank head above the first rule
const RULE_SPACING = 0.22;
const RULE_SIDE_PAD = 0.08; // rules stop just short of the sheet's edges
const MARGIN_FROM_LEFT = 0.32; // the red margin's distance from the sheet's left (low-x) edge

interface IsoPaperStackProps {
    /** The sheet footprint (world units). Long side along world y = portrait. */
    rect: WorldRect;
    /** Sheets in the stack. 0 draws nothing. */
    sheets: number;
    /** 0 → 1 build-up: the top sheet rides up as the rest grow in under it. 1 = settled. */
    progress?: number;
    /** The surface the stack stands on. */
    surface: IsoSurface;
}

const IsoPaperStack: React.FC<IsoPaperStackProps> = ({ rect, sheets, surface, progress = 1 }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const baseZ = surface.z;
    const height = paperStackHeight(sheets, progress);
    const shownSheets = height / PAPER_SHEET_THICKNESS;
    const topZ = baseZ + height;

    const body = useMemo(() => (height > 0 ? prism(proj, rect, baseZ, topZ) : null), [proj, rect, baseZ, topZ, height]);

    // Wall seams, one path of subpaths so the cost never grows with the stack. None at the
    // base (that edge is where the stack meets the floor) and none at the top (the face's
    // own edge already reads).
    const seams = useMemo(() => {
        const out: string[] = [];
        for (let s = SEAM_EVERY_SHEETS; s < shownSheets; s += SEAM_EVERY_SHEETS) {
            out.push(toOpenPath(frontContour(proj, rect, baseZ + s * PAPER_SHEET_THICKNESS)));
        }
        return out.length > 0 ? out.join(" ") : null;
    }, [proj, rect, baseZ, shownSheets]);

    // The top sheet's print: straight world-space segments projected onto the face (both
    // are straight lines in world space, so projecting their ends is exact).
    const face = useMemo(() => {
        const seg = (x0: number, y0: number, x1: number, y1: number) => {
            const a = proj.project(x0, y0, topZ);
            const b = proj.project(x1, y1, topZ);
            return `M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`;
        };
        const rules: string[] = [];
        for (let y = rect.y + RULE_TOP_GAP; y < rect.y + rect.d - RULE_SPACING * 0.6; y += RULE_SPACING) {
            rules.push(seg(rect.x + RULE_SIDE_PAD, y, rect.x + rect.w - RULE_SIDE_PAD, y));
        }
        const mx = rect.x + MARGIN_FROM_LEFT;
        return { rules: rules.join(" "), margin: seg(mx, rect.y + RULE_SIDE_PAD, mx, rect.y + rect.d - RULE_SIDE_PAD) };
    }, [proj, rect, topZ]);

    if (!body) return null;

    return (
        <g className="iso-paper-stack">
            {/* Its height stated, so a stack only a sheet or two thick gets a sliver to match
                rather than the full contact lift, which would float it (light.ts → `contactLift`). */}
            <IsoShadow footprint={rect} casterZ={baseZ} casterHeight={height} receiver={surface} className="iso-paper-stack__shadow" />
            <IsoSolid geometry={body} material={palette.paper} className="iso-paper-stack__body">
                {seams && (
                    <path
                        className="iso-paper-stack__seams"
                        d={seams}
                        fill="none"
                        stroke={palette.paperSeam}
                        strokeWidth={1}
                        strokeLinecap="round"
                    />
                )}
                <path className="iso-paper-stack__rules" d={face.rules} fill="none" stroke={palette.paperRule} strokeWidth={0.75} strokeLinecap="round" />
                <path className="iso-paper-stack__margin" d={face.margin} fill="none" stroke={palette.paperMargin} strokeWidth={0.75} strokeLinecap="round" />
            </IsoSolid>
        </g>
    );
};

export default IsoPaperStack;

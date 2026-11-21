import { makeProjector } from "../iso";
import { HEAD_CENTRE, HEAD_RADIUS } from "../iso/pawnFigure";

/**
 * launchDrop.ts — the launch screen's scene scale and the geometry of its pawn drop
 * (docs/LAUNCH_SCREEN.md § "The fall"). Kept out of LaunchScreen.tsx so that file exports only
 * components (react-refresh), and so /gravity-lab's timings (src/pages/gravityLab/gravityTimings.ts)
 * can time the drop from the SAME geometry the cover uses.
 *
 * Layer: feature module (pure; no React). Readers: launch/LaunchScreen.tsx, gravityTimings.ts.
 */

/** Screen px per world unit. */
export const LAUNCH_UNIT = 30;
export const LAUNCH_PROJ = makeProjector(LAUNCH_UNIT);
/** Screen px from the pawn's feet up to the top of its head, standing at rest (pawnFigure.ts). */
export const PAWN_HEAD_TOP_PX = HEAD_CENTRE * LAUNCH_PROJ.heightUnit + HEAD_RADIUS * LAUNCH_PROJ.facingScaleAt(0, 0, 0);
/** Where the pawn's feet (the floor's centre) sit, as a share of the screen's height from the top. */
export const FEET_AT_SCREEN_Y = 0.8;
/** Clear space between the top of the cover and the pawn's head when the fall starts. */
export const FALL_START_MARGIN_PX = 16;

/**
 * The drop on a cover `coverHeight` px tall: from the head FALL_START_MARGIN_PX above the
 * cover's top edge down to the feet's resting place, FEET_AT_SCREEN_Y down. In px, and in
 * world units (what the fall physics times).
 */
export function launchFall(coverHeight: number): { px: number; units: number } {
    const px = coverHeight * FEET_AT_SCREEN_Y + PAWN_HEAD_TOP_PX + FALL_START_MARGIN_PX;
    return { px, units: px / LAUNCH_PROJ.heightUnit };
}

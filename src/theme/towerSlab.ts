import { liftHex } from "../timeOfDay/wash";
import { COLORS } from "./colors";
import { shadeHex } from "./shadeHex";
import type { PlateTones } from "./towerPlate";

/**
 * towerSlab — the Deck Tower's floating platform as a flat play surface for HTML: a gold
 * slab with a lighter bevel round its top edge and a solid wall under it. Cream cards on a
 * gold slab in blue air is the tower scene's own picture (docs/ISO_ART_FRAMEWORK.md
 * § "Palette"), so a game drawn on this reads as played on the platform.
 *
 * The shades match `platformTone(COLORS.gld)` in the iso kit (walls `shadeHex` 0.07 / 0.15,
 * rim `slabRim`). They are derived, not tokens: the flagged `shadeHex` divergence.
 *
 * Fixed gold in every world. The reading and writing worlds paint their platforms other
 * colours, but a game on its own route has no world to read.
 *
 * Depended on by: games/shared/GameFrame.tsx (`tone="tower"`), games/match-speed/
 * MatchSpeedPlateButton.tsx, GameBreakCard.tsx (`CREAM_PLATE_TONES`).
 * Docs: docs/TOWER_STYLE_SHIFT.md § "The play slab".
 */

/** OKLCH lightness of a slab's rim over its floor. Set to keep the gold rim where it was. */
const RIM_LIFT = 0.04;

/**
 * The light bevel round a slab's top edge. Also the iso kit's (`platformTone`), so a
 * platform's rim stands off its floor by the same visible amount in every hue.
 * Docs: docs/ISO_ART_FRAMEWORK.md § "Palette".
 */
export function slabRim(base: string): string {
    return liftHex(base, RIM_LIFT);
}

export const TOWER_SLAB = {
    top: COLORS.gld,
    left: shadeHex(COLORS.gld, 0.07),
    right: shadeHex(COLORS.gld, 0.15),
    rim: slabRim(COLORS.gld),
} as const;

/**
 * The slab's visible wall, px: the tower platform's own thickness at phone scale
 * (`PLATFORM_THICKNESS` 1.5 world units, at about 17 px each). `GameFrame` adds it to its
 * bottom margin, since the wall hangs below the box and a game's content area clips.
 */
export const TOWER_SLAB_WALL_PX = 26;

/** A plate cut from card stock: reads as part of a card or a card-stock popup. */
export const CREAM_PLATE_TONES: PlateTones = { top: COLORS.cardFace, left: COLORS.cardWall, right: COLORS.cardWall };

/** A plate's tones under a wash (src/timeOfDay/wash.ts). */
export function washPlateTones(tones: PlateTones, wash: (hex: string) => string): PlateTones {
    return { top: wash(tones.top), left: wash(tones.left), right: wash(tones.right) };
}

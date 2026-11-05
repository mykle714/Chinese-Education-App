import { liftHex } from "../timeOfDay/wash";
import { COLORS } from "./colors";
import type { PlateTones } from "./towerPlate";

/**
 * towerSlab — slab colour helpers shared by the Deck Tower's iso kit and the flp game
 * break:
 *   - `slabRim` — the light bevel round a platform's top edge (iso/palette.ts →
 *     `platformTone`);
 *   - `CREAM_PLATE_TONES` — a plate cut from card stock (GameBreakCard.tsx).
 *
 * It also held `TOWER_SLAB` / `TOWER_SLAB_WALL_PX` — the gold play slab GameFrame's
 * `tone="tower"` drew a game on — until that tone was removed on 2026-11-04.
 *
 * Depended on by: src/features/deckTower/iso/palette.ts (`slabRim`),
 * src/features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakCard.tsx (`CREAM_PLATE_TONES`).
 * Docs: docs/ISO_ART_FRAMEWORK.md § "Palette".
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

/** A plate cut from card stock: reads as part of a card or a card-stock popup. */
export const CREAM_PLATE_TONES: PlateTones = { top: COLORS.cardFace, left: COLORS.cardWall, right: COLORS.cardWall };

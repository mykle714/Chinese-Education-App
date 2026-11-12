import { SIZE } from "../../../../theme/scale";
import { shadeHex } from "../../../../theme/shadeHex";
import { PLATE_WALL_PX, towerPlateSx, type PlateTones } from "../../../../theme/towerPlate";

/**
 * interimCardPlate — the plate buttons on the flp's INTERIM cards: the cards that sit in
 * the word stack without being words. Shared by the game break's title card
 * (GameBreakCard.tsx: Skip / Play) and the out-of-ready-cards card
 * (../ReadyOutCardLayer.tsx: "Got it!"). They are the tower's floor-plate push button
 * (src/theme/towerPlate.ts), cut full-size for a card panel.
 *
 * Docs: docs/FLP_GAME_BREAKS.md § 5, docs/DECK_TOWER.md § "Running out of ready cards".
 */

/** A ramp hue as slab tones: the face is its mid tier, the wall a shade down. */
export function hueTones(mid: string): PlateTones {
    return { top: mid, left: shadeHex(mid, 0.1), right: shadeHex(mid, 0.2) };
}

/** A full-size plate button on an interim card's panel. */
export const plateButtonSx = (tones: PlateTones) => ({
    ...towerPlateSx(tones),
    height: 46,
    borderRadius: "14px",
    fontSize: SIZE.body,
    // The wall hangs below the box; keep it clear of the panel's foot.
    marginBottom: `${PLATE_WALL_PX}px`,
});

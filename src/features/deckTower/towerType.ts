import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";

/**
 * towerType.ts — the Deck Tower's type on the sky: the CJK face in bold (synthesised where
 * the face has no bold), for the header and the stage. Shared with the tier-2 pages that
 * stand on the tower's sky, so their headers match the tower's (acp: AddCardsPage.tsx).
 *
 * Layer: page style constant (feature module `src/features/deckTower`).
 * Depended on by: DeckTowerPage.tsx, discover/AddCardsPage.tsx.
 * Docs: docs/DECK_TOWER.md, docs/SORT_CARDS_REQUIREMENTS.md § 4.9.
 */
export const TOWER_TYPE_SX = { fontFamily: FONTS.cjk, fontWeight: WEIGHT.bold, fontSynthesis: "weight" } as const;

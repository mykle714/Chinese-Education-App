import { COLORS } from "../../theme/colors";
import { cardStockPressSx, cardStockShadow, sortCardStockSx } from "../discover/sortCardStock";
import { MINI_CARD_DIMENSIONS } from "../../components/miniCardFace";
import { FLP_CARD_STOCK_INSET_RATIO } from "../flashcards/constants";

/**
 * towerCardStock — the card stock td's mini cards are printed on (docs/DECK_TOWER.md
 * § "The cards page"). Its own module (not TowerCardsPage) so the card view's zoom ghost
 * can share it without breaking the page's fast refresh.
 *
 * Used by: TowerCardsPage.tsx (the grid), cardView/TowerCardView.tsx (the ghost).
 */

/**
 * The cards' cast-shadow colour: a CSS variable set from the sky on whatever holds the
 * cards — TowerCardsPage's root, and the card view's zoom ghost — so a sky that changes
 * every frame (a pan's blend) never re-renders a card.
 */
export const GROUND_SHADOW_VAR_NAME = "--tower-cards-ground-shadow";
const GROUND_SHADOW_VAR = `var(${GROUND_SHADOW_VAR_NAME})`;

/**
 * The mastery strip's left/right inset on this stock, px: the beige panel's inset plus
 * `STRIP_PANEL_CLEARANCE_PX` of panel on either end, so the strip sits wholly on the panel.
 */
const STRIP_PANEL_CLEARANCE_PX = 5;
const STRIP_SIDE_INSET_PX = Math.round(MINI_CARD_DIMENSIONS.regular.width * FLP_CARD_STOCK_INSET_RATIO + STRIP_PANEL_CLEARANCE_PX);

/**
 * The stock every card is printed on — acp's thick panel (sortCardStock
 * `sortCardStockSx`: 4px wall + cast shadow; `cardStockPressSx`: pushed back on
 * press). Also the stock of the card view's zoom ghost (cardView/TowerCardView), so the
 * ghost is exactly the tapped tile. Module-level so its identity never changes — every memoized card receives
 * it. Its `&:hover` keeps the panel's shadow: the flat face's hover elevation would
 * replace the wall and shadow on a desktop hover.
 */
export const TOWER_CARD_STOCK = {
    rim: COLORS.cardFace,
    sx: {
        ...sortCardStockSx("regular", false, GROUND_SHADOW_VAR),
        "&:hover": { boxShadow: cardStockShadow(false, GROUND_SHADOW_VAR) },
        // Pressed, the card is pushed back flush with the sky (no wall, no shadow); the card
        // view opens on release. After `&:hover`, so a sticky touch hover cannot mask the press.
        ...cardStockPressSx(GROUND_SHADOW_VAR),
        // The mastery strip squeezed in off the cream rim: MiniCard spans it 8px in from
        // the card's sides, which on this stock is only ~1.5px inside the beige panel
        // (inset `width × FLP_CARD_STOCK_INSET_RATIO`, ≈6.5px), so its ends touched the rim.
        "& .mini-card__mastery-strip": { left: STRIP_SIDE_INSET_PX, right: STRIP_SIDE_INSET_PX },
    },
} as const;

import {
    FLP_CARD_CORNER_RATIO,
    FLP_CARD_STOCK_INSET_RATIO,
    FLP_CARD_PANEL_RADIUS_RATIO,
} from "../constants";

/**
 * cardStock — the CSS custom properties a card FRAME sets so the `CardFaceSide` faces
 * inside it print on the Deck Tower's card stock: a cream rim around a beige panel, the
 * same stock as the tower's IsoCards (docs/TOWER_STYLE_SHIFT.md § "Card stock").
 *
 * Every vet flashcard face is on this stock: the tower's flp card stack
 * (FlashCardSection) and the card detail page's hero card (VocabCardDetailPage). Until
 * 2026-11-04 there was also a plain, hairlined face for the standalone flp route and the
 * old Home page's world; both were deleted that day.
 *
 * `widthCss` is the card's rendered width as a CSS length (container units are fine — a
 * custom property's `cq` units resolve where it is USED, i.e. inside the frame), so the
 * rim, the panel's corner and the card's own corner all scale with the card exactly as
 * the tower's IsoCard does.
 *
 *   --card-radius        the card's corner (read by CARD_SURFACE, theme/surfaces.ts)
 *   --card-stock-inset   the cream rim's width
 *   --card-panel-radius  the beige panel's corner
 *   --card-hint-band     the card's top band (the rim) — the flp's swipe/flip hint labels
 *   --card-chrome-inset  where the card's own top chrome sits: CardOpsRail's `•••`, the
 *                        CardNote strip — just under the rim
 *
 * Layer: feature presentation helper (src/features/flashcards/card).
 * Depended on by: FlashcardsLearnPage/FlashCardSection.tsx, VocabCardDetailPage.tsx.
 */

/** Gap between the rim and the card's own top chrome, px. */
const CARD_CHROME_GAP_PX = 6;

export function cardStockVars(widthCss: string) {
    return {
        "--card-radius": `calc(${widthCss} * ${FLP_CARD_CORNER_RATIO})`,
        "--card-stock-inset": `calc(${widthCss} * ${FLP_CARD_STOCK_INSET_RATIO})`,
        "--card-panel-radius": `calc(${widthCss} * ${FLP_CARD_PANEL_RADIUS_RATIO})`,
        "--card-hint-band": "var(--card-stock-inset)",
        "--card-chrome-inset": `calc(var(--card-stock-inset) + ${CARD_CHROME_GAP_PX}px)`,
    } as const;
}

import { keyframes } from "@mui/material/styles";
import { COLORS } from "../../theme/colors";
import { shadeHex } from "../deckTower/iso";
import { FLP_CARD_PANEL_RADIUS_RATIO, FLP_CARD_STOCK_INSET_RATIO } from "../flashcards/constants";
import { MINI_CARD_DIMENSIONS, type MiniCardSize } from "../../components/miniCardFace";

/**
 * sortCardStock — the look of every card-stock mini card: the Deck Tower's card stock
 * (cream rim + inset beige panel) drawn as one thick panel (outlined 4px wall, cast
 * shadow on the ground), the grey "already sorted" variant, and the resting levitation bob.
 *
 * Shared by the places a sort card's stock is drawn:
 *   - AddCardsPage → DraggableCard (the on-deck pack; adds drag lift + hover raise)
 *   - SkippedCardsSheet → RecyclableSkippedCard (the hidden skipped-cards grid)
 *   - deckTower/TowerCardsPage → the cards page under td's platform (through
 *     MiniVocabCard `stock`; no levitation)
 *
 * Layer: feature styling helper (src/features/discover) — pure values, no React.
 * Docs: docs/SORT_CARDS_REQUIREMENTS.md § 4.5 (card stock), § 5.1a (skipped sheet);
 *       docs/TOWER_STYLE_SHIFT.md § "Card stock"; docs/DECK_TOWER.md § "The cards page".
 */

/**
 * The card stock is drawn as ONE THICK PANEL (user request 2026-11-05) — a cream face
 * standing on a solid wall, the whole silhouette outlined once, a cast shadow beneath.
 * It replaced a thin stock (unoutlined 2px wall, inset ring on the face only, a flat
 * hard-edged cast shadow) that read as a STACK of cards: the ring stopped at the face,
 * splitting face from wall, and the flat shadow was the card's rounded outline again a
 * few px further out — a second card behind. Its pieces, as box-shadows (first-listed
 * paints on top):
 *   1. the WALL — the card's thickness, seen below and to the right of the face, as
 *      the bins' iso cards show their front and right walls. box-shadow cannot slant,
 *      so it is the face's outline stepped 1px at a time along the (1, 1) extrusion
 *      vector, PANEL_WALL_PX copies, so it stays continuous;
 *   2. the OUTLINE — a 1px-spread copy in PANEL_OUTLINE under the face (k = 0, which
 *      lines its top and left edges) and under every wall step. There is no ring on the
 *      face itself: a line between face and wall split the panel back into layers. The
 *      card still carries its outline (CLAUDE.md "Buttons & cards"), around the whole
 *      panel;
 *   3. a CAST SHADOW on the ground in the caller's `groundShadow` (the iso shadow
 *      rule's tone for that ground), falling down-right past the wall like the tower's
 *      own shadows. Kept near-solid — a 2px blur only softens its edge so it does not
 *      read as another card. A wide soft blur was tried 2026-11-05 and vanished: the
 *      tone is only `SHADOW_DEPTH` (10%) darker than the ground (deckTower/iso/light.ts
 *      → `shadowTone`), and a 10px blur spread that faint step out to nothing. A sorted
 *      card has none — see SORTED_STOCK.
 */
const PANEL_WALL_PX = 4;
/**
 * The panel's outline, on every surface it is drawn on (user decision 2026-11-05).
 * ⚠️ Framework divergence: the line tokens stop at `border` (16% ink), which all but
 * vanished on the cream rim against td's sky, so this borrows the faint TEXT grey.
 */
export const PANEL_OUTLINE = COLORS.textFaint;
/** How far the cast shadow reaches past the wall, right and down, and its blur, px (at rest). */
const PANEL_SHADOW_REACH_PX = 4;
const PANEL_SHADOW_BLUR_PX = 2;
/**
 * A held card is lifted further off the ground, so its shadow falls further away and
 * softer: at full lift (`lift` = 1) the reach and blur are HELD_SHADOW_GROWTH × their
 * resting values. DraggableCard springs `lift` 0 → 1 on pickup and back on a miss.
 */
const HELD_SHADOW_GROWTH = 2.5;

/**
 * An already-sorted card: the card stock's three tones translated into greys, keeping the
 * stock's light rim → deeper panel → deeper-still wall order, so the wall reads as the
 * card's own edge. (The wall used to be the SAME grey as the face, `COLORS.header`, and
 * a wall the face's colour reads as a second card stacked behind — user report 2026-10-29.)
 * The wall is the panel darkened one iso step, exactly how `COLORS.cardWall` is derived
 * from `cardBeige` (`shadeHex(…, 0.07)`); rim and panel are framework greys.
 */
export const SORTED_STOCK = {
    rim: COLORS.header,
    panel: COLORS.card,
    wall: shadeHex(COLORS.card, 0.07),
} as const;
/** How faint a sorted card's print (icon, word, definition) is, under its grayscale. */
export const SORTED_PRINT_OPACITY = 0.4;

const WALL_STEPS = Array.from({ length: PANEL_WALL_PX }, (_, i) => i + 1);
const panelWall = (color: string) => WALL_STEPS.map((k) => `${k}px ${k}px 0 ${color}`);
const PANEL_SILHOUETTE = [0, ...WALL_STEPS].map((k) => `${k}px ${k}px 0 1px ${PANEL_OUTLINE}`);
const panelCastShadow = (groundShadow: string, lift: number) => {
    const growth = 1 + (HELD_SHADOW_GROWTH - 1) * lift;
    const offset = (PANEL_WALL_PX + PANEL_SHADOW_REACH_PX * growth).toFixed(2);
    const blur = (PANEL_SHADOW_BLUR_PX * growth).toFixed(2);
    return `${offset}px ${offset}px ${blur}px ${groundShadow}`;
};

/**
 * The stock's whole box-shadow: wall, outline, cast shadow (at `lift`). A sorted card is
 * GROUNDED — it stands on the ground rather than floating over it, so it casts no shadow
 * and never lifts; its wall is in SORTED_STOCK's grey.
 */
export const cardStockShadow = (sorted: boolean, groundShadow: string, lift = 0) =>
    (sorted
        ? [...panelWall(SORTED_STOCK.wall), ...PANEL_SILHOUETTE]
        : [...panelWall(COLORS.cardWall), ...PANEL_SILHOUETTE, panelCastShadow(groundShadow, lift)]
    ).join(", ");

/**
 * The Deck Tower's CARD STOCK on a mini card (docs/TOWER_STYLE_SHIFT.md § "Card stock"):
 * the face is the cream rim (`COLORS.cardFace`, passed as MiniCard `background`) with the
 * beige printed panel inset in it — `FLP_CARD_STOCK_INSET_RATIO` of the card's width in
 * from every edge, corners `FLP_CARD_PANEL_RADIUS_RATIO`, the ratios CardFaceSide paints
 * every flp face with — plus the thick-panel box-shadow above. The panel is a `::before`,
 * so it paints FIRST: MiniCard's icon layer, icon and text all sit over it.
 */
export const sortCardStockSx = (size: MiniCardSize, sorted: boolean, groundShadow: string) => {
    const width = MINI_CARD_DIMENSIONS[size].width;
    return {
        boxShadow: cardStockShadow(sorted, groundShadow, 0),
        "&::before": {
            content: '""',
            position: "absolute",
            inset: `${width * FLP_CARD_STOCK_INSET_RATIO}px`,
            borderRadius: `${width * FLP_CARD_PANEL_RADIUS_RATIO}px`,
            // `--mini-card-panel` lets a card with its OWN colour (an advanced-layout vet
            // card's `cardColor`, set by MiniVocabCard `stock`) fill the panel while the rim
            // stays cream — the flp card stock's rule (CardFaceSide). Unset on
            // every acp card, so they keep the beige.
            backgroundColor: sorted ? SORTED_STOCK.panel : `var(--mini-card-panel, ${COLORS.cardBeige})`,
            pointerEvents: "none",
        },
    } as const;
};

// Resting cards levitate: a 3px rise and fall (the artboard's `lev`), each slot a
// different phase so the pack never moves in lockstep. Driven by the CSS `translate`
// property, which composes with the drag spring's `transform` rather than fighting it.
export const CARD_LEVITATE_MS = 4200;
export const cardLevitateKeyframes = keyframes`
    0%, 100% { translate: 0 0; }
    50%      { translate: 0 -3px; }
`;
export const LEVITATE_PHASES_MS = [0, -1100, -2300, -3100];

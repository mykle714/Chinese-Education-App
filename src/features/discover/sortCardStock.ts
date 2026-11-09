import { keyframes } from "@mui/material/styles";
import { COLORS } from "../../theme/colors";
import { keycapPressSx } from "../../theme/keycapPress";
import { roundedEdgeFillet, roundedEdgeRimLight } from "../../theme/roundedEdge";
import { shadeHex } from "../deckTower/iso";
import { FLP_CARD_PANEL_RADIUS_RATIO, FLP_CARD_STOCK_INSET_RATIO } from "../flashcards/constants";
import { MINI_CARD_DIMENSIONS, type MiniCardSize } from "../../components/miniCardFace";

/**
 * sortCardStock — the look of every card-stock mini card: the Deck Tower's card stock
 * (cream rim + inset beige panel) drawn as one thick panel (4px wall, cast shadow on the
 * ground; no outline), the grey "already sorted" variant, and the resting levitation bob.
 *
 * Shared by the places a sort card's stock is drawn:
 *   - AddCardsPage → DraggableCard (the on-deck pack; adds drag lift + hover raise)
 *   - SkippedCardsSheet → RecyclableSkippedCard (the hidden skipped-cards grid)
 *   - deckTower/TowerCardsPage → the cards page under td's platform (through
 *     MiniVocabCard `stock`; no levitation; pushed back on press — `cardStockPressSx`)
 *
 * Layer: feature styling helper (src/features/discover) — pure values, no React.
 * Docs: docs/SORT_CARDS_REQUIREMENTS.md § 4.5 (card stock), § 5.1a (skipped sheet);
 *       docs/TOWER_STYLE_SHIFT.md § "Card stock"; docs/DECK_TOWER.md § "The cards page".
 */

/**
 * The card stock is drawn as ONE THICK PANEL (user request 2026-11-05) — a cream face
 * standing on a solid wall, a cast shadow beneath.
 * It replaced a thin stock (unoutlined 2px wall, inset ring on the face only, a flat
 * hard-edged cast shadow) that read as a STACK of cards: the ring stopped at the face,
 * splitting face from wall, and the flat shadow was the card's rounded outline again a
 * few px further out — a second card behind. Its pieces, as box-shadows (first-listed
 * paints on top):
 *   1. the WALL — the card's thickness, seen below and to the right of the face, as
 *      the bins' iso cards show their front and right walls. box-shadow cannot slant,
 *      so it is the face's outline stepped 1px at a time along the (1, 1) extrusion
 *      vector, PANEL_WALL_PX copies, so it stays continuous;
 *   2. a CAST SHADOW on the ground in the caller's `groundShadow` (the iso shadow
 *      rule's tone for that ground), falling down-right past the wall like the tower's
 *      own shadows. Kept near-solid — a 2px blur only softens its edge so it does not
 *      read as another card. A wide soft blur was tried 2026-11-05 and vanished: the
 *      tone is only `SHADOW_DEPTH` (10%) darker than the ground (deckTower/iso/light.ts
 *      → `shadowTone`), and a 10px blur spread that faint step out to nothing. A sorted
 *      card has none — see SORTED_STOCK.
 */
const PANEL_WALL_PX = 4;
/*
 * NO OUTLINE (user call 2026-11-06). The stock used to carry a 1px `textFaint` line round
 * the whole silhouette (face + wall); it was tried across td's iso scene and filter keys,
 * disliked, and removed everywhere. The panel's edge is its wall and cast shadow, the
 * tower style's rule (docs/TOWER_STYLE_SHIFT.md: "Edge — drawn by the object's own wall,
 * rim or shadow"). It is an exception to CLAUDE.md "Buttons & cards", like the rest of the
 * tower world.
 */
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
/**
 * The panel's wall with a hairline ROUNDED perimeter (theme/roundedEdge.ts, user request
 * 2026-11-08 — the td filter keys' edge): a 1px rim light on the cream rim's top-left edge
 * and a 0.5px fillet, half-way between the rim and wall colours, over the wall's first
 * step. `face` is the rim the wall stands under (cream, or the sorted grey).
 */
const panelWall = (face: string, wall: string) => [
    roundedEdgeRimLight(face),
    roundedEdgeFillet(face, wall),
    ...WALL_STEPS.map((k) => `${k}px ${k}px 0 ${wall}`),
];
const panelCastShadow = (groundShadow: string, lift: number) => {
    const growth = 1 + (HELD_SHADOW_GROWTH - 1) * lift;
    const offset = (PANEL_WALL_PX + PANEL_SHADOW_REACH_PX * growth).toFixed(2);
    const blur = (PANEL_SHADOW_BLUR_PX * growth).toFixed(2);
    return `${offset}px ${offset}px ${blur}px ${groundShadow}`;
};

/**
 * The stock's whole box-shadow: wall and cast shadow (at `lift`). A sorted card is
 * GROUNDED — it stands on the ground rather than floating over it, so it casts no shadow
 * and never lifts; its wall is in SORTED_STOCK's grey.
 */
export const cardStockShadow = (sorted: boolean, groundShadow: string, lift = 0) =>
    (sorted
        ? panelWall(SORTED_STOCK.rim, SORTED_STOCK.wall)
        : [...panelWall(COLORS.cardFace, COLORS.cardWall), panelCastShadow(groundShadow, lift)]
    ).join(", ");

/**
 * A card-stock card PUSHED BACK — held under the finger, it stops FLOATING but is not
 * flattened: the panel keeps its whole 4px wall (it is still a thick card), and
 * only the cast shadow — the gap between the card and the ground, the thing that reads as
 * levitation — is gone. The face moves PRESS_SINK_PX down-right, toward where its shadow
 * fell, so the card reads as pushed back onto the ground rather than merely un-shadowed.
 * (A first version sank the face the full wall depth onto a bare outline; flush was too far
 * — user call 2026-11-06.) This is the `sorted` silhouette in the live wall colour.
 */
const PRESS_SINK_PX = 2;
const PRESSED_STOCK_SHADOW = panelWall(COLORS.cardFace, COLORS.cardWall).join(", ");

/**
 * The press of a card-stock card whose tap OPENS something (td's cards page → the cdp,
 * through MiniVocabCard `stock`): the app's raised-key press (theme/keycapPress.ts —
 * snaps, min held time from the app-wide delegate), pushed back diagonally (the light's
 * (1, 1) direction, the way the wall and shadow fall) rather than straight down. The tap's action fires on release (`click`), so the card
 * is down while held and the page changes as the finger lifts.
 *
 * Moves through `transform`. These cards are useScrollStretch track elements
 * (MiniVocabCardGrid), but the stretch writes the separate `translate` property, so the
 * two compose. (A press that moves past the delegate's drag slop — a scroll — lets the
 * card up at once anyway.)
 *
 * Spread AFTER any `&:hover` shadow: on touch, `:hover` sticks after a tap, and the
 * pressed selectors share its specificity, so the later one wins.
 */
export const cardStockPressSx = (groundShadow: string) =>
    keycapPressSx({
        restShadow: cardStockShadow(false, groundShadow, 0),
        pressedShadow: PRESSED_STOCK_SHADOW,
        pressedX: PRESS_SINK_PX,
        pressedY: PRESS_SINK_PX,
    });

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
    const panelInset = `${width * FLP_CARD_STOCK_INSET_RATIO}px`;
    const panelRadius = `${width * FLP_CARD_PANEL_RADIUS_RATIO}px`;
    return {
        boxShadow: cardStockShadow(sorted, groundShadow, 0),
        // The printed panel as a clip shape, under the same name `CardFaceSide` gives the
        // big face's: `CardIconLayer` reads it, so an advanced layout's icons are cut at the
        // panel's edge instead of painting over the cream rim — the mini mirrors the big
        // preview. (The mini's word/definition sit at fixed insets inside the panel already.)
        "--card-panel-clip": `inset(${panelInset} round ${panelRadius})`,
        "&::before": {
            content: '""',
            position: "absolute",
            inset: panelInset,
            borderRadius: panelRadius,
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

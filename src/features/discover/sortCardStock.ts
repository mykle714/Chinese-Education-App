import { keyframes } from "@mui/material/styles";
import { COLORS } from "../../theme/colors";
import { shadeHex } from "../deckTower/iso";
import { FLP_CARD_PANEL_RADIUS_RATIO, FLP_CARD_STOCK_INSET_RATIO } from "../flashcards/constants";
import { MINI_CARD_DIMENSIONS, MINI_CARD_RING, type MiniCardSize } from "../../components/miniCardFace";

/**
 * sortCardStock — the look of ancp's on-deck mini cards: the Deck Tower's card stock
 * (cream rim + inset beige panel, 2px iso wall, flat cast shadow on the ground), the grey
 * "already sorted" variant, and the resting levitation bob.
 *
 * Shared by the places a sort card's stock is drawn:
 *   - AddNewCardsPage → DraggableCard (the on-deck pack; adds drag lift + hover raise)
 *   - SkippedCardsSheet → RecyclableSkippedCard (the hidden skipped-cards grid)
 *   - deckTower/TowerCardsPage → the cards page under td's platform (through
 *     MiniVocabCard `stock`; the wall + cast shadow, no levitation)
 *
 * Layer: feature styling helper (src/features/discover) — pure values, no React.
 * Docs: docs/SORT_CARDS_REQUIREMENTS.md § 4.5 (card stock), § 5.1a (skipped sheet);
 *       docs/TOWER_STYLE_SHIFT.md § "Card stock"; docs/DECK_TOWER.md § "The cards page".
 */

// A card's solid wall — the card stock's thickness, seen below AND to the right of its
// face, as the bins' iso cards show their front and right walls. The artboard drew only a 6px bottom lip
// (`0 6px 0 --cardR`); by user request (2026-10-29) the wall shows on the right too and
// is as thick as a Deck Tower card: `CARD_THICKNESS` (deckTower/iso/cardStackMetrics.ts,
// 0.12 world units) at the tower scene's ~16.5px per unit ≈ 2px. A literal, not derived:
// the tower scene scales to fit its screen, so it has no fixed px-per-unit to import.
// box-shadow cannot slant, so the wall is the face's outline stepped along the extrusion
// vector (CARD_WALL_X, CARD_WALL_Y), one copy per px.
// The SORTED (already-in-library) card is the same stock in greys — see SORTED_STOCK.
export const CARD_WALL_X = 2;
export const CARD_WALL_Y = 2;
const CARD_WALL_STEPS = 2;
const cardWall = (color: string) =>
    Array.from({ length: CARD_WALL_STEPS }, (_, i) => {
        const k = (i + 1) / CARD_WALL_STEPS;
        return `${(CARD_WALL_X * k).toFixed(2)}px ${(CARD_WALL_Y * k).toFixed(2)}px 0 ${color}`;
    }).join(", ");
const CARD_LIP = cardWall(COLORS.cardWall);

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
const SORTED_CARD_LIP = cardWall(SORTED_STOCK.wall);
/** How faint a sorted card's print (icon, word, definition) is, under its grayscale. */
export const SORTED_PRINT_OPACITY = 0.4;

/**
 * The Deck Tower's CARD STOCK on a sort card (docs/TOWER_STYLE_SHIFT.md § "Card stock";
 * user request 2026-10-29), so the cards on deck look like the tower's own:
 *   - the face is the cream rim (`COLORS.cardFace`, passed as MiniCard `background`)
 *     with the beige printed panel inset in it — `FLP_CARD_STOCK_INSET_RATIO` of the
 *     card's width in from every edge, corners `FLP_CARD_PANEL_RADIUS_RATIO` — the same
 *     ratios CardFaceSide paints every flp face with;
 *   - the wall (CARD_LIP), and a flat CAST SHADOW on the ground (`cardCastShadow`) in the
 *     look's `groundShadow` — the iso shadow rule the tower and this page's floating
 *     platforms use. (`SHADOW.lifted`, the tower's held-card shadow, was tried
 *     2026-10-29: a soft 12%-ink blur, invisible on the tinted grounds.)
 * The panel is a `::before`, so it paints FIRST: MiniCard's icon layer, icon and text
 * all sit over it. Unlike the tower's stock it keeps the hairline ring (CLAUDE.md
 * "Buttons & cards").
 */
/**
 * The cast shadow scales with the wall, on both axes: it reaches CARD_SHADOW_PER_WALL ×
 * the wall's own extrusion right and down — the artboard's ratio (a 14px shadow drop
 * under a 6px lip), applied to the 2 × 2px wall, so ≈ 4.7px each way.
 */
const CARD_SHADOW_PER_WALL = 14 / 6;
/**
 * A held card is lifted further off the ground, so its shadow falls further away: at
 * full lift (`lift` = 1) the cast shadow's offset is HELD_SHADOW_GROWTH × its resting
 * offset. DraggableCard springs `lift` 0 → 1 on pickup and back to 0 on a miss.
 */
const HELD_SHADOW_GROWTH = 2.5;
const cardCastShadow = (groundShadow: string, lift = 0) => {
    const reach = CARD_SHADOW_PER_WALL * (1 + (HELD_SHADOW_GROWTH - 1) * lift);
    return `${(CARD_WALL_X * reach).toFixed(2)}px ${(CARD_WALL_Y * reach).toFixed(2)}px 0 ${groundShadow}`;
};
/**
 * The stock's whole box-shadow: hairline ring, wall, cast shadow (at `lift`). A sorted
 * card is GROUNDED — it stands on the ground rather than floating over it, so it casts no
 * shadow (its wall meets the ground) and never lifts. `ring` replaces the default
 * `MINI_CARD_RING` hairline (td's cards page draws a stronger one — TowerCardsPage
 * `TOWER_CARD_RING`).
 */
export const cardStockShadow = (sorted: boolean, groundShadow: string, lift = 0, ring = MINI_CARD_RING) =>
    sorted
        ? `${ring}, ${SORTED_CARD_LIP}`
        : `${ring}, ${CARD_LIP}, ${cardCastShadow(groundShadow, lift)}`;
export const sortCardStockSx = (size: MiniCardSize, sorted: boolean, groundShadow: string, ring = MINI_CARD_RING) => {
    const width = MINI_CARD_DIMENSIONS[size].width;
    return {
        boxShadow: cardStockShadow(sorted, groundShadow, 0, ring),
        "&::before": {
            content: '""',
            position: "absolute",
            inset: `${width * FLP_CARD_STOCK_INSET_RATIO}px`,
            borderRadius: `${width * FLP_CARD_PANEL_RADIUS_RATIO}px`,
            // `--mini-card-panel` lets a card with its OWN colour (an advanced-layout vet
            // card's `cardColor`, set by MiniVocabCard `stock`) fill the panel while the rim
            // stays cream — the flp card stock's rule (CardFaceSide). Unset on
            // every ancp card, so they keep the beige.
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

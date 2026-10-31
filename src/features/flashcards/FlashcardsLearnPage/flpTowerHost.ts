import type React from "react";
import type { FlpWorld } from "../../../../server/contracts/studyMode";
import type { PlateTones } from "../../../theme/towerPlate";

export type { PlateTones };

/**
 * flpTowerHost — the contract between the flp and the Deck Tower when the flp runs
 * INSIDE the tower page, laid over the tower scene (docs/DECK_TOWER.md § "Studying the
 * tower"), instead of on its own `/flashcards/learn` route.
 *
 * Layer: feature types (src/features/flashcards). FlashcardsLearnPage takes it as its
 * optional `tower` prop; without it the page is the ordinary routed flp, unchanged.
 * With it:
 *   - the session is the HOST's: its bar is `world`, always in Mix (no mode, category or
 *     collection — the tower is the whole Learning deck), whatever the URL says;
 *   - leaving calls `onExit` (the host climbs its camera back out) instead of navigating;
 *   - the page is transparent and its header is the over-the-sky study header
 *     (TowerStudyHeader), and its card stack behaves as the tower's top card
 *     (FlashCardSection `towerStack`);
 *   - its page buttons (Write it, Compare, More Info) are drawn as the tower's floor-plate
 *     push button, in white (`plateTones`; towerPlate.ts);
 *   - every swipe and undo is reported, so the host can take cards off its tower and put
 *     them back.
 *
 * Depended on by: FlashcardsLearnPage.tsx (reads it), FlashCardSection.tsx (via the page);
 * src/features/deckTower/useTowerStudy.ts (builds it).
 */
export interface FlpTowerHost {
    /** The bar this session studies (the tower's world). Always Mix. */
    world: FlpWorld;
    /**
     * Not being studied: the session is mounted, dealt and hidden under the tower, waiting
     * for the next tap on its tower (docs/DECK_TOWER.md § "Studying the tower" → "Parked sessions"). While parked
     * it draws no header, sets no tab title, raises no notice and narrates nothing; on
     * PARKING (a visit ending) it clears its undo, re-arms the sort offer and starts the
     * game-break counter over. Its working loop is kept.
     */
    parked: boolean;
    /** The study header's title (TowerStudyHeader) — the deck being studied. */
    title: string;
    /** The learner left the session (back arrow, or "Leave anyway" on the sort offer). */
    onExit: () => void;
    /** A card was swiped: true = correct (right). Fired at the swipe, before the server answers. */
    onMarked: (isCorrect: boolean) => void;
    /** A mark was undone; `wasCorrect` says which way it had been swiped. */
    onUndone: (wasCorrect: boolean) => void;
    /**
     * A game break took a card off the tower: a correct mark the server recorded on a card
     * the learner owns. The host holds these until the game ends (`onGameBreakChange`).
     */
    onGameCardCleared: () => void;
    /**
     * A break's game came up (true), or ended and started falling away (false). `onGround`:
     * it is drawn on the bare ground, so the deck fades for it too
     * (docs/DECK_TOWER.md § "Studying the tower" → "The platform fades").
     */
    onGameBreakChange: (up: boolean, onGround: boolean) => void;
    /**
     * The session's deal changed: how many cards the working loop holds, whether it is
     * still loading, and whether there is a card on top. `hasCard: false` once loaded
     * means the session has run dry (every card resting).
     */
    onLoopChange: (loop: { size: number; loading: boolean; hasCard: boolean }) => void;
    /**
     * The tower's count card lies over the cards (the dive onto it, and the climb after it
     * is put back): hidden at ONCE, with no fade — they are simply under it. The count card
     * itself is the host's (DeckTowerPage → TowerCoverCard), drawn over this page.
     */
    cardsCovered: boolean;
    /** The card's box — the host measures it to land its camera on the tower's top card. */
    cardFrameRef: React.Ref<HTMLDivElement>;
    /** The floor plate's tones, for the page's plate-style buttons (towerPlate.ts). */
    plateTones: PlateTones;
}

/**
 * cardStackMetrics.ts — how tall an IsoCardStack is for a deck of N cards
 * (docs/ISO_ART_FRAMEWORK.md § "IsoCardStack").
 *
 * Every card is drawn at one fixed thickness, whatever the deck size, with a seam under
 * each. A big deck simply grows TALL — a 500-card stack is ~190 world units and runs
 * off the top of the screen, which is the point: the height IS the deck size. (Until
 * 2026-10-17 the stack was capped at 11 units and its cards thinned to fit; that made a
 * 500-card deck look the same height as a 35-card one.)
 *
 * Depended on by: IsoCardStack.tsx (drawing). Callers fitting a viewBox should NOT fit
 * the stack's height — see DeckTowerPage.tsx.
 */

/**
 * World thickness of one card. 0.38 ≈ 6.3px on a ~390px-wide phone (where the Deck
 * Tower scene draws one world unit at ~16.5px); raised from 0.32 (~5.3px) on 2026-10-17
 * to make each card a pixel thicker.
 */
export const CARD_THICKNESS = 0.38;

export interface CardStackMetrics {
    /** Full (un-animated) body height — every card but the top one. */
    bodyHeight: number;
    /** The top card's thickness (the same as every other card's). */
    topThickness: number;
}

export function cardStackMetrics(count: number): CardStackMetrics {
    const n = Math.max(0, count);
    return { bodyHeight: Math.max(0, n - 1) * CARD_THICKNESS, topThickness: CARD_THICKNESS };
}

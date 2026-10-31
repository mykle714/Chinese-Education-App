/**
 * cardStackMetrics.ts — how tall an IsoCardStack is for a deck of N cards
 * (docs/ISO_ART_FRAMEWORK.md § "IsoCardStack").
 *
 * Every card is drawn at one fixed thickness, whatever the deck size, with a seam under
 * every 2.5 card thicknesses (`SEAM_SPACING_CARDS`). A big deck simply grows TALL — a 500-card stack is ~60 world units and runs
 * off the top of the screen, which is the point: the height IS the deck size. (Until
 * 2026-10-17 the stack was capped at 11 units and its cards thinned to fit; that made a
 * 500-card deck look the same height as a 35-card one.)
 *
 * Depended on by: IsoCardStack.tsx, IsoCardRuns.tsx (drawing; `seamHeights`). Callers fitting a viewBox should NOT fit
 * the stack's height — see DeckTowerPage.tsx.
 */

/**
 * World thickness of one card. 0.12 ≈ 2px on a ~390px-wide phone (where the Deck
 * Tower scene draws one world unit at ~16.5px). Raised from 0.32 (~5.3px) to 0.38
 * (~6.3px) on 2026-10-17; on 2026-10-22 halved to 0.19, halved again to 0.095 (~1.6px),
 * doubled back to 0.19 (~3.1px), then cut ~25% to 0.12 — chosen as a whole pixel count.
 */
export const CARD_THICKNESS = 0.12;

/**
 * Spacing between seams, in card thicknesses: 2 lines per 5 cards, evenly, ~5px apart. Not
 * one per card: at 0.12 units a per-card seam would be ~2px apart, so a 1px line under every
 * card would cover half the wall and shimmer as the platform bobs. A fractional spacing means
 * most seams fall partway up a card, deliberately: nothing else on the wall marks a card
 * edge, and on whole-card boundaries 2-in-5 could only alternate gaps of 2 and 3 cards, which
 * was tried and rejected on 2026-10-31 as non-uniform. (Every card was used briefly at 0.19
 * units, ~3.1px apart; every 10th, a ruler, was tried on 2026-10-22 and rejected: the wall
 * read as blocks, not cards; every other card (~4px) ran until 2026-10-31, and every third
 * (~6px) was tried that day and dropped.) Piece boundaries keep their own seam
 * regardless — the top card's underside (IsoCardStack), and a run's base / lid underside
 * (IsoCardRuns) — so the top card and cards that land on each other still read as separate.
 */
const SEAM_SPACING_CARDS = 2.5;

/**
 * The seam heights in [fromCards, toCards), in card thicknesses above the floor (fractional),
 * for a stack that settles at `count` cards. The floor itself never gets one. The grid is
 * counted DOWN from the top card's underside (count − 1 cards up), and carries on above it
 * for pieces still mid-collapse, so that always-drawn seam falls on the grid: counted up from the base instead,
 * the last grid seam could fall just under it (40 cards at every-2 → seams at 38 and 39),
 * a doubled line at the top of the tower. It depends only on the SETTLED count, so the
 * seams still stay put through a build-up.
 */
export function seamHeights(fromCards: number, toCards: number, count: number): number[] {
    const top = count - 1;
    const heights: number[] = [];
    // n counts seams down from the top card's underside; negative n is above it.
    let n = Math.floor((top - toCards) / SEAM_SPACING_CARDS) + 1;
    for (let h = top - n * SEAM_SPACING_CARDS; h >= fromCards && h > 0; h = top - ++n * SEAM_SPACING_CARDS) heights.push(h);
    return heights;
}

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

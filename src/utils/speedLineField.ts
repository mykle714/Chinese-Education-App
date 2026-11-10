/**
 * speedLineField.ts — the streak lanes of a camera dash: where each speed line runs, how
 * long, thick, fast and bright it is. Pure; no DOM.
 *
 * One field, two renderers, so the Deck Tower's world pan and the page-to-page dash draw
 * the very same streaks:
 *   - src/features/deckTower/SpeedLines.tsx (React, the world pan — useWorldPan.ts);
 *   - src/hooks/pageDash.ts → runPageDash (imperative DOM, the route dash).
 *
 * Seeded (mulberry32), so the field is the same on every dash.
 *
 * Docs: docs/DECK_TOWER.md § "Worlds → The pan", docs/LEAF_NODE_PAGES.md § "The dash transition".
 */

/** How many streaks are on screen. */
export const SPEED_LINE_COUNT = 16;

/** The fixed seed: the same field on every dash. */
const SPEED_LINE_SEED = 41;

/** One streak. Percentages are of the dash area; it crosses the whole width every `durationMs`. */
export interface SpeedLine {
    id: number;
    topPct: number;
    widthPct: number;
    heightPx: number;
    durationMs: number;
    /** Negative: each streak starts part-way across, so the field is full from the first frame. */
    delayMs: number;
    opacity: number;
}

/** A deterministic PRNG (mulberry32). */
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let r = Math.imul(a ^ (a >>> 15), 1 | a);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/** The streak field (`SPEED_LINE_COUNT` lanes). */
export function speedLineField(): SpeedLine[] {
    const rand = seededRandom(SPEED_LINE_SEED);
    return Array.from({ length: SPEED_LINE_COUNT }, (_, i) => ({
        id: i,
        topPct: 4 + rand() * 88,
        widthPct: 18 + rand() * 34,
        heightPx: 2 + Math.round(rand() * 2),
        durationMs: 260 + rand() * 220,
        delayMs: -rand() * 480,
        opacity: 0.45 + rand() * 0.45,
    }));
}

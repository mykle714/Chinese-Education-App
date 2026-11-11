/**
 * Fade a board's cells in one by one, each at its own RANDOM delay, so an opening board
 * sparkles in rather than arriving as one block (docs/FLP_GAME_BREAKS.md § 2 "playing":
 * a break's content arrives after the circle grow).
 *
 * Match Speed draws the same arrival with a CSS animation on each card's wrapper
 * (MatchSpeedCard → `match-speed-fade-in`, delays from `FADE_IN_MAX_DELAY_MS`), because its
 * cards also arrive one refill at a time. This helper is for a board that arrives whole
 * and stays: Word Search's letter grid.
 *
 * Web Animations rather than CSS, so it composes over a cell's own CSS `animation` (Word
 * Search's miss and hint shakes) instead of replacing it. `backwards` fill hides each cell
 * until its delay comes up, then lets go, so nothing lingers on the cell after its arrival.
 * Returns a canceller for the effect cleanup. Does nothing under reduced motion.
 *
 * Layer: games shared (DOM only, no React). Used by: WordSearchGrid.
 */

/** The window the random delays spread over, ms. */
export const STAGGER_FADE_IN_SPREAD_MS = 400;
/** Each cell's own fade, ms. */
export const STAGGER_FADE_IN_MS = 200;

export function staggerFadeIn(
    cells: Iterable<Element>,
    { spreadMs = STAGGER_FADE_IN_SPREAD_MS, durationMs = STAGGER_FADE_IN_MS }: { spreadMs?: number; durationMs?: number } = {},
): () => void {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        return () => undefined;
    }
    const animations: Animation[] = [];
    for (const cell of cells) {
        if (typeof cell.animate !== "function") continue;
        animations.push(
            cell.animate(
                // The same small rise in scale Match Speed's cards arrive with, so the two
                // boards read as one family.
                [{ opacity: 0, transform: "scale(0.88)" }, { opacity: 1, transform: "scale(1)" }],
                { duration: durationMs, delay: Math.random() * spreadMs, easing: "ease-out", fill: "backwards" },
            ),
        );
    }
    return () => animations.forEach((animation) => animation.cancel());
}

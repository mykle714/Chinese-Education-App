/**
 * deckFillNotices — the numbers behind acp's two deck-size notifications
 * (docs/SORT_CARDS_REQUIREMENTS.md § 5.4):
 *
 *   - the GOAL: sort at least `DECK_FILL_TARGET − today's deck` cards, so the learner's
 *     deck reaches about a 25-card stack at the start of the day;
 *   - the WARNING: today's deck is at or over `DECK_FILL_WARN_AT` (on arrival, or after a
 *     counted sort) — stop adding.
 *
 * "Today's deck" = the core world's OFF-COOLDOWN cards in all four utcm bands (the Deck
 * Tower's Learning-deck figure, `flpReadyCountsByBand`) + the cooling cards that come off
 * cooldown before the next 04:00 local reset (the app's day boundary), + the cards sorted
 * into Unfamiliar / Target / Comfortable on this visit. A Mastered sort does NOT count
 * (owner, 2026-11-14) — it starts a 180-day cooldown and never joins today's stack.
 *
 * LAYER: acp feature logic — pure, no React, no clock reads (callers pass `now`).
 * Depended on by: useDeckFillNotices.ts, src/__tests__/deckFillNotices.test.ts.
 */
import type { FlpUpcomingRelease } from "../../../server/contracts/flpReadiness";
import type { SortBucket } from "./starterPacksApi";

/** The deck size the goal fills toward: about a 25-card stack at the start of the day. */
export const DECK_FILL_TARGET = 25;

/** Today's deck at or above this size raises the "don't add too many" warning. */
export const DECK_FILL_WARN_AT = 40;

/** The local hour the study day turns over (the app-wide 04:00 boundary: streaks, focus mode). */
export const STUDY_DAY_START_HOUR = 4;

/**
 * The acp bins whose sorts grow today's deck: Unfamiliar, Target, Comfortable. Mastered
 * (`already-learned`) is left out by owner decision (2026-11-14).
 */
export const DECK_FILL_COUNTED_BUCKETS: ReadonlySet<SortBucket> = new Set<SortBucket>(["library", "target", "comfortable"]);

/**
 * Epoch ms of the next 04:00 local after `now` (strictly after: at 04:00:00 exactly, the
 * NEXT day's). Uses calendar arithmetic (`setDate`), not `+ 24h`, so a DST change in
 * between still lands on 04:00 wall-clock time.
 */
export function nextStudyDayStart(now: number): number {
    const boundary = new Date(now);
    boundary.setHours(STUDY_DAY_START_HOUR, 0, 0, 0);
    if (boundary.getTime() <= now) boundary.setDate(boundary.getDate() + 1);
    return boundary.getTime();
}

/**
 * Today's deck as it stood on arrival: every off-cooldown card (all bands) plus each
 * cooling card released before the next 04:00. `upcoming` is the server's 24 h release
 * schedule, which always covers the time to the next 04:00 (at most 24 h away).
 */
export function deckSizeToday(
    counts: Record<string, number>,
    upcoming: readonly FlpUpcomingRelease[],
    now: number,
): number {
    const readyNow = Object.values(counts).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
    const boundary = nextStudyDayStart(now);
    const releasedToday = upcoming.filter((r) => r.readyAt > now && r.readyAt < boundary).length;
    return readyNow + releasedToday;
}

/** How many of this visit's sorts count toward today's deck, from acp's per-bin session decks. */
export function countedSessionSorts(sessionDecks: Record<string, readonly unknown[]>): number {
    let n = 0;
    for (const [bucket, cards] of Object.entries(sessionDecks)) {
        if (DECK_FILL_COUNTED_BUCKETS.has(bucket as SortBucket)) n += cards.length;
    }
    return n;
}

export interface DeckFillState {
    /** Today's deck including this visit's counted sorts. */
    total: number;
    /** Cards still to sort to reach DECK_FILL_TARGET; 0 once reached. */
    toGo: number;
    /** Today's deck has reached DECK_FILL_WARN_AT. */
    full: boolean;
}

export function deckFillState(arrivalDeck: number, countedSorts: number): DeckFillState {
    const total = arrivalDeck + countedSorts;
    return { total, toGo: Math.max(0, DECK_FILL_TARGET - total), full: total >= DECK_FILL_WARN_AT };
}

// ── Copy (drafts — the owner will edit these) ────────────────────────────────────────

/** The goal banner. On arrival it names the minimum; once sorting, it counts down. */
export function deckFillGoalCopy(toGo: number, sortedSoFar: number): string {
    const cards = toGo === 1 ? "card" : "cards";
    return sortedSoFar === 0
        ? `Sort at least ${toGo} new ${cards} to fill today's deck.`
        : `${toGo} more ${cards} to fill today's deck.`;
}

/**
 * The warning banner. A learner who ARRIVES at or over the line (nothing sorted yet) is told
 * they need not add any; one who sorted their way over it is told to slow down.
 */
export function deckFillWarningCopy(total: number, sortedSoFar: number): string {
    return sortedSoFar === 0
        ? `Your deck already has ${total} cards due today. You don't need to add any more.`
        : `Your deck has ${total} cards due today. Adding many more may be hard to keep up with.`;
}

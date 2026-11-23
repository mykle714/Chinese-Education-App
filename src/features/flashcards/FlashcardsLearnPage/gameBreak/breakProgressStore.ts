/**
 * breakProgressStore — how far the learner is toward the next flp game break, kept per
 * device so the count survives a parked visit, a reload and a closed app
 * (docs/FLP_GAME_BREAKS.md § 1 → "The count persists").
 *
 * Layer: feature store (features/flashcards). localStorage only — a convenience, not a
 * record: a missing, unreadable or blocked store just means the count starts at 0.
 * Keyed by (user, language, world), so core / reading / writing each keep their own
 * count, per language, and two accounts on one device never share one.
 *
 * The stored value is always in [0, BREAK_INTERVAL − 1]: the number of cards dismissed
 * since the last break, modulo the interval. BREAK_INTERVAL − 1 means the next card is
 * the last one before a break (what a visit left mid-break saves).
 *
 * Depended on by: useGameBreak.ts.
 */

const KEY_PREFIX = "flp.breakProgress";

function storageKey(userId: string | number, language: string, world: string): string {
    return `${KEY_PREFIX}:${userId}:${language}:${world}`;
}

/** The stored count, or 0 when there is none, it is malformed, or storage is unavailable. */
export function readBreakProgress(userId: string | number, language: string, world: string, interval: number): number {
    try {
        const raw = window.localStorage.getItem(storageKey(userId, language, world));
        if (raw === null) return 0;
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 && n < interval ? n : 0;
    } catch {
        return 0;
    }
}

export function writeBreakProgress(userId: string | number, language: string, world: string, cards: number): void {
    try {
        window.localStorage.setItem(storageKey(userId, language, world), String(cards));
    } catch {
        // Private mode / blocked storage: the count just starts over next session.
    }
}

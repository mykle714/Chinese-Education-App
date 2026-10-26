/**
 * towerHeightStore.ts — the height the main world's Learning tower last stood at, kept
 * per device so the next visit opens at that height and ANIMATES to today's figure
 * (docs/DECK_TOWER.md § "Opening at the last height").
 *
 * Layer: page logic (feature module `src/features/deckTower`). localStorage only — a
 * convenience, not a record: a missing, unreadable or blocked store just means the tower
 * opens at its real height with nothing to animate. Keyed by (user, language, world,
 * deck); only the core world's Learning deck uses it today (the reading and writing
 * worlds are visited far less, so a stored height there would mean a large grow dropped
 * on the learner almost every visit).
 *
 * Depended on by: DeckTowerPage.tsx.
 */

const KEY_PREFIX = "deckTower.towerHeight";

function storageKey(userId: string | number, language: string, world: string, deck: string): string {
    return `${KEY_PREFIX}:${userId}:${language}:${world}:${deck}`;
}

/** The stored height, or null when there is none (or storage is unavailable). */
export function readTowerHeight(userId: string | number, language: string, world: string, deck: string): number | null {
    try {
        const raw = window.localStorage.getItem(storageKey(userId, language, world, deck));
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 ? n : null;
    } catch {
        return null;
    }
}

export function writeTowerHeight(userId: string | number, language: string, world: string, deck: string, cards: number): void {
    try {
        window.localStorage.setItem(storageKey(userId, language, world, deck), String(Math.max(0, Math.round(cards))));
    } catch {
        // Private mode / blocked storage: the next visit simply opens at the real height.
    }
}

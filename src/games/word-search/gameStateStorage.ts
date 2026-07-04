/**
 * Word Search — client-only save/resume for an in-progress board.
 *
 * No server/DB involvement (mirrors the hint meter's client-only design, see
 * docs/WORD_SEARCH_GAME.md §5a) — the whole board payload is already on the
 * client, so a single localStorage blob is enough to survive a page exit or
 * the app being backgrounded. See §5b for the pause/resume flow that reads
 * and writes this.
 *
 * The key is scoped per userId — without that, switching accounts in the same
 * browser (e.g. testing multiple test users) would resume the PREVIOUS
 * account's saved board, showing target words that have nothing to do with
 * the current user's library cards.
 */
import type { WordSearchResponse } from "./types";

const STORAGE_KEY_PREFIX = "wordSearch.savedGame.";

export interface SavedWordSearchState {
    data: WordSearchResponse;
    found: string[];
    elapsedMs: number;
    /** Whether the count-up timer had ever been started on this board — a
     *  board that was loaded but never touched should stay untouched on
     *  resume rather than starting the clock. */
    timerStarted: boolean;
    hintUnits: number;
    hintEntryKey: string | null;
    hintRevealCount: number;
    hintLocationRevealed: boolean;
    rewardedBonusWords: string[];
}

/** Persist the in-progress board so it survives a page exit / app backgrounding. */
export function saveGameState(userId: string, state: SavedWordSearchState): void {
    try {
        window.localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(state));
    } catch {
        // Storage full or disabled — the session just won't resume; non-fatal.
    }
}

/** Load a previously saved board, or null if none/unparseable/already complete. */
export function loadGameState(userId: string): SavedWordSearchState | null {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + userId);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as SavedWordSearchState;
        if (!parsed?.data?.grid || !Array.isArray(parsed.found)) return null;
        if (parsed.found.length >= parsed.data.words.length) return null; // stale, already won
        return parsed;
    } catch {
        return null;
    }
}

/** Clear the saved board (on win, restart, or once it's no longer resumable). */
export function clearGameState(userId: string): void {
    try {
        window.localStorage.removeItem(STORAGE_KEY_PREFIX + userId);
    } catch {
        // ignore
    }
}

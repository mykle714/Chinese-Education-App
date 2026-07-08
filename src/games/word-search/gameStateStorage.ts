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
 *
 * There is exactly ONE saved slot per user, SHARED across both modes
 * ("pinyin" / "no-pinyin"): the two hub entries now always start a fresh game
 * (warning first if a save exists — see GamesPage / WordSearchHubItem), and the
 * single saved board is resumed only from the dedicated resume card, which
 * restores it in whichever `mode` it was saved under. The mode therefore lives
 * IN the payload (`SavedWordSearchState.mode`), not in the key. See
 * docs/WORD_SEARCH_GAME.md §3 / §5b.
 */
import type { WordSearchResponse } from "./types";
import type { WordSearchMode } from "./constants";

const STORAGE_KEY_PREFIX = "wordSearch.savedGame.";

/** localStorage key for a given user's single saved board (mode-agnostic). */
function storageKey(userId: string): string {
    return `${STORAGE_KEY_PREFIX}${userId}`;
}

export interface SavedWordSearchState {
    /** Which board this snapshot is for — restored into this mode, and shown on
     *  the resume card. Both modes share one slot, so this is the only record of
     *  which one is parked. */
    mode: WordSearchMode;
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
        window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
    } catch {
        // Storage full or disabled — the session just won't resume; non-fatal.
    }
}

/** Load a previously saved board, or null if none/unparseable/already complete. */
export function loadGameState(userId: string): SavedWordSearchState | null {
    try {
        const raw = window.localStorage.getItem(storageKey(userId));
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
        window.localStorage.removeItem(storageKey(userId));
    } catch {
        // ignore
    }
}

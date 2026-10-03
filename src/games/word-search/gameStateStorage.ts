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
 * There is ONE saved slot per (user, mode). Each mode has exactly one launch
 * surface — "pinyin" is the Games hub's (WordSearchHubItem), "no-pinyin" the
 * Reading Center carousel's (ReadingGamesCarousel) — so a slot per mode is a slot
 * per surface: neither can resume, or clobber, the other's parked board. See
 * docs/WORD_SEARCH_GAME.md §3 / §5b.
 *
 * Until 2026-10-03 both modes shared ONE mode-agnostic slot (`wordSearch.savedGame.
 * <userId>`, mode carried in the payload). `loadGameState` still reads that legacy
 * key and moves a board into its mode's slot the first time that mode looks, so a
 * board parked before the split is not lost. ⚠️ The legacy read can be deleted once
 * no device can still hold such a save.
 */
import type { WordSearchResponse } from "./types";
import { TOTAL_WORDS, type WordSearchMode } from "./constants";

const STORAGE_KEY_PREFIX = "wordSearch.savedGame.";

/** localStorage key for a given user's saved board in one mode. */
function storageKey(userId: string, mode: WordSearchMode): string {
    return `${STORAGE_KEY_PREFIX}${mode}.${userId}`;
}

/** The pre-split, mode-agnostic key (read-only — see the header). */
function legacyStorageKey(userId: string): string {
    return `${STORAGE_KEY_PREFIX}${userId}`;
}

export interface SavedWordSearchState {
    /** Which mode this snapshot was played in. Redundant with the slot's key since
     *  the per-mode split, but kept: it is how a legacy (shared-slot) save is routed
     *  to its mode's slot, and it guards a restore into the wrong mode. */
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
    /** Words that received a hint on this board — they earn no flashcard mark when
     *  found (see WordSearchPage's `markWordFound`). Optional: snapshots written
     *  before hint-tracking existed simply restore as "nothing hinted". */
    hintedWords?: string[];
}

/** Persist the in-progress board so it survives a page exit / app backgrounding. */
export function saveGameState(userId: string, state: SavedWordSearchState): void {
    try {
        window.localStorage.setItem(storageKey(userId, state.mode), JSON.stringify(state));
    } catch {
        // Storage full or disabled — the session just won't resume; non-fatal.
    }
}

/** Parse a stored snapshot, or null if absent/unparseable/already complete. */
function parseSaved(raw: string | null): SavedWordSearchState | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as SavedWordSearchState;
        if (!parsed?.data?.grid || !Array.isArray(parsed.found)) return null;
        if (parsed.found.length >= parsed.data.words.length) return null; // stale, already won
        return parsed;
    } catch {
        return null;
    }
}

/** Load the saved board for `mode`, or null if none/unparseable/already complete. */
export function loadGameState(userId: string, mode: WordSearchMode): SavedWordSearchState | null {
    try {
        const own = parseSaved(window.localStorage.getItem(storageKey(userId, mode)));
        if (own) return own.mode === mode ? own : null;
        // Pre-split save: adopt it into this mode's slot if it was played in this mode.
        const legacy = parseSaved(window.localStorage.getItem(legacyStorageKey(userId)));
        if (legacy?.mode !== mode) return null;
        window.localStorage.setItem(storageKey(userId, mode), JSON.stringify(legacy));
        window.localStorage.removeItem(legacyStorageKey(userId));
        return legacy;
    } catch {
        return null;
    }
}

/** Clear `mode`'s saved board (on win, restart, or once it's no longer resumable). */
export function clearGameState(userId: string, mode: WordSearchMode): void {
    try {
        window.localStorage.removeItem(storageKey(userId, mode));
    } catch {
        // ignore
    }
}

/**
 * How many targets the PARKED board has — read off the saved payload, never from
 * `TOTAL_WORDS`. A save written before a board-size change (12 words until
 * 2026-08-28) still resumes and still plays to its own word count, so "3/12" must
 * keep saying 12 even once new boards are 9. `TOTAL_WORDS` remains the right number
 * for a board that has not been dealt yet.
 */
export function savedWordCount(saved: SavedWordSearchState): number {
    return saved.data.words.length || TOTAL_WORDS;
}

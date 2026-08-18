/**
 * Memory Map — client-only save/resume for an in-progress run.
 *
 * Word Search's model (src/games/word-search/gameStateStorage.ts) extended to hold
 * colours. No server involvement: a run is not server state (§ 1). The map — where each
 * word sits — IS server state and is never written here, so a corrupted or cleared save
 * costs the player their colours and nothing else. That asymmetry is deliberate: the
 * map is the thing the learner grows attached to, and no client action can move a word.
 *
 * ── WHY COLOURS ARE SAVED AT ALL ─────────────────────────────────────────────
 * The original design lost them on exit. That was reversed (Q10) once the run became
 * "colour the whole map" — up to 100 prompts is not a sitting, so a run that reset on
 * every exit would be a run nobody ever finished.
 *
 * ── KEYED PER (user, language) ───────────────────────────────────────────────
 * Per user for the same reason Word Search is: switching accounts in one browser must
 * not resume the previous account's colours. Per LANGUAGE additionally, because each
 * language has its own map and its own independent save (Q28) — switching to Spanish
 * and back must find the Chinese run exactly as it was left.
 */
import type { Camera, QueuedPrompt, WordOutcome } from "./types";

const STORAGE_KEY_PREFIX = "memoryMap.run.";

/** localStorage key for one user's run in one language. */
function storageKey(userId: string, language: string): string {
    return `${STORAGE_KEY_PREFIX}${userId}.${language}`;
}

export interface SavedMemoryMapRun {
    /**
     * The shuffled prompt order, fixed at run start (§ 3.2). Stored rather than
     * reshuffled on resume, because a reshuffle would re-prompt words the player had
     * already coloured and make the progress count meaningless.
     */
    queue: QueuedPrompt[];
    /** How far through `queue` the run is. */
    position: number;
    /**
     * Colour per vet id, for every word answered so far.
     *
     * Keyed by id rather than parallel to `queue` so that a word which LEFT the map
     * mid-run (graduated) simply stops being looked up, instead of shifting every
     * subsequent index by one.
     */
    outcomes: Record<number, WordOutcome>;
    camera: Camera;
}

/** Persist the run so it survives leaving the page or the app being backgrounded. */
export function saveRun(userId: string, language: string, run: SavedMemoryMapRun): void {
    try {
        window.localStorage.setItem(storageKey(userId, language), JSON.stringify(run));
    } catch {
        // Storage full or disabled — the run just won't resume. Non-fatal, and
        // deliberately silent: there is nothing the player could do about it.
    }
}

/**
 * Load a saved run, or null if there is none or it is unusable.
 *
 * Validates the SHAPE rather than the contents. Whether a saved word still exists on
 * the map is not knowable here — the map arrives from the server separately — so
 * reconciling the two is the run hook's job (see useMemoryMapRun), which drops queue
 * entries for words that have since left.
 */
export function loadRun(userId: string, language: string): SavedMemoryMapRun | null {
    try {
        const raw = window.localStorage.getItem(storageKey(userId, language));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as SavedMemoryMapRun;
        if (!Array.isArray(parsed?.queue) || typeof parsed?.position !== "number") return null;
        if (!parsed.outcomes || typeof parsed.outcomes !== "object") return null;
        return parsed;
    } catch {
        // Unparseable (hand-edited, or written by an older shape) — start fresh.
        return null;
    }
}

/** Clear the saved run — on Restart, and on Play Again after completion. */
export function clearRun(userId: string, language: string): void {
    try {
        window.localStorage.removeItem(storageKey(userId, language));
    } catch {
        // Nothing to do; the next save overwrites it anyway.
    }
}

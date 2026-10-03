import { fetchWordOfTheDay, localDayKey, type WordOfTheDay } from "../../api/wordOfTheDay";
import { fetchCollectionCards } from "../../api/collections";
import { ALL_COLLECTION_ID } from "../../../server/contracts/wire";
import type { VocabEntry } from "../../types";

/**
 * centerPrefetch — the two Mastery Center loads, shared between the fdp and the Centers
 * so a Center opened from the fdp paints from data the fdp already asked for.
 *
 *   • Word of the Day — the fdp WARMS it on landing (`prefetchWordOfTheDay`) for an
 *     account that has a Center button; `WordOfTheDayCard` then reads the same promise.
 *   • The card library (the "all" collection) — the fdp's panel ALREADY loads it
 *     (`useDecksPanel("core")`). Routing that load through here lets a Center's panel
 *     seed from it on mount and join it while it is still in flight, rather than
 *     starting the same request over.
 *
 * Module-level and in-memory on purpose: it lives exactly as long as the page session,
 * and both entries are keyed so a stale one is never served to the wrong reader —
 * Word of the Day by local date, the library by (user, language) plus a max age.
 *
 * Layer: feature data helper (src/features/flashcards). Calls go through src/api/*.
 * Docs: docs/READING_WRITING_CENTERS.md § "Prefetch from the fdp".
 */

// ── Word of the Day ────────────────────────────────────────────────────────────

type WordEntry = { day: string; promise: Promise<WordOfTheDay>; value: WordOfTheDay | null };
let wordEntry: WordEntry | null = null;

/**
 * The day's word — one request per local date, shared by every caller.
 *
 * Two results are NOT kept: a failure (the next caller retries), and a word whose
 * `content` is still null (the day's model call had not succeeded yet, so a later
 * request may come back with the full card body). Either way the caller that started
 * the request still gets its answer.
 */
export function loadWordOfTheDay(day: string = localDayKey()): Promise<WordOfTheDay> {
    if (wordEntry?.day === day) return wordEntry.promise;
    const entry: WordEntry = { day, promise: fetchWordOfTheDay(day), value: null };
    wordEntry = entry;
    entry.promise.then(
        (w) => {
            if (wordEntry !== entry) return;
            if (w.content) entry.value = w;
            else wordEntry = null;
        },
        () => { if (wordEntry === entry) wordEntry = null; }
    );
    return entry.promise;
}

/** The day's word if it has already arrived (complete) — lets the card paint on its first frame. */
export function peekWordOfTheDay(day: string = localDayKey()): WordOfTheDay | null {
    return wordEntry?.day === day ? wordEntry.value : null;
}

/** Fire-and-forget warm-up from the fdp. Errors are logged; the Center retries on mount. */
export function prefetchWordOfTheDay(): void {
    loadWordOfTheDay().catch((err) => console.error("[centerPrefetch] word of the day prefetch failed:", err));
}

// ── The card library ───────────────────────────────────────────────────────────

/**
 * How old a loaded library may be and still seed a Center's first paint. The Center
 * refreshes it in the background regardless; this only bounds how stale the FIRST
 * frame can be (the Centers' word grids are built once from the first library they
 * see, so this is also how stale their sampling can be).
 */
const LIBRARY_SEED_MAX_AGE_MS = 2 * 60 * 1000;

/** The request currently on the wire, if any. */
let inFlight: { key: string; promise: Promise<VocabEntry[]> } | null = null;
/** The last library that arrived. Kept across a refresh, so a failed refresh still leaves a seed. */
let landed: { key: string; cards: VocabEntry[]; at: number } | null = null;

/** `${userId}:${language}` — the server reads the library for the selected language. */
export const libraryKey = (userId: string | number, language: string | null | undefined) =>
    `${userId}:${language ?? ""}`;

/**
 * Load the library for `key`. While a load for the same key is IN FLIGHT this joins it;
 * otherwise it starts a fresh one. Every panel mount still refreshes — this removes the
 * duplicate request, it does not make the library sticky.
 */
export function loadCardLibrary(key: string): Promise<VocabEntry[]> {
    if (inFlight?.key === key) return inFlight.promise;
    const request = { key, promise: fetchCollectionCards(ALL_COLLECTION_ID) };
    inFlight = request;
    request.promise.then(
        (cards) => { landed = { key, cards, at: Date.now() }; },
        () => { /* the caller handles the error; `landed` keeps the last good copy */ }
    ).finally(() => { if (inFlight === request) inFlight = null; });
    return request.promise;
}

/** A recently landed library for `key`, or null — the seed for a panel's first paint. */
export function peekCardLibrary(key: string): VocabEntry[] | null {
    if (!landed || landed.key !== key || Date.now() - landed.at > LIBRARY_SEED_MAX_AGE_MS) return null;
    return landed.cards;
}

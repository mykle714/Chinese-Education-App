/**
 * collectionRef.ts — the ONE place that knows what a "collection of cards" is on
 * the client, and how one becomes a URL.
 *
 * A collection is any named set of the learner's cards that a CollectionViewPage
 * can render and a game/flp can be launched against. There are four kinds:
 *
 *   all        — every sorted card, mastered or not.
 *   learn-now  — every card the user sorted, minus the ones mastered in ONE bar.
 *                Three of these, exactly as `mastered` is: the core set is the fdp's
 *                default deck, and the reading/writing sets are what the matching
 *                Mastery Center lists.
 *   mastered   — the cards mastered in ONE bar. Three of these since migration 143
 *                (core / reading / writing), because a card has three independent
 *                bars and can be mastered in each; the reading and writing ones are
 *                offered only when that goal is set.
 *   deck       — a user-authored set (`decks`, migration 141).
 *
 * Everything downstream of a CollectionRef is deliberately AGNOSTIC to which kind it
 * holds: the launch sheet, the play buttons, the sort toolbar and the game fetches
 * all treat a collection as an opaque set of cards. Adding the two new Mastered
 * collections therefore touched this module and the fdp row list, and nothing else.
 *
 * WHICH collections a SURFACE offers is not decided here — that is
 * `builtinCollections.ts`, the shared list the fdp and the Games hub selector both
 * render. This module only says what a collection IS and how it becomes a URL.
 *
 * WHY A SHARED MODULE. Four surfaces have to agree on this: the collection page
 * (which one am I showing), the launch button (what do I append to the game URL),
 * every game page (what did I arrive with), and the flp mark call (what do I echo
 * back so refills stay inside the set). Five copies of `?deck=${id}` would drift
 * the moment a fourth kind is added, and the failure mode is silent — a round that
 * quietly draws from the whole library.
 *
 * Depended on by:
 *   src/features/flashcards/CollectionViewPage.tsx
 *   src/features/flashcards/FlashcardsDecksPage.tsx
 *   src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts
 *   src/games/{bubble-match,match-speed,word-search,speed-reading}/*
 * Server counterpart: `CollectionFilter` in server/services/OnDeckVocabService.ts
 * and `resolveCollection` in server/controllers/OnDeckVocabController.ts. The wire
 * VALUES themselves are shared rather than mirrored — `MASTERED_COLLECTION_IDS` and
 * `masteredCollectionBar` live in server/contracts/wire.ts, so the two sides cannot
 * drift on the spelling of `mastered-reading`. See docs/DECKS_FEATURE.md.
 */
import {
    ALL_COLLECTION_ID,
    LEARN_NOW_COLLECTION_IDS,
    MASTERED_COLLECTION_IDS,
    learnNowCollectionBar,
    masteredCollectionBar,
    parseMasteryBar,
    type MasteryBarId,
} from '../../../server/contracts/wire';
import {
    BUILTIN_COLLECTION_IDS,
    parseBuiltinCollectionId,
    type BuiltinCollectionId,
} from '../../../server/dal/shared/vetTable';

/** Which set of cards a page is showing / a round is drawn from. */
export type CollectionRef =
    | { kind: 'all' }
    | { kind: 'learn-now'; bar: MasteryBarId }
    | { kind: 'mastered'; bar: MasteryBarId }
    | { kind: 'deck'; deckId: number; name?: string };

/**
 * The built-in collections, as they appear in the `/flashcards/collection/:builtin`
 * route and in `?collection=`.
 *
 * The list itself lives SERVER-SIDE (`BUILTIN_COLLECTION_IDS`, vetTable.ts) beside
 * the WHERE fragment that gives each id its meaning, and is re-exported here rather
 * than restated — a collection the client can link to but the server cannot resolve
 * would be a dead page, and that is exactly the drift a second list invites.
 *
 * The core bar keeps the bare `mastered` id it has always had, so existing links and
 * bookmarks still resolve.
 */
export const BUILTIN_COLLECTIONS = BUILTIN_COLLECTION_IDS;
export type BuiltinCollection = BuiltinCollectionId;

/** Narrow a route param to a built-in collection id, or null if it isn't one. */
export function parseBuiltinCollection(raw: string | undefined): BuiltinCollection | null {
    return parseBuiltinCollectionId(raw);
}

/** The CollectionRef a built-in id names. */
export function builtinCollectionRef(id: BuiltinCollection): CollectionRef {
    const masteredBar = masteredCollectionBar(id);
    if (masteredBar) return { kind: 'mastered', bar: masteredBar };
    if (id === ALL_COLLECTION_ID) return { kind: 'all' };
    // Anything else is a Learn Now id; an unrecognized one falls back to the core set,
    // which is the same "widest sensible answer" rule the server's parser follows.
    return { kind: 'learn-now', bar: learnNowCollectionBar(id) ?? 'core' };
}

/**
 * Human-readable name for each bar's Mastered collection.
 *
 * All three lead with the word "Mastered" and end with what was mastered. The
 * reading/writing names used to read the other way round ("Reading Mastered"),
 * which sorted badly next to core's "Mastered Cards" and — now that the fdp tile
 * wraps a long name onto a second line — put the qualifier first. One word order
 * for all three, so every Mastered tile wraps to the same shape: "MASTERED" then
 * what was mastered.
 */
const MASTERED_TITLES: Record<MasteryBarId, string> = {
    core: 'Mastered Cards',
    reading: 'Mastered Reading',
    writing: 'Mastered Writing',
};

/** Human-readable title for a collection, used as the page title and in the launch sheet. */
export function collectionTitle(ref: CollectionRef): string {
    switch (ref.kind) {
        case 'all':
            return 'All Cards';
        case 'learn-now':
            // "Learn Now" is the user-facing name of the `library` bucket (CLAUDE.md
            // § Terminology) — the internal identifier stays `library` everywhere.
            //
            // All three bars share the ONE title: a Learn Now set is only ever shown
            // on the surface that is already about its bar (the fdp for core, a
            // Mastery Center for reading/writing), so the page's own name supplies
            // the qualifier and the tile would only repeat it.
            return 'Learn Now';
        case 'mastered':
            return MASTERED_TITLES[ref.bar];
        case 'deck':
            return ref.name ?? 'Deck';
    }
}

/** The built-in id naming a non-deck collection. */
export function builtinCollectionId(ref: CollectionRef): BuiltinCollection | null {
    switch (ref.kind) {
        case 'all':
            return ALL_COLLECTION_ID;
        case 'learn-now':
            return LEARN_NOW_COLLECTION_IDS[ref.bar];
        case 'mastered':
            return MASTERED_COLLECTION_IDS[ref.bar];
        case 'deck':
            return null;
    }
}

/** The route that renders a collection. */
export function collectionPath(ref: CollectionRef): string {
    if (ref.kind === 'deck') return `/flashcards/deck/${ref.deckId}`;
    return `/flashcards/collection/${builtinCollectionId(ref)}`;
}

/**
 * The `?bar=` LENS param (docs/DECKS_FEATURE.md § "Mastery Centers").
 *
 * A lens is not a collection: it does not change WHICH cards a page shows, only which
 * mastery bar that page reads them through. So it rides as its own param rather than
 * being folded into the collection id — the two are orthogonal, and a deck has a lens
 * without having a built-in id at all.
 *
 * Built-in collections that are themselves per-bar (`learn-now-reading`,
 * `mastered-writing`, …) carry their lens in the id and need no param; the collection
 * page infers it (`lensFromCollection`). The param exists for the sets that are
 * bar-agnostic — a user deck, All Cards, and the card-detail page — when they are
 * opened from inside a Center.
 *
 * `core` is the default everywhere, so it is never written into a URL: a link with no
 * `?bar=` means the ordinary account-wide view, exactly as it did before Centers.
 */
export const LENS_PARAM = 'bar';

/** Append the lens param to a path, unless it is the default (`core`). */
export function withLens(path: string, lens: MasteryBarId): string {
    if (lens === 'core') return path;
    const [base, existing] = path.split('?');
    const search = new URLSearchParams(existing ?? '');
    search.set(LENS_PARAM, lens);
    return `${base}?${search.toString()}`;
}

/** Read a lens off a URL's search params. Anything unrecognized means `core`. */
export function lensFromSearch(search: URLSearchParams): MasteryBarId {
    return parseMasteryBar(search.get(LENS_PARAM)) ?? 'core';
}

/**
 * The lens a COLLECTION implies on its own — a per-bar built-in set is always read
 * through its own bar, so `/flashcards/collection/mastered-reading` needs no `?bar=`.
 * Returns null when the set implies nothing (All Cards, a deck), leaving the URL's
 * `?bar=` (or `core`) to decide.
 */
export function lensFromCollection(ref: CollectionRef | null): MasteryBarId | null {
    if (!ref) return null;
    if (ref.kind === 'learn-now' || ref.kind === 'mastered') return ref.bar;
    return null;
}

/**
 * The query params a game/flp launch must carry to stay inside this collection.
 *
 * **`all` returns NOTHING**, and that is correct rather than a gap: every game and the
 * flp already draw from every sorted card, so `all` IS the default pool and a clause
 * for it would restate the query's own `vetPlayableClause()`.
 *
 * `learn-now` used to return nothing for that same reason, and that stopped being
 * true when `all` arrived: Learn Now is "sorted AND not core-mastered", which is a
 * real narrowing, and a round launched from it was quietly including mastered cards
 * the page does not list. It now sends its id like any other narrowing collection.
 */
export function collectionLaunchParams(ref: CollectionRef): Record<string, string> {
    if (ref.kind === 'deck') return { deck: String(ref.deckId) };
    if (ref.kind === 'all') return {};
    const id = builtinCollectionId(ref);
    return id ? { collection: id } : {};
}

/** Append a collection's launch params to a path, preserving any params already on it. */
export function withCollectionParams(path: string, ref: CollectionRef | null): string {
    if (!ref) return path;
    const params = collectionLaunchParams(ref);
    const keys = Object.keys(params);
    if (keys.length === 0) return path;

    const [base, existing] = path.split('?');
    const search = new URLSearchParams(existing ?? '');
    for (const key of keys) search.set(key, params[key]);
    return `${base}?${search.toString()}`;
}

/**
 * Recover the collection a surface was launched with, from its own URL search
 * params. Returns null for an ordinary unrestricted launch.
 *
 * Every game page and the flp call this on mount and pass the result back down to
 * their fetches — a page that forgets to would silently play the whole library.
 */
export function collectionFromSearch(search: URLSearchParams): CollectionRef | null {
    const rawDeck = search.get('deck');
    if (rawDeck) {
        const deckId = parseInt(rawDeck, 10);
        // A malformed id means "no restriction" rather than a crash — but note the
        // server 404s on a well-formed id that isn't the caller's, so a stale deck
        // link fails loudly there instead of quietly widening the pool here.
        if (Number.isInteger(deckId) && deckId > 0) return { kind: 'deck', deckId };
    }
    const builtin = parseBuiltinCollection(search.get('collection') ?? undefined);
    return builtin ? builtinCollectionRef(builtin) : null;
}

/**
 * The body fields `POST /api/flashcards/mark` needs so a flp refill stays inside
 * the collection. Mirrors the `deckId` / `collection` fields the mark route reads.
 */
export function collectionMarkFields(
    ref: CollectionRef | null
): { deckId?: number; collection?: string } {
    if (!ref) return {};
    if (ref.kind === 'deck') return { deckId: ref.deckId };
    // Same rule as the launch params: everything a refill must stay inside sends its
    // id; `all` sends nothing because it narrows nothing.
    const { collection } = collectionLaunchParams(ref);
    return collection ? { collection } : {};
}

/**
 * A deck's persistent pastel accent, derived from its id rather than stored.
 *
 * The `decks` table deliberately has no `color` column: a derived color is stable
 * for the life of the deck, costs no migration, and cannot drift out of sync with
 * anything. The palette is the app's existing accent family (theme/colors.ts), so
 * deck rows sit in the same visual system as the Home/Games hub cards.
 *
 * Modulo over the id gives adjacent decks different colors, which is what the eye
 * actually wants in a list; it is not trying to be unique per deck.
 */
export const DECK_ACCENTS = [
    '#BAD7F2', // blueAccent
    '#BAF2D8', // greenAccent
    '#F2E2BA', // yellowAccent
    '#D8BAF2', // purpleAccent
    '#F2BAC9', // redAccent
] as const;

export function deckAccentColor(deckId: number): string {
    return DECK_ACCENTS[Math.abs(deckId) % DECK_ACCENTS.length];
}

/**
 * The saturated body tone paired with each entry of DECK_ACCENTS, for the deck TILE
 * (which needs two tones: a card body and a lighter inner fill). Index-aligned with
 * DECK_ACCENTS, so `deckTileColors` can read both from one modulo.
 */
const DECK_MAINS = [
    '#779BE7', // blueMain
    '#05C793', // greenMain
    '#FF9E5A', // yellowMain
    '#9B8BD4', // purpleMain
    '#EF476F', // redMain
] as const;

/** A deck's two-tone tile palette, derived from its id exactly as its accent is. */
export function deckTileColors(deckId: number): { main: string; accent: string } {
    const index = Math.abs(deckId) % DECK_ACCENTS.length;
    return { main: DECK_MAINS[index], accent: DECK_ACCENTS[index] };
}

/**
 * The launch params as a query-string SUFFIX (`"&deck=12"`, or `""` when
 * unrestricted), for the several game fetches that build their query by string
 * concatenation rather than URLSearchParams.
 *
 * Always starts with `&`, so it appends to a query that already has at least one
 * param — which every caller's does.
 */
export function collectionQuerySuffix(ref: CollectionRef | null): string {
    if (!ref) return '';
    return Object.entries(collectionLaunchParams(ref))
        .map(([key, value]) => `&${key}=${encodeURIComponent(value)}`)
        .join('');
}

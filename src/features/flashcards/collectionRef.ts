/**
 * collectionRef.ts — the ONE place that knows what a "collection of cards" is on
 * the client, and how one becomes a URL.
 *
 * A collection is any named set of the learner's cards that a CollectionViewPage
 * can render and a game/flp can be launched against. There are three kinds:
 *
 *   learn-now  — every card the user sorted into Learn Now, minus the mastered
 *                ones. The built-in default deck.
 *   mastered   — the cards whose overall utcm category is Mastered.
 *   deck       — a user-authored set (`decks`, migration 141).
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
 * and `resolveCollection` in server/controllers/OnDeckVocabController.ts —
 * keep the param names in step. See docs/DECKS_FEATURE.md.
 */

/** Which set of cards a page is showing / a round is drawn from. */
export type CollectionRef =
    | { kind: 'learn-now' }
    | { kind: 'mastered' }
    | { kind: 'deck'; deckId: number; name?: string };

/** The two built-in collections, as they appear in the `/flashcards/collection/:builtin` route. */
export const BUILTIN_COLLECTIONS = ['learn-now', 'mastered'] as const;
export type BuiltinCollection = (typeof BUILTIN_COLLECTIONS)[number];

/** Narrow a route param to a built-in collection id, or null if it isn't one. */
export function parseBuiltinCollection(raw: string | undefined): BuiltinCollection | null {
    return BUILTIN_COLLECTIONS.includes(raw as BuiltinCollection) ? (raw as BuiltinCollection) : null;
}

/** Human-readable title for a collection, used as the page title and in the launch sheet. */
export function collectionTitle(ref: CollectionRef): string {
    switch (ref.kind) {
        case 'learn-now':
            // "Learn Now" is the user-facing name of the `library` bucket (CLAUDE.md
            // § Terminology) — the internal identifier stays `library` everywhere.
            return 'Learn Now';
        case 'mastered':
            return 'Mastered Cards';
        case 'deck':
            return ref.name ?? 'Deck';
    }
}

/** The route that renders a collection. */
export function collectionPath(ref: CollectionRef): string {
    return ref.kind === 'deck'
        ? `/flashcards/deck/${ref.deckId}`
        : `/flashcards/collection/${ref.kind}`;
}

/**
 * The query params a game/flp launch must carry to stay inside this collection.
 *
 * `learn-now` returns NOTHING, and that is correct rather than a gap: every game
 * and the flp already draw from the sorted library, so Learn Now is the default
 * pool. The server has no `collection=learn-now` value for the same reason.
 */
export function collectionLaunchParams(ref: CollectionRef): Record<string, string> {
    switch (ref.kind) {
        case 'deck':
            return { deck: String(ref.deckId) };
        case 'mastered':
            return { collection: 'mastered' };
        case 'learn-now':
            return {};
    }
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
    if (search.get('collection') === 'mastered') return { kind: 'mastered' };
    return null;
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
    if (ref.kind === 'mastered') return { collection: 'mastered' };
    return {};
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

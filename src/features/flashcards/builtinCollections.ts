/**
 * builtinCollections.ts — the ONE list of built-in collections a surface offers, and
 * which section each one sits in.
 *
 * ── What a collection list is now ─────────────────────────────────────────────
 * Three ideas, and deliberately no more:
 *
 *   All Cards   — every sorted card, mastered or not
 *   Learn Now   — the ones still being learned (sorted, core bar not Mastered)
 *   Mastered    — the ones finished, ONE collection per active mastery bar
 *
 * The per-band collections (Unfamiliar / Target / Comfortable) were removed: a utcm
 * band is a property of one card's progress, not a set a learner studies, and its
 * membership changes under you on every mark. See the note in server/contracts/wire.ts.
 *
 * ── The one conditional rule ──────────────────────────────────────────────────
 * Mastered is its own SECTION only when the account pursues a reading or writing
 * goal, i.e. only when there is more than one Mastered collection to distinguish.
 * With core alone, a captioned section holding a single tile is a heading for
 * nothing, so that tile joins the Collections section and the list reads as three peers.
 *
 * ── Why it is shared ──────────────────────────────────────────────────────────
 * Two surfaces render this list — the fdp tile rows and the Games hub's "Playing
 * with …" selector — and they must agree: a collection a learner can open on
 * /decks but cannot play a game with (or the reverse) is a silent inconsistency,
 * and the fdp is the source of truth for what exists. Each surface still owns its
 * own PRESENTATION (tiles vs. menu rows) and its own deck fetch; only the set of
 * built-in collections, their order, their colors and their grouping live here.
 *
 * Layer: feature module (src/features/flashcards), imported by src/games — the same
 * direction `selectedCollection.ts` is already imported in.
 *
 * Depended on by:
 *   src/features/flashcards/FlashcardsDecksPage.tsx  (tiles + counts)
 *   src/games/GamesCollectionSelector.tsx            (menu rows)
 * See docs/DECKS_FEATURE.md § "Which collections exist" and docs/GAMES_FEATURE.md.
 */
import { activeBars, type MasteryGoals, type MasteryBarId } from '../../utils/masteryCompute';
import { BAND_COLORS, LEARN_NOW_COLORS, MASTERY_BAR_COLORS } from '../../utils/categoryColors';
import { collectionTitle, type CollectionRef } from './collectionRef';

/**
 * The two sections a built-in collection can be listed under.
 *
 * These strings are USER-VISIBLE: the /decks sheet uses them as its section
 * captions and the Games hub's collection selector renders `entry.group`
 * verbatim as its `ListSubheader`. Rename here and both surfaces follow — which
 * is the point, since the selector's grouping is documented as "matching the
 * decks page's sections".
 */
export type CollectionGroup = 'Collections' | 'Mastered';

export interface BuiltinCollectionEntry {
    /** Stable per-entry key — a React key, and the class-name/test suffix each surface appends. */
    key: string;
    ref: CollectionRef;
    label: string;
    /** The tile's two-tone palette; the selector uses `main` alone for its dot. */
    colors: { main: string; accent: string };
    group: CollectionGroup;
}

/**
 * Does the account get a separate Mastered section?
 *
 * True exactly when a second Mastered collection exists to tell apart from the first.
 * Exported because the fdp needs it for the section CAPTION and its separator, which
 * are page furniture rather than list entries.
 */
export function hasMasteredSection(goals: MasteryGoals): boolean {
    return goals.reading || goals.writing;
}

/**
 * Every built-in collection the account has, in display order.
 *
 * Order is All → Learn Now → Mastered(core, reading, writing), which is ascending
 * narrowness: the whole library, the part still in progress, then the finished parts.
 */
export function builtinCollectionEntries(goals: MasteryGoals): BuiltinCollectionEntry[] {
    const separateMastered = hasMasteredSection(goals);
    const masteredGroup: CollectionGroup = separateMastered ? 'Mastered' : 'Collections';

    const cards: BuiltinCollectionEntry[] = [
        {
            key: 'all',
            ref: { kind: 'all' },
            label: collectionTitle({ kind: 'all' }),
            colors: BAND_COLORS.All,
            group: 'Collections',
        },
        {
            key: 'learn-now',
            ref: { kind: 'learn-now' },
            label: collectionTitle({ kind: 'learn-now' }),
            colors: LEARN_NOW_COLORS,
            group: 'Collections',
        },
    ];

    const mastered: BuiltinCollectionEntry[] = activeBars(goals).map((bar: MasteryBarId) => {
        const ref: CollectionRef = { kind: 'mastered', bar };
        return {
            key: `mastered-${bar}`,
            ref,
            label: collectionTitle(ref),
            colors: MASTERY_BAR_COLORS[bar],
            group: masteredGroup,
        };
    });

    return [...cards, ...mastered];
}

/**
 * The card count shown on a built-in collection's tile, from the two count hooks the
 * fdp already loads — no extra request, and no third endpoint to keep in step.
 *
 *   all       — the sum of the four core bands, which is exactly what its page lists
 *   learn-now — the three UNMASTERED bands (the collection's own SQL is
 *               `core category <> 'Mastered'`, so this mirrors it by construction)
 *   mastered  — that bar's own total, from `useMasteredCounts`
 *
 * Returns undefined for a deck ref (decks carry their own `cardCount`).
 */
export function builtinCollectionCount(
    ref: CollectionRef,
    categoryCounts: Record<string, number>,
    masteredCounts: Record<MasteryBarId, number>
): number | undefined {
    const band = (name: string) => categoryCounts[name] || 0;
    const unmastered = band('Unfamiliar') + band('Target') + band('Comfortable');

    switch (ref.kind) {
        case 'all':
            return unmastered + band('Mastered');
        case 'learn-now':
            return unmastered;
        case 'mastered':
            return masteredCounts[ref.bar];
        case 'deck':
            return undefined;
    }
}

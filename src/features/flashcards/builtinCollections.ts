/**
 * builtinCollections.ts — the ONE list of built-in collections a surface offers, and
 * which section each one sits in.
 *
 * ── What a collection list is now ─────────────────────────────────────────────
 * Three ideas, and deliberately no more:
 *
 *   All Cards   — every sorted card, mastered or not
 *   Learn Now   — the ones still being learned (sorted, that bar not Mastered)
 *   Mastered    — the ones finished in that bar
 *
 * ── Two lists, because there are two kinds of surface ─────────────────────────
 *   `lensCollectionEntries(lens)`     — ONE bar's two sets (Learn Now, Mastered).
 *       What a LENS-SCOPED surface renders: the fdp (core) and the two Mastery
 *       Centers (reading / writing). Always two tiles in one group.
 *   `builtinCollectionEntries(goals)` — the GOAL-driven list, for the Games hub's
 *       "Playing with …" selector, where the learner is choosing a set to play
 *       rather than looking at one skill.
 *
 * The per-band collections (Unfamiliar / Target / Comfortable) were removed: a utcm
 * band is a property of one card's progress, not a set a learner studies, and its
 * membership changes under you on every mark. See the note in server/contracts/wire.ts.
 *
 * ── Where Mastered sits ───────────────────────────────────────────────────────
 * CORE Mastered is ALWAYS a Collections entry. It is the third of the three peer
 * ideas above ("everything / still learning / finished"), and it belongs beside them
 * whatever else the account is pursuing — a learner who turns on a writing goal
 * should not find their Mastered tile has moved to a different section.
 *
 * The separate "Mastered" SECTION therefore holds only the PER-SKILL bars —
 * Mastered Reading and Mastered Writing — and exists only in the GOAL-driven list,
 * where the Games hub renders `entry.group` as its caption. The lens list has no such
 * section: it shows one bar, so its Mastered tile always sits in Collections.
 *
 * ── Why it is shared ──────────────────────────────────────────────────────────
 * Several surfaces render one of these lists — the fdp tile rows, both Mastery
 * Center pages and the Games hub's "Playing with …" selector — and they must agree
 * on what a collection IS: a collection a learner can open on /decks but cannot play
 * a game with (or the reverse) is a silent inconsistency.
 *
 * ⚠️ ONE deliberate divergence between the two: `lensCollectionEntries` has no
 * **All Cards** entry, because every panel lists those cards inline at the bottom of
 * its own scroller. The entry lives on in `builtinCollectionEntries`, so the Games hub
 * still offers All Cards as a playable set and its route still resolves. Do not "fix"
 * that by adding it back — see docs/DECKS_FEATURE.md § "Which collections exist".
 *
 * Each surface still owns its own PRESENTATION (tiles vs. menu rows) and its own
 * deck fetch; only the set of built-in collections, their order, their colors and
 * their grouping live here.
 *
 * Layer: feature module (src/features/flashcards), imported by src/games — the same
 * direction `selectedCollection.ts` is already imported in.
 *
 * Depended on by:
 *   src/features/flashcards/DecksPanelBody.tsx       (tiles + counts, all lenses)
 *   src/features/flashcards/useDecksPanel.ts         (the lens's entry list)
 *   src/games/GamesCollectionSelector.tsx            (menu rows)
 * See docs/DECKS_FEATURE.md § "Which collections exist" and docs/GAMES_FEATURE.md.
 */
import { activeBars, type MasteryGoals, type MasteryBarId } from '../../utils/masteryCompute';
import {
    BAND_COLORS, LEARN_NOW_COLORS, LEARN_NOW_HUE, MASTERY_BAR_COLORS, MASTERY_BAR_HUES,
} from '../../utils/categoryColors';
import type { RampHue } from '../../theme/colors';
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
    /**
     * The same colour as a RAMP hue KEY, for surfaces that need a third tier of it —
     * the saturated `ink`. `LibraryDuo`'s ACTIVE (filtering) tile is the caller: a
     * pastel fill cannot say "this filter is on" on its own, so the active tile takes
     * this hue's ink for its ring, its glyph and its figure. Carried beside `colors`
     * rather than replacing it because the two are derived from the same hue anyway
     * (categoryColors.ts) and the menu surfaces only ever want the fill.
     */
    hue: RampHue;
    group: CollectionGroup;
}

/**
 * The built-in collections ONE LENS offers, in display order: that bar's Learn Now and
 * that bar's Mastered — two tiles, one group, whichever bar it is.
 *
 * This is the list the decks PANEL renders on all three of its hosts: the fdp (lens
 * `core`) and the two Mastery Centers (lens `reading` / `writing`). A lens-scoped
 * surface never shows another bar's sets, which is the whole point of the split: the
 * fdp answers "how am I doing at KNOWING these words" and a Center answers the same
 * question about one skill.
 *
 * ⚠️ NO **All Cards** TILE, on any lens. The panel lists those cards inline at the
 * bottom of its own scroller, so a tile would cost a navigation to reach a grid the
 * learner is already scrolling toward — the same surface-local omission the fdp has
 * always made, now stated in the list rather than filtered out by the page. The
 * COLLECTION is untouched: its route still works and `builtinCollectionEntries` still
 * offers it to the Games hub as a playable set. Do not "fix" this by adding it back —
 * see docs/DECKS_FEATURE.md § "Which collections exist".
 */
export function lensCollectionEntries(lens: MasteryBarId): BuiltinCollectionEntry[] {
    const learnNow: CollectionRef = { kind: 'learn-now', bar: lens };
    const mastered: CollectionRef = { kind: 'mastered', bar: lens };
    return [
        {
            key: `learn-now-${lens}`,
            ref: learnNow,
            label: collectionTitle(learnNow),
            colors: LEARN_NOW_COLORS,
            hue: LEARN_NOW_HUE,
            group: 'Collections',
        },
        {
            key: `mastered-${lens}`,
            ref: mastered,
            label: collectionTitle(mastered),
            colors: MASTERY_BAR_COLORS[lens],
            hue: MASTERY_BAR_HUES[lens],
            group: 'Collections',
        },
    ];
}

/**
 * Every built-in collection the account has, in display order — the GOAL-driven list,
 * rendered by the Games hub's "Playing with …" selector.
 *
 * Order is All → Learn Now (core) → Mastered(core, reading, writing), which is
 * ascending narrowness: the whole library, the part still in progress, then the
 * finished parts.
 *
 * GROUPING is decided per bar: `core` is always a Collections entry (it is the third
 * peer idea), and the reading/writing bars are always the Mastered section — which the
 * surface only renders when it has entries (hasMasteredSection).
 *
 * ⚠️ Only ONE Learn Now is offered here, the core one. The per-bar Learn Now sets
 * exist (docs/DECKS_FEATURE.md § "Mastery Centers") but a game selector listing three
 * sets called "Learn Now" would be unreadable, and a reading game launched from core
 * Learn Now is a perfectly sensible round. The Centers are where the per-bar sets are
 * chosen from.
 */
export function builtinCollectionEntries(goals: MasteryGoals): BuiltinCollectionEntry[] {

    const cards: BuiltinCollectionEntry[] = [
        {
            key: 'all',
            ref: { kind: 'all' },
            label: collectionTitle({ kind: 'all' }),
            colors: BAND_COLORS.All,
            hue: 'grey',
            group: 'Collections',
        },
        {
            key: 'learn-now',
            ref: { kind: 'learn-now', bar: 'core' },
            label: collectionTitle({ kind: 'learn-now', bar: 'core' }),
            colors: LEARN_NOW_COLORS,
            hue: LEARN_NOW_HUE,
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
            hue: MASTERY_BAR_HUES[bar],
            // core beside All/Learn Now; the per-skill bars in their own section.
            group: bar === 'core' ? 'Collections' : 'Mastered',
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
 *               `<that bar's> category <> 'Mastered'`, so this mirrors it by
 *               construction — PROVIDED the caller hands in counts banded by the
 *               same bar, which is why useDecksPanel fetches them per lens)
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

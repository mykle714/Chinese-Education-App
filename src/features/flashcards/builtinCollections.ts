/**
 * builtinCollections.ts — the built-in collections a decks panel offers, and their
 * tile counts.
 *
 * ── What a collection list is now ─────────────────────────────────────────────
 * Three ideas, and deliberately no more:
 *
 *   All Cards   — every sorted card, mastered or not
 *   Learn Now   — the ones still being learned (sorted, that bar not Mastered)
 *   Mastered    — the ones finished in that bar
 *
 * ── One list, for the lens-scoped surfaces ────────────────────────────────────
 *   `lensCollectionEntries(lens)` — ONE bar's two sets (Learn Now, Mastered).
 *       What a LENS-SCOPED surface renders: the fdp (core) and the two Mastery
 *       Centers (reading / writing). Always two tiles.
 *
 * The Games hub's "Playing with …" selector used to have a second, goal-driven list
 * here (`builtinCollectionEntries`). It was deleted on 2026-10-03 when that selector
 * was narrowed to All Cards + decks — see src/games/GamesCollectionSelector.tsx.
 *
 * The per-band collections (Unfamiliar / Target / Comfortable) were removed: a utcm
 * band is a property of one card's progress, not a set a learner studies, and its
 * membership changes under you on every mark. See the note in server/contracts/wire.ts.
 *
 * ── Where Mastered sits ───────────────────────────────────────────────────────
 * Every lens's Mastered tile is a Collections entry beside its Learn Now — a lens
 * shows one bar, so there is no separate Mastered section.
 *
 * ⚠️ `lensCollectionEntries` has no **All Cards** entry, because every panel lists
 * those cards inline at the bottom of its own scroller. The collection itself still
 * exists — its route resolves and the Games hub selector offers it (building its own
 * row). Do not "fix" that by adding a tile back — see docs/DECKS_FEATURE.md
 * § "Which collections exist".
 *
 * Each surface still owns its own PRESENTATION and its own deck fetch; only the set
 * of built-in collections, their order and their colors live here.
 *
 * Layer: feature module (src/features/flashcards).
 *
 * Depended on by:
 *   src/features/flashcards/DecksPanelBody.tsx       (tiles + counts, all lenses)
 *   src/features/flashcards/useDecksPanel.ts         (the lens's entry list)
 * See docs/DECKS_FEATURE.md § "Which collections exist" and docs/GAMES_FEATURE.md.
 */
import type { MasteryBarId } from '../../utils/masteryCompute';
import {
    LEARN_NOW_COLORS, LEARN_NOW_HUE, MASTERY_BAR_COLORS, MASTERY_BAR_HUES,
} from '../../utils/categoryColors';
import type { RampHue } from '../../theme/colors';
import { collectionTitle, type CollectionRef } from './collectionRef';

export interface BuiltinCollectionEntry {
    /** Stable per-entry key — a React key, and the class-name/test suffix each surface appends. */
    key: string;
    ref: CollectionRef;
    label: string;
    /** The tile's two-tone palette. */
    colors: { main: string; accent: string };
    /**
     * The same colour as a RAMP hue KEY, for surfaces that need another tier of it —
     * the MID. `LibraryDuo`'s ACTIVE (filtering) tile is the caller: a pastel fill
     * cannot say "this filter is on" on its own, so the active tile takes an ink ring
     * plus a halo in this hue's mid tier (v2 has no per-hue ink). Carried beside `colors`
     * rather than replacing it because the two are derived from the same hue anyway
     * (categoryColors.ts) and the menu surfaces only ever want the fill.
     */
    hue: RampHue;
}

/**
 * The built-in collections ONE LENS offers, in display order: that bar's Learn Now and
 * that bar's Mastered — two tiles, whichever bar it is.
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
 * COLLECTION is untouched: its route still works and the Games hub selector still
 * offers it as a playable set. Do not "fix" this by adding it back —
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
        },
        {
            key: `mastered-${lens}`,
            ref: mastered,
            label: collectionTitle(mastered),
            colors: MASTERY_BAR_COLORS[lens],
            hue: MASTERY_BAR_HUES[lens],
        },
    ];
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

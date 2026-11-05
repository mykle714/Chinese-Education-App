/**
 * collectionGlyph.ts — the ONE mapping from a collection to the glyph that stands
 * for it — today on the Deck Tower cards page's filter keys (TowerFilterKeys).
 *
 * Kept OUT of `builtinCollections.ts` on purpose. That module is the shared list of
 * WHICH collections exist and deliberately owns no presentation. (Its other reader, the
 * Games hub's collection selector, drew menu rows with no icon; it was deleted with
 * collection-scoped launches on 2026-11-04.)
 *
 * The mapping is exhaustive over `CollectionRef`, so a fifth kind of collection is a
 * type error here rather than a silently glyph-less key.
 *
 * It returns a Material Symbols NAME rather than an element (decision D3): its first
 * host, a shelf spine, sized the glyph in `cqw` against its own width, which it cannot
 * do to an opaque `@mui/icons-material` element. Renamed from `collectionIcon` when that changed —
 * the old name returned a `ReactNode`, and a silent type swap under the same name
 * would have compiled at some call sites.
 *
 * Layer: feature module (src/features/flashcards) — presentation helper.
 *
 * Depended on by: src/features/deckTower/TowerFilterKeys.tsx.
 * The Account page's utcm-band row has its own map in src/components/DeckBuckets.tsx
 * (components/ must not import from features/ — docs/FRONTEND_LAYERING.md).
 * See docs/DECK_TOWER.md § "The cards page".
 */
import type { CollectionRef } from "./collectionRef";

/**
 * The glyph for one collection.
 *
 *   all              — a card stack: the whole library.
 *   learn-now        — `autorenew`: the set in rotation, still coming back around.
 *   mastered (core)  — `check_circle`, a check in a circle: the set that is DONE. It and
 *                      learn-now read as a matched pair of STATUS glyphs (in rotation vs
 *                      finished) rather than two unrelated objects. The reading and
 *                      writing bars still get the glyph of the SKILL they mastered (an
 *                      open book / a pencil) rather than three identical checks, which
 *                      would defeat the point of the glyph.
 */
export function collectionGlyph(ref: CollectionRef): string {
    switch (ref.kind) {
        case "all":
            return "style";
        case "learn-now":
            return "autorenew";
        case "mastered":
            switch (ref.world) {
                case "reading":
                    return "menu_book";
                case "writing":
                    return "edit";
                default:
                    return "check_circle";
            }
    }
}

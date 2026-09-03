/**
 * collectionGlyph.ts — the ONE mapping from a collection to the glyph that stands
 * for it on a shelf spine.
 *
 * Kept OUT of `builtinCollections.ts` on purpose. That module is the shared list of
 * WHICH collections exist (the fdp spines and the Games hub selector both read it) and
 * it deliberately owns no presentation: the selector draws menu rows with a color dot
 * and wants no icon at all. A glyph is spine presentation, so it lives here, beside the
 * only surface that renders spines.
 *
 * The mapping is exhaustive over `CollectionRef`, so a fifth kind of collection is a
 * type error here rather than a silently glyph-less spine.
 *
 * It returns a Material Symbols NAME rather than an element (decision D3): the spine
 * sizes the glyph in `cqw` against its own width, which it cannot do to an opaque
 * `@mui/icons-material` element. Renamed from `collectionIcon` when that changed —
 * the old name returned a `ReactNode`, and a silent type swap under the same name
 * would have compiled at some call sites.
 *
 * Layer: feature module (src/features/flashcards) — presentation helper.
 *
 * Depended on by: src/features/flashcards/DecksPanelBody.tsx.
 * The Account page's utcm-band row has its own map in src/components/DeckBuckets.tsx
 * (components/ must not import from features/ — docs/FRONTEND_LAYERING.md).
 * See docs/DECKS_FEATURE.md § "Slots, and the glyph on the foot".
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
 *   deck             — a folder: a set the user assembled themselves.
 */
export function collectionGlyph(ref: CollectionRef): string {
    switch (ref.kind) {
        case "all":
            return "style";
        case "learn-now":
            return "autorenew";
        case "mastered":
            switch (ref.bar) {
                case "reading":
                    return "menu_book";
                case "writing":
                    return "edit";
                default:
                    return "check_circle";
            }
        case "deck":
            return "folder";
    }
}

/**
 * collectionIcon.tsx — the ONE mapping from a collection to the glyph that stands
 * for it on a DeckTile.
 *
 * Kept OUT of `builtinCollections.ts` on purpose. That module is the shared list of
 * WHICH collections exist (the fdp tiles and the Games hub selector both read it) and
 * it deliberately owns no presentation: the selector draws menu rows with a color dot
 * and wants no icon at all. A glyph is tile presentation, so it lives here, beside the
 * only surface that renders tiles.
 *
 * The mapping is exhaustive over `CollectionRef`, so a fifth kind of collection is a
 * type error here rather than a silently icon-less tile.
 *
 * Layer: feature module (src/features/flashcards) — presentation helper.
 *
 * Depended on by: src/features/flashcards/FlashcardsDecksPage.tsx.
 * The Account page's utcm-band row has its own map in src/components/DeckBuckets.tsx
 * (components/ must not import from features/ — docs/FRONTEND_LAYERING.md).
 * See docs/DECKS_FEATURE.md § "Which collections exist".
 */
import StyleOutlinedIcon from '@mui/icons-material/StyleOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import type { CollectionRef } from './collectionRef';

/**
 * The glyph for one collection, as a bare element — DeckTile sizes and fades it.
 *
 *   all              — a card stack: the whole library.
 *   learn-now        — a graduation cap: the part still being studied.
 *   mastered (core)  — a trophy; the reading and writing bars get the icon of the
 *                      SKILL they mastered (an open book / a pencil) rather than three
 *                      identical trophies, which would defeat the point of the glyph.
 *   deck             — a folder: a set the user assembled themselves.
 */
export function collectionIcon(ref: CollectionRef): React.ReactNode {
    switch (ref.kind) {
        case 'all':
            return <StyleOutlinedIcon />;
        case 'learn-now':
            return <SchoolOutlinedIcon />;
        case 'mastered':
            switch (ref.bar) {
                case 'reading':
                    return <MenuBookOutlinedIcon />;
                case 'writing':
                    return <EditOutlinedIcon />;
                default:
                    return <EmojiEventsOutlinedIcon />;
            }
        case 'deck':
            return <FolderOutlinedIcon />;
    }
}

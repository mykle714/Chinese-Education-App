// Barrel for the bento primitive (docs/SHELF_REDESIGN.md § A4). Import from here
// rather than reaching into the individual files, so a caller sees the whole
// vocabulary — grid, tile, strip, sub-tile, collection chip — in one import.
export {
    default as Bento,
    BentoTile,
    BentoStrip,
    BentoSubTile,
    type BentoTileProps,
    type BentoTileVariant,
    type BentoStripProps,
    type BentoSubTileProps,
} from "./Bento";
export { default as CollectionChip, type CollectionChipProps } from "./CollectionChip";

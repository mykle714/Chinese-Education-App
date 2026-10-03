// Barrel for the bento primitive (docs/SHELF_REDESIGN.md § A4). Import from here
// rather than reaching into the individual files, so a caller sees the whole
// vocabulary — grid, tile, card shell, collection chip — in one import.
export {
    default as Bento,
    BentoTile,
    TILE_VARIANTS,
    type BentoTileProps,
    type BentoTileVariant,
} from "./Bento";
export {
    default as CardShell,
    CARD_SHELL,
    CARD_TITLE_SX,
    type CardShellProps,
    type CardShellPin,
} from "./CardShell";
export { default as CollectionChip, type CollectionChipProps } from "./CollectionChip";

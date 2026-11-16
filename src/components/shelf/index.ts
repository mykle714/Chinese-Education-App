// Barrel for the shelf primitive (docs/SHELF_REDESIGN.md § A3). Import from here
// rather than reaching into the individual files, so a caller sees the whole
// vocabulary — container, header, row, note, spine — in one import.
export { default as Shelf, ShelfRow, ShelfHeader, ShelfNote } from "./Shelf";
export { default as Spine, type SpineProps } from "./Spine";
export { relativeSpineHeights, SPINE_VARIANTS, type SpineVariant } from "./spineGeometry";

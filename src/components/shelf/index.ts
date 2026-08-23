// Barrel for the shelf primitive (docs/SHELF_REDESIGN.md § A3). Import from here
// rather than reaching into the individual files, so a caller sees the whole
// vocabulary — container, header, row, note, spine, add-spine — in one import.
export { default as Shelf, ShelfRow, ShelfHeader, ShelfNote } from "./Shelf";
export { default as Spine, type SpineProps } from "./Spine";
export { default as AddSpine, type AddSpineProps } from "./AddSpine";
export { spineHeight, SPINE_VARIANTS, SPINE_BANDS, type SpineVariant } from "./spineGeometry";

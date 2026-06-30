// Class selector matching the root of every advanced-row dropdown (align / order / snap /
// shift / contrast). These MUI Menu/Popover surfaces are PORTALED to <body>, so they are not
// DOM-descendants of `.card-edit-toolbar`. Anything that needs to recognize "the press landed
// inside an open dropdown" must key off these portaled classes. Used by the toolbar's own
// outside-press handler (useToolbarMenus) AND by the page's outside-tap deselect (which only
// sees these presses because React synthetic events bubble through the React tree, not the DOM
// tree). Keep this in sync with the className on each <Menu>/<Popover> in CardEditToolbar.
// See docs/CARD_ICON_LAYOUT.md.
//
// Lives in its own module (rather than CardEditToolbar.tsx) so useToolbarMenus can import it
// without a circular dependency on the component. CardEditToolbar re-exports it for callers
// that historically imported it from there (e.g. FlashcardsLearnPage).
export const TOOLBAR_DROPDOWN_SELECTOR =
    ".card-edit-toolbar__align-menu, .card-edit-toolbar__order-popover, .card-edit-toolbar__snap-menu, .card-edit-toolbar__shift-menu, .card-edit-toolbar__contrast-menu";

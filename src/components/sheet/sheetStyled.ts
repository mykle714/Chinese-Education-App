import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import { COLORS } from "../../theme/colors";

/**
 * Styled surfaces for `SheetPanel` — the app's modal/persistent bottom sheet.
 *
 * These moved out of `features/flashcards/FlashcardsLearnPage/styled.ts` when SheetPanel
 * itself became shared (the flp eip, the /decks sheet, the scp, both cdps and the
 * compare sheet all mount one). Per docs/FRONTEND_LAYERING.md, a file a second feature
 * imports moves to a shared home rather than being reached across the feature boundary.
 * The `Eic`/`InfoSheet` names are kept verbatim: they are the eip's originals, they
 * appear in a dozen comments across the flp, and renaming them is a separate pass from
 * moving them.
 *
 * LAYER: shared presentational. They read only theme tokens (`theme.palette.flashcard.*`)
 * and know nothing about flashcards, compare, or any other feature.
 */

// Scrim overlay behind the modal info sheet — tap to close.
export const EicScrim = styled(Box)(({ theme }) => ({
    position: "absolute",
    inset: 0,
    background: theme.palette.flashcard.scrim,
    animation: "eicScrimIn 0.18s ease-out both",
    zIndex: 10,
    "@keyframes eicScrimIn": {
        from: { opacity: 0 },
        to: { opacity: 1 },
    },
}));

// Modal bottom sheet for the EIP. Height is set inline by InfoCardSection
// (measured natural height on mount, adjustable via grabber drag) and
// position is fixed to the bottom of the parent.
export const InfoSheetContainer = styled(Box)(({ theme }) => ({
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // WHITE, not the page ground: a sheet is a surface that sits ON the page, and the
    // design paints all three of them (`.sheet`, `.eic`, `.pnl`) `var(--white)` over
    // `--paper`. It used to take `flashcard.background` — the same value as the page
    // behind it — which only read as a sheet because of its shadow.
    background: COLORS.white,
    borderRadius: "20px 20px 0 0",
    padding: "10px 0 18px",
    display: "flex",
    flexDirection: "column",
    zIndex: 11,
    boxShadow: theme.palette.flashcard.sheetShadow,
}));

// Symmetric vertical padding for the panel header's row — see the centring note below.
const SHEET_HEADER_PAD_Y = 12;

// Slot for the panel's HEADER — a plain, unclipped wrapper whose only job is to be the
// drag target `SheetPanel` binds (the whole header resizes the panel) and to refuse to
// shrink when the body overflows.
//
// It used to be a CLIPPING slot: zero height, `overflow: hidden`, opacity 0, with
// SheetPanel interpolating height/opacity as the sheet grew into the top of the screen
// (the "merge header"). The header is permanent chrome now — present at every panel
// height — so there is nothing left to clip or ramp (2026-09-05, see SheetPanel's
// `title` prop). Renamed from `SheetMergeHeaderSlot` to match.
export const SheetHeaderSlot = styled(Box)({
    flexShrink: 0,
    // VERTICAL CENTRING. `PageHeader`'s node spec pads 23px ABOVE its row and 0 below
    // (SIZE_SPEC.node) — correct on a page, where that padding is the gap under the
    // status bar and there is nothing below the header but the page. In a panel the
    // header is a BAND with a grabber above it and the body below, so the same asymmetry
    // reads as content shoved against the band's bottom edge. Equal padding centres the
    // title, the ✕ and the flame in it, at roughly the height the 23/0 version had.
    "& .page-header": {
        paddingTop: `${SHEET_HEADER_PAD_Y}px`,
        paddingBottom: `${SHEET_HEADER_PAD_Y}px`,
    },
});

// Centered grabber pill at the top of the info sheet.
export const InfoSheetGrabber = styled(Box)(({ theme }) => ({
    width: 44,
    height: 5,
    borderRadius: 5,
    background: theme.palette.flashcard.grabber,
    flexShrink: 0,
}));

// ── Sheet edge fade ───────────────────────────────────────────────────────────
// The "content dissolves rather than being sliced" treatment every scrollable
// surface in the app wears at the edges of its scroll area. The BOTTOM band is
// where a panel differs from a page: a page spends the footer bar's height on it
// (`EDGE_FADE_MASK`, MobileTabScreen), while a SHEET or PANEL has no footer to
// clear — a modal sheet holds `useHideFooter` for its whole lifetime — so its
// fade runs out AT its own bottom edge across a short band, instead of reserving
// 164px of the sheet for emptiness.
//
// The mask is anchored to the SCROLLER's box, not to the scrolled content, so
// the bands stay parked at the edges while the content moves between them.
//
// ⚠️ A mask clips its entire rendered subtree, `position: fixed` descendants
// included (see src/components/overlayHost.ts). Never put one on a box that
// hosts an overlay — portal the overlay out first.
//
// Used by: DecksPanelBody (sheet variant), SheetBody, InfoCardPanelBody's tab
// panes, ChallengeSheet's scroller. Documented in docs/SHELF_REDESIGN.md.
// BOTH edges, like a page: rows dissolve as they scroll up out of the panel just as
// they do on the way down. The two bands are the page's 28/34 scaled to the panel's
// tighter geometry, keeping the same top-is-slightly-shorter proportion — a panel is a
// smaller box and a page-sized band eats a visible fraction of it.
const SHEET_EDGE_FADE_TOP_BAND = 20;
export const SHEET_EDGE_FADE_BAND = 24;
export const SHEET_EDGE_FADE_MASK =
    `linear-gradient(to bottom, transparent 0, #000 ${SHEET_EDGE_FADE_TOP_BAND}px, ` +
    `#000 calc(100% - ${SHEET_EDGE_FADE_BAND}px), transparent 100%)`;
// Bottom band only. For a scroller whose first row must stay solid — nothing uses this
// today; it exists so "no top fade" is a stated choice rather than a re-derived string.
export const SHEET_EDGE_FADE_MASK_NO_TOP =
    `linear-gradient(to bottom, #000 0, #000 calc(100% - ${SHEET_EDGE_FADE_BAND}px), transparent 100%)`;

// Spread into any scroller's `sx` to wear the fade. Both spellings, because
// iOS Safari still needs the prefixed property.
export const sheetEdgeFadeSx = {
    maskImage: SHEET_EDGE_FADE_MASK,
    WebkitMaskImage: SHEET_EDGE_FADE_MASK,
} as const;

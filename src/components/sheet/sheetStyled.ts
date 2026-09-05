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

// Clipping slot for the sheet's MERGE HEADER (see SheetPanel's writeMergeChrome).
// It holds a real PageHeader but starts at zero height with `overflow: hidden`, so the
// header is fully laid out — and therefore measurable — from the first paint while
// showing nothing. SheetPanel interpolates its height/opacity as the sheet grows into
// the top of the screen, which is what turns the sheet into a page.
export const SheetMergeHeaderSlot = styled(Box)({
    height: 0,
    opacity: 0,
    overflow: "hidden",
    flexShrink: 0,
    // Off until the header is fully merged in; SheetPanel flips it (see writeMergeChrome).
    pointerEvents: "none",
});

// Centered grabber pill at the top of the info sheet.
export const InfoSheetGrabber = styled(Box)(({ theme }) => ({
    width: 44,
    height: 5,
    borderRadius: 5,
    background: theme.palette.flashcard.grabber,
    flexShrink: 0,
}));

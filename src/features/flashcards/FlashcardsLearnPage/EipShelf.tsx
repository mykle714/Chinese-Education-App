import { Box } from "@mui/material";
import type { useDrag } from "@use-gesture/react";
import { InfoSheetGrabber } from "../../../components/sheet/sheetStyled";
import { useEipColors } from "./useEipPalette";

/**
 * EipShelf — the LOWER panel of an upper-band sheet (design `.tabw` + `.body`): the white
 * shelf under the tinted upper panel. Rounded top corners, a solid 3px `edge` lip above
 * it, its own small grabber (a resize handle, like the whole upper panel), then the
 * host's content. The sheet's ground shows in its corners.
 *
 * One component for both sheets that use the band + shelf layout, so they cannot drift:
 *   - the eip (InfoCardSection) — the content tabs and the tab body;
 *   - the Compare panel (features/flashcards/compare/CompareSheet) — the dictionary search
 *     and the AI comparison.
 *
 * Reads the palette from `EipPaletteProvider` (useEipColors), so it must sit under one.
 *
 * Layer: feature component (src/features/flashcards).
 * Depended on by: InfoCardSection, compare/CompareSheet.
 * Docs: docs/EIP_SHEET_GESTURES.md § Telescope; docs/WORD_COMPARE_FEATURE.md § Layout.
 */
interface EipShelfProps {
    /** SheetPanel's header-drag binder — the grabber zone resizes the sheet. */
    bindHeaderDrag: ReturnType<typeof useDrag>;
    children: React.ReactNode;
}

// The shelf's top corner radius and the lip that stands above it (design `.tabw`).
const SHELF_RADIUS_PX = 24;
const SHELF_LIP_PX = 3;

export default function EipShelf({ bindHeaderDrag, children }: EipShelfProps) {
    const colors = useEipColors();
    return (
        <Box
            className="eip-shelf"
            sx={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                background: colors.shelf,
                borderRadius: `${SHELF_RADIUS_PX}px ${SHELF_RADIUS_PX}px 0 0`,
                boxShadow: `0 -${SHELF_LIP_PX}px 0 ${colors.edge}`,
                paddingTop: "8px",
            }}
        >
            <Box
                className="eip-shelf__drag-zone"
                {...bindHeaderDrag()}
                sx={{ display: "flex", justifyContent: "center", paddingBottom: "11px", touchAction: "none", flexShrink: 0 }}
            >
                <InfoSheetGrabber
                    className="eip-shelf__grabber"
                    style={{ width: 40, background: colors.shelfGrab }}
                />
            </Box>
            {children}
        </Box>
    );
}

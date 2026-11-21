import type { ComponentProps } from "react";
import { Box, type SxProps, type Theme } from "@mui/material";
import ReaderTapOverlay from "./ReaderTapOverlay";

type Inset = number | { xs: number; sm: number };

interface ReadingTapRegionProps extends ComponentProps<typeof ReaderTapOverlay> {
    /**
     * How far the region reaches PAST the reading box's own edges, px (negative = outward):
     * the Reader pushes it over its content gutters to the screen's sides and bottom
     * (owner's call 2026-11-17: tap-to-navigate covers the whole screen below the strip).
     * 0 = exactly the reading box (cyoa's inspected choice label).
     */
    left?: Inset;
    right?: Inset;
    bottom?: Inset;
    /** Runs before the overlay sees a press (the Reader hands focus back from its search field). */
    onPointerDownCapture?: () => void;
    className?: string;
    sx?: SxProps<Theme>;
}

/**
 * ReadingTapRegion — the frame that places ReaderTapOverlay (tap-to-navigate: the back /
 * forward thirds, the long-press word jump and sentence press, the scroll proxy) over a
 * reading box. Put it inside the box's `position: relative` parent; it lies over that
 * parent from its top edge, widened by `left` / `right` / `bottom`.
 *
 * Only a positioning frame: `pointer-events: none`, the overlay inside re-enables them. On
 * desktop the overlay renders nothing, and the frame must not swallow clicks meant for the
 * textarea.
 *
 * Layer: shared presentation (src/reading). Rendered by ReaderDocumentPage (the document)
 * and StoryPlayPage (the passage, and the inspected choice label — docs/CYOA_FEATURE.md § 3.2).
 */
function ReadingTapRegion({ left = 0, right = 0, bottom = 0, onPointerDownCapture, className, sx, ...overlay }: ReadingTapRegionProps) {
    return (
        <Box
            className={className ?? "reading-tap-region"}
            onPointerDownCapture={onPointerDownCapture}
            sx={[
                { position: "absolute", top: 0, left, right, bottom, pointerEvents: "none" },
                ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
            ]}
        >
            <ReaderTapOverlay {...overlay} />
        </Box>
    );
}

export default ReadingTapRegion;

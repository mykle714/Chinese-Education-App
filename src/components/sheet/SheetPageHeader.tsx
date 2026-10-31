import { forwardRef, useImperativeHandle, useRef } from "react";
import { Box } from "@mui/material";
import type { useDrag } from "@use-gesture/react";
import PageHeader from "../PageHeader";
import type { SheetTelescopeHandle } from "./SheetPanel";

/**
 * SheetPageHeader — a sheet header that BECOMES a page header at max: a real leaf
 * PageHeader (⌄ + title) with no ✕ and no grabber. For a sheet whose maximized state
 * should be indistinguishable from a drill-in page. Today: AccountSheet.
 *
 * It matches the eip's caret at both ends of its travel (EipUpperPanel):
 *   - open height: the caret sits on the same line as the eip's trail-row caret;
 *   - max: caret and title land on exactly a leaf page's pixels.
 *
 * Those two positions are 10px apart, and SheetPanel's TELESCOPE supplies the difference:
 * `extra` here is a plain spacer rather than a title row, so the frame reveals it only as
 * the sheet is pulled to max. SheetPanel's merged top padding adds the status-bar inset.
 *
 * The host passes SheetPanel `telescopeRef`, `showClose={false}`, `showGrabber={false}`
 * and `edgePadding={false}`, then renders this first from the `children` render function,
 * wiring `dismiss` to `onClose`. The whole header is a resize handle; filterTaps keeps
 * the caret tappable.
 *
 * Layer: shared presentational (src/components/sheet). Depended on by: AccountSheet.
 * Docs: docs/EIP_SHEET_GESTURES.md § Page-style sheet header.
 */

// The eip's trail-row caret centre is 28px below the sheet's top (10px pad + half its 36px
// row); PageHeader's leaf chevron is 22px tall, so its row starts at 28 − 11 = 17px.
const OPEN_HEADER_TOP_PX = 17;
// PageHeader's leaf `padTop` (SIZE_SPEC.leaf) minus the above: the max-only extra.
const MAX_EXTRA_TOP_PX = 27 - OPEN_HEADER_TOP_PX;

interface SheetPageHeaderProps {
    title: string;
    /** The caret's action — SheetPanel's `dismiss`. */
    onClose: () => void;
    bindHeaderDrag: ReturnType<typeof useDrag>;
}

const SheetPageHeader = forwardRef<SheetTelescopeHandle, SheetPageHeaderProps>(function SheetPageHeader(
    { title, onClose, bindHeaderDrag },
    ref,
) {
    const frameRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const extraRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(ref, () => ({
        get frame() { return frameRef.current; },
        get content() { return contentRef.current; },
        get extra() { return extraRef.current; },
    }), []);

    return (
        <Box
            ref={frameRef}
            className="sheet-page-header"
            {...bindHeaderDrag()}
            sx={{
                flexShrink: 0,
                // Height is owned by SheetPanel (writeTelescope); starts closed.
                height: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                // Bottom-anchored, so the spacer is clipped off the top until max.
                justifyContent: "flex-end",
                touchAction: "none",
                userSelect: "none",
            }}
        >
            <Box ref={contentRef} className="sheet-page-header__content" sx={{ flexShrink: 0 }}>
                <Box ref={extraRef} className="sheet-page-header__max-spacer" sx={{ height: MAX_EXTRA_TOP_PX }} />
                <Box
                    className="sheet-page-header__row"
                    sx={{ "& .page-header": { paddingTop: `${OPEN_HEADER_TOP_PX}px` } }}
                >
                    {/* No flame: like the pull-up sheets, this surface is not a study page,
                        and a second PageHeader flame would add a second accrual tick. */}
                    <PageHeader
                        title={title}
                        arrowDirection="down"
                        onBack={onClose}
                        safeAreaTop={false}
                        showFlame={false}
                    />
                </Box>
            </Box>
        </Box>
    );
});

export default SheetPageHeader;

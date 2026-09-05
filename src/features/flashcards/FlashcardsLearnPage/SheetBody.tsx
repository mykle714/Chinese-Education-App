import { forwardRef, useImperativeHandle, useRef } from "react";
import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { FOOTER_TOTAL_CLEARANCE } from "../../../components/MobileFooter";
import type { SheetPanelBodyHandle } from "../../../components/sheet/SheetPanel";

/**
 * `SheetBody` — the plumbing every `SheetPanel` body needs, with none of the content.
 *
 * `SheetPanel` drives its resize/scroll coupling off a `{root, scroll}` handle: it
 * binds raw touch listeners to `root` (so a swipe anywhere on the panel can feed the
 * gesture) and reads `scroll.scrollTop` to decide whether a drag should grow the sheet
 * or scroll its contents. That contract is about twenty lines of refs, imperative
 * handle and `touchAction` — and it was written out longhand inside `DecksPanelBody`,
 * which is a 500-line data component that also happens to be a sheet body.
 *
 * Any body that has no reason to own that plumbing wraps its content in this instead.
 * `DecksPanelBody` keeps its own copy on purpose: it renders the same content as a
 * PAGE too (the Mastery Centers), where the touch rules invert, so the coupling there
 * is conditional rather than fixed.
 *
 * Referenced by docs/SHELF_REDESIGN.md (artboard 18's `.peek` sheet).
 */

export interface SheetBodyProps {
    children: React.ReactNode;
    className?: string;
    /** Applied to the scrolling column, so callers can set their own padding/gap. */
    sx?: SxProps<Theme>;
}

const SheetBody = forwardRef<SheetPanelBodyHandle, SheetBodyProps>(function SheetBody(
    { children, className, sx },
    ref
) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    // Getters rather than captured values: SheetPanel reads the handle inside an
    // effect that may run before these refs are attached on a later re-render.
    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        get scroll() { return scrollRef.current; },
    }), []);

    return (
        <Box
            ref={rootRef}
            className={className ? `sheet-body ${className}` : "sheet-body"}
            sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
            <Box
                ref={scrollRef}
                className="sheet-body__scroll"
                sx={[
                    {
                        flex: 1,
                        minHeight: 0,
                        overflowY: "auto",
                        // SheetPanel still decides, on the gesture's first committed
                        // move, between growing the sheet and scrolling this box — but
                        // it expresses "scroll" by NOT preventing the default, so the
                        // browser pans this container natively (on the compositor).
                        // Hence `pan-y` rather than `none`; see SheetPanel.onTouchMove
                        // and CLAUDE.md § Touch & Scroll.
                        touchAction: "pan-y",
                        // The browser owns the pan now, so stop it chaining/bouncing
                        // out of the sheet into the page behind it.
                        overscrollBehavior: "contain",
                        display: "flex",
                        flexDirection: "column",
                        // ⚠️ NO SHRINKING. This column is MEANT to overflow and be
                        // scrolled, but a flex item's default `flex-shrink: 1` makes
                        // every section compress to fit the box instead.
                        "& > *": { flexShrink: 0 },
                        // The footer bar is rendered at frame level, OVER the sheet, so
                        // the last row has to clear it exactly as a page's scroll area
                        // does.
                        paddingBottom: FOOTER_TOTAL_CLEARANCE,
                    },
                    ...(Array.isArray(sx) ? sx : [sx]),
                ]}
            >
                {children}
            </Box>
        </Box>
    );
});

export default SheetBody;

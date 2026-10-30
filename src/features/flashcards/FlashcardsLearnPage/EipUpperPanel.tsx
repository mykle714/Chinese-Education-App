import { forwardRef, useImperativeHandle, useRef } from "react";
import { Box } from "@mui/material";
import type { useDrag } from "@use-gesture/react";
import Icon from "../../../components/Icon";
import PageHeader from "../../../components/PageHeader";
import type { SheetTelescopeHandle } from "../../../components/sheet/SheetPanel";
import { useEipColors } from "./useEipPalette";

/**
 * EipUpperPanel — the eip's UPPER panel (Tower Tier 2 design): the tinted band above the
 * white tab shelf. Three rows, top to bottom:
 *
 *   TITLE  ⌄ "More Info" / "Compare" · flame   (a real leaf PageHeader; maximized only)
 *   TRAIL  ⌄ · the word trail · [Add key]       (the ⌄ fades out as the title arrives)
 *   HEADER the entry header (headword tile, gloss, sense chip) (`.ehd`; absent on Compare)
 *
 * It is SheetPanel's TELESCOPE (SheetTelescopeHandle; docs/EIP_SHEET_GESTURES.md
 * § Telescope): the frame is a clipping box whose height SheetPanel writes from the sheet's
 * own height — 0 → the trail+header height as the sheet opens, then on up to include the
 * title row as the sheet is pulled to max. The content is bottom-anchored (flex-end), so a
 * short frame shows the header first and growing reveals the rows above it. The TITLE row
 * is `extra`: the part only a maximized sheet shows.
 *
 * CLOSE IS A DOWN CARET (⌄), not a ✕ (2026-10-29). It sits where a page header's back
 * chevron sits and closes the whole panel (SheetPanel's `dismiss` — it does NOT pop a word;
 * tapping an earlier crumb does that). It is shown at every height:
 *   - at and below the open height, at the LEFT of the trail row;
 *   - toward max, the title row telescopes in carrying its own caret, and the trail-row
 *     caret collapses and fades out over the same travel (`--sheet-telescope-t`, written by
 *     SheetPanel's writeTelescope), so the one control reads as moving up into the header.
 *
 * The TITLE ROW IS A REAL PageHeader (leaf size, down chevron, `safeAreaTop={false}`), so a
 * maximized panel's caret, title and flame land on exactly the pixels a drill-in page's
 * would: SheetPanel's merged top padding supplies the status-bar inset, PageHeader adds the
 * leaf's own 27px, and its 18px side padding is the panel's own gutter. The flame shows only
 * toward max with it; the page header it stands in for is covered by the sheet.
 *
 * The whole panel is a resize handle (`bindHeaderDrag`; filterTaps keeps the ✕, the Add
 * key and the trail words tappable). The trail row's own word list pans sideways
 * (`touch-action: pan-x`, EipTabStrip).
 *
 * Layer: feature component (src/features/flashcards). Depended on by: InfoCardSection.
 * Docs: docs/EIP_SHEET_GESTURES.md § Telescope.
 */

interface EipUpperPanelProps {
    /** Panel title for the maximized row ("More Info", or "Compare" on the Compare tab). */
    title: string;
    /** The word trail (EipTabStrip). Optional: the saved-card cdp's sheet has no trail. */
    trail?: React.ReactNode;
    /** The Dictionary eip's Add key (EipAddKey), just left of the ✕. */
    addKey?: React.ReactNode;
    /** The entry header (EipEntryHeader). Absent on the Compare tab. */
    header?: React.ReactNode;
    /** The down caret's action — SheetPanel's `dismiss` (closes the whole panel). */
    onClose: () => void;
    /** Show the minute-points flame in the title row (study surfaces; see SheetPanel). */
    showMinutePoints?: boolean;
    bindHeaderDrag: ReturnType<typeof useDrag>;
}

// Vertical rhythm (2026-10-29, tightened from the design's `.eip{gap:14px}`):
//   TRAIL_TOP_PAD  space above the trail row — at the open height it is the gap between the
//                  panel's top edge and the trail (the sheet itself has no top padding,
//                  `edgePadding={false}`); at max it adds to the title row's own 8px.
//   HEADER_GAP     trail row → entry header.
const TRAIL_TOP_PAD = 10;
const HEADER_GAP = 6;
// The trail row is as tall as the design's 36px round buttons, so the caret and the Add
// key sit on one line whatever the trail holds.
const TRAIL_ROW_HEIGHT = 36;
// The trail-row caret's slot: PageHeader's 22px leaf chevron + its 9px gap to the title,
// so the first crumb starts where the page title would. Collapses to 0 toward max.
const TRAIL_CARET_SLOT = 31;

const EipUpperPanel = forwardRef<SheetTelescopeHandle, EipUpperPanelProps>(function EipUpperPanel(
    { title, trail, addKey, header, onClose, showMinutePoints, bindHeaderDrag },
    ref,
) {
    const colors = useEipColors();
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
            className="eip-upper"
            {...bindHeaderDrag()}
            sx={{
                flexShrink: 0,
                // Height is owned by SheetPanel (writeTelescope); starts closed.
                height: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                // Bottom-anchored: overflow is clipped off the TOP, so the header shows
                // first and the title row is the last thing revealed.
                justifyContent: "flex-end",
                touchAction: "none",
                userSelect: "none",
            }}
        >
            <Box
                ref={contentRef}
                className="eip-upper__content"
                sx={{ flexShrink: 0, display: "flex", flexDirection: "column", padding: "0 18px" }}
            >
                {/* TITLE — a real leaf PageHeader (see the header comment). It brings its own
                    18px side padding, so it cancels the content's gutter, and its own 8px
                    bottom padding, which `extra` measures as part of the row it adds. */}
                <Box
                    ref={extraRef}
                    className="eip-upper__title-row"
                    sx={{ margin: "0 -18px" }}
                >
                    <PageHeader
                        title={title}
                        arrowDirection="down"
                        onBack={onClose}
                        safeAreaTop={false}
                        showFlame={!!showMinutePoints}
                        titleColor={colors.ink}
                    />
                </Box>

                {/* TRAIL — `.trail`: the caret, the words, then the Add key at the right. */}
                <Box
                    className="eip-upper__trail-row"
                    sx={{
                        minHeight: TRAIL_ROW_HEIGHT,
                        boxSizing: "content-box",
                        paddingTop: `${TRAIL_TOP_PAD}px`,
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    {/* The caret's slot narrows and fades as the title row (and ITS caret)
                        telescopes in — width, not just opacity, so the crumbs slide left
                        into the space rather than leaving a hole. Hit target is the full
                        row height; at max its width is 0, so it cannot be hit. */}
                    <Box
                        className="eip-upper__trail-caret"
                        role="button"
                        aria-label="Close"
                        onClick={onClose}
                        sx={{
                            flexShrink: 0,
                            alignSelf: "stretch",
                            display: "flex",
                            alignItems: "center",
                            overflow: "hidden",
                            cursor: "pointer",
                            // `6px` cancels the row gap so the first crumb sits at exactly
                            // the chevron-to-title gap a page header has.
                            width: `calc(${TRAIL_CARET_SLOT - 6}px * (1 - var(--sheet-telescope-t, 0)))`,
                            marginRight: `calc(-6px * var(--sheet-telescope-t, 0))`,
                            opacity: "calc(1 - var(--sheet-telescope-t, 0))",
                            transition:
                                "width var(--sheet-telescope-transition, 0ms) ease-out, " +
                                "margin-right var(--sheet-telescope-transition, 0ms) ease-out, " +
                                "opacity var(--sheet-telescope-transition, 0ms) ease-out",
                        }}
                    >
                        <Icon name="keyboard_arrow_down" size={22} color={colors.ink} />
                    </Box>
                    {trail ?? <Box sx={{ flex: 1 }} />}
                    {addKey}
                </Box>

                {header && (
                    <Box className="eip-upper__header" sx={{ paddingTop: `${HEADER_GAP}px` }}>
                        {header}
                    </Box>
                )}
            </Box>
        </Box>
    );
});

export default EipUpperPanel;

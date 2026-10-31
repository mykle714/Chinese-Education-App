import { forwardRef, useImperativeHandle, useRef } from "react";
import { Box } from "@mui/material";
import type { useDrag } from "@use-gesture/react";
import Icon from "../../../components/Icon";
import PageHeader from "../../../components/PageHeader";
import { SPEAKER_BUTTON_SIZE } from "../../../components/SpeakerButton";
import type { SheetTelescopeHandle } from "../../../components/sheet/SheetPanel";
import { HEADWORD_TILE_MIN } from "./EipEntryHeader";
import { EIP_PANEL_GUTTER as PANEL_GUTTER, EIP_TRAIL_WORD_PAD } from "./styled";
import { useEipColors } from "./useEipPalette";

/**
 * EipUpperPanel — the eip's UPPER panel (Tower Tier 2 design): the tinted band above the
 * white tab shelf. Three rows, top to bottom:
 *
 *   TITLE  "More Info" / "Compare" · flame      (a real leaf PageHeader; maximized only)
 *   TRAIL  speaker · the word trail · [Add key]
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
 * tapping an earlier crumb does that). THERE IS ONE CARET at every height, and it belongs
 * to the panel rather than to a row: it is pinned to the frame's top-left, so it rides the
 * top of the panel up the screen and never arrives from anywhere. Its small offset from
 * the frame's top eases from the trail row's line to the page header's line over the same
 * travel that reveals the title (`--sheet-telescope-t`, written by SheetPanel's
 * writeTelescope). The rows only keep room for it: the trail row its leading cluster
 * (below), the title row a hidden chevron, so the title starts where a page's does.
 *
 * The TITLE ROW IS A REAL PageHeader (leaf size, `safeAreaTop={false}`), so a maximized
 * panel's title and flame land on exactly the pixels a drill-in page's would, with the
 * pinned caret on the chevron's: SheetPanel's merged top padding supplies the status-bar inset, PageHeader adds the
 * leaf's own 27px, and its 18px side padding is the panel's own gutter. The flame shows only
 * toward max with it; the page header it stands in for is covered by the sheet.
 *
 * THE SPEAKER CLUSTER (2026-10-31) leads the trail row: the speaker is dead centre between
 * the caret and the trail. Toward max the cluster slides left until the speaker is under
 * the caret, and the trail moves with it. The cluster keeps its width on Compare, which has
 * no speaker, so the trail does not jump between crumbs.
 *
 * THE TRAIL AND THE GLOSS SHARE BOUNDARIES (2026-10-31). At the open height both start at
 * the right edge of a one-character headword keycap and run off the screen's right edge
 * (EipEntryHeader's `glossToScreenEdge`). A wider keycap pushes only the gloss. The Add key,
 * where there is one, still ends the trail at the gutter.
 *
 * The whole panel is a resize handle (`bindHeaderDrag`; filterTaps keeps the caret, the
 * speaker, the Add key and the trail words tappable). The trail row's own word list pans sideways
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
    /** The showing word's SpeakerButton, leading the trail row. Absent on Compare. */
    speaker?: React.ReactNode;
    /** The Dictionary eip's Add key (EipAddKey), at the trail row's right end. */
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
// The pinned caret. Its glyph's top sits this far below the frame's top: centred on the
// trail row at the open height, and on PageHeader's leaf `padTop` (27) at max.
const CARET_GLYPH_PX = 22;
const CARET_OPEN_TOP = TRAIL_TOP_PAD + TRAIL_ROW_HEIGHT / 2 - CARET_GLYPH_PX / 2;
const CARET_TRAVEL = 27 - CARET_OPEN_TOP;
// The tap target around the glyph, and how far it overhangs the glyph on each side.
const CARET_HIT_PX = 40;
const CARET_HIT_OVERHANG = (CARET_HIT_PX - CARET_GLYPH_PX) / 2;
// The trail row's leading cluster, in px from the panel gutter. The gaps are measured between
// the INK of each neighbour, because the caret and crumb glyphs both have side bearing.
const TRAIL_ROW_GAP = 6;
const TRAIL_LEFT = HEADWORD_TILE_MIN;                    // The crumb list's left boundary.
const TRAIL_INK_LEFT = TRAIL_LEFT + EIP_TRAIL_WORD_PAD;
const CARET_INK_RIGHT = CARET_GLYPH_PX - 5;             // keyboard_arrow_down's side bearing.
const SPEAKER_CENTER = (CARET_INK_RIGHT + TRAIL_INK_LEFT) / 2;
// How far the cluster and the trail travel toward max: speaker centre → caret centre.
const CLUSTER_TRAVEL = SPEAKER_CENTER - CARET_GLYPH_PX / 2;

const EipUpperPanel = forwardRef<SheetTelescopeHandle, EipUpperPanelProps>(function EipUpperPanel(
    { title, trail, speaker, addKey, header, onClose, showMinutePoints, bindHeaderDrag },
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
                // Positioning context for the pinned caret.
                position: "relative",
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
            {/* THE caret — the only one, pinned to the frame (see the header comment). */}
            <Box
                className="eip-upper__caret"
                role="button"
                aria-label="Close"
                onClick={onClose}
                sx={{
                    position: "absolute",
                    zIndex: 1,
                    left: PANEL_GUTTER - CARET_HIT_OVERHANG,
                    top: CARET_OPEN_TOP - CARET_HIT_OVERHANG,
                    width: CARET_HIT_PX,
                    height: CARET_HIT_PX,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transform: `translateY(calc(${CARET_TRAVEL}px * var(--sheet-telescope-t, 0)))`,
                    transition: "transform var(--sheet-telescope-transition, 0ms) ease-out",
                }}
            >
                <Icon name="keyboard_arrow_down" size={CARET_GLYPH_PX} color={colors.ink} />
            </Box>
            <Box
                ref={contentRef}
                className="eip-upper__content"
                sx={{ flexShrink: 0, display: "flex", flexDirection: "column", padding: `0 ${PANEL_GUTTER}px` }}
            >
                {/* TITLE — a real leaf PageHeader (see the header comment). It brings its own
                    18px side padding, so it cancels the content's gutter, and its own 8px
                    bottom padding, which `extra` measures as part of the row it adds. Its
                    chevron is hidden, not removed: it holds the title on the page's column,
                    and the pinned caret draws over it. */}
                <Box
                    ref={extraRef}
                    className="eip-upper__title-row"
                    sx={{
                        margin: `0 -${PANEL_GUTTER}px`,
                        "& .page-header__back-icon": { visibility: "hidden" },
                    }}
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

                {/* TRAIL — `.trail`: room for the caret, the speaker, the words, the Add key. */}
                <Box
                    className="eip-upper__trail-row"
                    sx={{
                        minHeight: TRAIL_ROW_HEIGHT,
                        boxSizing: "content-box",
                        paddingTop: `${TRAIL_TOP_PAD}px`,
                        display: "flex",
                        alignItems: "center",
                        gap: `${TRAIL_ROW_GAP}px`,
                        // The crumbs run off the screen edge. The Add key stays on the gutter,
                        // and when it is present the crumbs stop beside it, with no end inset.
                        marginRight: `-${PANEL_GUTTER}px`,
                        "& .eip-add-key": { marginRight: `${PANEL_GUTTER}px` },
                        "& .eip-entry-tab-list": { paddingRight: addKey ? 0 : `${PANEL_GUTTER}px` },
                    }}
                >
                    {/* The cluster's width places the trail; its margin slides both left
                        toward max. The speaker is absolute, centred on the row. */}
                    <Box
                        className="eip-upper__speaker-cluster"
                        sx={{
                            position: "relative",
                            flexShrink: 0,
                            alignSelf: "stretch",
                            width: TRAIL_LEFT - TRAIL_ROW_GAP,
                            marginLeft: `calc(${-CLUSTER_TRAVEL}px * var(--sheet-telescope-t, 0))`,
                            transition: "margin-left var(--sheet-telescope-transition, 0ms) ease-out",
                        }}
                    >
                        {speaker && (
                            <Box
                                className="eip-upper__speaker"
                                sx={{
                                    position: "absolute",
                                    top: "50%",
                                    left: SPEAKER_CENTER - SPEAKER_BUTTON_SIZE / 2,
                                    marginTop: `${-SPEAKER_BUTTON_SIZE / 2}px`,
                                    display: "flex",
                                }}
                            >
                                {speaker}
                            </Box>
                        )}
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

import { Box, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { cyoaChipSx, cyoaFlatCardSx } from "./cyoaStyles";

/**
 * StoryPassageRow — one row of the story editor's passage LIST (docs/CYOA_FEATURE.md § 5:
 * "a passage list, not a node map"). Tapping it opens the passage editor.
 *
 *   ┌───────────────────────────────────────────────────┐
 *   │ ⠿ The forest   [Start] [⛓ 2 unlinked]       ›  ⧉ │
 *   └───────────────────────────────────────────────────┘
 *
 * One line: the passage's label — its author-written name, or "Passage n" when unnamed
 * (storyEditorModel.ts → passageLabels) — and its role chips: **Start** (blue MID),
 * **Ending** with its name (yellow MID — the end screen's "New!" hue), and **n unlinked**
 * (orange MID + a broken-link icon) when any of its choices still has no target — the
 * thing to attend to: learners see such a choice disabled ("Coming soon"). It replaced the
 * outline-only "To be continued" chip (shown only when EVERY choice was targetless) on
 * 2026-11-21, owner's ask: "an indicator in the box that there is an unlinked option to
 * attend to". Orange, not red: red MID is the editor's destructive colour (Delete). Where its choices lead and
 * what leads into it are drawn by the link gutter beside the list (StoryPassageLinks.tsx),
 * not written in the row; the opening-words and incoming-choice lines were dropped for it
 * (owner's call 2026-11-21).
 *
 * The ⠿ (`drag_indicator`) at the left is the DRAG HANDLE (§ 5.3): pressing it starts a
 * reorder, which StoryPassageList runs — the row only forwards the pointer events and
 * shows itself lifted while `dragging`. The rest of the row is a <button> that opens the
 * passage; the handle sits beside it, not in it (a button cannot hold another control, and a
 * press on the handle must never open the passage). `touch-action: none` on the handle
 * keeps the browser from scrolling the list instead.
 *
 * The ⧉ (`content_copy`) at the right DUPLICATES the passage (§ 5.4, owner's ask
 * 2026-11-21): a copy lands right below it and the list stays put. Like the handle it is a
 * sibling of the open button, not inside it.
 *
 * A flat card (the Reader list rows' skin): surface + hairline, no raised edge.
 *
 * Layer: feature presentation (src/features/cyoa). Rendered by StoryPassageList.tsx.
 */

interface StoryPassageRowProps {
    look: Tier2Look;
    /** storyEditorModel.ts → passageLabels: the name, or "Passage n". */
    label: string;
    isStart: boolean;
    /** Non-null for an ending (a passage with no choices); "" = an unnamed ending. */
    endingTitle: string | null;
    /** Choices with no target yet; 0 = none to attend to. */
    unlinkedCount: number;
    onOpen: () => void;
    /** Pointer handlers for the drag handle (StoryPassageList owns the drag). */
    handleProps: React.HTMLAttributes<HTMLDivElement>;
    /** This row is the one being dragged: lifted (shadow) above its neighbours. */
    dragging: boolean;
    onDuplicate: () => void;
    /** A save is in flight: the copy button waits. */
    busy: boolean;
}

function StoryPassageRow({ look, label, isStart, endingTitle, unlinkedCount, onOpen, handleProps, dragging, onDuplicate, busy }: StoryPassageRowProps) {
    return (
        <Box
            className={`story-passage-row${dragging ? " story-passage-row--dragging" : ""}`}
            sx={{
                ...cyoaFlatCardSx(look),
                display: "flex",
                alignItems: "stretch",
                // Lifted while dragged: the app's soft drop shadow, no colour change.
                boxShadow: dragging ? "0 6px 18px rgba(0, 0, 0, 0.18)" : "none",
                transition: "box-shadow 120ms ease-out",
            }}
        >
            <Box
                {...handleProps}
                className="story-passage-row__handle"
                role="button"
                aria-label={`Reorder ${label}`}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    width: 32,
                    pl: "4px",
                    cursor: dragging ? "grabbing" : "grab",
                    touchAction: "none",
                }}
            >
                <Icon name="drag_indicator" size={20} color={look.muted} />
            </Box>
            <Box
                component="button"
                type="button"
                className="story-passage-row__open"
                onClick={onOpen}
                sx={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    padding: "12px 12px 12px 2px",
                    border: "none",
                    background: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                    color: "inherit",
                    touchAction: "manipulation",
                }}
            >
                <Box className="story-passage-row__body" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <Box className="story-passage-row__head" sx={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <Typography
                            className="story-passage-row__label"
                            sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: look.ink, lineHeight: LEADING.tight, minWidth: 0, overflowWrap: "anywhere" }}
                        >
                            {label}
                        </Typography>
                        {isStart && <Box component="span" className="story-passage-row__chip story-passage-row__chip--start" sx={cyoaChipSx(look, COLORS.bluM)}>Start</Box>}
                        {endingTitle !== null && (
                            <Box component="span" className="story-passage-row__chip story-passage-row__chip--ending" sx={cyoaChipSx(look, COLORS.yelM)}>
                                {endingTitle ? `Ending · ${endingTitle}` : "Ending · unnamed"}
                            </Box>
                        )}
                        {unlinkedCount > 0 && (
                            <Box
                                component="span"
                                className="story-passage-row__chip story-passage-row__chip--unlinked"
                                aria-label={`${unlinkedCount} ${unlinkedCount === 1 ? "choice has" : "choices have"} no passage linked`}
                                sx={{ ...cyoaChipSx(look, COLORS.orgM), gap: "3px" }}
                            >
                                <Icon name="link_off" size={12} color={COLORS.onSurface} />
                                {unlinkedCount} unlinked
                            </Box>
                        )}
                    </Box>
                </Box>
                <Icon name="chevron_right" size={20} color={look.muted} />
            </Box>
            <Box
                component="button"
                type="button"
                className="story-passage-row__duplicate"
                onClick={onDuplicate}
                disabled={busy}
                aria-label={`Duplicate ${label}`}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    width: 40,
                    padding: 0,
                    border: "none",
                    // A hairline splits it from the open button: two targets, not one.
                    borderLeft: `1px solid ${look.outline}`,
                    background: "none",
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.4 : 1,
                    touchAction: "manipulation",
                }}
            >
                <Icon name="content_copy" size={18} color={look.muted} />
            </Box>
        </Box>
    );
}

export default StoryPassageRow;

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import type { StoryChoiceView } from "../../../server/contracts/stories";
import { STORY_KEY_LIP_PX, storyKeyShadow } from "./cyoaStyles";

/**
 * StoryChoiceStack — the 1–4 full-width choice buttons at the foot of a passage
 * (docs/CYOA_FEATURE.md § 3.1 Choices, § 3.2 Inspecting a choice).
 *
 * Each choice is a raised straight-lip key (the look's surface on a `surfaceEdge` lip,
 * the 1px outline and the rounded edge — CLAUDE.md § Buttons & cards). Its label wraps,
 * so the key grows to fit a whole sentence.
 *
 * ── The inspect key ───────────────────────────────────────────────────────────
 * A square key in a SOCKET cut into the right end of the button: a sunken `look.well`
 * pocket (with the well's inner top lip) holding a small raised key. The socket is what
 * makes the key read as part of the button rather than a control beside it.
 *
 * DOM: the label area and the inspect key are SIBLING buttons (the key is absolutely
 * positioned over the face's right end) — a <button> inside a <button> is invalid and its
 * tap would also pick the choice.
 *
 * ── Inspect mode (§ 3.2) ──────────────────────────────────────────────────────
 * The parent owns `inspectingId`. While one button is inspected:
 *   • its key shows ✕ (`close`) and tapping it leaves inspect mode;
 *   • its label does NOT pick — picking needs inspect mode closed;
 *   • every other button dims and ignores taps, label and key alike.
 *   • its label becomes a small reading box (`inspectedLabel`, built by the page from
 *     src/reading's TextArea at `size="inline"` + its own tap region): gsa words,
 *     tap-to-navigate, the page's one rdb following it. The face is then a plain <div>,
 *     not a <button> — a textarea may not sit inside a button.
 *
 * ── Unavailable choices ───────────────────────────────────────────────────────
 * A choice with no target yet (`available: false`, § 6.3) is drawn faded with a
 * "Coming soon" line and cannot be picked; it can still be inspected (reading it is
 * harmless).
 *
 * Layer: feature presentation (src/features/cyoa). Stateless. Rendered by StoryPlayPage.
 */

/** The inspect key's square, px, and the socket's margin around it. */
const INSPECT_KEY_PX = 34;
const SOCKET_INSET_PX = 6;
/** Width the label must keep clear of on the right: socket + its inset + a gap. */
const LABEL_CLEAR_RIGHT_PX = INSPECT_KEY_PX + SOCKET_INSET_PX * 2 + 10;
const KEY_RADIUS_PX = 14;

interface StoryChoiceStackProps {
    look: Tier2Look;
    choices: StoryChoiceView[];
    /** The choice in inspect mode, or null. */
    inspectingId: string | null;
    /** The inspected choice's label as a reading box, drawn in place of its plain text. */
    inspectedLabel?: ReactNode;
    /** Locks every button (a choose request is in flight). */
    locked: boolean;
    onPick: (choiceId: string) => void;
    /** Enter inspect mode for `choiceId`, or leave it with null. */
    onInspect: (choiceId: string | null) => void;
}

function StoryChoiceStack({ look, choices, inspectingId, inspectedLabel, locked, onPick, onInspect }: StoryChoiceStackProps) {
    return (
        <Box
            className="story-choice-stack"
            sx={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
            {choices.map((choice) => {
                const inspecting = inspectingId === choice.id;
                // Another button is being inspected: this one dims and ignores taps.
                const sidelined = inspectingId !== null && !inspecting;
                const pickable = choice.available && !locked && inspectingId === null;
                return (
                    <Box
                        key={choice.id}
                        className={`story-choice${inspecting ? " story-choice--inspecting" : ""}`}
                        sx={{
                            position: "relative",
                            // Room for the lip below the face, so stacked keys never overlap.
                            marginBottom: `${STORY_KEY_LIP_PX}px`,
                            opacity: sidelined || locked ? 0.4 : 1,
                            pointerEvents: sidelined || locked ? "none" : "auto",
                            transition: "opacity 160ms ease",
                        }}
                    >
                        {/* The face — the label's tap target; while inspected, the frame of the
                        label's reading box (a <div>: the box's textarea may not sit in a button). */}
                        <Box
                            component={inspecting ? "div" : "button"}
                            type={inspecting ? undefined : "button"}
                            className="story-choice__face"
                            aria-disabled={inspecting ? undefined : !pickable}
                            onClick={inspecting ? undefined : () => { if (pickable) onPick(choice.id); }}
                            sx={{
                                width: "100%",
                                minHeight: INSPECT_KEY_PX + SOCKET_INSET_PX * 2 + 2,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                alignItems: "flex-start",
                                gap: "2px",
                                padding: `10px ${LABEL_CLEAR_RIGHT_PX}px 10px 16px`,
                                textAlign: "left",
                                backgroundColor: look.surface,
                                border: `1px solid ${look.outline}`,
                                borderRadius: `${KEY_RADIUS_PX}px`,
                                boxShadow: storyKeyShadow(look),
                                cursor: inspecting ? "text" : pickable ? "pointer" : "default",
                                font: "inherit",
                                color: look.ink,
                                touchAction: "manipulation",
                                "&:active": pickable
                                    ? { transform: `translateY(${STORY_KEY_LIP_PX - 1}px)`, boxShadow: storyKeyShadow(look, 1) }
                                    : undefined,
                            }}
                        >
                            {inspecting && inspectedLabel ? inspectedLabel : (
                            <Typography
                                className="story-choice__label"
                                sx={{
                                    fontFamily: FONTS.cjk,
                                    fontSize: SIZE.bodyLg,
                                    lineHeight: LEADING.normal,
                                    color: look.ink,
                                    opacity: choice.available ? 1 : 0.55,
                                    overflowWrap: "anywhere",
                                }}
                            >
                                {choice.label}
                            </Typography>
                            )}
                            {!choice.available && (
                                <Typography
                                    className="story-choice__coming-soon"
                                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.medium, color: look.muted }}
                                >
                                    Coming soon
                                </Typography>
                            )}
                        </Box>

                        {/* The socket cut into the face's right end, and the inspect key in it. */}
                        <Box
                            className="story-choice__socket"
                            sx={{
                                position: "absolute",
                                top: "50%",
                                right: SOCKET_INSET_PX,
                                transform: "translateY(-50%)",
                                width: INSPECT_KEY_PX + SOCKET_INSET_PX,
                                height: INSPECT_KEY_PX + SOCKET_INSET_PX,
                                borderRadius: `${KEY_RADIUS_PX - 3}px`,
                                backgroundColor: look.well,
                                // The well's inner top lip — the pocket reads as sunk into the face.
                                boxShadow: `inset 0 2px 0 ${look.wellShadow}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <Box
                                component="button"
                                type="button"
                                className="story-choice__inspect-key"
                                aria-label={inspecting ? "Stop inspecting this choice" : "Inspect this choice"}
                                aria-pressed={inspecting}
                                onClick={() => onInspect(inspecting ? null : choice.id)}
                                sx={{
                                    width: INSPECT_KEY_PX - 4,
                                    height: INSPECT_KEY_PX - 6,
                                    marginTop: "-2px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                    backgroundColor: look.surface,
                                    border: `1px solid ${look.outline}`,
                                    borderRadius: "9px",
                                    boxShadow: storyKeyShadow(look, 2),
                                    cursor: "pointer",
                                    touchAction: "manipulation",
                                    "&:active": { transform: "translateY(1px)", boxShadow: storyKeyShadow(look, 1) },
                                }}
                            >
                                {/* Placeholder glyph (§ 3.2): magnifier, ✕ while inspecting. */}
                                <Icon name={inspecting ? "close" : "search"} size={18} color={look.ink2} />
                            </Box>
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}

export default StoryChoiceStack;

import React from "react";
import { Box, Typography } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { stripParentheses } from "../../utils/definitionUtils";
import { FONTS } from "../../theme/fonts";
import { API_BASE_URL } from "../../constants";
import type { BubbleBody, BubbleStatus } from "./types";
import {
    WORD_BUBBLE_BG,
    WORD_BUBBLE_BORDER,
    DEFINITION_BUBBLE_BG,
    DEFINITION_BUBBLE_BORDER,
    CORRECT_BUBBLE_BG,
    WRONG_BUBBLE_BG,
    POP_DURATION_MS,
    WRONG_FEEDBACK_MS,
} from "./constants";

interface BubbleProps {
    body: BubbleBody;
    /** Passed as a primitive (not read off `body`) so React.memo can detect
        status transitions — the loop mutates `body` in place, so prev/next.body
        are the same object and body.status comparisons would always tie. */
    status: BubbleStatus;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** Registers the outer node so the rAF loop can write its transform. */
    registerNode: (id: string, el: HTMLDivElement | null) => void;
    onPointerDown: (id: string, e: React.PointerEvent) => void;
    /** Study-mode (game-over, popup minimized) hover highlight on desktop. */
    onPointerEnter: (id: string, e: React.PointerEvent) => void;
    onPointerLeave: (id: string, e: React.PointerEvent) => void;
    /** True while study mode is active — switches the cursor to a tap pointer. */
    studyMode: boolean;
}

// Length-based font scale for the definition text, similar in spirit to the
// flashcard's englishFontSize but tuned to the smaller circular area.
const definitionFontSize = (text: string, radius: number): number => {
    const base = radius < 50 ? 13 : 14.5;
    if (text.length > 42) return base - 3;
    if (text.length > 26) return base - 1.5;
    return base;
};

// Word bubbles shrink their cpcd row to fit longer words inside the circle.
const wordContentScale = (charCount: number, radius: number): number => {
    const innerWidth = radius * 2 * 0.82; // usable width inside the circle
    const approxContentWidth = charCount * 30; // ~30px per char at cpcd "sm"
    return Math.min(1, innerWidth / approxContentWidth);
};

/**
 * A single floating bubble. Two layers by design:
 *  - The outer node carries the physics transform (translate + scale) written
 *    every frame by the rAF loop — React never touches it per-frame.
 *  - The inner node carries status-driven CSS feedback (green pop / red shake),
 *    remounted via `key={body.status}` so each animation restarts cleanly. Using
 *    a separate element keeps these transforms from fighting the loop's.
 */
const Bubble: React.FC<BubbleProps> = ({
    body,
    status,
    showPinyin,
    showPinyinColor,
    registerNode,
    onPointerDown,
    onPointerEnter,
    onPointerLeave,
    studyMode,
}) => {
    const { id, kind, entry, radius, targetRadius } = body;
    const isWord = kind === "word";
    const dimmed = status === "held" || status === "hovered";
    // Only promote a bubble to its own compositor layer while it's actually
    // moving (being dragged, the drop-target growing, or inflating in). A
    // permanent `willChange: transform` on all ~40 bubbles keeps 40 GPU layers
    // alive at once, which thrashes the mobile compositor and shows up as input
    // lag (taps/drags register a beat late). Idle bubbles don't animate, so they
    // get `auto` and stay off their own layer.
    const animating = status === "held" || status === "hovered" || status === "growing";

    let bg: string;
    let border: string;
    if (status === "correct" || status === "revealed") {
        // Study-mode highlight reuses the match-green, minus the pop animation.
        bg = CORRECT_BUBBLE_BG;
        border = CORRECT_BUBBLE_BG;
    } else if (status === "wrong" || status === "nomatch") {
        // Both render red; only "wrong" (a bad drag-drop) adds the shake below.
        bg = WRONG_BUBBLE_BG;
        border = WRONG_BUBBLE_BG;
    } else if (isWord) {
        bg = WORD_BUBBLE_BG;
        border = WORD_BUBBLE_BORDER;
    } else {
        bg = DEFINITION_BUBBLE_BG;
        border = DEFINITION_BUBBLE_BORDER;
    }

    // Lay text out for the bubble's FINAL size; the grow-in is a CSS scale on the
    // outer node, so the content scales with it rather than re-flowing each frame.
    const contentScale = wordContentScale([...entry.entryKey].length, targetRadius);

    const defText = stripParentheses(entry.definition ?? "");
    // Definition bubbles show the entry's representative icons8 icon (same one as
    // the flashcard faces) stacked above the text. Absent icon -> text only, no
    // reserved space (a bubble has no fixed image slot like the card does).
    const hasIcon = !isWord && !!entry.iconId;

    return (
        <Box
            ref={(el: HTMLDivElement | null) => registerNode(id, el)}
            className={`bubble bubble--${kind} bubble--${status}`}
            onPointerDown={(e) => onPointerDown(id, e)}
            onPointerEnter={(e) => onPointerEnter(id, e)}
            onPointerLeave={(e) => onPointerLeave(id, e)}
            sx={{
                position: "absolute",
                top: 0,
                left: 0,
                width: targetRadius * 2,
                height: targetRadius * 2,
                // Initial transform; the rAF loop overwrites this each frame. The
                // node is laid out at full size, so growth shows as a scale and the
                // translate offset is by targetRadius (see writeTransform).
                transform: `translate(${body.x - targetRadius}px, ${body.y - targetRadius}px) scale(${(targetRadius > 0 ? radius / targetRadius : 1) * body.scale})`,
                willChange: animating ? "transform" : "auto",
                touchAction: "none", // pointer events drive dragging, not scrolling
                cursor: studyMode ? "pointer" : "grab",
                zIndex: status === "held" ? 30 : status === "hovered" ? 20 : status === "revealed" ? 15 : 10,
            }}
        >
            <Box
                key={status}
                className="bubble__inner"
                sx={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    backgroundColor: bg,
                    border: `2px solid ${border}`,
                    boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    boxSizing: "border-box",
                    padding: "6px",
                    position: "relative",
                    transition: "background-color 0.15s ease, border-color 0.15s ease",
                    ...(status === "correct" && {
                        animation: `bubblePop ${POP_DURATION_MS}ms ease-out forwards`,
                        "@keyframes bubblePop": {
                            "0%": { transform: "scale(1)", opacity: 1 },
                            "45%": { transform: "scale(1.25)", opacity: 1 },
                            "100%": { transform: "scale(0.2)", opacity: 0 },
                        },
                    }),
                    ...(status === "wrong" && {
                        animation: `bubbleShake ${WRONG_FEEDBACK_MS}ms ease-in-out`,
                        "@keyframes bubbleShake": {
                            "0%, 100%": { transform: "translateX(0)" },
                            "20%": { transform: "translateX(-6px)" },
                            "40%": { transform: "translateX(6px)" },
                            "60%": { transform: "translateX(-4px)" },
                            "80%": { transform: "translateX(4px)" },
                        },
                    }),
                }}
            >
                {isWord ? (
                    <Box
                        className="bubble__word"
                        sx={{
                            transform: `scale(${contentScale})`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <ForeignText
                            size="sm"
                            justifyContent="center"
                            text={entry.entryKey}
                            pronunciation={entry.pronunciation}
                            showPinyin={showPinyin}
                            useToneColor={showPinyinColor}
                            // Match flp example sentences: nudge long pinyin syllables apart.
                            pinyinShift
                        />
                    </Box>
                ) : (
                    <Box
                        className="bubble__definition-stack"
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "3px",
                        }}
                    >
                        {hasIcon && (
                            <Box
                                component="img"
                                className="bubble__definition-icon"
                                src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(entry.iconId!)}/image`}
                                alt=""
                                // Decorative: not draggable / no pointer events so it
                                // doesn't fight the bubble drag gesture.
                                draggable={false}
                                sx={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0, pointerEvents: "none" }}
                            />
                        )}
                        <Typography
                            className="bubble__definition"
                            sx={{
                                fontSize: definitionFontSize(defText, targetRadius),
                                // 1.3 (was 1.15) so the last clamped line's descenders
                                // (q/g/y/p) aren't clipped by the -webkit-box overflow.
                                lineHeight: 1.3,
                                fontWeight: 500,
                                fontFamily: FONTS.cjk,
                                color: status === "wrong" || status === "nomatch" || status === "correct" || status === "revealed" ? "#fff" : "#3a3a3a",
                                textAlign: "center",
                                // Clamp very long definitions so they never overflow the
                                // circle. One line fewer when the icon is taking up room.
                                display: "-webkit-box",
                                WebkitLineClamp: hasIcon ? 3 : 4,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {defText}
                        </Typography>
                    </Box>
                )}

                {/* Grey dim overlay shown while held or while a valid drop target. */}
                {dimmed && (
                    <Box
                        className="bubble__dim"
                        sx={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            backgroundColor: "rgba(90,90,90,0.32)",
                            pointerEvents: "none",
                        }}
                    />
                )}
            </Box>
        </Box>
    );
};

// Re-render only when something the React layer cares about changes. Position
// lives in a ref and is written straight to the DOM, so x/y/scale changes must
// NOT trigger re-renders — only status and identity do.
export default React.memo(Bubble, (prev, next) => {
    return (
        prev.body.id === next.body.id &&
        prev.status === next.status &&
        prev.studyMode === next.studyMode &&
        prev.showPinyin === next.showPinyin &&
        prev.showPinyinColor === next.showPinyinColor
    );
});

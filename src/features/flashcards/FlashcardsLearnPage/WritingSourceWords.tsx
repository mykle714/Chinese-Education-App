import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import { ChevronRight } from "@mui/icons-material";
import ForeignText from "../../../components/ForeignText";
import { useScreenOverlayHost } from "../../../hooks/useScreenOverlayHost";
import type { UsedInItem } from "../../../types";
import { COLORS, DATA_TYPE } from "../../../theme";
import { LEADING, SIZE, WEIGHT } from "../../../theme/scale";

/**
 * WritingSourceWords — the writing-flp card's "From your words" strip
 * (docs/WRITING_PRACTICE_REWORK.md § 3b "Source words"). The writing flp deals single
 * characters, each in the deck because it appears in some of the learner's sorted words
 * (dal/shared/writingDeck.ts); this names those words, so the learner knows WHICH word
 * the character is from:
 *
 *     FROM YOUR WORDS                 See all 7 ›
 *       ?习          ?生          大?
 *      to study     student    university
 *
 * - The first `STRIP_WORDS` (3) words, most frequent first (the server's order —
 *   VocabEntryDAL.findWritingSourceWordsForCharacters), each a cpcd with its pinyin over
 *   it and its dd under it, truncated with an ellipsis.
 * - "See all N" appears only when there are more than 3. It opens `SourceWordsPopover`,
 *   the whole list, anchored under the button.
 * - The card's character is drawn as `?` (`maskChar`) unless the level previews the whole
 *   character anyway (levels 1–3; `previewShowsWholeCharacter`), the rule the hint pawn's
 *   used-in hint followed before this strip replaced it (2026-11-22).
 * - Renders nothing when there are no words (a character in the deck only as the
 *   learner's own 1-character card).
 *
 * Taps: the button stops its click, so it never reaches the card's own tap (submit on the
 * front, dismiss on the back). The words themselves are inert — the eip is gated until
 * submit on the writing flp, and the popover's rows are inert for the same reason.
 *
 * Layer: flp presentation (client). Referenced by: WritingCardFace.tsx.
 */

/** Words shown on the card itself (owner, 2026-11-22: "support up to 3, with a button to see all"). */
export const STRIP_WORDS = 3;
/** Widest one strip word's column may grow before its dd truncates, px. */
const WORD_COLUMN_MAX = 96;

export interface WritingSourceWordsProps {
    words: UsedInItem[];
    /** The card's character, drawn as ? in every word — or undefined at levels that preview it. */
    maskChar: string | undefined;
    /** False for the peeking / flying card: draw only, the button is inert. */
    interactive: boolean;
}

export default function WritingSourceWords({ words, maskChar, interactive }: WritingSourceWordsProps) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const close = useCallback(() => setOpen(false), []);
    // A card that stops being interactive (it was sent off) must not keep a popover up.
    useEffect(() => { if (!interactive) setOpen(false); }, [interactive]);

    if (words.length === 0) return null;
    const hasMore = words.length > STRIP_WORDS;

    return (
        <Box className="writing-source-words" sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Box className="writing-source-words__head" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: SEE_ALL_HEIGHT }}>
                <Box
                    className="writing-source-words__label"
                    sx={{ ...DATA_TYPE, fontSize: SIZE.micro, fontWeight: WEIGHT.semibold, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.textFaint }}
                >
                    From your words
                </Box>
                {hasMore && (
                    <Box
                        component="button"
                        type="button"
                        ref={buttonRef}
                        className="writing-source-words__see-all"
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        disabled={!interactive}
                        // Never let a press here reach the card: its click would submit /
                        // dismiss, its touch/mouse handlers would read a slipping press as a
                        // swipe attempt (useWritingFlashcard → swipeHandlers).
                        onMouseDown={stopPropagation}
                        onTouchStart={stopPropagation}
                        onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (interactive) setOpen(true);
                        }}
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.25,
                            height: SEE_ALL_HEIGHT,
                            pl: 1,
                            pr: 0.5,
                            borderRadius: 999,
                            // The app's button outline (CLAUDE.md § Buttons & cards).
                            border: `1px solid ${COLORS.border}`,
                            bgcolor: COLORS.cardFace,
                            color: COLORS.textSecondary,
                            fontFamily: "inherit",
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.medium,
                            cursor: interactive ? "pointer" : "default",
                            WebkitTapHighlightColor: "transparent",
                            "&:disabled": { color: COLORS.textSecondary },
                        }}
                    >
                        See all {words.length}
                        <ChevronRight className="writing-source-words__see-all-icon" sx={{ fontSize: 16 }} />
                    </Box>
                )}
            </Box>
            <Box className="writing-source-words__row" sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", justifyContent: "flex-start" }}>
                {words.slice(0, STRIP_WORDS).map((word) => (
                    <Box
                        key={word.entryKey}
                        className="writing-source-words__word"
                        sx={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: WORD_COLUMN_MAX, minWidth: 0 }}
                    >
                        <ForeignText
                            className="writing-source-words__word-text"
                            language="zh"
                            text={word.entryKey}
                            maskChar={maskChar}
                            pronunciation={word.pronunciation}
                            showPinyin={!!word.pronunciation}
                            size="sm"
                        />
                        {word.definition && (
                            <Box
                                className="writing-source-words__word-definition"
                                sx={{
                                    maxWidth: "100%",
                                    px: 0.25,
                                    fontSize: SIZE.caption,
                                    color: COLORS.textSecondary,
                                    lineHeight: LEADING.tight,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {word.definition}
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>
            {hasMore && (
                <SourceWordsPopover open={open} onClose={close} anchorEl={buttonRef.current} words={words} maskChar={maskChar} />
            )}
        </Box>
    );
}

/** The "See all" button's height, px — also the strip's head row height, so the label never jumps. */
const SEE_ALL_HEIGHT = 26;

// ── The popover ─────────────────────────────────────────────────────────────────────

const ENTER_MS = 200;
const EXIT_MS = 140;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Above the footer's 100, like every dim (src/components/overlayHost.ts § "THE RULE FOR A DIM"). */
const Z_INDEX = 200;
const POPOVER_WIDTH = 300;
/** Smallest gap kept between the popover and the phone frame's edges, px. */
const FRAME_MARGIN = 12;
/** Gap between the button's bottom and the popover's top, px. */
const ANCHOR_GAP = 8;
/** The card stock's lip under the popover, px (MenuPopover's look). */
const CARD_LIP = 6;

/** Keeps an event inside the popover's portal (see the portal root's comment). */
function stopPropagation(e: React.SyntheticEvent) {
    e.stopPropagation();
}

/** Where the popover sits inside the host, from the button's rect at open time. */
interface PopoverPlacement {
    top: number;
    right: number;
    maxHeight: number;
}

/**
 * The whole source-word list, anchored under the "See all" button. A DIM, so it portals
 * to the phone frame (`useScreenOverlayHost`) behind a scrim that dims everything, footer
 * included. Cut from the flashcard's card stock — `cardFace` on a `cardWall` lip, the
 * MenuPopover look — so it reads as a slip lifted off the card. Each row: the word
 * (masked like the strip) with its pinyin, and its dd beside it, wrapping to two lines.
 * The list scrolls when it is longer than the space under the button.
 *
 * Closes on a scrim tap or Escape. Placement is measured once per open; the card does
 * not move while it is open (its taps are swallowed by the scrim).
 */
function SourceWordsPopover({ open, onClose, anchorEl, words, maskChar }: {
    open: boolean;
    onClose: () => void;
    anchorEl: HTMLElement | null;
    words: UsedInItem[];
    maskChar: string | undefined;
}) {
    // Mount → next frame "shown" (enter transition); close → transition out, then unmount.
    const [mounted, setMounted] = useState(open);
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (open) {
            setMounted(true);
            const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
            return () => cancelAnimationFrame(raf);
        }
        setShown(false);
        const t = window.setTimeout(() => setMounted(false), EXIT_MS);
        return () => window.clearTimeout(t);
    }, [open]);

    const { anchorRef, host } = useScreenOverlayHost(mounted);

    // Measured against the host (the phone frame), which the popover is absolutely
    // positioned in. Right-aligned to the button, clamped inside the frame.
    const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
    useEffect(() => {
        if (!open || !host || !anchorEl) return;
        const hostRect = host.getBoundingClientRect();
        const btn = anchorEl.getBoundingClientRect();
        const top = btn.bottom - hostRect.top + ANCHOR_GAP;
        setPlacement({
            top,
            right: Math.max(FRAME_MARGIN, hostRect.right - btn.right),
            maxHeight: Math.max(120, hostRect.height - top - FRAME_MARGIN - CARD_LIP),
        });
    }, [open, host, anchorEl]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    const transition = shown
        ? `transform ${ENTER_MS}ms ${EASING}, opacity ${ENTER_MS}ms ${EASING}`
        : `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;

    return (
        <>
            <span ref={anchorRef} hidden />
            {host && mounted && placement && createPortal(
                // React events bubble through a portal to the React parent — here the card,
                // whose touch/mouse handlers read a moving press as a submit or dismiss tap
                // (useWritingFlashcard → swipeHandlers) and whose click submits. Stop them all
                // at the portal's root, so scrolling the list or tapping the scrim stays here.
                <Box
                    className="writing-source-words-popover__root"
                    onClick={stopPropagation}
                    onMouseDown={stopPropagation}
                    onTouchStart={stopPropagation}
                    onTouchMove={stopPropagation}
                    onTouchEnd={stopPropagation}
                    sx={{ display: "contents" }}
                >
                    <Box
                        className="writing-source-words-popover__scrim"
                        onClick={onClose}
                        sx={{
                            position: "absolute",
                            inset: 0,
                            zIndex: Z_INDEX,
                            bgcolor: COLORS.scrim,
                            touchAction: "none",
                            opacity: shown ? 1 : 0,
                            transition: `opacity ${shown ? ENTER_MS : EXIT_MS}ms ease`,
                        }}
                    />
                    <Box
                        className="writing-source-words-popover"
                        role="dialog"
                        aria-label={`All ${words.length} words with this character`}
                        sx={{
                            position: "absolute",
                            top: placement.top,
                            right: placement.right,
                            width: POPOVER_WIDTH,
                            maxWidth: `calc(100% - ${FRAME_MARGIN * 2}px)`,
                            maxHeight: placement.maxHeight,
                            zIndex: Z_INDEX + 1,
                            display: "flex",
                            flexDirection: "column",
                            boxSizing: "border-box",
                            borderRadius: "20px",
                            bgcolor: COLORS.cardFace,
                            boxShadow: `0 ${CARD_LIP}px 0 ${COLORS.cardWall}`,
                            transformOrigin: "top right",
                            opacity: shown ? 1 : 0,
                            transform: shown ? "none" : "translateY(-6px) scale(0.95)",
                            transition,
                        }}
                    >
                        <Box
                            className="writing-source-words-popover__title"
                            sx={{ ...DATA_TYPE, px: 2, pt: 1.5, pb: 1, fontSize: SIZE.micro, fontWeight: WEIGHT.semibold, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.textFaint }}
                        >
                            From your words · {words.length}
                        </Box>
                        <Box
                            className="writing-source-words-popover__list"
                            // Scrolling is opt-in per container (docs/UX_AND_NAVIGATION.md § Touch & Scroll).
                            sx={{ flex: 1, minHeight: 0, overflowY: "auto", touchAction: "pan-y", overscrollBehavior: "contain", px: 1, pb: 1 }}
                        >
                            {words.map((word, i) => (
                                <Box
                                    key={word.entryKey}
                                    className="writing-source-words-popover__row"
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1.5,
                                        px: 1,
                                        py: 0.75,
                                        borderTop: i === 0 ? "none" : `1px solid ${COLORS.cardWall}`,
                                    }}
                                >
                                    <Box className="writing-source-words-popover__word" sx={{ flexShrink: 0 }}>
                                        <ForeignText
                                            className="writing-source-words-popover__word-text"
                                            language="zh"
                                            text={word.entryKey}
                                            maskChar={maskChar}
                                            pronunciation={word.pronunciation}
                                            showPinyin={!!word.pronunciation}
                                            size="sm"
                                        />
                                    </Box>
                                    <Box
                                        className="writing-source-words-popover__definition"
                                        sx={{
                                            flex: 1,
                                            minWidth: 0,
                                            fontSize: SIZE.caption,
                                            lineHeight: LEADING.normal,
                                            color: COLORS.textSecondary,
                                            display: "-webkit-box",
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: "vertical",
                                            overflow: "hidden",
                                        }}
                                    >
                                        {word.definition}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Box>,
                host,
            )}
        </>
    );
}

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Box, Popper, Typography, useMediaQuery } from "@mui/material";
import type { PopperProps } from "@mui/material";
import { FONTS } from "../theme/fonts";
import { SIZE } from "../theme/scale";
import { COLORS } from "../theme/colors";
import { tier2Var } from "../timeOfDay/tier2Chrome";
import { HINT_MOTION } from "./hintBubble/hintMotion";
import { fadeIn, fadeOut, growIn, growInFromAbove } from "./hintBubble/bubbleKeyframes";

// The exit: a quiet fade, not the hint bubble's pop (owner's call 2026-11-10: the pop was
// "too loud" for a caption). Also how long Popper keeps the card mounted after close.
const FADE_OUT_MS = 160;

/**
 * The colours a dark surface lends the popup. Null (the default) leaves it on the Tier 2
 * variables below; EipPaletteProvider publishes tones for the eip's dark (Dark-theme)
 * palette, because the eip no longer follows the Tier 2 clock and can open over a page
 * with no Tier 2 claim (the Deck Tower), where those variables are unset.
 */
export interface CpcdPopupTones {
    surface: string;
    pressed: string;
    outline: string;
    ink: string;
    muted: string;
}

export const CpcdPopupTonesCtx = createContext<CpcdPopupTones | null>(null);

/**
 * The small caption card that floats above a cpcd run: white, or the lighter night slate
 * (#2A3446) on a night-themed Tier 2 page or the dark eip. Docs: docs/EIP_SHEET_GESTURES.md
 * § "Light / dark theme",
 * docs/SHELF_REDESIGN.md § 7b "Time of day".
 *
 * Extracted from SegmentedSentenceDisplay (where it is the est's tapped-segment
 * definition box) so a second surface can reuse the SAME visual affordance rather
 * than re-authoring it: CPCDRow's tap-to-copy toast ("Characters Copied!") is the
 * same box saying something else. Anything specific to a caller — what dismisses
 * it, whether a tap on it does anything — stays with the caller and arrives here
 * as props; this component owns only the Popper placement and the card's looks.
 *
 * Motion (owner's call 2026-11-10): grows in out of its anchor with the hint bubble's small
 * overshoot (shared ./hintBubble/bubbleKeyframes.ts, `HINT_MOTION.growMs`) and simply FADES
 * away on exit (`FADE_OUT_MS`) — the hint bubble's pop was too loud here. A plain fade-in
 * under `prefers-reduced-motion`. It keeps its last anchor, caption and interactive/pressed look
 * through the fade, since callers clear them on close — the card fades out as it last looked. `contentKey` replays the grow when the subject changes.
 * Docs: docs/EIP_SHEET_GESTURES.md § "CpcdPopup motion".
 *
 * Placement is always "above the anchor, flipping below when there is no room".
 * The anchor may be a real element or a Popper virtual element (a bare
 * `{ getBoundingClientRect }`), which is how the est anchors to a measured
 * highlight rect rather than to a DOM node.
 *
 * `children`, when given, replaces the plain `text` caption — for a surface whose caption
 * is not a string (the eip sense list's commonality meter). It sits in
 * the same `__text` slot, so it inherits the caption's ink, size and font; render it with
 * `currentColor` to follow the popup's light/dark tones.
 *
 * Referenced by: src/components/SegmentedSentenceDisplay.tsx (segment definition
 * popup), src/components/CPCDRow.tsx (tap-to-copy toast),
 * src/features/flashcards/FlashcardsLearnPage/EipSenseList.tsx (tapped-sense facts).
 */
export interface CpcdPopupProps {
    open: boolean;
    anchorEl: PopperProps["anchorEl"];
    /** The caption text. Callers pre-format it (the est strips parentheses first). */
    text?: string;
    /** Rich caption content; replaces `text` when given (see the header note). */
    children?: React.ReactNode;
    /**
     * Identity of what the popup is about (a sense index, a segment range). Changing it
     * while open replays the grow-in at the new spot; omitted, the card just moves.
     */
    contentKey?: string | number;
    /**
     * Root class name; the text and chevron nodes derive theirs from it
     * (`${className}__text`, `${className}__chevron`) so each surface keeps its own
     * descriptive, greppable class names.
     */
    className?: string;
    /** Render the drill-in chevron and the pointer cursor: the card itself is tappable. */
    interactive?: boolean;
    /** Grey the card while it is being pressed (tap feedback for `interactive` cards). */
    pressed?: boolean;
    /** Popper's live instance, for callers that need to re-run placement (see the est). */
    popperRef?: PopperProps["popperRef"];
    /** Ref to the card element itself — the est uses it to tell a tap on the popup apart from a tap outside. */
    cardRef?: React.Ref<HTMLDivElement>;
    onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
    onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
    onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
}

const CpcdPopup: React.FC<CpcdPopupProps> = ({
    open,
    anchorEl,
    text,
    children,
    contentKey,
    className = "cpcd-popup",
    interactive = false,
    pressed = false,
    popperRef,
    cardRef,
    onMouseEnter,
    onMouseLeave,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
}) => {
    // Tier 2 variables are unset away from a Tier 2 page, so each falls back to the day look.
    const tones = useContext(CpcdPopupTonesCtx);
    const surface = tones?.surface ?? tier2Var("surface", COLORS.white);
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

    // What the popup last showed while open. Callers clear their anchor and caption the
    // moment they close it (the est sets text "" and drops its rect; the sense list drops
    // its anchor), but the fade-out still has a moment to play — so while closing it keeps
    // drawing, and stays placed against, what it showed last. Captured in an effect (not
    // during render) and read back on the closing renders only.
    const [held, setHeld] = useState<HeldContent | null>(null);
    useEffect(() => {
        if (open) setHeld({ anchorEl, text, children, contentKey, interactive, pressed });
    }, [open, anchorEl, text, children, contentKey, interactive, pressed]);
    const live: HeldContent = { anchorEl, text, children, contentKey, interactive, pressed };
    const shown: HeldContent = open ? live : (held ?? live);

    return (
    // Rendered into a portal via Popper so the card escapes any ancestor's
    // overflow:auto/hidden (e.g. the EIP scroll container) and is never clipped.
    // `transition`: Popper stays mounted after `open` falls until the child calls
    // `TransitionProps.onExited` — which CpcdPopupMotion does once the fade has played.
    <Popper
        open={open}
        anchorEl={shown.anchorEl}
        popperRef={popperRef}
        placement="top"
        transition
        modifiers={[
            { name: "offset", options: { offset: [0, 6] } },
            { name: "preventOverflow", options: { boundary: "viewport", padding: 8 } },
            { name: "flip", options: { fallbackPlacements: ["bottom"] } },
        ]}
        sx={{ zIndex: 1300 }}
    >
        {({ TransitionProps, placement }) => (
        <CpcdPopupMotion
            // A new `contentKey` while open re-mounts the card, so it grows in afresh at
            // its new spot instead of sliding there (another sense, another segment).
            key={shown.contentKey ?? "cpcd-popup"}
            isIn={!!TransitionProps?.in}
            onEnter={TransitionProps?.onEnter}
            onExited={TransitionProps?.onExited}
            below={placement.startsWith("bottom")}
            reduceMotion={reduceMotion}
            className={className}
        >
        <Box
            ref={cardRef}
            className={className}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onPointerCancel={onPointerCancel}
            sx={{
                backgroundColor: surface,
                border: "1px solid",
                borderColor: (theme) => tones?.outline ?? tier2Var("outline", theme.palette.divider),
                borderRadius: "8px",
                boxShadow: 2,
                px: 1.25,
                py: 0.75,
                maxWidth: "220px",
                ...(shown.interactive && {
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    // Grey the whole card while pressed so a registered tap is obvious.
                    transition: "background-color 100ms ease",
                    backgroundColor: (theme) => shown.pressed
                        ? tones?.pressed ?? tier2Var("pressed", theme.palette.action.selected)
                        : surface,
                }),
            }}
        >
            <Typography
                className={`${className}__text`}
                // A rich caption may hold block elements, which a <p> cannot contain.
                component={shown.children != null ? "div" : "p"}
                sx={{
                    fontSize: SIZE.caption,
                    lineHeight: 1.3,
                    color: (theme) => tones?.ink ?? tier2Var("ink", theme.palette.text.primary),
                    fontFamily: FONTS.sans,
                    textAlign: "center",
                    wordBreak: "break-word",
                    ...(shown.interactive && { flex: 1, textAlign: "left" }),
                }}
            >
                {shown.children ?? shown.text}
            </Typography>
            {shown.interactive && (
                // Same drill-in chevron the breakdown/used-in rows use, so "chevron =
                // opens the eip for this word" stays a consistent gesture across the card.
                <Box
                    className={`${className}__chevron`}
                    component="span"
                    sx={{
                        flexShrink: 0,
                        fontSize: SIZE.body,
                        lineHeight: 1,
                        color: (theme) => tones?.muted ?? tier2Var("muted", theme.palette.text.secondary),
                        fontFamily: FONTS.sans,
                    }}
                >
                    ›
                </Box>
            )}
        </Box>
        </CpcdPopupMotion>
        )}
    </Popper>
    );
};

// The caption state the popup holds through its fade-out (see `held` above).
interface HeldContent {
    anchorEl: PopperProps["anchorEl"];
    text?: string;
    children?: React.ReactNode;
    contentKey?: string | number;
    // The est drops `interactive` (and `pressed`) together with its selection on close;
    // held so the chevron, the left-aligned layout and a tapped card's grey fade out WITH
    // the card instead of vanishing on the first frame of the fade.
    interactive: boolean;
    pressed: boolean;
}

interface CpcdPopupMotionProps {
    // Popper's TransitionProps: `in` follows `open`; `onEnter` must be called on entry or
    // Popper unmounts at once on close; `onExited` releases it after the fade.
    isIn: boolean;
    onEnter?: () => void;
    onExited?: () => void;
    // Popper flipped the card under its anchor: grow DOWN out of the anchor, not up.
    below: boolean;
    reduceMotion: boolean;
    className: string;
    children: React.ReactNode;
}

/**
 * The popup's motion: grows in out of its anchor with the hint bubble's small overshoot
 * (HintBubbleSurface's `growIn`), and on exit just fades away (`FADE_OUT_MS`). Reduced
 * motion: a plain fade in. A fading card takes no taps (`pointerEvents: none`), so a tap
 * during the fade reaches what is behind it.
 * Keyframes: ./hintBubble/bubbleKeyframes.ts; timing: HINT_MOTION.growMs, FADE_OUT_MS.
 */
const CpcdPopupMotion: React.FC<CpcdPopupMotionProps> = ({
    isIn, onEnter, onExited, below, reduceMotion, className, children,
}) => {
    // Popper hands over fresh callbacks on every render; read them through a ref so a
    // re-render mid-fade cannot restart (and so postpone) the release timer below.
    const callbacks = useRef({ onEnter, onExited });
    useEffect(() => {
        callbacks.current = { onEnter, onExited };
    });
    useEffect(() => {
        if (isIn) {
            callbacks.current.onEnter?.();
            return;
        }
        // Released on a timer rather than `animationend`, which never fires when the
        // animation is skipped (a hidden tab, reduced motion settings in some engines).
        const t = window.setTimeout(() => callbacks.current.onExited?.(), FADE_OUT_MS);
        return () => window.clearTimeout(t);
    }, [isIn]);

    const fading = !isIn;
    const enter = reduceMotion ? fadeIn : below ? growInFromAbove : growIn;
    const animation = fading
        ? `${fadeOut} ${FADE_OUT_MS}ms ease-out forwards`
        : `${enter} ${HINT_MOTION.growMs}ms ease-out both`;

    return (
        <Box
            className={`${className}-motion`}
            sx={{
                position: "relative",
                // Grow out of the anchor: the edge facing it, centred (Popper centres the card on it).
                transformOrigin: below ? "50% 0%" : "50% 100%",
                animation,
                pointerEvents: fading ? "none" : undefined,
            }}
        >
            {children}
        </Box>
    );
};

export default CpcdPopup;

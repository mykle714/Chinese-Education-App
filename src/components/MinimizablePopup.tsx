import { alpha } from "@mui/material/styles";
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, IconButton, useTheme } from "@mui/material";
import CloseFullscreenRoundedIcon from "@mui/icons-material/CloseFullscreenRounded";
import OpenInFullRoundedIcon from "@mui/icons-material/OpenInFullRounded";
import { SHADOW } from "../theme/shadows";
import { COLORS } from "../theme/colors";
import { useScreenOverlayHost } from "../hooks/useScreenOverlayHost";

// Resting visual constants for the minimized "tiny square" puck. Measured in
// px so the collapse transform can land the card exactly on top of the square.
const SQUARE_SIZE = 52; // width/height of the minimized puck (visual square)
const PUCK_HIT = 84; // larger transparent tap target around the visual square
const SQUARE_MARGIN = 16; // inset from the chosen corner of the stage
const MORPH_MS = 380; // duration of the collapse / restore animation

/** Which corner the card collapses into. */
export type PopupCorner = "top-right" | "top-left";

export interface MinimizablePopupProps {
    /** When true the card is collapsed into the corner puck. */
    minimized?: boolean;
    /**
     * Collapse the card into the corner square (the card's × button). OMIT to make
     * the popup non-minimizable — the × and the puck are then not rendered at all,
     * which is what a popup that gates an action (flp's exit offer) wants.
     */
    onMinimize?: () => void;
    /** Re-expand the card from the corner square (clicking the puck). */
    onRestore?: () => void;
    /** BEM-style class prefix so each caller keeps descriptive, distinct classes. */
    classPrefix: string;
    /** Corner the card collapses into. Default top-right. */
    corner?: PopupCorner;
    /**
     * Puck fill + minimize-icon color. Defaults to the flashcard surface (a neutral
     * card-colored puck). Two popups can be on screen at once — a game's end popup
     * and the provisional sort offer — so the second one recolors itself to stay
     * visually distinct from the first.
     */
    puckColor?: string;
    /** Icon/text color inside the puck and on the minimize button. */
    accentContrast?: string;
    /**
     * Stacking order of the scrim, among the frame-level overlays. Default 200 — above
     * the footer bar (100), below the challenge scoreboard (1200) and modal sheets.
     * Raise it to stack over another popup.
     */
    zIndex?: number;
    /** Scrim fill while open. Lighten it when stacking over an already-dimmed popup. */
    scrimColor?: string;
    /**
     * CSS selector for the element whose corner the puck docks into — the closest
     * ancestor of the popup that matches, else the first match inside the popup's
     * parent (the phone frame, since the scrim is portaled there). The scrim still
     * covers the whole screen; only the puck (and the card's collapse target) moves.
     * Omitted, or no match, docks to the scrim's own corner — the SCREEN's corner.
     * GameEndPopup and ProvisionalSortOffer pass `.game-frame` so the puck sits in the
     * game panel's corner rather than over the header's back arrow.
     */
    puckAnchorSelector?: string;
    /**
     * Render the scrim IN PLACE instead of portaling it to the phone frame. Only for a
     * caller whose positioned container already covers the entire screen AND must carry
     * the popup with it — Speed Reading's sideways stage, which rotates its whole
     * contents (header included); a frame-hosted popup would draw upright over a
     * sideways game. Every other caller leaves this off.
     */
    inPlace?: boolean;
    /** Card body (title / message / actions) supplied by the caller. */
    children: React.ReactNode;
}

/** Puck centre, px from the scrim's top-left corner. */
interface PuckDock {
    x: number;
    y: number;
}

/** The anchor element for `selector`: an enclosing match first, else one inside the parent. */
function findPuckAnchor(scrim: HTMLElement, selector: string): HTMLElement | null {
    return scrim.closest<HTMLElement>(selector) ?? scrim.parentElement?.querySelector<HTMLElement>(selector) ?? null;
}

/**
 * MinimizablePopup — a centered card over a scrim that can collapse into a small
 * corner puck and be restored by tapping it. Layout layer: presentational; the
 * caller owns the `minimized` flag and the card content, this owns the scrim, the
 * card chrome (minimize button), the puck, and the FLIP-style collapse animation.
 *
 * The card stays flex-centered at its natural (un-transformed) size so its layout
 * box never changes. To collapse it we measure the scrim + card once (and on
 * resize) and build a single `translate(...) scale(...)` transform that flies the
 * card's center onto the corner puck. As the card scales away and fades out, the
 * real square puck fades in — so it reads as the popup shrinking into a tiny square
 * that can be clicked to bring the menu back.
 *
 * The puck docks into the scrim's corner by default, or into the corner of
 * `puckAnchorSelector`'s element (GameEndPopup: the game frame) when one is given.
 *
 * ⚠️ THE SCRIM COVERS THE ENTIRE SCREEN. It is written in place but PORTALED to the
 * phone frame (`useScreenOverlayHost`, src/hooks/useScreenOverlayHost.ts) and pinned
 * `absolute; inset: 0` there, so it dims the status band, the page header and the footer
 * bar along with the page. It used to take a `positioning` prop whose `absolute` default
 * dimmed only the nearest positioned ancestor — in five games that was the content box
 * under the header, which left the back arrow and title lit above the dim; `fixed` was
 * sealed inside the transformed page Surface, under the footer (scp's done popup).
 * Rule: src/components/overlayHost.ts § "THE RULE FOR A DIM".
 *
 * Two of these can be on screen at once (a game's end popup in the top-right, the
 * provisional sort offer in the top-left); `corner`, `puckColor` and `zIndex` are
 * what keep the pair readable as two separate things.
 *
 * Referenced by: src/games/runtime/GameEndPopup.tsx (the games' end-of-run popup),
 * src/components/ProvisionalSortOffer.tsx. See docs/PROVISIONAL_CARDS.md § 5.
 */
const MinimizablePopup: React.FC<MinimizablePopupProps> = ({
    minimized = false,
    onMinimize,
    onRestore,
    classPrefix,
    corner = "top-right",
    puckColor,
    accentContrast,
    zIndex = 200,
    scrimColor = COLORS.scrim,
    puckAnchorSelector,
    inPlace = false,
    children,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const minimizable = typeof onMinimize === "function";
    const puckBg = puckColor ?? fc.flashCard;
    const puckFg = accentContrast ?? fc.onSurface;

    // Where the scrim is portaled: the phone frame, so the dim covers the whole screen.
    const { anchorRef, host } = useScreenOverlayHost(!inPlace);
    const scrimRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    // Transform that collapses the centered card onto the corner puck. Computed
    // from measured geometry so the landing spot tracks the real square.
    const [collapseTransform, setCollapseTransform] = useState<string>(
        // Sensible pre-measure fallback (corner-ish) to avoid a flash if the user
        // minimizes before the first measure lands.
        corner === "top-left" ? "translate(-40%, -40%) scale(0.12)" : "translate(40%, -40%) scale(0.12)"
    );

    // Measure the scrim + natural card size and derive the collapse transform.
    // offsetWidth/Height are layout sizes (unaffected by the transform), so this
    // stays correct even while the card is mid-collapse.
    // Where the puck docks (its centre in scrim coordinates). Null until measured; the
    // puck then falls back to the scrim's own corner.
    const [dock, setDock] = useState<PuckDock | null>(null);
    // The anchor being observed, so a resize of the game frame re-measures too.
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

    const measure = useCallback(() => {
        const scrim = scrimRef.current;
        const card = cardRef.current;
        if (!scrim || !card) return;
        const scrimW = scrim.clientWidth;
        const scrimH = scrim.clientHeight;
        const cardW = card.offsetWidth;
        const cardH = card.offsetHeight;
        // Scale the card down so its larger side matches the puck size.
        const scale = SQUARE_SIZE / Math.max(cardW, cardH);
        // The box the puck docks into, in scrim coordinates: the anchor's rect when there
        // is one, else the scrim itself. Rects are divided by the scrim's rendered/layout
        // ratio so an ancestor transform (mdp's scaled phone frame) cancels out.
        const anchor = puckAnchorSelector ? findPuckAnchor(scrim, puckAnchorSelector) : null;
        setAnchorEl(anchor);
        let box = { left: 0, top: 0, width: scrimW, height: scrimH };
        if (anchor) {
            const s = scrim.getBoundingClientRect();
            const a = anchor.getBoundingClientRect();
            const ratio = s.width > 0 ? scrimW / s.width : 1;
            box = { left: (a.left - s.left) * ratio, top: (a.top - s.top) * ratio, width: a.width * ratio, height: a.height * ratio };
        }
        // Puck center, measured from the scrim's top-left corner.
        const targetX =
            corner === "top-left"
                ? box.left + SQUARE_MARGIN + SQUARE_SIZE / 2
                : box.left + box.width - SQUARE_MARGIN - SQUARE_SIZE / 2;
        const targetY = box.top + SQUARE_MARGIN + SQUARE_SIZE / 2;
        setDock({ x: targetX, y: targetY });
        // Card center currently sits at the scrim center (flex-centered). The
        // scale uses transform-origin: center, so the center is the fixed point
        // we translate from.
        const dx = targetX - scrimW / 2;
        const dy = targetY - scrimH / 2;
        setCollapseTransform(`translate(${dx}px, ${dy}px) scale(${scale})`);
    }, [corner, puckAnchorSelector]);

    // `host` is a dep: the scrim mounts one commit after this component (once the host
    // resolves), so the first run finds no scrim to measure or observe.
    useLayoutEffect(() => {
        measure();
        const ro = new ResizeObserver(measure);
        if (scrimRef.current) ro.observe(scrimRef.current);
        if (cardRef.current) ro.observe(cardRef.current);
        if (anchorEl) ro.observe(anchorEl);
        return () => ro.disconnect();
    }, [measure, anchorEl, host]);

    const scrim = (
        <Box
            ref={scrimRef}
            className={`${classPrefix}__popup-scrim`}
            sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                px: 4,
                zIndex,
                // Translucent so whatever is behind the card stays visible.
                // No backdrop blur — the background should remain crisp.
                backgroundColor: scrimColor,
                transition: `background-color ${MORPH_MS}ms ease`,
                // When collapsed the scrim clears away so only the puck reads —
                // and stops intercepting clicks meant for the puck behind it.
                ...(minimized && {
                    // The scrim's own ink at zero alpha, so the fade does not pass through grey.
                    backgroundColor: alpha(COLORS.onSurface, 0),
                    pointerEvents: "none",
                }),
            }}
        >
            {/* The card. Flex-centered at natural size; collapses via transform. */}
            <Box
                ref={cardRef}
                className={`${classPrefix}__popup-card`}
                sx={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    textAlign: "center",
                    width: "100%",
                    maxWidth: 340,
                    px: 4,
                    py: 3.5,
                    borderRadius: "20px",
                    backgroundColor: fc.flashCard,
                    boxShadow: SHADOW.popover,
                    transformOrigin: "center center",
                    transition: `transform ${MORPH_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${MORPH_MS}ms ease`,
                    ...(minimized && {
                        transform: collapseTransform,
                        opacity: 0,
                        pointerEvents: "none",
                    }),
                }}
            >
                {/* Minimize — collapses the card into the corner puck. Absent entirely
                    on a non-minimizable popup, whose only exits are its own buttons. */}
                {minimizable && (
                    <IconButton
                        className={`${classPrefix}__popup-close`}
                        aria-label="Minimize"
                        onClick={onMinimize}
                        size="small"
                        sx={{
                            position: "absolute",
                            top: 8,
                            // Mirror the button to the side the card collapses toward, so
                            // the shrink reads as heading for the puck it lands on.
                            ...(corner === "top-left" ? { left: 8 } : { right: 8 }),
                            color: puckColor ? puckBg : fc.textSecondary,
                            "&:hover": { backgroundColor: COLORS.rowHoverBg },
                        }}
                    >
                        <CloseFullscreenRoundedIcon fontSize="small" />
                    </IconButton>
                )}
                {children}
            </Box>

            {/* Minimized puck — fades in as the card collapses; click to restore.
                The interactive element is an oversized, transparent hit pad around
                a small visual square so close taps still catch (the scrim is
                pointer-events:none while minimized). */}
            {minimizable && (
                <Box
                    className={`${classPrefix}__popup-puck-hit`}
                    role="button"
                    aria-label="Reopen menu"
                    onClick={onRestore}
                    // Belt-and-suspenders: keep the gesture from bubbling anywhere.
                    onPointerDown={(e) => e.stopPropagation()}
                    sx={{
                        position: "absolute",
                        // Center the pad on the measured dock (the same point the card's
                        // collapse transform flies to), so it lands exactly on the square.
                        // Before the first measure, fall back to the scrim's own corner.
                        ...(dock
                            ? { top: dock.y - PUCK_HIT / 2, left: dock.x - PUCK_HIT / 2 }
                            : {
                                  top: SQUARE_MARGIN - (PUCK_HIT - SQUARE_SIZE) / 2,
                                  ...(corner === "top-left"
                                      ? { left: SQUARE_MARGIN - (PUCK_HIT - SQUARE_SIZE) / 2 }
                                      : { right: SQUARE_MARGIN - (PUCK_HIT - SQUARE_SIZE) / 2 }),
                              }),
                        width: PUCK_HIT,
                        height: PUCK_HIT,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        transition: `opacity ${MORPH_MS}ms ease, transform ${MORPH_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                        // Mirror image of the card: hidden + un-clickable while the menu
                        // is open, visible + interactive once collapsed.
                        ...(minimized
                            ? { opacity: 1, transform: "scale(1)", pointerEvents: "auto" }
                            : { opacity: 0, transform: "scale(0.4)", pointerEvents: "none" }),
                    }}
                >
                    <Box
                        className={`${classPrefix}__popup-puck`}
                        sx={{
                            width: SQUARE_SIZE,
                            height: SQUARE_SIZE,
                            borderRadius: "14px",
                            backgroundColor: puckBg,
                            color: puckFg,
                            boxShadow: SHADOW.float,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <OpenInFullRoundedIcon fontSize="small" />
                    </Box>
                </Box>
            )}
        </Box>
    );

    if (inPlace) return scrim;

    return (
        <>
            {/* Never painted — the in-place point the frame host is found from. */}
            <span ref={anchorRef} className={`${classPrefix}__popup-anchor`} hidden />
            {host && createPortal(scrim, host)}
        </>
    );
};

export default MinimizablePopup;

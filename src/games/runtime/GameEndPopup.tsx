import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Box, IconButton, useTheme } from "@mui/material";
import CloseFullscreenRoundedIcon from "@mui/icons-material/CloseFullscreenRounded";
import OpenInFullRoundedIcon from "@mui/icons-material/OpenInFullRounded";

// Resting visual constants for the minimized "tiny square" puck. Measured in
// px so the collapse transform can land the card exactly on top of the square.
const SQUARE_SIZE = 52; // width/height of the minimized puck (visual square)
const PUCK_HIT = 84; // larger transparent tap target around the visual square
const SQUARE_MARGIN = 16; // inset from the top-right corner of the stage
const MORPH_MS = 380; // duration of the collapse / restore animation

interface GameEndPopupProps {
    /** When true the card is collapsed into the top-right square puck. */
    minimized: boolean;
    /** Collapse the card into the corner square (the card's × button). */
    onMinimize: () => void;
    /** Re-expand the card from the corner square (clicking the puck). */
    onRestore: () => void;
    /** BEM-style class prefix so each game keeps descriptive, distinct classes. */
    classPrefix: string;
    /** Card body (title / message / actions) supplied by the page. */
    children: React.ReactNode;
}

/**
 * Shared end-of-run popup for games with a minimize-to-corner affordance
 * (Bubble Match, Word Search). Layout layer: presentational. The page owns the
 * `minimized` flag + card content; this component owns the scrim, the card
 * chrome (× button), the corner puck, and the FLIP-style collapse animation
 * between them.
 *
 * The card stays flex-centered at its natural (un-transformed) size so its
 * layout box never changes. To collapse it we measure the scrim + card once
 * (and on resize) and build a single `translate(...) scale(...)` transform that
 * flies the card's center onto the corner puck. As the card scales away and
 * fades out, the real square puck fades in — so it reads as the popup shrinking
 * into a tiny square that can be clicked to bring the menu back.
 */
const GameEndPopup: React.FC<GameEndPopupProps> = ({
    minimized,
    onMinimize,
    onRestore,
    classPrefix,
    children,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const scrimRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    // Transform that collapses the centered card onto the corner puck. Computed
    // from measured geometry so the landing spot tracks the real square.
    const [collapseTransform, setCollapseTransform] = useState<string>(
        // Sensible pre-measure fallback (top-right-ish) to avoid a flash if the
        // user minimizes before the first measure lands.
        "translate(40%, -40%) scale(0.12)"
    );

    // Measure the scrim + natural card size and derive the collapse transform.
    // offsetWidth/Height are layout sizes (unaffected by the transform), so this
    // stays correct even while the card is mid-collapse.
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
        // Puck center, measured from the scrim's top-left corner.
        const targetX = scrimW - SQUARE_MARGIN - SQUARE_SIZE / 2;
        const targetY = SQUARE_MARGIN + SQUARE_SIZE / 2;
        // Card center currently sits at the scrim center (flex-centered). The
        // scale uses transform-origin: center, so the center is the fixed point
        // we translate from.
        const dx = targetX - scrimW / 2;
        const dy = targetY - scrimH / 2;
        setCollapseTransform(`translate(${dx}px, ${dy}px) scale(${scale})`);
    }, []);

    useLayoutEffect(() => {
        measure();
        const ro = new ResizeObserver(measure);
        if (scrimRef.current) ro.observe(scrimRef.current);
        if (cardRef.current) ro.observe(cardRef.current);
        return () => ro.disconnect();
    }, [measure]);

    return (
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
                zIndex: 200,
                // Translucent so the game field stays visible behind the card.
                // No backdrop blur — the background should remain crisp.
                backgroundColor: "rgba(20, 20, 28, 0.32)",
                transition: `background-color ${MORPH_MS}ms ease`,
                // When collapsed the scrim clears away so only the puck reads —
                // and stops intercepting clicks meant for the puck behind it.
                ...(minimized && {
                    backgroundColor: "rgba(20, 20, 28, 0)",
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
                    boxShadow: "0 18px 48px rgba(0, 0, 0, 0.32)",
                    transformOrigin: "center center",
                    transition: `transform ${MORPH_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${MORPH_MS}ms ease`,
                    ...(minimized && {
                        transform: collapseTransform,
                        opacity: 0,
                        pointerEvents: "none",
                    }),
                }}
            >
                {/* Minimize (×) — collapses the card into the corner puck. */}
                <IconButton
                    className={`${classPrefix}__popup-close`}
                    aria-label="Minimize"
                    onClick={onMinimize}
                    size="small"
                    sx={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        color: fc.textSecondary,
                        "&:hover": { backgroundColor: "rgba(0,0,0,0.06)" },
                    }}
                >
                    <CloseFullscreenRoundedIcon fontSize="small" />
                </IconButton>
                {children}
            </Box>

            {/* Minimized puck — fades in as the card collapses; click to restore.
                The interactive element is an oversized, transparent hit pad around
                a small visual square so close taps still catch (the scrim is
                pointer-events:none while minimized). */}
            <Box
                className={`${classPrefix}__popup-puck-hit`}
                role="button"
                aria-label="Reopen menu"
                onClick={onRestore}
                // Belt-and-suspenders: keep the gesture from bubbling anywhere.
                onPointerDown={(e) => e.stopPropagation()}
                sx={{
                    position: "absolute",
                    // Center the pad on the intended square location so the card's
                    // collapse transform still lands exactly on the visual square.
                    top: SQUARE_MARGIN - (PUCK_HIT - SQUARE_SIZE) / 2,
                    right: SQUARE_MARGIN - (PUCK_HIT - SQUARE_SIZE) / 2,
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
                        backgroundColor: fc.flashCard,
                        color: fc.onSurface,
                        boxShadow: "0 8px 20px rgba(0, 0, 0, 0.28)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <OpenInFullRoundedIcon fontSize="small" />
                </Box>
            </Box>
        </Box>
    );
};

export default GameEndPopup;

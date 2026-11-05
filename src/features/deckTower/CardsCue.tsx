import React, { useEffect, useRef, useState, type RefObject } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { ISO, prefersReducedMotion } from "./iso";
import { FLOAT_MS, floatPhaseDelay } from "./skyCueFloat";
import { heightAbovePlatform } from "./towerScroll";

/**
 * CardsCue — "Cards" over a small down chevron at the bottom centre of the Deck Tower,
 * saying the world's card library lies under the platform (docs/DECK_TOWER.md
 * § "The cards page" → "The cards cue"). A tap glides down to the cards page.
 *
 * Layer: page-private component (feature module `src/features/deckTower`).
 *
 * The WorldIndicators' sibling: the same boxless white ink on the sky (`skyInk`, the
 * page title's), the same label type, and the same box, so "Cards" stands on one line with
 * "Reading" and "Writing" (decided 2026-11-04). A squat chevron (wider than tall) hangs just
 * under the word, and the two bob together, CENTRED on that line (half the travel above,
 * half below), on the world arrows' `FLOAT_MS` page clock (`floatPhaseDelay`), so all three
 * cues move in step. Boxless, so like them an
 * exception to the app-wide outline rule (CLAUDE.md § Buttons & cards).
 *
 * It FADES OUT as the cards page rises: fully shown at or above the platform line, gone
 * `FADE_PX` below it. Written straight to the button's `opacity` from its own scroll
 * listener, never through state — it runs every scroll frame (towerScroll's header push
 * does the same). `hidden` (a pan, a deck swap, a resize, a study) multiplies in on top.
 *
 * Depends on: towerScroll (`heightAbovePlatform`), skyCueFloat (`FLOAT_MS`,
 * `floatPhaseDelay`). Depended on by: DeckTowerPage.tsx (`toCards` is its glide).
 */

/** The bob's full travel, px (label and chevron together). */
const BOB_PX = 4;
/** Gap (px) between the cue and the top of the footer bar — WorldIndicator's `FOOTER_GAP_PX`. */
const FOOTER_GAP_PX = 12;
/** The row's height — WorldIndicator's 32px chevron, which its label is centred on. */
const ROW_PX = 32;
/** The squat chevron's box, px, and its gap under the label's line box. */
const CHEVRON_W = 16;
const CHEVRON_H = 7;
const CHEVRON_GAP_PX = 6;
/** How far below the platform line (px) the cue has fully faded. */
const FADE_PX = 48;

// Centred on the resting line: half the travel above it, half below, so on average the
// word sits exactly on the world labels' line.
const bobDown = keyframes`
    0%, 100% { transform: translateY(${-BOB_PX / 2}px); }
    50% { transform: translateY(${BOB_PX / 2}px); }
`;

interface CardsCueProps {
    /** The tower's scroller — its position drives the fade. */
    scrollerRef: RefObject<HTMLDivElement | null>;
    /** Glide down to the cards page (DeckTowerPage `toCards`). */
    onTap: () => void;
    /** Hidden (a pan, deck swap, resize or study is running). */
    hidden: boolean;
    /** CSS length of the footer's height; the cue sits FOOTER_GAP_PX above it. */
    bottom: string;
    /** The ink: `ISO.white` under the time-of-day wash. Default unwashed. */
    color?: string;
}

const CardsCue: React.FC<CardsCueProps> = ({ scrollerRef, onTap, hidden, bottom, color = ISO.white }) => {
    const [phaseDelay] = useState(floatPhaseDelay);
    const buttonRef = useRef<HTMLButtonElement>(null);
    // The scroll fade, kept in a ref so a re-render (`hidden` flipping) does not reset it.
    const scrollFade = useRef(1);
    const hiddenRef = useRef(hidden);
    hiddenRef.current = hidden;

    const paint = () => {
        const button = buttonRef.current;
        if (!button) return;
        const opacity = hiddenRef.current ? 0 : scrollFade.current;
        button.style.opacity = String(opacity);
        // Faded out is out of the way: no tap on an invisible cue.
        button.style.pointerEvents = opacity < 0.05 ? "none" : "";
    };

    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const onScroll = () => {
            const below = -heightAbovePlatform(el);
            const next = Math.max(0, Math.min(1, 1 - below / FADE_PX));
            if (next === scrollFade.current) return;
            scrollFade.current = next;
            paint();
        };
        onScroll();
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
        // The scroller mounts once with the page; `paint` reads refs only.
    }, [scrollerRef]);

    // `hidden` changes go through the same writer as the scroll fade.
    useEffect(paint, [hidden]);

    return (
        <ButtonBase
            ref={buttonRef}
            className="deck-tower-page__cards-cue"
            aria-label="Go down to your cards"
            onClick={onTap}
            disableRipple
            sx={{
                position: "absolute",
                zIndex: 2,
                // WorldIndicator's box exactly — same floor, same 8px vertical padding, a
                // row as tall as its 32px chevron with the label centred in it — so "Cards"
                // sits on one line with "Reading" and "Writing".
                bottom: `calc(${bottom} + ${FOOTER_GAP_PX}px)`,
                left: "50%",
                transform: "translateX(-50%)",
                px: "12px",
                py: "8px",
                color,
                transition: "opacity 160ms ease-out",
            }}
        >
            <Box
                component="span"
                className="deck-tower-page__cards-cue-row"
                sx={{ height: ROW_PX, display: "flex", alignItems: "center" }}
            >
                {/* The label, centred in the row on the world labels' line, carries the
                    chevron hanging just under it; the two bob together around that line. */}
                <Typography
                    component="span"
                    className="deck-tower-page__cards-cue-label"
                    sx={{
                        position: "relative",
                        display: "block",
                        fontFamily: FONTS.cjk,
                        fontSize: SIZE.bodyLg,
                        fontWeight: WEIGHT.bold,
                        lineHeight: 1,
                        animation: prefersReducedMotion() ? undefined : `${bobDown} ${FLOAT_MS}ms ease-in-out ${phaseDelay} infinite`,
                    }}
                >
                    Cards
                    <Box
                        component="svg"
                        className="deck-tower-page__cards-cue-arrow"
                        viewBox={`0 0 ${CHEVRON_W} ${CHEVRON_H}`}
                        aria-hidden
                        sx={{
                            position: "absolute",
                            top: `calc(100% + ${CHEVRON_GAP_PX}px)`,
                            left: `calc(50% - ${CHEVRON_W / 2}px)`,
                            width: CHEVRON_W,
                            height: CHEVRON_H,
                            overflow: "visible",
                        }}
                    >
                        {/* A squat chevron: wider than it is tall. */}
                        <path
                            d={`M 1.5 1.5 L ${CHEVRON_W / 2} ${CHEVRON_H - 1.5} L ${CHEVRON_W - 1.5} 1.5`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.6}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </Box>
                </Typography>
            </Box>
        </ButtonBase>
    );
};

export default CardsCue;

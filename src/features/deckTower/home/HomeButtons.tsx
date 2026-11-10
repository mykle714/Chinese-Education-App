import React, { useState } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Icon from "../../../components/Icon";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { keycapPressSx } from "../../../theme/keycapPress";
import type { ScreenPoint } from "../../../utils/pageTransition";
import { prefersReducedMotion } from "../iso";
import { FLOAT_MS, floatPhaseDelay } from "../skyCueFloat";
import { towerKeyShadow, type TowerKeycapMetrics } from "../towerKeycap";

/**
 * HomeButtons — the home screen's footer row in the footer slab's place (HomeStage)
 * (docs/HOME_SCREEN.md § "The buttons"): the **Dictionary** keycap on the left and, on the
 * right, **"Swipe down to enter"** painted on the sky over one down chevron. The key takes a
 * third of the row (footer-tab style: glyph over label), the words two thirds.
 *
 * The right two thirds are NOT a keycap: they are a white sky cue cut exactly like td's world
 * labels ("‹ Reading", "Writing ›" — WorldIndicator): the same 32 px MUI chevron (turned down:
 * `ExpandMore`), the same `FONTS.cjk` / `SIZE.bodyLg` / bold label, white under the hour's
 * wash, and the same float on the shared sky-cue clock (skyCueFloat) — drifting DOWN, the
 * way the swipe goes, where the world labels drift outward. Because the way in
 * is the swipe (HomeStage → `useEnterSwipe`). It is still a <button>, so a tap (or the
 * keyboard) also enters; the swipe is what it advertises.
 *
 * Cut exactly like td's cards-page filter keys (towerKeycap.ts — the diagonal wall, the hard
 * cast shadow on the sky, the hairline rounded edge, and the app's raised-key press), so the
 * keycaps on the tower's sky are one family. Like those keys they carry NO outline: on the
 * sky a keycap's edge is its wall and its cast shadow (the tower style's rule — an exception
 * to CLAUDE.md's outline rule, the same one TowerFilterKeys takes).
 *
 * Colours, from the framework: the Dictionary key is the flashcard stock the slab footer is
 * cut from (`COLORS.cardFace` on `COLORS.cardWall`), with the footer tab's `translate` glyph;
 * the hint is `COLORS.white` washed for the hour (HomeStage passes it in).
 *
 * The cast shadow reads `--home-ground-shadow`, set by HomeStage from the sky, so a sky
 * change (the hour, the weather) never re-renders the keys.
 *
 * Layer: feature page view (src/features/deckTower/home). Rendered by HomeStage.
 */

/** The keys' wall and cast reach, px — the filter keys' UP metrics. */
const KEY_METRICS: TowerKeycapMetrics = { wallPx: 5, castReachPx: 4 };
const CAST_PX = KEY_METRICS.wallPx + KEY_METRICS.castReachPx;
/** The stage's ground-shadow var (HomeStage sets it from the sky). */
const GROUND_SHADOW = "var(--home-ground-shadow)";

/** The world labels' chevron size, px (WorldIndicator's `fontSize: 32`). */
const HINT_CHEVRON_PX = 32;
/** How far (px) the cue drifts down at the top of its float — WorldIndicator's `FLOAT_PX`. */
const HINT_FLOAT_PX = 4;

const floatDown = keyframes`
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(${HINT_FLOAT_PX}px); }
`;

interface HomeKeyProps {
    kind: "dictionary";
    label: string;
    glyph: string;
    face: string;
    wall: string;
    disabled: boolean;
    onTap: (at: ScreenPoint) => void;
}

const HomeKey: React.FC<HomeKeyProps> = ({ kind, label, glyph, face, wall, disabled, onTap }) => (
    <Box
        component="button"
        type="button"
        className={`home-buttons__key home-buttons__key--${kind}`}
        disabled={disabled}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            // The key's own centre — the Dictionary circle grows out of it.
            const r = e.currentTarget.getBoundingClientRect();
            onTap({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }}
        sx={{
            // A third of the row (the hint is flex 2).
            flex: 1,
            minWidth: 0,
            height: 60,
            display: "flex",
            // Glyph over label, like the footer's tabs: a third of the row is too narrow side by side.
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
            cursor: "pointer",
            borderRadius: "15px",
            border: "none",
            padding: "0 6px",
            backgroundColor: face,
            color: COLORS.onSurface,
            fontFamily: FONTS.sans,
            WebkitTapHighlightColor: "transparent",
            ...keycapPressSx({
                restShadow: towerKeyShadow(face, wall, 0, KEY_METRICS, GROUND_SHADOW),
                pressedShadow: towerKeyShadow(face, wall, KEY_METRICS.wallPx, KEY_METRICS, GROUND_SHADOW),
                // The press runs down the wall's (1, 1) diagonal.
                pressedX: KEY_METRICS.wallPx,
                pressedY: KEY_METRICS.wallPx,
            }),
            "&:disabled": { cursor: "default" },
        }}
    >
        <Icon name={glyph} size={22} fill={1} weight={500} color={COLORS.onSurface} className="home-buttons__glyph" sx={{ flexShrink: 0 }} />
        <Box component="span" className="home-buttons__label" sx={{ fontSize: 14, fontWeight: WEIGHT.bold, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
            {label}
        </Box>
    </Box>
);

/**
 * "Swipe down to enter" — a white sky cue over one down chevron, cut like td's world labels
 * (WorldIndicator), in two thirds of the row. A tap on it enters too.
 */
const EnterHint: React.FC<{ paint: string; disabled: boolean; onTap: () => void }> = ({ paint, disabled, onTap }) => {
    // Read once per mount: the delay only aligns the cycle's start with td's other sky cues.
    const [phaseDelay] = useState(floatPhaseDelay);
    return (
        <Box
            component="button"
            type="button"
            className="home-buttons__enter-hint"
            disabled={disabled}
            onClick={onTap}
            sx={{
                flex: 2,
                minWidth: 0,
                height: 60,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: paint,
                WebkitTapHighlightColor: "transparent",
                "&:disabled": { cursor: "default" },
            }}
        >
            {/* Words + chevron float as one unit; the button around them stays still. */}
            <Box
                component="span"
                className="home-buttons__enter-float"
                sx={{
                    display: "flex",
                    // The words, and the chevron centred under them (it points the swipe's way).
                    flexDirection: "column",
                    alignItems: "center",
                    animation: prefersReducedMotion() ? undefined : `${floatDown} ${FLOAT_MS}ms ease-in-out ${phaseDelay} infinite`,
                }}
            >
                <Box
                    component="span"
                    className="home-buttons__enter-words"
                    sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.bodyLg, fontWeight: WEIGHT.bold, lineHeight: 1, textAlign: "center" }}
                >
                    Swipe down to enter
                </Box>
                <ExpandMoreIcon className="home-buttons__enter-chevron" sx={{ fontSize: HINT_CHEVRON_PX, display: "block", mt: "-2px" }} />
            </Box>
        </Box>
    );
};

interface HomeButtonsProps {
    /** Opens the Dictionary with the circle transition, grown from `at`. */
    onDictionary: (at: ScreenPoint) => void;
    /** Starts the Enter shift down into the tower (the hint's tap; the swipe is HomeStage's). */
    onEnter: () => void;
    /** White under the hour's wash, for the hint. */
    hintPaint: string;
    /** Both dead (the Enter shift has started). */
    disabled: boolean;
}

const HomeButtons: React.FC<HomeButtonsProps> = ({ onDictionary, onEnter, hintPaint, disabled }) => (
    <Box
        className="home-buttons"
        // The gap clears the key's cast shadow; the bottom padding keeps the shadow in the box.
        sx={{ display: "flex", gap: `${CAST_PX + 6}px`, pb: `${CAST_PX}px`, width: "100%" }}
    >
        <HomeKey
            kind="dictionary"
            label="Dictionary"
            glyph="translate"
            face={COLORS.cardFace}
            wall={COLORS.cardWall}
            disabled={disabled}
            onTap={onDictionary}
        />
        <EnterHint paint={hintPaint} disabled={disabled} onTap={onEnter} />
    </Box>
);

export default HomeButtons;

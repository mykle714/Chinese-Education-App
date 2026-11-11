import React from "react";
import { Box } from "@mui/material";
import Icon from "../../../components/Icon";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";
import { keycapPressSx } from "../../../theme/keycapPress";
import type { ScreenPoint } from "../../../utils/pageTransition";
import { towerKeyShadow, type TowerKeycapMetrics } from "../towerKeycap";

/**
 * HomeButtons — the home screen's footer row in the footer slab's place (HomeStage)
 * (docs/HOME_SCREEN.md § "The buttons"): the **Dictionary** keycap alone, in the bottom-left
 * corner, at a third of the row's width (footer-tab style: glyph over label). "Swipe down to enter" used to share
 * this row; it now stands mid-screen on Tap to Start's line (HomeEnterHint).
 *
 * Cut exactly like td's cards-page filter keys (towerKeycap.ts — the diagonal wall, the hard
 * cast shadow on the sky, the hairline rounded edge, and the app's raised-key press), so the
 * keycaps on the tower's sky are one family. Like those keys they carry NO outline: on the
 * sky a keycap's edge is its wall and its cast shadow (the tower style's rule — an exception
 * to CLAUDE.md's outline rule, the same one TowerFilterKeys takes).
 *
 * Colours, from the framework: the Dictionary key is the flashcard stock the slab footer is
 * cut from (`COLORS.cardFace` on `COLORS.cardWall`), with the footer tab's `translate` glyph.
 *
 * The cast shadow reads `--home-ground-shadow`, set by HomeStage from the sky, so a sky
 * change (the hour, the weather) never re-renders the key.
 *
 * Layer: feature page view (src/features/deckTower/home). Rendered by HomeStage.
 */

/** The keys' wall and cast reach, px — the filter keys' UP metrics. */
const KEY_METRICS: TowerKeycapMetrics = { wallPx: 5, castReachPx: 4 };
const CAST_PX = KEY_METRICS.wallPx + KEY_METRICS.castReachPx;
/** The stage's ground-shadow var (HomeStage sets it from the sky). */
const GROUND_SHADOW = "var(--home-ground-shadow)";

/** The key's width: the third of the row it had beside the hint (gap `CAST_PX + 6` between the two). */
const KEY_WIDTH = `calc((100% - ${CAST_PX + 6}px) / 3)`;

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
            // A third of the row, at its left end.
            width: KEY_WIDTH,
            flexShrink: 0,
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

interface HomeButtonsProps {
    /** Opens the Dictionary with the circle transition, grown from `at`. */
    onDictionary: (at: ScreenPoint) => void;
    /** Dead (the Enter shift has started). */
    disabled: boolean;
}

const HomeButtons: React.FC<HomeButtonsProps> = ({ onDictionary, disabled }) => (
    <Box
        className="home-buttons"
        // The key at the row's left end; the bottom padding keeps its cast shadow in the box.
        sx={{ display: "flex", justifyContent: "flex-start", pb: `${CAST_PX}px`, width: "100%" }}
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
    </Box>
);

export default HomeButtons;

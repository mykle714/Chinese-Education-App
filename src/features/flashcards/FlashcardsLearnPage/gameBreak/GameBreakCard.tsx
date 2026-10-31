import React from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import DelayedCircularProgress from "../../../../components/DelayedCircularProgress";
import Icon from "../../../../components/Icon";
import { flpBreakGameFor, type FlpBreakCandidate } from "../../../../games/flpBreak";
import { COLORS, RAMP } from "../../../../theme/colors";
import { LEADING, SIZE, WEIGHT } from "../../../../theme/scale";
import { SHADOW } from "../../../../theme/shadows";
import { shadeHex } from "../../../../theme/shadeHex";
import { CREAM_PLATE_TONES } from "../../../../theme/towerSlab";
import { PLATE_WALL_PX, towerPlateSx, type PlateTones } from "../../../../theme/towerPlate";

/** The glyph token: a slab like the tower's plates, cut thicker so it is the card's one object. */
const TOKEN = { size: 104, wall: 9, radius: 26, glyph: 58 } as const;
/** Clear space between the panel's edge and the card's content. */
const PANEL_PAD = "calc(var(--card-stock-inset, 0px) + 16px)";

/** A game hue as slab tones: the face is its mid tier, the wall a shade down. */
function hueTones(mid: string): PlateTones {
    return { top: mid, left: shadeHex(mid, 0.1), right: shadeHex(mid, 0.2) };
}

const plateButtonSx = (tones: PlateTones) => ({
    ...towerPlateSx(tones),
    height: 46,
    borderRadius: "14px",
    fontSize: SIZE.body,
    // The wall hangs below the box; keep it clear of the panel's foot.
    marginBottom: `${PLATE_WALL_PX}px`,
});

/**
 * GameBreakCard — the face of the break's card (docs/FLP_GAME_BREAKS.md § 5): one side, in
 * the card stock of `BreakCardLayer`. The game's colour is held back to two raised objects,
 * the glyph token and the Play plate, so the card still reads as one of the deck's.
 *
 * Tower plates have no `COLORS.border` outline: their edge is their wall
 * (docs/TOWER_STYLE_SHIFT.md § "The outline rule").
 *
 * Layer: feature component (features/flashcards): it needs towerPlate, so it can't sit in
 * the games engine. Reads the game through its `FlpBreakGame` adapter.
 */
const GameBreakCard: React.FC<{
    candidate: FlpBreakCandidate;
    onSkip: () => void;
    onPlay: () => void;
    /** The opening board is still loading: Play shows a spinner and waits. */
    playPending: boolean;
}> = ({ candidate, onSkip, onPlay, playPending }) => {
    const { game } = candidate;
    const adapter = flpBreakGameFor(game.gameId);
    const tones = hueTones(RAMP[game.hue].mid);

    return (
        <Box
            className="game-break-card"
            sx={{ width: "100%", height: "100%", boxSizing: "border-box", padding: PANEL_PAD, display: "flex", flexDirection: "column", textAlign: "center" }}
        >
            <Box
                className="game-break-card__info"
                sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}
            >
                <Box
                    className="game-break-card__token"
                    sx={{
                        width: TOKEN.size,
                        height: TOKEN.size,
                        flexShrink: 0,
                        marginBottom: `${TOKEN.wall + 10}px`,
                        borderRadius: `${TOKEN.radius}px`,
                        backgroundColor: tones.top,
                        boxShadow: `0 ${TOKEN.wall}px 0 ${tones.right}, ${SHADOW.chip}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Icon name={game.glyph} size={TOKEN.glyph} color={COLORS.onSurface} className="game-break-card__glyph" />
                </Box>
                <Typography className="game-break-card__title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight, color: COLORS.onSurface }}>
                    {game.title}
                </Typography>
                <Typography className="game-break-card__rules" sx={{ fontSize: SIZE.body, lineHeight: LEADING.normal, color: COLORS.onSurface }}>
                    {adapter?.rulesLine}
                </Typography>
            </Box>
            <Box className="game-break-card__actions" sx={{ display: "flex", gap: 1.25, paddingTop: 2 }}>
                <ButtonBase className="game-break-card__skip" onClick={onSkip} sx={{ ...plateButtonSx(CREAM_PLATE_TONES), flex: 1 }}>
                    Skip
                </ButtonBase>
                <ButtonBase
                    className="game-break-card__play"
                    onClick={onPlay}
                    disabled={playPending}
                    sx={{ ...plateButtonSx(tones), flex: 2 }}
                >
                    {playPending ? <DelayedCircularProgress className="game-break-card__play-spinner" size={18} /> : "Play"}
                </ButtonBase>
            </Box>
        </Box>
    );
};

export default GameBreakCard;

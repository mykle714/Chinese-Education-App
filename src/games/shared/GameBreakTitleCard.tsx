import React from "react";
import { Box, Button, Typography } from "@mui/material";
import { CARD_SHELL, CARD_TITLE_SX } from "../../components/bento";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import Icon from "../../components/Icon";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, TRACKING, WEIGHT } from "../../theme/scale";
import type { PersonalBestGame } from "../../../server/contracts/personalBests";
import { GameFrame } from "./GameFrame";
import { GameSurfaceContext } from "./gameSurface";
import { usePersonalBest } from "./usePersonalBest";
import PersonalBestLine from "./PersonalBestLine";

/** The ghost glyph: drawn large and bled off the panel's top-right, in CardShell's
 *  treatment (ink at `CARD_SHELL.ghostOpacity`, `CARD_SHELL.ghostRight` bleed) so the
 *  panel reads as the hub tile it stands in for, scaled up to a whole play area. */
const GHOST = { size: 200, top: -28 } as const;

export interface GameBreakTitleCardProps {
    /** Eyebrow above the name — "Game break" on the flp (docs/FLP_GAME_BREAKS.md § 5). */
    eyebrow: string;
    title: string;
    /** Material Symbols name (`GameDef.glyph`). */
    glyph: string;
    /** The game's ramp hue (`GameDef.hue`) — a KEY, so the fill and the frame match. */
    hue: RampHue;
    rulesLine: string;
    /** Medal targets ("🥇 9 · 🥈 6 · 🥉 3 pairs"), or null for a game without medals. */
    medalLine: string | null;
    personalBest: { game: PersonalBestGame; mode: string | number | null; unitLabel?: string } | null;
    onSkip: () => void;
    onPlay: () => void;
    /** The opening board is still loading — Play shows a spinner and waits. */
    playPending?: boolean;
}

/**
 * GameBreakTitleCard — a game break's opening screen (docs/FLP_GAME_BREAKS.md § 5),
 * drawn AS THE GAME'S PLAY PANEL: the same `GameFrame` every game draws its board in,
 * filled with the game's mid tier (`RAMP[hue].mid` — the hub tile's fill). It is the
 * panel that rises into the flp; on Play the game's own `GameFrame` takes the same
 * place, so the break reads as one panel that fills with a game.
 *
 * Content: eyebrow, the game's name and ghost glyph, the one-line rule, medal targets
 * and personal best on top; Skip / Play at the foot (thumb reach). Buttons mirror the
 * games' own end popups (Match Speed's Play Again / Back to Games): contained primary,
 * outlined secondary, 14px corners — so the break's first and last screens share one
 * button language.
 *
 * Provides its own `GameSurfaceContext` so `GameFrame` takes the accent-ground border
 * (`--line2`) — the fill IS the hue, and the faint default hairline would vanish on it.
 *
 * Layer: games engine, shared presentational (no flp knowledge).
 * Consumer: features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakArea.
 */
const GameBreakTitleCard: React.FC<GameBreakTitleCardProps> = ({
    eyebrow, title, glyph, hue, rulesLine, medalLine, personalBest, onSkip, onPlay, playPending = false,
}) => {
    // Hooks can't be conditional, so a game with no best asks with a null mode — which
    // `usePersonalBest` treats as "nothing to fetch".
    const { best } = usePersonalBest(personalBest?.game ?? "match-speed", personalBest?.mode ?? null);
    return (
        <GameSurfaceContext.Provider value={hue}>
            <GameFrame className="game-break-title-card" sx={{ backgroundColor: RAMP[hue].mid }}>
                <Icon
                    name={glyph}
                    size={GHOST.size}
                    color={COLORS.onSurface}
                    className="game-break-title-card__ghost"
                    sx={{
                        position: "absolute",
                        top: GHOST.top,
                        right: CARD_SHELL.ghostRight,
                        opacity: CARD_SHELL.ghostOpacity,
                        pointerEvents: "none",
                    }}
                />
                <Box
                    className="game-break-title-card__info"
                    sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 1.25, padding: "24px 22px 8px" }}
                >
                    <Typography
                        className="game-break-title-card__eyebrow"
                        sx={{
                            fontFamily: FONTS.mono,
                            fontSize: SIZE.caption,
                            letterSpacing: TRACKING.caps,
                            textTransform: "uppercase",
                            color: COLORS.textSecondary,
                        }}
                    >
                        {eyebrow}
                    </Typography>
                    <Typography className="game-break-title-card__title" sx={{ ...CARD_TITLE_SX, fontSize: SIZE.heading }}>
                        {title}
                    </Typography>
                    <Typography
                        className="game-break-title-card__rules"
                        sx={{ fontSize: SIZE.body, lineHeight: LEADING.normal, color: COLORS.onSurface, maxWidth: "90%" }}
                    >
                        {rulesLine}
                    </Typography>
                    {(medalLine || (personalBest && best !== null)) && (
                        <Box
                            className="game-break-title-card__targets"
                            sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.5, mt: 0.5 }}
                        >
                            {medalLine && (
                                <Typography
                                    className="game-break-title-card__medals"
                                    sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.medium, color: COLORS.onSurface }}
                                >
                                    {medalLine}
                                </Typography>
                            )}
                            {personalBest && (
                                <PersonalBestLine
                                    game={personalBest.game}
                                    best={best}
                                    isNewBest={false}
                                    unitLabel={personalBest.unitLabel}
                                    className="game-break-title-card__personal-best"
                                />
                            )}
                        </Box>
                    )}
                </Box>
                <Box className="game-break-title-card__actions" sx={{ display: "flex", gap: 1.25, padding: "16px 22px 22px" }}>
                    <Button
                        className="game-break-title-card__skip"
                        variant="outlined"
                        onClick={onSkip}
                        sx={{
                            flex: 1,
                            py: 1.25,
                            borderRadius: "14px",
                            textTransform: "none",
                            fontWeight: WEIGHT.medium,
                            borderColor: COLORS.border,
                            color: COLORS.onSurface,
                            backgroundColor: COLORS.white,
                        }}
                    >
                        Skip
                    </Button>
                    <Button
                        className="game-break-title-card__play"
                        variant="contained"
                        onClick={onPlay}
                        disabled={playPending}
                        sx={{
                            flex: 2,
                            py: 1.25,
                            borderRadius: "14px",
                            textTransform: "none",
                            fontSize: SIZE.bodyLg,
                            fontWeight: WEIGHT.bold,
                            lineHeight: LEADING.tight,
                        }}
                    >
                        {playPending ? <DelayedCircularProgress className="game-break-title-card__play-spinner" size={18} /> : "Play"}
                    </Button>
                </Box>
            </GameFrame>
        </GameSurfaceContext.Provider>
    );
};

export default GameBreakTitleCard;

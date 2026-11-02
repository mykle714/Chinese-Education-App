import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import PersonalBestLine from "../../../../games/shared/PersonalBestLine";
import type { FlpBreakPersonalBest, FlpBreakResults } from "../../../../games/flpBreak";
import { COLORS } from "../../../../theme/colors";
import { LEADING, SIZE, WEIGHT } from "../../../../theme/scale";

/** Clear space between the panel's edge and the card's content (`GameBreakCard`'s). */
const PANEL_PAD = "calc(var(--card-stock-inset, 0px) + 16px)";

/**
 * GameBreakResultCard — the break's card after the game (docs/FLP_GAME_BREAKS.md § 5b): the
 * run's results, on the card the game opened from. It has no buttons: `BreakCardLayer`
 * takes a tap or a swipe, so the hint line is the only instruction.
 *
 * Layer: feature component (features/flashcards). Rendered through `BreakCardLayer`; reads
 * display strings only, so it needs no change when another game gets an adapter.
 */
const GameBreakResultCard: React.FC<{ results: FlpBreakResults }> = ({ results }) => {
    const [personalBest, setPersonalBest] = useState<FlpBreakPersonalBest | null>(null);
    useEffect(() => {
        let live = true;
        void results.personalBest.then((best) => {
            if (live) setPersonalBest(best);
        });
        return () => { live = false; };
    }, [results]);

    return (
        <Box
            className="game-break-result-card"
            sx={{ width: "100%", height: "100%", boxSizing: "border-box", padding: PANEL_PAD, display: "flex", flexDirection: "column", textAlign: "center" }}
        >
            <Box
                className="game-break-result-card__info"
                sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}
            >
                <Typography className="game-break-result-card__title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight, color: COLORS.onSurface }}>
                    {results.title}
                </Typography>
                <Typography className="game-break-result-card__score" sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight, color: COLORS.onSurface }}>
                    {results.score}
                </Typography>
                {results.details.map((detail) => (
                    <Typography key={detail} className="game-break-result-card__detail" sx={{ fontSize: SIZE.body, lineHeight: LEADING.normal, color: COLORS.textSecondary }}>
                        {detail}
                    </Typography>
                ))}
                {personalBest && (
                    <PersonalBestLine
                        game={personalBest.game}
                        best={personalBest.best}
                        isNewBest={personalBest.isNewBest}
                        className="game-break-result-card__personal-best"
                    />
                )}
            </Box>
            <Typography className="game-break-result-card__hint" sx={{ fontSize: SIZE.body, lineHeight: LEADING.normal, color: COLORS.textSecondary }}>
                Tap or swipe to continue
            </Typography>
        </Box>
    );
};

export default GameBreakResultCard;

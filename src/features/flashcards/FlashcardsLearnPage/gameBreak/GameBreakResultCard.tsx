import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import PersonalBestLine from "../../../../games/shared/PersonalBestLine";
import RunTierPanels from "../../../../games/shared/RunTierPanels";
import type { FlpBreakPersonalBest, FlpBreakResults } from "../../../../games/flpBreak";
import { COLORS } from "../../../../theme/colors";
import { LEADING, SIZE, WEIGHT } from "../../../../theme/scale";
import SidewaysCardFace from "./SidewaysCardFace";

/** Clear space between the panel's edge and the card's content (`GameBreakCard`'s). */
const PANEL_PAD = "calc(var(--card-stock-inset, 0px) + 16px)";

/**
 * GameBreakResultCard — the break's card after the game (docs/FLP_GAME_BREAKS.md § 5b): the
 * run's results, on the card the game opened from.
 *
 *   Finished run (`results.tiers` set): the heading and the two run-tier panels, and
 *     nothing else — the time and personal best live in the speed panel, the accuracy
 *     fraction in the accuracy panel (`RunTierPanels`). `score` / `details` are not shown.
 *   Unfinished run (`tiers` null — left early, out of cards): the heading, `score`,
 *     `details` and the personal best line, as there are no tiers to carry them. It has no buttons: `BreakCardLayer`
 * takes a tap or a swipe, so the hint line is the only instruction.
 *
 * Layer: feature component (features/flashcards). Rendered through `BreakCardLayer`; reads
 * display strings only, so it needs no change when another game gets an adapter.
 *
 * `sideways` (a landscape game's adapter, `FlpBreakGame.sideways`) turns the face 90° the
 * game's way, as the title card did: the learner is still holding the phone sideways when
 * the game closes onto this card.
 */
const GameBreakResultCard: React.FC<{ results: FlpBreakResults; sideways?: boolean }> = ({ results, sideways = false }) => {
    const [personalBest, setPersonalBest] = useState<FlpBreakPersonalBest | null>(null);
    useEffect(() => {
        let live = true;
        void results.personalBest.then((best) => {
            if (live) setPersonalBest(best);
        });
        return () => { live = false; };
    }, [results]);

    return (
        <SidewaysCardFace sideways={sideways}>
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
                {results.tiers ? (
                    <RunTierPanels tiers={results.tiers} personalBest={personalBest} className="game-break-result-card__tiers" />
                ) : (
                    <>
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
                    </>
                )}
            </Box>
            <Typography className="game-break-result-card__hint" sx={{ fontSize: SIZE.body, lineHeight: LEADING.normal, color: COLORS.textSecondary }}>
                Tap or swipe to continue
            </Typography>
        </Box>
        </SidewaysCardFace>
    );
};

export default GameBreakResultCard;

import React from "react";
import { Box, Button, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import { formatTimeMs } from "../../utils/timeUtils";
import GameEndPopup from "../runtime/GameEndPopup";
import PersonalBestLine from "../shared/PersonalBestLine";
import { GAME_ID, MEDAL_LABEL, type Medal } from "./constants";

/**
 * Bucket Drop's end-of-run card (docs/BUCKET_DROP_GAME.md § 6): medal, time (the
 * score, so the biggest thing on it), words and misses, personal best, then Play Again
 * and Back.
 *
 * NOT minimizable — no `onMinimize`/`onRestore` are passed to GameEndPopup, so it is
 * modal. A finished board is empty, so there is nothing behind it worth uncovering
 * (the Speed Reading rule, docs/GAMES_FEATURE.md § Layer 2).
 *
 * Never shown during a Study Challenge round — the page renders
 * ChallengeRoundScoreboard instead, which has no Play Again.
 */
interface BucketDropEndPopupProps {
    medal: Medal | null;
    finalMs: number;
    total: number;
    misses: number;
    /** False when the dictionary could not fill a full run — no medal, no best. */
    fullRun: boolean;
    personalBestMs: number | null;
    isNewBest: boolean;
    exitLabel: string;
    onPlayAgain: () => void;
    onLeave: () => void;
}

const BucketDropEndPopup: React.FC<BucketDropEndPopupProps> = ({
    medal, finalMs, total, misses, fullRun, personalBestMs, isNewBest, exitLabel, onPlayAgain, onLeave,
}) => (
    <GameEndPopup classPrefix="bucket-drop">
        <Typography className="bucket-drop__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
            {medal ? `${MEDAL_LABEL[medal]}!` : "Finished!"}
        </Typography>
        <Typography className="bucket-drop__popup-time" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
            {formatTimeMs(finalMs)}
        </Typography>
        <Typography className="bucket-drop__popup-score" sx={{ fontSize: SIZE.body, color: COLORS.textSecondary }}>
            {total} words · {misses} {misses === 1 ? "miss" : "misses"}
            {!fullRun && " · short run, no medal"}
        </Typography>
        <PersonalBestLine game={GAME_ID} best={personalBestMs} isNewBest={isNewBest} className="bucket-drop__personal-best" />
        <Box className="bucket-drop__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}>
            <Button
                className="bucket-drop__popup-again"
                variant="contained"
                onClick={onPlayAgain}
                sx={{ py: 1.25, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.bold }}
            >
                Play Again
            </Button>
            <Button
                className="bucket-drop__popup-back"
                variant="outlined"
                onClick={onLeave}
                sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
            >
                Back to {exitLabel}
            </Button>
        </Box>
    </GameEndPopup>
);

export default BucketDropEndPopup;

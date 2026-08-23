import { Box, Typography } from "@mui/material";
import type { ChallengeRound } from "../../types";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { breakdownRowSx, challengeMutedSx } from "./challengeStyles";
import { signedPoints } from "./challengeLabels";

/**
 * A player's rounds as itemised score lines
 * (docs/STUDY_CHALLENGE.md § 5.5 — the between-games scoreboard, and § 6 results).
 *
 * ⚠️ EVERY LINE IS RENDERED FROM THE STORED BREAKDOWN, never recomputed here. The
 * breakdown was derived from the same accumulator as the total when the round was
 * played (§ 5.6), so drawing it verbatim is what guarantees the card can never
 * disagree with the number it is showing. A display-time recomputation would
 * reintroduce exactly that possibility, with nothing to arbitrate between the two.
 *
 * The breakdown is an OPEN shape — jsonb server-side — so a game may add lines later
 * without a migration and without a change here: this component draws whatever lines
 * it is given, in the order it is given them.
 */
function ChallengeScoreTable({ rounds }: { rounds: Record<string, ChallengeRound> | undefined }) {
    const entries = Object.entries(rounds ?? {})
        // Numeric sort on the round index: the keys are strings ("1", "2", "3"), and a
        // lexicographic sort would put "10" before "2" the day a test is ever longer
        // than nine rounds.
        .sort(([a], [b]) => Number(a) - Number(b));

    if (entries.length === 0) {
        return (
            <Typography className="challenge-score-table__empty" sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}>
                No rounds played.
            </Typography>
        );
    }

    return (
        <Box className="challenge-score-table" sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 0.5 }}>
            {entries.map(([index, round]) => (
                <Box key={index} className="challenge-score-table__round">
                    <Box sx={{ ...breakdownRowSx, fontWeight: WEIGHT.semibold }}>
                        <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                            Round {index} · {round.gameId}{round.mode ? ` (${round.mode})` : ""}
                        </Typography>
                        <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                            {round.score.toLocaleString()}
                        </Typography>
                    </Box>

                    {(round.breakdown?.lines ?? []).map((line, lineIndex) => (
                        <Box
                            key={`${line.ruleId}-${lineIndex}`}
                            className={`challenge-score-table__line challenge-score-table__line--${line.ruleId}`}
                            sx={{ ...breakdownRowSx, pl: 1.5, color: COLORS.textSecondary }}
                        >
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary }}>
                                {line.label}
                                {/* "7 × 100" only when the line really is a simple multiple —
                                    a one-off such as a survival bonus has no count, and
                                    printing "1 ×" for it would misdescribe it. */}
                                {line.count != null && line.unitPoints != null
                                    ? ` ${line.count} × ${line.unitPoints}`
                                    : ""}
                            </Typography>
                            <Typography
                                sx={{
                                    fontFamily: FONTS.sans,
                                    fontSize: SIZE.micro,
                                    // A negative line is drawn in the warning colour: mistakes
                                    // and time penalties are the lines a player actually
                                    // scans for, and totals may legitimately go negative.
                                    color: line.points < 0 ? COLORS.dangerInk : COLORS.textSecondary,
                                }}
                            >
                                {signedPoints(line.points)}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            ))}
        </Box>
    );
}

export default ChallengeScoreTable;

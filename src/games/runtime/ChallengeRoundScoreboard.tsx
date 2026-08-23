import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import GameEndPopup from "./GameEndPopup";
import { challengeLaunchFor } from "./challengeLaunch";
import { signedPoints } from "../../features/studyChallenge/challengeLabels";
import type { ChallengeRoundState } from "./useChallengeRound";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

/**
 * The between-games scoreboard (docs/STUDY_CHALLENGE.md § 5.5).
 *
 * Shown after EVERY round of a test, in place of the game's own end-of-run popup:
 *
 *     ROUND 2 · BUBBLE MATCH
 *     contested matches      7 × 100     +700
 *     contested mistakes     2 × −100    −200
 *     survival bonus                     +300
 *     ─────────────────────────────────────────
 *     this round                          800
 *     previous rounds                   1 240
 *     TOTAL                             2 040
 *
 * Every line comes from the round's own accumulator (§ 5.6) — this component does
 * no arithmetic beyond adding the two totals it is handed, because a display-side
 * recomputation is exactly how a card ends up disagreeing with the number stored.
 *
 * ⚠️ ASYNC MODE SHOWS ONLY THE PLAYER'S OWN NUMBERS. The opponent's score, per
 * round and in total, stays hidden until BOTH players have finished all their
 * rounds (§ 6) — whoever plays second must play against the game, not against a
 * number. That rule is enforced by the server (`opponentRounds` is simply absent
 * from the payload), so there is nothing to withhold here; it is stated because the
 * live-mode version of this card (§ 7) DOES show both, and this is the difference.
 *
 * NOT MINIMIZABLE, unlike a game's own end popup: the board behind it belongs to a
 * scored round that is now final, so there is nothing to uncover and the only exits
 * are forward — the next round, or the challenge.
 */
const ChallengeRoundScoreboard: React.FC<{
    round: ChallengeRoundState;
    /** BEM-style prefix so each game keeps distinct class names. */
    classPrefix: string;
}> = ({ round, classPrefix }) => {
    const navigate = useNavigate();
    const { result, challenge, challengeId, roundCount } = round;
    // THE ROUND THIS CARD IS ABOUT is the one frozen on the result, never the hook's
    // live index — that advances the instant the POST lands (see ChallengeRoundResult).
    const roundIndex = result?.roundIndex ?? 0;

    // The NEXT round's launch, when there is one. Read off the challenge's own drawn
    // sequence — the order is part of the format and identical for both players
    // (§ 5.1), so it is never re-derived here.
    const next = useMemo(() => {
        const sequence = challenge?.gameSequence ?? [];
        const upcoming = sequence[roundIndex]; // 0-based: entry `roundIndex` is round roundIndex+1
        if (!challengeId || !upcoming || roundIndex >= roundCount) return null;
        return challengeLaunchFor(challengeId, roundIndex + 1, upcoming);
    }, [challenge?.gameSequence, challengeId, roundIndex, roundCount]);

    if (!result) return null;

    // The game just played. Titled through the launch table so the card says
    // "Word Search (pinyin)" rather than the raw id, falling back to the id for a game
    // this build no longer knows (the two-phase retirement window).
    const played = challenge?.gameSequence?.[roundIndex - 1];
    const gameTitle = played
        ? challengeLaunchFor(challengeId ?? "", roundIndex, played)?.title ?? played.gameId
        : "";
    const total = result.breakdown.total + result.previousTotal;
    const challengePath = challengeId ? `/friends/challenges/${challengeId}` : "/friends/challenges";

    /** One `label   count × unit   points` row. */
    const line = (label: string, detail: string | null, points: number, bold = false) => (
        <Box
            key={`${label}-${detail ?? ""}`}
            className={`${classPrefix}__challenge-line`}
            sx={{ display: "flex", alignItems: "baseline", gap: 1, width: "100%" }}
        >
            <Typography sx={{
                fontFamily: FONTS.sans,
                fontSize: SIZE.caption,
                fontWeight: bold ? WEIGHT.bold : WEIGHT.regular,
                color: COLORS.onSurface,
                flex: 1,
                textAlign: "left",
            }}>
                {label}
            </Typography>
            {detail && (
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary }}>
                    {detail}
                </Typography>
            )}
            <Typography sx={{
                fontFamily: FONTS.mono,
                fontSize: SIZE.caption,
                fontWeight: bold ? WEIGHT.bold : WEIGHT.semibold,
                color: points < 0 ? COLORS.redAccent : COLORS.onSurface,
                minWidth: 64,
                textAlign: "right",
            }}>
                {signedPoints(points)}
            </Typography>
        </Box>
    );

    return (
        <GameEndPopup classPrefix={classPrefix}>
            <Typography
                className={`${classPrefix}__challenge-title`}
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.caption,
                    fontWeight: WEIGHT.bold,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: COLORS.textSecondary,
                }}
            >
                Round {roundIndex} of {roundCount} · {gameTitle}
            </Typography>

            <Box
                className={`${classPrefix}__challenge-lines`}
                sx={{ display: "flex", flexDirection: "column", gap: 0.5, width: "100%", mt: 1 }}
            >
                {/* A round with no lines at all (nothing matched, nothing penalised)
                    still has to say something, or the card reads as broken. */}
                {result.breakdown.lines.length === 0
                    ? line("no points scored", null, 0)
                    : result.breakdown.lines.map((entry) => line(
                        entry.label,
                        entry.count != null && entry.unitPoints != null
                            ? `${entry.count} × ${signedPoints(entry.unitPoints)}`
                            : null,
                        entry.points
                    ))}
            </Box>

            <Box sx={{ width: "100%", borderTop: `1px solid ${COLORS.rowBorder}`, my: 1 }} />
            {line("this round", null, result.breakdown.total)}
            {line("previous rounds", null, result.previousTotal)}
            {line("total", null, total, true)}

            {/* The submit is the only thing here that can fail, and a submitted round
                is final — so the state is stated plainly rather than retried behind
                the player's back. */}
            {result.error && (
                <Typography
                    className={`${classPrefix}__challenge-error`}
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.redAccent, mt: 0.5 }}
                >
                    {result.error}
                </Typography>
            )}
            {!result.submitted && !result.error && (
                <Typography
                    className={`${classPrefix}__challenge-saving`}
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary, mt: 0.5 }}
                >
                    Saving your score…
                </Typography>
            )}

            <Box
                className={`${classPrefix}__challenge-actions`}
                sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%", mt: 1.5 }}
            >
                {next && (
                    <Button
                        className={`${classPrefix}__challenge-next`}
                        variant="contained"
                        // Disabled until the round is banked: round n+1's board is
                        // refused by the server until n is stored (§ 5.1a), so an
                        // eager tap would land on an error screen.
                        disabled={!result.submitted}
                        onClick={() => navigate(next.to, { state: next.state, replace: true })}
                        sx={{
                            py: 1.25,
                            borderRadius: "14px",
                            textTransform: "none",
                            fontSize: SIZE.bodyLg,
                            fontWeight: WEIGHT.bold,
                            lineHeight: LEADING.tight,
                        }}
                    >
                        Next round · {next.title}
                    </Button>
                )}
                <Button
                    className={`${classPrefix}__challenge-back`}
                    variant={next ? "outlined" : "contained"}
                    onClick={() => navigate(challengePath)}
                    sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
                >
                    {next ? "Back to the challenge" : "See the challenge"}
                </Button>
            </Box>
        </GameEndPopup>
    );
};

export default ChallengeRoundScoreboard;

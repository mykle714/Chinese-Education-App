import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import StyleIcon from "@mui/icons-material/Style";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import ForeignText from "../../components/ForeignText";
import ChallengeScoreTable from "./ChallengeScoreTable";
import { fetchChallenge, withdrawChallenge } from "../../api/studyChallenges";
import type { ChallengeSummary } from "../../api/studyChallenges";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { challengeErrorMessage, challengeStatusLine, deadlineLabel, roundsTotal } from "./challengeLabels";
import { challengeCardSx, challengeMessageSx, challengeMutedSx, wordTileSx } from "./challengeStyles";

/**
 * One challenge, in every state after `pending`-on-the-challenger's-side
 * (docs/STUDY_CHALLENGE.md §§ 4–6): the word set, the deadlines, the study deck, the
 * test entry point, and — once both players are done — the result.
 *
 * ⚠️ WHAT THIS PAGE MUST NOT SHOW, and the server makes sure it cannot:
 *   * THE GAMES, before the viewer's own window opens. `gameSequence` is simply absent
 *     from the payload until then (Q63), so there is nothing to leak even by accident.
 *     The copy therefore promises "three games" without naming them.
 *   * THE OPPONENT'S SCORE, before both players have finished. `opponentRounds` is
 *     likewise absent (§ 6). Only their PROGRESS is available, because whoever plays
 *     second must play against the game and never against a number.
 *
 * The results view shows TOTALS AND PER-GAME SCORES ONLY (Q64) — no per-word
 * comparison. That would be a nice study artifact but it would require every game to
 * emit per-word outcomes forever, a permanent tax on the scoring contract for a screen
 * nobody has asked for. The breakdown is jsonb, so it stays addable later.
 */
function ChallengeDetailPage() {
    const { challengeId } = useParams<{ challengeId: string }>();
    usePageTitle("Challenge");

    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Keyed on isAuthenticated + the id, never on `token`.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchChallenge(challengeId!)
            .then((result) => { if (!cancelled) { setChallenge(result); setError(null); } })
            .catch((err: unknown) => {
                if (!cancelled) setError(challengeErrorMessage(err, "Could not load that challenge"));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isAuthenticated, challengeId]);

    /**
     * Withdraw — challenger only, and only while `pending`. The row is deleted, which
     * frees the pair's week immediately; this is the repair for a challenge sent to
     * the wrong friend, or into a language the other player does not study.
     */
    const handleWithdraw = useCallback(async () => {
        if (busy || !challengeId) return;
        setBusy(true);
        try {
            await withdrawChallenge(challengeId);
            slideNavigate("/friends/challenges");
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, "Could not withdraw the challenge"));
        } finally {
            setBusy(false);
        }
    }, [busy, challengeId, slideNavigate]);

    const myTotal = roundsTotal(challenge?.rounds);
    const theirTotal = roundsTotal(challenge?.opponentRounds);
    const bothFinished = !!challenge?.opponentRounds;
    const isResolved = challenge?.status === "complete" || challenge?.status === "no_contest";

    /** The winner banner. A draw and a no-contest both declare nobody. */
    const verdict = (() => {
        if (!challenge || !isResolved) return null;
        if (challenge.status === "no_contest") return "No contest";
        if (!challenge.winnerUserId) return "Draw";
        return challenge.winnerUserId === user?.id ? "You won" : `${challenge.opponent.name || "They"} won`;
    })();

    return (
        <NodePage
            title="Challenge"
            activePage="home"
            onBack={() => slideNavigate("/friends/challenges")}
            contentClassName="challenge-detail-page__content"
        >
            <Box className="challenge-detail-page" sx={{ display: "flex", flexDirection: "column", gap: 2, px: 2, pt: 1 }}>

                {error && (
                    <Typography className="challenge-detail-page__error" sx={challengeMessageSx}>{error}</Typography>
                )}

                {loading ? (
                    <Typography className="challenge-detail-page__loading" sx={challengeMutedSx}>Loading…</Typography>
                ) : !challenge ? (
                    <Typography className="challenge-detail-page__missing" sx={challengeMutedSx}>
                        This challenge is no longer available.
                    </Typography>
                ) : (
                    <>
                        {/* ── Header: who, and what it is waiting on ── */}
                        <Box className="challenge-detail-page__header" sx={challengeCardSx}>
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                                vs {challenge.opponent.name || challenge.opponent.email}
                            </Typography>
                            <Typography sx={{ ...challengeMutedSx, mt: 0.25 }}>
                                {challengeStatusLine(challenge)}
                            </Typography>
                            {verdict && (
                                <Typography
                                    className="challenge-detail-page__verdict"
                                    sx={{
                                        mt: 1,
                                        fontFamily: FONTS.sans,
                                        fontSize: SIZE.title,
                                        fontWeight: WEIGHT.bold,
                                        color: challenge.winnerUserId === user?.id ? COLORS.greenMain : COLORS.onSurface,
                                    }}
                                >
                                    {verdict}
                                </Typography>
                            )}
                        </Box>

                        {/* ── The results, once the comparison is legitimate ── */}
                        {bothFinished && (
                            <Box className="challenge-detail-page__results" sx={challengeCardSx}>
                                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                        You
                                    </Typography>
                                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                                        {myTotal.toLocaleString()}
                                    </Typography>
                                </Box>
                                <ChallengeScoreTable rounds={challenge.rounds} />

                                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mt: 1.5 }}>
                                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                        {challenge.opponent.name || "Them"}
                                    </Typography>
                                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                                        {theirTotal.toLocaleString()}
                                    </Typography>
                                </Box>
                                <ChallengeScoreTable rounds={challenge.opponentRounds} />
                            </Box>
                        )}

                        {/* ── Your own rounds, while the opponent's are still hidden ── */}
                        {!bothFinished && Object.keys(challenge.rounds).length > 0 && (
                            <Box className="challenge-detail-page__my-rounds" sx={challengeCardSx}>
                                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                    Your rounds so far — {myTotal.toLocaleString()}
                                </Typography>
                                <ChallengeScoreTable rounds={challenge.rounds} />
                                <Typography sx={{ ...challengeMutedSx, fontSize: SIZE.micro, mt: 0.5 }}>
                                    {challenge.opponentFinished
                                        ? "Their score unlocks when you finish."
                                        : `${challenge.opponent.name || "They"} hasn't finished yet — scores unlock when you both have.`}
                                </Typography>
                            </Box>
                        )}

                        {/* ── The study deck ── */}
                        {challenge.presetDeckId && (
                            <Button
                                className="challenge-detail-page__deck-button"
                                onClick={() => slideNavigate(`/flashcards/decks`)}
                                startIcon={<StyleIcon />}
                                sx={{
                                    alignSelf: "flex-start",
                                    textTransform: "none",
                                    fontFamily: FONTS.sans,
                                    fontSize: SIZE.body,
                                    fontWeight: WEIGHT.semibold,
                                    color: COLORS.onSurface,
                                    backgroundColor: COLORS.blueAccent,
                                    borderRadius: 3,
                                    px: 2,
                                    py: 0.75,
                                }}
                            >
                                Study your deck
                            </Button>
                        )}

                        {/* ── The word set ── */}
                        {challenge.words.length > 0 && (
                            <Box className="challenge-detail-page__words" sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                    The {challenge.words.length} words
                                </Typography>
                                {challenge.words.map((word) => (
                                    <Box key={`${word.position}-${word.word1}`} className="challenge-detail-page__word" sx={wordTileSx}>
                                        <ForeignText text={word.word1} language={word.language} size="sm" />
                                    </Box>
                                ))}
                            </Box>
                        )}

                        {/* ── The test ──
                            `gameSequence` is present only once this player's window is
                            open, so its presence IS the gate — there is no separate
                            "is it Friday" check to get wrong. */}
                        {challenge.status === "accepted" && (
                            <Box className="challenge-detail-page__test" sx={challengeCardSx}>
                                {challenge.gameSequence ? (
                                    <>
                                        <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                            Your test is open until {deadlineLabel(challenge.deadlines.testClosesAt)}
                                        </Typography>
                                        {challenge.gameSequence.map((game, index) => {
                                            const roundIndex = index + 1;
                                            const played = challenge.rounds[String(roundIndex)];
                                            const previousPlayed = roundIndex === 1 || !!challenge.rounds[String(roundIndex - 1)];
                                            return (
                                                <Box
                                                    key={`${game.gameId}-${game.mode ?? ""}`}
                                                    className="challenge-detail-page__round"
                                                    sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mt: 1 }}
                                                >
                                                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.onSurface }}>
                                                        Round {roundIndex} · {game.gameId}{game.mode ? ` (${game.mode})` : ""}
                                                    </Typography>
                                                    {played ? (
                                                        <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                                                            {played.score.toLocaleString()}
                                                        </Typography>
                                                    ) : (
                                                        // Rounds are strictly sequential with one
                                                        // attempt each: n+1 stays locked until n is
                                                        // submitted, and a submitted round is final.
                                                        // The server enforces both — this only
                                                        // reflects them.
                                                        <Typography sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}>
                                                            {previousPlayed ? "Next" : "Locked"}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                        <Typography sx={{ ...challengeMutedSx, fontSize: SIZE.micro, mt: 1 }}>
                                            {/* TEMPORARY, and deliberately explicit rather than a
                                                dead button: the round runner is the games step of
                                                the build (docs/STUDY_CHALLENGE.md § 5), which is
                                                not written yet. Delete this line when it lands. */}
                                            The scored test runner isn't built yet — see the build status in docs/STUDY_CHALLENGE.md.
                                        </Typography>
                                    </>
                                ) : (
                                    <>
                                        <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                            Your test opens {deadlineLabel(challenge.deadlines.testOpensAt)}
                                        </Typography>
                                        {/* The games are not named — and cannot be, since the
                                            server withholds them until the window opens. Saying
                                            "three games" without naming them is the honest
                                            statement of the format. */}
                                        <Typography sx={{ ...challengeMutedSx, mt: 0.5 }}>
                                            {challenge.roundCount} games, the same ones for both of you, drawn when the window opens.
                                            Study your deck until then.
                                        </Typography>
                                    </>
                                )}
                            </Box>
                        )}

                        {/* ── Withdraw ── */}
                        {challenge.status === "pending" && challenge.isChallenger && (
                            <Button
                                className="challenge-detail-page__withdraw"
                                onClick={handleWithdraw}
                                disabled={busy}
                                startIcon={<UndoIcon sx={{ fontSize: 16 }} />}
                                sx={{
                                    alignSelf: "flex-start",
                                    textTransform: "none",
                                    fontFamily: FONTS.sans,
                                    fontSize: SIZE.caption,
                                    fontWeight: WEIGHT.semibold,
                                    color: COLORS.redMain,
                                    backgroundColor: COLORS.surface,
                                    borderRadius: 2,
                                    px: 1.5,
                                    py: 0.5,
                                }}
                            >
                                Withdraw challenge
                            </Button>
                        )}
                    </>
                )}

                <FooterSpacer />
            </Box>
        </NodePage>
    );
}

export default ChallengeDetailPage;

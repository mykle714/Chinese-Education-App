import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import { nearestOverlayHost } from "../../components/overlayHost";
import { challengeLaunchFor } from "./challengeLaunch";
import { signedPoints } from "../../features/studyChallenge/challengeLabels";
import type { ChallengeRoundState } from "./useChallengeRound";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

/**
 * The between-games scoreboard (docs/STUDY_CHALLENGE.md § 5.5, design F14).
 *
 * Shown after EVERY round of a test, in place of the game's own end-of-run popup:
 *
 *     ROUND 2 OF 3
 *     Bubble Match
 *     ─────────────────────────────────────────
 *     correct matches        7 × +100     +700
 *     incorrect matches      2 × −100     −200
 *     bonus for surviving                 +300
 *     ─────────────────────────────────────────
 *     this round                           800
 *     previous rounds                    1 240
 *     ─────────────────────────────────────────
 *     TOTAL                              2 040
 *
 * Every line comes from the round's own accumulator (§ 5.6) — this component does
 * no arithmetic beyond adding the two totals it is handed, because a display-side
 * recomputation is exactly how a card ends up disagreeing with the number stored.
 *
 * ⚠️ IT COVERS THE WHOLE SCREEN, HEADER INCLUDED. Written inside the game's content
 * box but PORTALED to `nearestOverlayHost` (src/components/overlayHost.ts) — the leaf
 * page surface, or the phone frame — because a scoreboard that stops short of the
 * game's header leaves the round's title bar and its controls lit above a blackout,
 * which reads as "the board is still playable up there". The portal is also why this
 * is `absolute; inset: 0` on the host rather than `fixed`: inside the desktop phone
 * frame, `fixed` would cover the browser window instead of the phone card.
 *
 * ⚠️ A FULL-BLEED DARK BOARD, NOT A POPUP CARD. It used to render through
 * `GameEndPopup`, which put a light card over a still-visible board. That was wrong
 * twice: the board behind it belongs to a round that is now SCORED AND FINAL, so
 * showing it invites a player to look for something to do with it, and a card sized
 * for a two-line "you won" cannot give a six-line itemisation the room to be read as
 * a scoreboard. Being its own surface is also what lets the total be the largest
 * thing on the screen, which is the one number the round was played for.
 *
 * Consequently it is NOT MINIMIZABLE and has no × — the only exits are forward: the
 * next round, or the challenge.
 *
 * ⚠️ IT SHOWS ONLY THE PLAYER'S OWN NUMBERS, even though the opponent's submitted
 * rounds are now available (they are revealed per round, § 6). Their figures live on
 * page 2 of View Challenge; putting them here would turn the moment a round is banked
 * into a comparison the player cannot act on, mid-test.
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

    /**
     * Where the board is WRITTEN (inside the game's content box, next to the game's own
     * end-of-run popup) and where it is PAINTED (the full-screen host) are two different
     * places. The anchor renders nothing; the host is found by walking up from it.
     */
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);

    // A LAYOUT effect, so the host is known and the portal committed before the browser
    // paints — a plain effect would show one frame of the board pinned under the header.
    useLayoutEffect(() => {
        const el = anchorRef.current;
        if (el) setHost(nearestOverlayHost(el));
    }, []);

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

    /**
     * One `label   count × unit   points` row.
     *
     * `tone` picks the three weights the board uses, all on the dark ground:
     *   * "line"  — an itemised rule from the breakdown;
     *   * "sub"   — the round's own subtotal and the running carry-in;
     *   * "total" — the one number the round was played for.
     *
     * ⚠️ A NEGATIVE LINE IS NOT PAINTED RED HERE, unlike the same line on the paper
     * ground (ChallengeScoreTable). Red on near-black reads as an error state, and a
     * round that scored fewer points is not an error — the minus sign carries it.
     */
    const line = (
        label: string,
        detail: string | null,
        points: number,
        tone: "line" | "sub" | "total" = "line"
    ) => (
        <Box
            key={`${label}-${detail ?? ""}`}
            className={`${classPrefix}__challenge-line ${classPrefix}__challenge-line--${tone}`}
            sx={{
                display: "flex",
                alignItems: "baseline",
                gap: 1,
                width: "100%",
                ...(tone === "sub" && { mt: 1.5, pt: 1.75, borderTop: "1px solid rgba(255,255,255,.18)" }),
                ...(tone === "total" && { mt: 1.75, pt: 2, borderTop: "1px solid rgba(255,255,255,.3)" }),
            }}
        >
            <Typography sx={{
                fontFamily: FONTS.sans,
                fontSize: tone === "total" ? "2.25rem" : tone === "sub" ? SIZE.title : SIZE.bodyLg,
                fontWeight: tone === "line" ? WEIGHT.medium : tone === "sub" ? WEIGHT.semibold : WEIGHT.bold,
                letterSpacing: tone === "total" ? "-0.03em" : undefined,
                textTransform: tone === "total" ? "uppercase" : undefined,
                lineHeight: tone === "total" ? LEADING.none : undefined,
                color: "#fff",
                flex: 1,
                textAlign: "left",
            }}>
                {label}
            </Typography>
            {detail && (
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: "rgba(255,255,255,.5)" }}>
                    {detail}
                </Typography>
            )}
            <Typography sx={{
                fontFamily: FONTS.mono,
                fontSize: tone === "total" ? "3.25rem" : tone === "sub" ? SIZE.title : SIZE.bodyLg,
                fontWeight: tone === "line" ? WEIGHT.regular : tone === "sub" ? WEIGHT.semibold : WEIGHT.bold,
                letterSpacing: tone === "line" ? undefined : "-0.02em",
                lineHeight: tone === "total" ? LEADING.none : undefined,
                // The two figures that are not a breakdown line get the dark-ground
                // highlights: yellow for this round, blue for the total, so the eye
                // can find either without reading the labels.
                color: tone === "sub" ? COLORS.hlYellow : tone === "total" ? COLORS.hlBlue : "#fff",
                minWidth: 72,
                textAlign: "right",
            }}>
                {signedPoints(points)}
            </Typography>
        </Box>
    );

    const board = (
        <Box
            className={`${classPrefix}__challenge-scoreboard`}
            sx={{
                // `absolute` on the overlay host (see the portal note in the header
                // comment), which either IS the leaf page surface or the phone frame —
                // both `inset: 0` to the whole screen, header strip included.
                position: "absolute",
                inset: 0,
                // Above the leaf page's own header, and above MinimizablePopup's 200 and
                // GamePausedOverlay's 150: once a round is scored, nothing the game can
                // still be showing may sit on top of the scoreboard.
                zIndex: 1200,
                // Not fully opaque: a sliver of the finished board stays legible behind
                // it, which is what says "this score came from THAT run" without
                // offering the board back.
                backgroundColor: "rgba(12,11,14,.93)",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                textAlign: "left",
                px: 3,
                pt: 7,
                pb: 3.5,
            }}
        >
            <Box
                className={`${classPrefix}__challenge-heading`}
                sx={{ display: "flex", flexDirection: "column", gap: 0.75, pb: 2.25, borderBottom: "1px solid rgba(255,255,255,.14)" }}
            >
                {/* Which round, then which game — in that order and at that contrast,
                    because after three rounds the player's question is "where am I",
                    not "what did I just play". */}
                <Typography
                    className={`${classPrefix}__challenge-round`}
                    sx={{
                        fontFamily: FONTS.label,
                        fontSize: SIZE.caption,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: "rgba(255,255,255,.5)",
                    }}
                >
                    Round {roundIndex} of {roundCount}
                </Typography>
                <Typography
                    className={`${classPrefix}__challenge-title`}
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.title, fontWeight: WEIGHT.bold, letterSpacing: "-0.02em", color: "#fff" }}
                >
                    {gameTitle}
                </Typography>
            </Box>

            <Box
                className={`${classPrefix}__challenge-lines`}
                sx={{ display: "flex", flexDirection: "column", gap: 1.6, width: "100%", mt: 2.5 }}
            >
                {/* A round with no lines at all (nothing matched, nothing penalised)
                    still has to say something, or the board reads as broken. */}
                {result.breakdown.lines.length === 0
                    ? line("no points scored", null, 0)
                    : result.breakdown.lines.map((entry) => line(
                        entry.label,
                        entry.count != null && entry.unitPoints != null
                            ? `${entry.count} × ${signedPoints(entry.unitPoints)}`
                            : null,
                        entry.points
                    ))}

                {line("this round", null, result.breakdown.total, "sub")}
                {line("previous rounds", null, result.previousTotal)}
                {line("total", null, total, "total")}
            </Box>

            {/* The submit is the only thing here that can fail, and a submitted round
                is final — so the state is stated plainly rather than retried behind
                the player's back. */}
            {result.error && (
                <Typography
                    className={`${classPrefix}__challenge-error`}
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.hlRed, mt: 1.5 }}
                >
                    {result.error}
                </Typography>
            )}
            {!result.submitted && !result.error && (
                <Typography
                    className={`${classPrefix}__challenge-saving`}
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: "rgba(255,255,255,.6)", mt: 1.5 }}
                >
                    Saving your score…
                </Typography>
            )}

            {/* Pushed to the bottom edge — the itemisation is read top-down and the
                exits should not float up under it on a short breakdown. */}
            <Box
                className={`${classPrefix}__challenge-actions`}
                sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%", mt: "auto", pt: 3 }}
            >
                {next && (
                    <Button
                        className={`${classPrefix}__challenge-next`}
                        // Disabled until the round is banked: round n+1's board is
                        // refused by the server until n is stored (§ 5.1a), so an
                        // eager tap would land on an error screen.
                        disabled={!result.submitted}
                        onClick={() => navigate(next.to, { state: next.state, replace: true })}
                        sx={{
                            py: 1.4,
                            borderRadius: "14px",
                            textTransform: "none",
                            fontSize: SIZE.bodyLg,
                            fontWeight: WEIGHT.semibold,
                            lineHeight: LEADING.tight,
                            // Inverted against the dark ground: white IS the primary
                            // here, the way charcoal is on the paper ground.
                            backgroundColor: "#fff",
                            color: "#111",
                            "&:hover": { backgroundColor: "#fff" },
                            "&.Mui-disabled": { backgroundColor: "rgba(255,255,255,.35)", color: "rgba(17,17,17,.5)" },
                        }}
                    >
                        Next round · {next.title}
                    </Button>
                )}
                <Button
                    className={`${classPrefix}__challenge-back`}
                    onClick={() => navigate(challengePath)}
                    sx={{
                        py: 1.2,
                        borderRadius: "14px",
                        textTransform: "none",
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.medium,
                        color: "rgba(255,255,255,.85)",
                        border: "1px solid rgba(255,255,255,.3)",
                    }}
                >
                    {next ? "Back to the challenge" : "See the challenge"}
                </Button>
            </Box>
        </Box>
    );

    return (
        <>
            <Box component="span" ref={anchorRef} className={`${classPrefix}__challenge-scoreboard-anchor`} sx={{ display: "none" }} />
            {host && createPortal(board, host)}
        </>
    );
};

export default ChallengeRoundScoreboard;

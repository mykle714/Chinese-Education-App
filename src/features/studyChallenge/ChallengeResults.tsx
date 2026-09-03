import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import ChallengeTestCard from "./ChallengeTestCard";
import { sendChallengeTaunt } from "../../api/studyChallenges";
import type { ChallengeSummary } from "../../api/studyChallenges";
import { CHALLENGE_TAUNTS, challengeTauntText } from "../../types";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import { challengeErrorMessage, roundsTotal } from "./challengeLabels";
import { challengeMessageSx } from "./challengeStyles";

/**
 * Floor on the gap between two taunt POSTs (§ 6a). Taps are free; the wire is not.
 * Two seconds is slower than an annoyed thumb and faster than anyone waits for the
 * opponent to see the line.
 */
const TAUNT_SEND_INTERVAL_MS = 2000;

interface ChallengeResultsProps {
    challenge: ChallengeSummary;
    viewerUserId: string | undefined;
    /** Replace the loaded challenge after a taunt lands. */
    onChallengeUpdated: (challenge: ChallengeSummary) => void;
}

/**
 * The results screen (docs/STUDY_CHALLENGE.md § 6, design F17/F17b/F18).
 *
 * ⚠️ ONE SCREEN, THREE READINGS, AND THE SAME STRUCTURE IN ALL THREE. Win, loss and
 * no-contest differ only in the crest's ink and the verdict line. The loser is shown
 * exactly what the winner is shown — both totals, every round scored on both sides —
 * with no consolation copy and nothing hidden, because the entire value of the screen
 * is that both players read the same evidence.
 *
 * ⚠️ NO RULE-BY-RULE BREAKDOWN HERE (2026-09-02). The charcoal `ChallengeTotalCard`
 * that used to be each player's card was deleted app-wide: an itemised "7 × +100,
 * −200 misses" reading belongs to the moment it was earned, so it lives only on the
 * game-finish screen (`ChallengeScoreTable`). What a result needs is the per-round
 * subtotal, and that is already a slot on `ChallengeTestCard` — which is why this
 * screen now renders THAT card per side, read-only. Reusing it is also what keeps
 * results and the mid-test page one screen rather than two kept in step by hand.
 *
 * ⚠️ NO PER-WORD COMPARISON, deliberately (Q64). It would be a lovely study artifact
 * and it would tax every game's scoring contract forever — every game would have to
 * emit per-word outcomes, permanently — for a screen nobody has asked for. The
 * breakdown is jsonb, so it stays addable later.
 *
 * A NO CONTEST declares nobody and moves no crown. It is distinct from an expiry: an
 * expired challenge never had an agreed set, while a no contest had one and a player
 * did not play it. Both records are still shown — a player who never played has a
 * real record of not having played.
 */
function ChallengeResults({ challenge, viewerUserId, onChallengeUpdated }: ChallengeResultsProps) {
    // The line this viewer has rolled locally this session, ahead of the server's
    // copy. Null until the first tap.
    const [rolledId, setRolledId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const myTotal = roundsTotal(challenge.rounds);
    const theirTotal = roundsTotal(challenge.opponentRounds);
    const opponentName = challenge.opponent.name || challenge.opponent.email;
    const noContest = challenge.status === "no_contest";
    const iWon = !noContest && !!challenge.winnerUserId && challenge.winnerUserId === viewerUserId;
    const theyWon = !noContest && !!challenge.winnerUserId && challenge.winnerUserId !== viewerUserId;

    const verdict = noContest
        ? "No contest"
        : !challenge.winnerUserId
            ? "Draw"
            : iWon ? "You won" : `${opponentName} won`;

    // The verdict's ink. A draw and a no contest both declare nobody, so both take the
    // neutral treatment rather than either player's colour.
    const verdictInk = iWon ? "#0B6B4F" : theyWon ? "#8E1526" : COLORS.textSecondary;

    /**
     * Whose taunt lands on whose card.
     *
     * Stored by SENDER (§ 6a), rendered on the card of the TARGET — so the taunt on
     * YOUR card is the one your opponent sent, and vice versa. Resolving both here
     * keeps that inversion in one place instead of at two render sites.
     */
    const taunts = useMemo(() => {
        const serverMine = viewerUserId ? challenge.taunts[viewerUserId] : undefined;
        const theirs = challenge.taunts[challenge.opponent.userId];
        // The local roll wins over the server's copy: taps cycle faster than the
        // throttled POST round-trips, so rendering the server's answer would make the
        // line stutter backwards between taps.
        const mineId = rolledId ?? serverMine?.tauntId ?? null;
        return {
            /** What they said, shown on your card. */
            onMyCard: theirs ? challengeTauntText(theirs.tauntId) : null,
            /** What you said, shown on theirs. */
            onTheirCard: mineId ? challengeTauntText(mineId) : null,
            /** The line the next tap advances FROM — server's or locally rolled. */
            mineId,
            iHaveSent: !!mineId,
        };
    }, [challenge.taunts, challenge.opponent.userId, viewerUserId, rolledId]);

    /**
     * Taunt: EVERY TAP ROLLS THE NEXT LINE, and the network follows at its own pace
     * (2026-09-02, revised same day).
     *
     * ⚠️ THE APP ROLLS; THE SENDER DOES NOT PICK. This reverses the original design
     * (the deleted `ChallengeTauntPicker` sheet). The taunt is still a closed list of
     * app-authored lines — never user text — so nothing here is attributable to the
     * sender beyond "they chose to taunt". A sheet to choose between eight
     * interchangeable jokes was a second screen for a one-bit decision; the button IS
     * the picker now: the first tap lands on a random line and each further tap steps
     * to the next one, wrapping, so a sender who dislikes their roll keeps tapping.
     *
     * ⚠️ THE TAUNT IS NO LONGER WRITE-ONCE. Cycling means the stored taunt is mutable
     * until the player stops tapping; the DAL's absence guard was dropped to match
     * (§ 6a). What is still true: only a resolved challenge accepts a taunt, and only
     * a known `tauntId` is stored.
     *
     * TAP CADENCE IS NOT NETWORK CADENCE. The visible line changes on every tap
     * synchronously — a throttled UI would feel broken — while the POST is throttled
     * to `TAUNT_SEND_INTERVAL_MS`: leading edge immediate, then one trailing send
     * carrying the LATEST rolled id. A trailing send is what makes the throttle safe:
     * without it the final tap of a burst would never reach the server, and the
     * opponent would read a line the sender never settled on.
     *
     * The throttle is a courtesy, not a defence — a hand-rolled client ignores it. The
     * real bound is the global per-user `writeLimiter` (600 writes / 5 min,
     * `server/middleware/rateLimits.ts`), which already covers this route.
     */
    const rollTimerRef = useRef<number | null>(null);
    const lastSentAtRef = useRef(0);
    /** The rolled id not yet POSTed. Null when nothing is in flight or pending. */
    const unsentIdRef = useRef<string | null>(null);
    // The send can outlive a render (and, on unmount, the component), so the pieces it
    // needs are read from refs rather than captured.
    const challengeIdRef = useRef(challenge.id);
    challengeIdRef.current = challenge.id;
    const onChallengeUpdatedRef = useRef(onChallengeUpdated);
    onChallengeUpdatedRef.current = onChallengeUpdated;

    /** POST whatever is pending, if anything, and re-arm the throttle window. */
    const flushTaunt = useCallback(() => {
        rollTimerRef.current = null;
        const tauntId = unsentIdRef.current;
        unsentIdRef.current = null;
        if (!tauntId) return;
        lastSentAtRef.current = Date.now();
        sendChallengeTaunt(challengeIdRef.current, tauntId)
            .then((updated) => {
                onChallengeUpdatedRef.current(updated);
                setError(null);
            })
            .catch((err: unknown) => {
                setError(challengeErrorMessage(err, "Could not send that taunt"));
            });
    }, []);

    const handleTaunt = useCallback(() => {
        // First tap rolls at random; every later tap steps to the next line so the
        // sender walks the list rather than re-rolling into the same joke twice.
        const current = taunts.mineId
            ? CHALLENGE_TAUNTS.findIndex((taunt) => taunt.id === taunts.mineId)
            : -1;
        const next = current >= 0
            ? CHALLENGE_TAUNTS[(current + 1) % CHALLENGE_TAUNTS.length]
            : CHALLENGE_TAUNTS[Math.floor(Math.random() * CHALLENGE_TAUNTS.length)];
        if (!next) return;
        setRolledId(next.id);
        unsentIdRef.current = next.id;

        const waitMs = TAUNT_SEND_INTERVAL_MS - (Date.now() - lastSentAtRef.current);
        if (waitMs <= 0) {
            flushTaunt();
        } else if (rollTimerRef.current === null) {
            // One trailing timer per window; further taps in the window just replace
            // `unsentIdRef`, so a burst of ten taps costs two requests, not ten.
            rollTimerRef.current = window.setTimeout(flushTaunt, waitMs);
        }
    }, [flushTaunt, taunts.mineId]);

    // Leaving the screen mid-throttle must not lose the last roll: fire the pending
    // send without touching state (the component is going away, so there is nobody to
    // show a success or an error to).
    useEffect(() => () => {
        if (rollTimerRef.current !== null) {
            clearTimeout(rollTimerRef.current);
            rollTimerRef.current = null;
        }
        const tauntId = unsentIdRef.current;
        unsentIdRef.current = null;
        if (tauntId) void sendChallengeTaunt(challengeIdRef.current, tauntId).catch(() => {});
    }, []);

    /** One player's card: the test they sat, scored, with their taunt over its edge. */
    const playerCard = (side: "you" | "opponent") => {
        const mine = side === "you";
        const taunt = mine ? taunts.onMyCard : taunts.onTheirCard;
        return (
            <Box className={`challenge-results__card challenge-results__card--${side}`} sx={{ position: "relative", mt: taunt || (!mine && !taunts.iHaveSent) ? 3.75 : 0 }}>
                {/* The test card, read-only: no `onPlay` makes every row inert, and no
                    `onExplain` drops the rules button — the test is over, so there is
                    nothing left to learn how to do. The heading is the PLAYER'S NAME
                    rather than "Test" / "Their Test", because on this screen the card
                    is the record a person set, and the name is the only thing telling
                    two identically-shaped cards apart. `showDeadline` is off for the
                    same reason: a close time nobody can still act on is pure noise.
                    Unplayed rounds still draw — a player who never played has a real
                    record of not having played (§ 6, design F18). */}
                <ChallengeTestCard
                    challenge={challenge}
                    side={side}
                    rounds={mine ? challenge.rounds : challenge.opponentRounds}
                    heading={mine ? "You" : opponentName}
                    showDeadline={false}
                />

                {/* The taunt, hand-written over the card's top edge — angled and in the
                    serif display face so it reads as a person talking rather than as
                    another field of the result. */}
                {taunt && (
                    <Box
                        className="challenge-results__taunt"
                        sx={{
                            position: "absolute",
                            top: -18,
                            right: 32,
                            maxWidth: "57%",
                            textAlign: "right",
                            transform: "rotate(-3.2deg)",
                            transformOrigin: "right bottom",
                        }}
                    >
                        <Typography sx={{ fontFamily: FONTS.serif, fontSize: SIZE.bodyLg, fontStyle: "italic", lineHeight: 1.2, color: COLORS.onSurface }}>
                            {taunt}
                        </Typography>
                    </Box>
                )}

                {/* The send button lives on THEIR card, because that is where the taunt
                    you send will appear — the button and its result occupy the same
                    place, so there is nothing to explain. */}
                {!mine && (
                    <ButtonBase
                        className="challenge-results__taunt-button"
                        onClick={handleTaunt}
                        sx={{
                            position: "absolute",
                            top: -13,
                            left: 34,
                            px: 1.25,
                            py: 0.75,
                            borderRadius: "10px",
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.micro,
                            fontWeight: WEIGHT.semibold,
                            backgroundColor: COLORS.onSurface,
                            color: "#fff",
                        }}
                    >
                        {/* ONE FIXED LABEL. The button does the same thing on every
                            tap whatever the state around it — nobody has taunted, they
                            got there first, or a line of yours is already on the card —
                            so it says the same thing. The cards show the state. */}
                        Taunt
                    </ButtonBase>
                )}
            </Box>
        );
    };

    return (
        <Box className="challenge-results">
            {/* ── The verdict crest ── */}
            <Box
                className={`challenge-results__verdict challenge-results__verdict--${noContest ? "none" : iWon ? "win" : theyWon ? "loss" : "draw"}`}
                sx={{
                    mx: 2.25,
                    mt: 1.9,
                    px: 2,
                    py: 1.75,
                    borderRadius: "18px",
                    backgroundColor: COLORS.white,
                    border: `1px solid ${iWon ? "rgba(11,107,79,.22)" : theyWon ? "rgba(142,21,38,.18)" : COLORS.rowBorder}`,
                }}
            >
                <Box
                    className="challenge-results__crest"
                    sx={{
                        width: 34,
                        height: 34,
                        borderRadius: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: SIZE.subtitle,
                        mb: 1.4,
                        backgroundColor: iWon ? COLORS.grn : theyWon ? COLORS.red : COLORS.iconBg,
                        // A crown that belongs to nobody is drained rather than removed:
                        // the shape says "this is where the winner goes", and its absence
                        // is the point of a draw or a no contest.
                        ...(iWon ? {} : { filter: theyWon ? "grayscale(.45)" : "grayscale(1)", opacity: theyWon ? 0.6 : 0.45 }),
                    }}
                >
                    👑
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                    <Typography
                        className="challenge-results__verdict-line"
                        sx={{ fontFamily: FONTS.sans, fontSize: "1.8rem", fontWeight: WEIGHT.bold, letterSpacing: "-0.03em", lineHeight: LEADING.none, color: verdictInk }}
                    >
                        {verdict}
                    </Typography>
                    <Box sx={{ ml: "auto", display: "flex", alignItems: "baseline", gap: 1.1, fontFamily: FONTS.sans, fontSize: "1.8rem", fontWeight: WEIGHT.bold, letterSpacing: "-0.03em" }}>
                        {/* Yours first, always — the reader's own number is the one they
                            came for, and swapping the order per outcome would make two
                            screens out of one. */}
                        <Box component="span" sx={{ color: iWon ? COLORS.onSurface : COLORS.textSecondary }}>
                            {myTotal.toLocaleString()}
                        </Box>
                        <Box component="span" sx={{ color: COLORS.textFaint }}>·</Box>
                        <Box component="span" sx={{ color: theyWon ? COLORS.onSurface : COLORS.textSecondary }}>
                            {theirTotal.toLocaleString()}
                        </Box>
                    </Box>
                </Box>

                {/* The two-bar comparison. Flex-weighted by the raw totals so the ratio
                    is the picture; a zero-zero result would collapse both to nothing, so
                    it falls back to an even split. */}
                <Box className="challenge-results__bars" sx={{ display: "flex", gap: "3px", mt: 1.5 }}>
                    <Box sx={{ flex: myTotal + theirTotal === 0 ? 1 : Math.max(myTotal, 0), height: 4, borderRadius: "2px", backgroundColor: iWon ? "#0B6B4F" : "rgba(23,22,26,.14)" }} />
                    <Box sx={{ flex: myTotal + theirTotal === 0 ? 1 : Math.max(theirTotal, 0), height: 4, borderRadius: "2px", backgroundColor: theyWon ? "#8E1526" : "rgba(23,22,26,.14)" }} />
                </Box>
            </Box>

            {error && (
                <Typography className="challenge-results__error" sx={{ ...challengeMessageSx, px: 2.25, pt: 1.5 }}>{error}</Typography>
            )}

            {playerCard("you")}
            {playerCard("opponent")}
        </Box>
    );
}

export default ChallengeResults;

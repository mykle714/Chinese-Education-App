import { Box, ButtonBase, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { challengeLaunchFor } from "../../games/runtime/challengeLaunch";
import type { ChallengeSummary } from "../../api/studyChallenges";
import type { ChallengeRound } from "../../types";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";
import { deadlineLabel } from "./challengeLabels";

/**
 * Roman numerals for the round badge. Three at most (CHALLENGE_ROUND_COUNT), and the
 * list is long enough to survive a larger test without becoming a numeral algorithm
 * nobody needed.
 *
 * ⚠️ ROMAN, NOT ARABIC, on purpose: every OTHER number on this card is a score, and a
 * "3" next to a "600" invites the eye to compare them.
 */
const NUMERALS = ["I", "II", "III", "IV", "V", "VI"];

interface ChallengeTestCardProps {
    challenge: ChallengeSummary;
    /**
     * Whose test this card is.
     *   "you"      — your rounds, with Play buttons (F12/F15/F16);
     *   "opponent" — theirs, read-only and in their ink (F15b/F15d).
     */
    side: "you" | "opponent";
    /** The rounds to draw against the sequence — yours or theirs. */
    rounds: Record<string, ChallengeRound>;
    /**
     * Overrides the card's own heading ("Test" / "Their Test").
     *
     * The results screen passes the PLAYER'S NAME, because there the card is no
     * longer "the test you are taking" but "the record this player set" — and the
     * name is the only thing distinguishing two cards that are otherwise the same
     * shape in two inks.
     */
    heading?: string;
    /**
     * Draw the "closes …" stamp. False once the window has shut (the results
     * screen): a deadline nobody can still act on is the loudest kind of noise.
     */
    showDeadline?: boolean;
    /** Opens the "How the test works" explainer. Own side only. */
    onExplain?: () => void;
    /** Launch a round. Own side only; absent means every row is inert. */
    onPlay?: (to: string, state: Record<string, unknown>) => void;
}

/**
 * The test card — the hero of View Challenge (docs/STUDY_CHALLENGE.md § 5, design
 * F12/F15/F15b/F16).
 *
 * ⚠️ ONE COMPONENT, TWO INKS. Page 1 is yours in blue, page 2 is theirs in red, and
 * they are the SAME card because the two pages must be readable against each other —
 * a different layout per side would make the comparison an act of translation. The
 * colour is the whole ownership mark, which is why red here is NOT a warning and must
 * never acquire warning semantics elsewhere on this page.
 *
 * ⚠️ THE SEQUENCE'S ABSENCE IS THE GATE. `gameSequence` is withheld by the server
 * until this player's window opens (§ 5.1b), so this card renders nothing playable
 * before Friday without any date check of its own. Do not add one — a second gate is
 * a second thing that can disagree with the first.
 *
 * ⚠️ THIS CARD IS THE ONLY PER-ROUND SCOREBOARD ON THE PAGE (2026-09-02). The charcoal
 * `ChallengeTotalCard` that used to sit beneath it — a grand total plus every scoring
 * RULE itemised — was deleted: the rule-by-rule breakdown belongs to the moment it was
 * earned and now lives only on the game-finish screen (`ChallengeScoreTable`), while
 * the figure a player wants when re-opening a challenge is the per-round subtotal,
 * which this card already had a slot for. Both sides therefore print a round's score
 * once it is banked; a round not yet played reads "not done" on their side and carries
 * a lock on yours. Rounds are revealed as they land (§ 6), never hidden.
 */
function ChallengeTestCard({ challenge, side, rounds, heading: headingOverride, showDeadline = true, onExplain, onPlay }: ChallengeTestCardProps) {
    const mine = side === "you";
    const sequence = challenge.gameSequence ?? [];

    /**
     * ⚠️ THE HEADING IS A LABEL, NOT A STATE (2026-09-01). It used to swing between
     * "Test Time" and "Test Done" — and, before the window opened, said "Test Time"
     * over a card whose own body read "Your test opens 4 AM Friday", which is the one
     * combination it must never produce. The state is already told three times over,
     * by things that cannot contradict each other: the page's chip, the numerals
     * filling in down the left edge, and each row's own Play / score / lock. A fourth
     * telling could only ever add a way to be wrong, so the card just names itself.
     */
    const heading = headingOverride ?? (mine ? "Test" : "Their Test");

    return (
        <Box
            className={`challenge-test-card challenge-test-card--${side}`}
            sx={{
                mx: 2.25,
                mt: 1.75,
                p: 2,
                pb: 2.25,
                borderRadius: "22px",
                backgroundColor: mine ? COLORS.blu : COLORS.red,
                border: `1px solid ${COLORS.border}`,
                boxShadow: SHADOW.raised,
            }}
        >
            <Box
                className="challenge-test-card__head"
                sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.25 }}
            >
                <Typography
                    className="challenge-test-card__heading"
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.title, fontWeight: WEIGHT.bold, letterSpacing: "-0.034em", lineHeight: LEADING.none, color: COLORS.onSurface }}
                >
                    {heading}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                    {/* ONE DATE AT A TIME. Before the window opens the card's body says
                        when it opens, so a "closes" here would be the second date on a
                        card whose reader cannot act on either — and the later of two
                        dates is the one that reads as the deadline. The close time
                        appears the moment there is something to be late for. */}
                    {showDeadline && sequence.length > 0 && (
                        <Typography sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textSecondary }}>
                            closes {deadlineLabel(challenge.deadlines.testClosesAt)}
                        </Typography>
                    )}
                    {/* The rules used to sit as fine print under the rounds. They moved
                        behind this button so the card stays a list of three things to do
                        — the copy is read once and then never again. */}
                    {onExplain && (
                        <ButtonBase
                            className="challenge-test-card__explain"
                            onClick={onExplain}
                            aria-label="How the test works"
                            sx={{ borderRadius: "999px", p: 0.6, backgroundColor: "rgba(255,255,255,.66)", color: COLORS.bluA }}
                        >
                            <Icon name="info" size={14} />
                        </ButtonBase>
                    )}
                </Box>
            </Box>

            {/* Before the window opens there is no sequence to draw, so the card says
                the one thing it can honestly say: WHEN. It never names the games — it
                does not know them — and it no longer counts them either: the round
                count is spelled out numeral by numeral the moment the sequence lands,
                and stating it early only invited "which three?", which is exactly the
                question the card is withholding. This line is also the only place the
                open time appears; the page header used to repeat it. */}
            {sequence.length === 0 ? (
                <Typography
                    className="challenge-test-card__pending"
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, mt: 1.25, lineHeight: LEADING.normal }}
                >
                    {mine
                        ? `Your test opens ${deadlineLabel(challenge.deadlines.testOpensAt)}.`
                        : "Their rounds appear here as they play them."}
                </Typography>
            ) : sequence.map((game, index) => {
                const roundIndex = index + 1;
                const played = rounds[String(roundIndex)];
                const previousPlayed = roundIndex === 1 || !!rounds[String(roundIndex - 1)];
                // Null when this build has no page for the stored game — the first half
                // of the two-phase game-retirement rule. The round reads as unplayable
                // rather than crashing.
                const launch = challengeLaunchFor(challenge.id, roundIndex, game);
                // Rounds are strictly sequential with one attempt each: n+1 stays locked
                // until n is submitted, and a submitted round is final. The SERVER
                // enforces both — this only reflects them.
                const playable = mine && !played && previousPlayed && !!launch && !!onPlay;
                const dimmed = !!played || (!playable && !previousPlayed);

                return (
                    <Box
                        key={`${game.gameId}-${game.mode ?? ""}`}
                        className={`challenge-test-card__round${played ? " challenge-test-card__round--done" : playable ? " challenge-test-card__round--on-deck" : " challenge-test-card__round--locked"}`}
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                            mt: index === 0 ? 1.9 : 1.15,
                            px: 1.5,
                            py: 1.4,
                            borderRadius: "16px",
                            border: `1px solid ${COLORS.border}`,
                            // A round that is finished or still locked recedes; the one
                            // on deck is the only fully-lit row on the card.
                            backgroundColor: dimmed ? "rgba(255,255,255,.34)" : "rgba(255,255,255,.62)",
                            boxShadow: dimmed ? "none" : SHADOW.rest,
                        }}
                    >
                        <Box
                            className="challenge-test-card__numeral"
                            sx={{
                                width: 30,
                                height: 30,
                                flexShrink: 0,
                                borderRadius: "9px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontFamily: FONTS.mono,
                                fontSize: SIZE.micro,
                                fontWeight: WEIGHT.bold,
                                letterSpacing: "0.04em",
                                // A banked round fills its numeral — the card's own
                                // progress bar, read down the left edge.
                                ...(played
                                    ? { backgroundColor: mine ? COLORS.onSurface : COLORS.redA, color: "#fff" }
                                    : { backgroundColor: COLORS.white, boxShadow: `inset 0 0 0 1px ${COLORS.border}`, color: COLORS.onSurface }),
                            }}
                        >
                            {NUMERALS[index] ?? roundIndex}
                        </Box>

                        <Icon
                            name={launch?.glyph ?? "sports_esports"}
                            size={20}
                            color={mine ? COLORS.bluA : COLORS.redA}
                        />

                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: dimmed ? COLORS.textSecondary : COLORS.onSurface }}>
                                {launch?.title ?? game.gameId}
                            </Typography>
                            {/* The mode is part of the FORMAT — both players get the same
                                one — so it is stated on every row, alongside where the
                                round stands.
                                ⚠️ NO "ON DECK" TAG (removed 2026-09-01). The playable row
                                is already the only lit, shadowed row on the card AND the
                                only one carrying a Play button; the words added a third
                                telling of a state that cannot be missed. "submitted"
                                stays, because a banked round's Play button is gone and
                                the filled numeral alone is a weaker signal. */}
                            <Typography sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, fontWeight: WEIGHT.semibold, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.textFaint }}>
                                {[game.mode, played ? "submitted" : null]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </Typography>
                        </Box>

                        {/* Their side has no button and no lock — nothing on it is
                            actionable — so the slot holds the same score chip yours does
                            once the round is banked, and the words "not done" until then.
                            The two pages are read against each other, so the banked
                            figure must sit in the SAME place on both. */}
                        {!mine && !played ? (
                            <Typography
                                className="challenge-test-card__opponent-state"
                                sx={{
                                    flexShrink: 0,
                                    fontFamily: FONTS.mono,
                                    fontSize: SIZE.micro,
                                    letterSpacing: "0.09em",
                                    textTransform: "uppercase",
                                    color: "rgba(23,22,26,.38)",
                                }}
                            >
                                not done
                            </Typography>
                        ) : playable ? (
                            <ButtonBase
                                className="challenge-test-card__play"
                                onClick={() => onPlay!(launch!.to, launch!.state)}
                                sx={{
                                    flexShrink: 0,
                                    px: 2.25,
                                    py: 1.1,
                                    borderRadius: "11px",
                                    backgroundColor: COLORS.onSurface,
                                    color: "#fff",
                                    fontFamily: FONTS.sans,
                                    fontSize: SIZE.body,
                                    fontWeight: WEIGHT.bold,
                                }}
                            >
                                Play
                            </ButtonBase>
                        ) : played ? (
                            // The score REPLACES the button, which is what makes
                            // "submitted is final" legible without a word of copy. On
                            // their side there was never a button, so the chip is simply
                            // the round's result.
                            <Typography
                                className="challenge-test-card__score"
                                sx={{
                                    flexShrink: 0,
                                    fontFamily: FONTS.mono,
                                    fontSize: SIZE.body,
                                    fontWeight: WEIGHT.bold,
                                    letterSpacing: "-0.01em",
                                    backgroundColor: COLORS.white,
                                    boxShadow: `inset 0 0 0 1px ${COLORS.border}`,
                                    borderRadius: "11px",
                                    px: 1.6,
                                    py: 1,
                                }}
                            >
                                {played.score.toLocaleString()}
                            </Typography>
                        ) : (
                            <Icon name="lock" size={16} color="rgba(23,22,26,.34)" />
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}

export default ChallengeTestCard;

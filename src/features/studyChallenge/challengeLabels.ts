/**
 * Copy and state derivation for the Study Challenge screens
 * (docs/STUDY_CHALLENGE.md).
 *
 * Two jobs, both deliberately kept out of the components:
 *   1. DEADLINE COPY. Every boundary is 04:00 LOCAL, never midnight, so the copy
 *      must say "4 AM Wednesday". Writing "midnight" anywhere here would be four
 *      hours wrong (§ 2), and it is the kind of error that only surfaces as a
 *      confused user.
 *   2. THE ROW'S STATE. One function maps a challenge to the single control its
 *      friend row shows, so the lifecycle (Challenge → Waiting on them / Review
 *      words → Play test → See results) exists in ONE place rather than as a chain
 *      of ternaries inside the list.
 *
 * Every helper is defensive about its input: timestamps arrive as strings from JSON,
 * so an unparseable value must degrade to a sensible line rather than rendering
 * "Invalid Date".
 */
import type { ChallengeSummary } from "../../api/studyChallenges";
import { COLORS } from "../../theme/colors";

/** Turn any thrown value into a user-facing line. */
export function challengeErrorMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? err.message : fallback;
}

/** Parse an ISO string, or null when it isn't one. */
function asDate(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Has this challenge's accept window closed while it was still `pending`?
 *
 * The server already derives this (`StudyChallengeService.toSummary`) and ships
 * `status: "expired"`, so this is the SECOND line of defence, not the rule: a page
 * left open across 04:00 Wednesday holds a payload that was true when it was
 * fetched and is not any more. Both sides read the same `acceptDeadline` instant,
 * so they cannot disagree.
 *
 * An unparseable deadline degrades to "not lapsed" — offering an accept the server
 * refuses is a worse failure than the reverse only when we are SURE, and here we
 * are not.
 */
function acceptLapsed(challenge: ChallengeSummary, anytime = false): boolean {
    // The tester hatch lifts every calendar gate, deadline included
    // (docs/STUDY_CHALLENGE.md § 2a). The server has already stopped deriving
    // `expired` for this caller; this keeps the row's own reading in step.
    if (anytime) return false;
    if (challenge.status !== "pending") return false;
    const deadline = asDate(challenge.deadlines.acceptDeadline);
    return !!deadline && Date.now() >= deadline.getTime();
}

/**
 * A deadline as the user experiences it: "4 AM Wednesday", "4 AM Fri 21 Aug" once it
 * is more than a week out.
 *
 * ⚠️ The hour is part of the label ON PURPOSE. The app's day boundary is 04:00, so a
 * deadline rendered as a bare weekday ("Wednesday") reads as "end of Wednesday" and
 * is a full day wrong; rendered as "midnight" it is four hours wrong.
 */
export function deadlineLabel(iso: string | null | undefined): string {
    const date = asDate(iso);
    if (!date) return "soon";

    const hour = date.toLocaleTimeString(undefined, { hour: "numeric" });
    const daysAway = Math.round((date.getTime() - Date.now()) / 86_400_000);
    // Inside a week, the weekday alone is the most readable anchor. Beyond that it is
    // ambiguous ("Wednesday" — which one?), so the date comes along.
    const day = Math.abs(daysAway) <= 6
        ? date.toLocaleDateString(undefined, { weekday: "long" })
        : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

    return `${hour} ${day}`;
}

/** "Accept by 4 AM Wednesday" — what a pending invitation is waiting on. */
export function acceptByLabel(challenge: ChallengeSummary): string {
    return `Accept by ${deadlineLabel(challenge.deadlines.acceptDeadline)}`;
}

/**
 * The line under a friend's name: what this challenge is waiting on, from the
 * viewer's side.
 *
 * Never mentions the opponent's SCORE — only their progress (§ 6). Whoever plays
 * second must play against the game, not against a number.
 */
export function challengeStatusLine(
    challenge: ChallengeSummary | null,
    /** Tester hatch on for this device (docs/STUDY_CHALLENGE.md § 2a). */
    anytime = false
): string | null {
    if (!challenge) return null;

    if (acceptLapsed(challenge, anytime)) return "Expired";

    switch (challenge.status) {
        case "pending":
            return challenge.isChallenger
                ? `Waiting on them · lapses ${deadlineLabel(challenge.deadlines.acceptDeadline)}`
                : acceptByLabel(challenge);
        case "accepted": {
            const opens = asDate(challenge.deadlines.testOpensAt);
            const closes = asDate(challenge.deadlines.testClosesAt);
            const now = Date.now();
            if (!anytime && opens && now < opens.getTime()) {
                // The study days. The deck is the point of this stretch, so the copy
                // names it rather than just counting down.
                return `Study your deck · test opens ${deadlineLabel(challenge.deadlines.testOpensAt)}`;
            }
            if (!anytime && closes && now >= closes.getTime()) return "Window closed";

            const played = Object.keys(challenge.rounds).length;
            if (played >= challenge.roundCount) {
                return challenge.opponentFinished
                    ? "Both finished"
                    : `Waiting on ${challenge.opponent.name || "them"} to play`;
            }
            return anytime
                ? `Round ${played + 1} of ${challenge.roundCount} · anytime`
                : `Round ${played + 1} of ${challenge.roundCount} · closes ${deadlineLabel(challenge.deadlines.testClosesAt)}`;
        }
        case "complete":
            if (!challenge.winnerUserId) return "Draw";
            return challenge.winnerUserId === challenge.opponent.userId ? "They won" : "You won";
        case "no_contest":
            return "No contest";
        case "declined":
            return "Declined";
        case "expired":
            return "Expired";
        default:
            return null;
    }
}

/**
 * What the friend row's one control does next — the seven states of the pill
 * lexicon (docs/STUDY_CHALLENGE.md § 1, design F3).
 *
 * The names ARE the design's names. `incoming` and `test` were called `review` and
 * `play` while both were their own routed page; they were renamed when the pre-play
 * states moved into a sheet, because "review" no longer described what the control
 * does (it opens the invitation, which holds accept AND decline) and "play" named
 * a verb the pill no longer uses.
 */
export type ChallengeAction =
    | "issue"          // no challenge — offer one
    | "incoming"       // an invitation awaiting the viewer's answer
    | "waiting"        // the viewer issued it; withdrawable until they answer
    | "study"          // accepted, test not open yet
    | "test"           // the viewer's window is open and they have rounds left
    | "results"        // resolved, or both finished
    | "none";          // nothing actionable (window closed, declined, expired)

/**
 * Map a row to its single action. ONE place, so the row never grows a ternary chain
 * and two screens can never disagree about what state a challenge is in.
 */
export function challengeAction(
    challenge: ChallengeSummary | null,
    /** Tester hatch on for this device (docs/STUDY_CHALLENGE.md § 2a). */
    anytime = false
): ChallengeAction {
    if (!challenge) return "issue";
    // A lapsed invitation is inert on BOTH sides: the challengee can no longer
    // accept it and the challenger has nothing left to withdraw from.
    if (acceptLapsed(challenge, anytime)) return "none";

    switch (challenge.status) {
        case "pending":
            return challenge.isChallenger ? "waiting" : "incoming";
        case "accepted": {
            const opens = asDate(challenge.deadlines.testOpensAt);
            const closes = asDate(challenge.deadlines.testClosesAt);
            const now = Date.now();
            // With the hatch on the test is playable the moment it is accepted, and
            // never closes — so both window branches are skipped and the row goes
            // straight to "Play test".
            if (!anytime && opens && now < opens.getTime()) return "study";
            if (!anytime && closes && now >= closes.getTime()) return "none";
            const played = Object.keys(challenge.rounds).length;
            // `roundCount` comes from the server's drawn sequence, which may be fewer
            // than three for a cross-language pair — never hard-code 3 here.
            return played >= challenge.roundCount ? "results" : "test";
        }
        case "complete":
        case "no_contest":
            return "results";
        default:
            return "none";
    }
}

/**
 * The control's label. The label IS the state — there is no second place on the row
 * that names it.
 *
 * ⚠️ EVERY LABEL NAMES THE TAP, NOT THE SITUATION. `waiting` reads "Withdraw" rather
 * than "Waiting on them" because the row is a button and the status line above it has
 * already said what is being waited on; a button captioned with a situation invites the
 * reader to tap it expecting a report. The same rule turned "Review words" into
 * "Incoming Challenge" (the tap opens the invitation) and "Study deck" into
 * "See Cards" (the tap does not start a study session — it opens the word set).
 */
export function challengeActionLabel(action: ChallengeAction): string {
    switch (action) {
        case "issue": return "Challenge";
        case "incoming": return "Incoming Challenge";
        case "waiting": return "Withdraw";
        case "study": return "See Cards";
        case "test": return "Take Test";
        case "results": return "See results";
        default: return "—";
    }
}

/**
 * The control's fill colour (design F2/F3).
 *
 * ⚠️ THE COLOUR NAMES THE KIND OF TAP, NOT WHOSE TURN IT IS. An earlier rule painted
 * everything green when the ball was in the viewer's court, which made "Take Test" and
 * "Incoming Challenge" the same colour despite being a routine step and a decision.
 * The lexicon now separates them:
 *   * GREEN — a decision that only arrives unasked. `incoming` alone.
 *   * RED   — the one destructive control on the page (`waiting` → Withdraw), which
 *             must not read as the neutral "nothing to do here" it replaced.
 *   * ORANGE — `study`, the one state where the row's job is the deck rather than the
 *             challenge, matching the Challenges shelf spines on /decks (§ 4).
 *   * PURPLE — `issue`, the one control that STARTS something. It was blue with the
 *             two routine taps below until 2026-09-01, which made the row that offers
 *             a new challenge look like the row that reports an old one — and it is the
 *             only control most of this list carries, so it is the page's main verb.
 *             Purple is the ramp's remaining hue here (`incoming` holds green,
 *             `waiting` red, `study` orange), so it separates without inventing an
 *             eighth colour.
 *   * BLUE  — the routine taps on a challenge that already exists: take the test,
 *             read the result.
 *   * GREY  — inert.
 */
export function challengeActionColor(action: ChallengeAction): string {
    switch (action) {
        case "incoming":
            return COLORS.grn;
        case "waiting":
            return COLORS.red;
        case "study":
            return COLORS.org;
        case "issue":
            return COLORS.pur;
        case "test":
        case "results":
            return COLORS.blu;
        default:
            return COLORS.iconBg;
    }
}

/**
 * Why a friend cannot be challenged, as the user should be told.
 *
 * ⚠️ ONLY the cap explains itself. It is the one unavailable state that is genuinely
 * the user's own doing, so it says so. A block is deliberately NOT disclosed — a
 * visible "Bob blocked you" is worse than a quiet absence — so it renders as the
 * neutral line, and `null` means "show no control and no explanation".
 */
export function blockedReasonLabel(
    reason: "at-cap" | "declined-this-week" | "unavailable" | null,
    maxActive: number
): string | null {
    switch (reason) {
        case "at-cap":
            return `You're in ${maxActive} challenges this week`;
        case "declined-this-week":
            return "Next challenge on Monday";
        case "unavailable":
            return "Not available";
        default:
            return null;
    }
}

/** A player's total across their submitted rounds. Unclamped — a total may be negative. */
export function roundsTotal(rounds: Record<string, { score: number }> | undefined): number {
    return Object.values(rounds ?? {}).reduce((sum, round) => sum + (round.score ?? 0), 0);
}

/** "+700" / "−200" — a signed points figure with the app's minus glyph. */
export function signedPoints(points: number): string {
    return points < 0 ? `−${Math.abs(points).toLocaleString()}` : `+${points.toLocaleString()}`;
}

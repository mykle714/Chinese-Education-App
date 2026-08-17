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
export function challengeStatusLine(challenge: ChallengeSummary | null): string | null {
    if (!challenge) return null;

    switch (challenge.status) {
        case "pending":
            return challenge.isChallenger
                ? `Waiting on them · lapses ${deadlineLabel(challenge.deadlines.acceptDeadline)}`
                : acceptByLabel(challenge);
        case "accepted": {
            const opens = asDate(challenge.deadlines.testOpensAt);
            const closes = asDate(challenge.deadlines.testClosesAt);
            const now = Date.now();
            if (opens && now < opens.getTime()) {
                // The study days. The deck is the point of this stretch, so the copy
                // names it rather than just counting down.
                return `Study your deck · test opens ${deadlineLabel(challenge.deadlines.testOpensAt)}`;
            }
            if (closes && now >= closes.getTime()) return "Window closed";

            const played = Object.keys(challenge.rounds).length;
            if (played >= challenge.roundCount) {
                return challenge.opponentFinished
                    ? "Both finished"
                    : `Waiting on ${challenge.opponent.name || "them"} to play`;
            }
            return `Round ${played + 1} of ${challenge.roundCount} · closes ${deadlineLabel(challenge.deadlines.testClosesAt)}`;
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

/** What the friend row's one control does next. */
export type ChallengeAction =
    | "issue"          // no challenge — offer one
    | "review"         // an invitation awaiting the viewer's answer
    | "waiting"        // the viewer issued it; nothing to do but it may be withdrawn
    | "study"          // accepted, test not open yet
    | "play"           // the viewer's window is open and they have rounds left
    | "results"        // resolved, or both finished
    | "none";          // nothing actionable (window closed, declined, expired)

/**
 * Map a row to its single action. ONE place, so the row never grows a ternary chain
 * and two screens can never disagree about what state a challenge is in.
 */
export function challengeAction(challenge: ChallengeSummary | null): ChallengeAction {
    if (!challenge) return "issue";

    switch (challenge.status) {
        case "pending":
            return challenge.isChallenger ? "waiting" : "review";
        case "accepted": {
            const opens = asDate(challenge.deadlines.testOpensAt);
            const closes = asDate(challenge.deadlines.testClosesAt);
            const now = Date.now();
            if (opens && now < opens.getTime()) return "study";
            if (closes && now >= closes.getTime()) return "none";
            const played = Object.keys(challenge.rounds).length;
            // `roundCount` comes from the server's drawn sequence, which may be fewer
            // than three for a cross-language pair — never hard-code 3 here.
            return played >= challenge.roundCount ? "results" : "play";
        }
        case "complete":
        case "no_contest":
            return "results";
        default:
            return "none";
    }
}

/** The control's label. */
export function challengeActionLabel(action: ChallengeAction): string {
    switch (action) {
        case "issue": return "Challenge";
        case "review": return "Review words";
        case "waiting": return "Waiting on them";
        case "study": return "Study deck";
        case "play": return "Play test";
        case "results": return "See results";
        default: return "—";
    }
}

/**
 * The control's fill colour. Green when the ball is in the VIEWER's court, neutral
 * blue when it is not — the same valence-carries-colour rule the friend screens use.
 */
export function challengeActionColor(action: ChallengeAction): string {
    switch (action) {
        case "review":
        case "play":
            return COLORS.greenAccent;
        case "issue":
        case "results":
        case "study":
            return COLORS.blueAccent;
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

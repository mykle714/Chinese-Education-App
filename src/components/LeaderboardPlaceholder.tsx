import { Box, Typography } from "@mui/material";
import DelayedCircularProgress from "./DelayedCircularProgress";
import { Board, BoardRow } from "./leaderboard/Board";
import { Label } from "./primitives";
import { useLeaderboard } from "../hooks/useLeaderboard";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE } from "../theme/scale";

/**
 * The all-users leaderboard on the tester dashboard, ranked by lifetime minute points.
 *
 * ⚠️ THE NAME IS A FOSSIL. There is nothing placeholder about it — it has been the real,
 * server-backed leaderboard since `useLeaderboard` landed. Renaming it is a one-line
 * change at its single call site (`src/pages/TesterDashboardPage.tsx`) and worth doing
 * the next time this file is touched for a real reason.
 *
 * Since the shelf redesign (docs/SHELF_REDESIGN.md § A7) this renders the shared `Board`
 * rather than its own markup. It previously carried ~150 lines of bespoke row layout
 * inside a pink-gradient card that predated the palette entirely — one of the three
 * independently-written ranked lists the `Board` primitive exists to collapse.
 *
 * The tester dashboard is not a designed entry, so this is an EXTRAPOLATION from the
 * primitives under decision D10 rather than a port of an artboard.
 */

/** The four per-user stats, as one mono sub-line. */
function statLine(entry: {
    currentStreak: number | null;
    weeklyAchievements: number;
    todaysMinutes: number;
    yesterdaysMinutes: number;
}): string {
    // `currentStreak` is null when the user is not public — their streak is hidden from
    // other viewers, so the fact is OMITTED rather than rendered as a zero, which would
    // be a claim about their behaviour rather than an absence of one.
    const parts = [
        entry.currentStreak !== null ? `${entry.currentStreak} streak` : null,
        `${entry.weeklyAchievements} weekly`,
        `${entry.todaysMinutes} today`,
        `${entry.yesterdaysMinutes} yest`,
    ].filter(Boolean);
    return parts.join(" · ");
}

/** Shared shell so the four states (loading / error / empty / list) line up identically. */
function LeaderboardShell({ children }: { children: React.ReactNode }) {
    return (
        <Box className="leaderboard">
            <Label className="leaderboard__heading" sx={{ display: "block", padding: "0 18px" }}>
                Leaderboard
            </Label>
            {children}
        </Box>
    );
}

function LeaderboardPlaceholder() {
    const { entries, loading, error, isEmpty } = useLeaderboard();

    if (loading) {
        return (
            <LeaderboardShell>
                <Box className="leaderboard__loading" sx={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
                    <DelayedCircularProgress />
                </Box>
            </LeaderboardShell>
        );
    }

    if (error || isEmpty) {
        return (
            <LeaderboardShell>
                <Typography
                    className={error ? "leaderboard__error" : "leaderboard__empty"}
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        // An error is the app's fault and an empty board is nobody's, so
                        // the first gets semantic red and the second stays muted.
                        color: error ? COLORS.dangerInk : COLORS.textSecondary,
                        padding: "12px 18px 0",
                    }}
                >
                    {error ?? "No one has earned any minute points yet."}
                </Typography>
            </LeaderboardShell>
        );
    }

    // Every meter is drawn against the leader. MAX rather than entries[0] so an unsorted
    // response can never produce a bar that overflows its track.
    const topScore = entries.reduce((max, e) => Math.max(max, e.accumulativeMinutePoints), 0);

    return (
        <LeaderboardShell>
            <Board className="leaderboard__board">
                {entries.map((entry) => (
                    <BoardRow
                        key={entry.userId}
                        className={`leaderboard__row${entry.isCurrentUser ? " leaderboard__row--you" : ""}`}
                        rank={entry.rank}
                        // Name is optional on the account, so the email is the fallback
                        // label — never render a blank row.
                        name={entry.name || entry.email}
                        sublabel={statLine(entry)}
                        meter={topScore > 0 ? entry.accumulativeMinutePoints / topScore : 0}
                        score={entry.accumulativeMinutePoints.toLocaleString()}
                        // Replaces the old "You" chip: the row itself says it, which is one
                        // fewer thing competing for the width a long display name needs.
                        highlighted={entry.isCurrentUser}
                    />
                ))}
            </Board>
        </LeaderboardShell>
    );
}

export default LeaderboardPlaceholder;

import { displayName } from "../utils/displayName";
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
    currentStreak: number;
    weeklyAchievements: number;
    todaysMinutes: number;
    yesterdaysMinutes: number;
}): string {
    // Every account's streak is shown (`isPublic` was removed, docs/LOGIN_REWORK.md Q7).
    const parts = [
        `${entry.currentStreak} streak`,
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
                        // Name is optional on the account, so the username is the
                        // fallback label — never a blank row, never an email (Q20).
                        name={displayName(entry)}
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

import { Box, Typography } from "@mui/material";
import { Label } from "../../components/primitives";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { LANGUAGE_NAMES, type Language } from "../../../server/contracts/wire";
import { USAGE_RECENT_USERS_LIMIT, type UsageUserRow } from "../../api/usage";
import { gameLabel } from "./usageFormat";

/**
 * UsageRecentUsers — the "Recent learners" card of the User Usage dashboard
 * (docs/USAGE_DASHBOARD.md § UI): one row per learner who opened the app or studied in
 * the selected window, by NAME, most recently seen first.
 *
 * LAYER: feature UI (presentational). The rows arrive already filtered, ordered and
 * capped by the server (UsageStatsDAL.getRecentUsers); this only formats them.
 *
 * Each row: name + relative "last seen", a muted detail line (days studied / opened +
 * languages), then a four-cell figure strip — sign-ins, minutes studied, cards sorted,
 * velocity — and a play line (Immersive World runs + wins per game), all over the
 * selected window.
 */

/**
 * "just now" / "12m ago" / "5h ago" / "3d ago", measured against the moment the server
 * built the payload (not the device clock, which may be skewed and would also drift
 * while the section sits open).
 */
function relativeTime(iso: string, nowIso: string): string {
    const minutes = Math.floor((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60_000);
    if (!Number.isFinite(minutes)) return "—";
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/** "studied 4d · opened 6d · Chinese, Spanish" — the parts that are zero are dropped. */
function detailLine(u: UsageUserRow): string {
    const parts: string[] = [];
    if (u.daysStudied > 0) parts.push(`studied ${u.daysStudied}d`);
    if (u.daysOpened > 0) parts.push(`opened ${u.daysOpened}d`);
    if (u.languages.length > 0) {
        parts.push(u.languages.map((l) => LANGUAGE_NAMES[l as Language] ?? l).join(", "));
    }
    return parts.join(" · ");
}

/**
 * "Immersive World 2 runs · Word Search 3 wins · Match Speed 1 win", or "" when the
 * learner played nothing. Games are WINS, not plays — the app logs no lost rounds.
 */
function playLine(u: UsageUserRow): string {
    const parts: string[] = [];
    if (u.iwRuns > 0) parts.push(`Immersive World ${u.iwRuns} ${u.iwRuns === 1 ? "run" : "runs"}`);
    for (const g of u.gameWins) parts.push(`${gameLabel(g.game)} ${g.wins} ${g.wins === 1 ? "win" : "wins"}`);
    return parts.join(" · ");
}

/** One figure of a learner's strip: a mono value over a micro label. */
function Figure({ label, value }: { label: string; value: number }) {
    return (
        <Box className="usage-recent-users__figure" sx={{ minWidth: 0 }}>
            <Typography className="usage-recent-users__figure-value" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.body, color: value > 0 ? COLORS.onSurface : COLORS.textFaint, lineHeight: 1.2 }}>
                {value.toLocaleString()}
            </Typography>
            <Typography className="usage-recent-users__figure-label" noWrap sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textFaint }}>
                {label}
            </Typography>
        </Box>
    );
}

export interface UsageRecentUsersProps {
    users: UsageUserRow[];
    /** The payload's `generatedAt` — the "now" that "last seen" is relative to. */
    generatedAt: string;
}

export default function UsageRecentUsers({ users, generatedAt }: UsageRecentUsersProps) {
    return (
        <Box className="usage-recent-users">
            <Box className="usage-recent-users__header" sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
                <Label className="usage-recent-users__label">Recent learners</Label>
                <Typography className="usage-recent-users__count" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textFaint }}>
                    {users.length >= USAGE_RECENT_USERS_LIMIT ? `latest ${USAGE_RECENT_USERS_LIMIT}` : users.length.toLocaleString()}
                </Typography>
            </Box>

            <Box className="usage-recent-users__list" sx={{ mt: "4px" }}>
                {users.length === 0 ? (
                    <Typography className="usage-recent-users__empty" sx={{ py: "7px", fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.textSecondary }}>
                        Nobody used the app in this window.
                    </Typography>
                ) : (
                    users.map((u) => (
                        <Box
                            key={u.userId}
                            className="usage-recent-users__row"
                            sx={{ py: "10px", "& + &": { borderTop: `1px solid ${COLORS.rowBorder}` } }}
                        >
                            <Box className="usage-recent-users__identity" sx={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                                <Typography className="usage-recent-users__name" noWrap sx={{ flex: 1, minWidth: 0, fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                    {u.name}
                                </Typography>
                                <Typography className="usage-recent-users__last-seen" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textFaint, whiteSpace: "nowrap" }}>
                                    {u.lastSeenAt ? relativeTime(u.lastSeenAt, generatedAt) : "no session"}
                                </Typography>
                            </Box>
                            <Typography className="usage-recent-users__detail" noWrap sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary }}>
                                {detailLine(u)}
                            </Typography>
                            <Box className="usage-recent-users__figures" sx={{ mt: "6px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                                <Figure label={u.signIns === 1 ? "sign-in" : "sign-ins"} value={u.signIns} />
                                <Figure label="min studied" value={u.minutes} />
                                <Figure label="cards sorted" value={u.cardsSorted} />
                                <Figure label="velocity" value={u.velocity} />
                            </Box>
                            {/* Wraps rather than truncates: six games can outgrow one line. */}
                            {playLine(u) && (
                                <Typography className="usage-recent-users__plays" sx={{ mt: "6px", fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary }}>
                                    {playLine(u)}
                                </Typography>
                            )}
                        </Box>
                    ))
                )}
            </Box>
        </Box>
    );
}

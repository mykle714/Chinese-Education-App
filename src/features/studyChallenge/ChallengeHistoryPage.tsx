import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, MenuItem, Select, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import ChallengeScoreTable from "./ChallengeScoreTable";
import { fetchChallengeHistory } from "../../api/studyChallenges";
import type { ChallengeSummary } from "../../api/studyChallenges";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { challengeErrorMessage, roundsTotal } from "./challengeLabels";
import { challengeCardSx, challengeMessageSx, challengeMutedSx } from "./challengeStyles";

/** How many entries a page of the log holds. */
const PAGE_SIZE = 20;

/**
 * The challenge History log (docs/STUDY_CHALLENGE.md § 1) — the full, paginated
 * record of every challenge the viewer has played.
 *
 * ⚠️ DELIBERATELY NOT LANGUAGE-SCOPED, unlike the challenges page. This is a record
 * of what you did, and hiding half of it behind the active language would make a page
 * whose whole purpose is completeness lie about it.
 *
 * PAGINATION IS KEYSET, not offset: the log only grows, and an offset page shifts
 * under the reader every time an older challenge resolves. Each request passes the
 * last row's `completedAt` as `before`.
 *
 * The two filters are applied CLIENT-SIDE over the loaded pages, not server-side. That
 * is a deliberate scope decision, not an oversight: a server-side game filter would
 * have to query inside the `rounds` jsonb, and the log is small enough per user that
 * filtering what has been loaded gives the right answer. If a user ever has enough
 * history for that to be wrong, the fix is a server-side filter on the same endpoint —
 * which is why the round entries store their own `gameId` (§ 1).
 */
function ChallengeHistoryPage() {
    usePageTitle("Challenge History");
    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    const [entries, setEntries] = useState<ChallengeSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [exhausted, setExhausted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [friendFilter, setFriendFilter] = useState<string>("all");
    const [gameFilter, setGameFilter] = useState<string>("all");

    // Keyed on isAuthenticated, never on `token`.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchChallengeHistory(PAGE_SIZE)
            .then((list) => {
                if (cancelled) return;
                setEntries(list);
                setExhausted(list.length < PAGE_SIZE);
                setError(null);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(challengeErrorMessage(err, "Could not load your challenge history"));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isAuthenticated]);

    const handleLoadMore = useCallback(async () => {
        if (loadingMore || exhausted || entries.length === 0) return;
        setLoadingMore(true);
        try {
            const last = entries[entries.length - 1];
            const next = await fetchChallengeHistory(PAGE_SIZE, last.completedAt);
            setEntries((prev) => [...prev, ...next]);
            setExhausted(next.length < PAGE_SIZE);
            setError(null);
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, "Could not load more history"));
        } finally {
            setLoadingMore(false);
        }
    }, [loadingMore, exhausted, entries]);

    /** Every opponent and every game present in what has been loaded — the filter options. */
    const { friends, games } = useMemo(() => {
        const friendMap = new Map<string, string>();
        const gameSet = new Set<string>();
        for (const entry of entries) {
            friendMap.set(entry.opponent.userId, entry.opponent.name || entry.opponent.email);
            for (const round of Object.values(entry.rounds)) gameSet.add(round.gameId);
        }
        return { friends: [...friendMap.entries()], games: [...gameSet].sort() };
    }, [entries]);

    const visible = useMemo(() => entries.filter((entry) => {
        if (friendFilter !== "all" && entry.opponent.userId !== friendFilter) return false;
        if (gameFilter !== "all") {
            const played = Object.values(entry.rounds).some((round) => round.gameId === gameFilter);
            if (!played) return false;
        }
        return true;
    }), [entries, friendFilter, gameFilter]);

    const selectSx = {
        fontFamily: FONTS.sans,
        fontSize: SIZE.caption,
        backgroundColor: COLORS.surface,
        borderRadius: 2,
        "& .MuiOutlinedInput-notchedOutline": { border: "none" },
    } as const;

    return (
        <NodePage
            title="Challenge History"
            activePage="home"
            onBack={() => slideNavigate("/friends/challenges")}
            contentClassName="challenge-history-page__content"
        >
            <Box className="challenge-history-page" sx={{ display: "flex", flexDirection: "column", gap: 2, px: 2, pt: 1 }}>

                <Box className="challenge-history-page__filters" sx={{ display: "flex", gap: 1 }}>
                    <Select
                        className="challenge-history-page__friend-filter"
                        value={friendFilter}
                        onChange={(e) => setFriendFilter(String(e.target.value))}
                        size="small"
                        sx={{ ...selectSx, flex: 1 }}
                    >
                        <MenuItem value="all">All opponents</MenuItem>
                        {friends.map(([id, label]) => (
                            <MenuItem key={id} value={id}>{label}</MenuItem>
                        ))}
                    </Select>
                    <Select
                        className="challenge-history-page__game-filter"
                        value={gameFilter}
                        onChange={(e) => setGameFilter(String(e.target.value))}
                        size="small"
                        sx={{ ...selectSx, flex: 1 }}
                    >
                        <MenuItem value="all">All games</MenuItem>
                        {games.map((game) => (
                            <MenuItem key={game} value={game}>{game}</MenuItem>
                        ))}
                    </Select>
                </Box>

                {error && (
                    <Typography className="challenge-history-page__error" sx={challengeMessageSx}>{error}</Typography>
                )}

                {loading ? (
                    <Typography className="challenge-history-page__loading" sx={challengeMutedSx}>Loading…</Typography>
                ) : visible.length === 0 ? (
                    <Typography className="challenge-history-page__empty" sx={challengeMutedSx}>
                        {entries.length === 0 ? "No finished challenges yet." : "Nothing matches those filters."}
                    </Typography>
                ) : (
                    <Box className="challenge-history-page__list" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        {visible.map((entry) => {
                            const myTotal = roundsTotal(entry.rounds);
                            const theirTotal = roundsTotal(entry.opponentRounds);
                            const outcome = entry.status === "no_contest"
                                ? "No contest"
                                : !entry.winnerUserId
                                    ? "Draw"
                                    : entry.winnerUserId === user?.id ? "Won" : "Lost";

                            return (
                                <Box key={entry.id} className="challenge-history-page__entry" sx={challengeCardSx}>
                                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 1 }}>
                                        <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                            vs {entry.opponent.name || entry.opponent.email}
                                        </Typography>
                                        <Typography
                                            className={`challenge-history-page__outcome challenge-history-page__outcome--${outcome.toLowerCase().replace(" ", "-")}`}
                                            sx={{
                                                fontFamily: FONTS.sans,
                                                fontSize: SIZE.caption,
                                                fontWeight: WEIGHT.bold,
                                                color: outcome === "Won" ? COLORS.greenMain
                                                    : outcome === "Lost" ? COLORS.redMain
                                                        : COLORS.textSecondary,
                                            }}
                                        >
                                            {outcome}
                                        </Typography>
                                    </Box>

                                    <Typography sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}>
                                        {/* Both totals, which is what the log is for. A
                                            no-contest may legitimately show one side at 0 —
                                            a player who never played still has a real record
                                            of not having played. */}
                                        {myTotal.toLocaleString()} — {theirTotal.toLocaleString()}
                                        {entry.completedAt
                                            ? ` · ${new Date(entry.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
                                            : ""}
                                    </Typography>

                                    <Typography sx={{ ...challengeMutedSx, fontSize: SIZE.micro, mt: 0.5 }}>
                                        {entry.words.map((w) => w.word1).join("  ")}
                                    </Typography>

                                    <ChallengeScoreTable rounds={entry.rounds} />
                                </Box>
                            );
                        })}
                    </Box>
                )}

                {!loading && !exhausted && entries.length > 0 && (
                    <Button
                        className="challenge-history-page__load-more"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        sx={{
                            alignSelf: "center",
                            textTransform: "none",
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.semibold,
                            color: COLORS.onSurface,
                            backgroundColor: COLORS.surface,
                            borderRadius: 2,
                            px: 2,
                            py: 0.5,
                        }}
                    >
                        {loadingMore ? "Loading…" : "Load more"}
                    </Button>
                )}

                <FooterSpacer />
            </Box>
        </NodePage>
    );
}

export default ChallengeHistoryPage;

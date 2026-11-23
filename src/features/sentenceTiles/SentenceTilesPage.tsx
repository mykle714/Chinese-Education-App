import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import Icon from "../../components/Icon";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { navigateBackOr } from "../../utils/navigateBack";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { fetchFriends, type FriendSummary } from "../../api/friends";
import { createSentenceTilesGame, fetchSentenceTilesGames, sentenceTilesErrorMessage } from "../../api/sentenceTiles";
import type { SentenceTilesGameSummary } from "../../../server/contracts/sentenceTiles";
import { TILES_HUE, mutedTextSx, pillButtonSx, playerName, sectionLabelSx } from "./sentenceTilesStyles";

/**
 * SentenceTilesPage — `/sentence-tiles`, your games (docs/SENTENCE_TILES_GAME.md § "Pages").
 *
 * A NODE page reached from the Menu popover's Sentence Tiles row (flag `sentenceTiles`, testing
 * features on). Keeps the footer with the Menu tab lit.
 *
 * Three groups: games waiting on you (including challenges to answer), games waiting on your
 * friend, and finished games. **New game** opens the friend picker inline; picking a friend
 * creates a draft and opens it, because the challenger plays the opening move to send the
 * challenge (the friend never sees a draft).
 *
 * No polling here — the list refreshes when the page opens. The game page is the one that polls.
 * Load effect keys on `user?.id`, never `token` (CLAUDE.md ⛔ rule).
 *
 * Layer: feature page (src/features/sentenceTiles). Data: src/api/sentenceTiles.ts, src/api/friends.ts.
 */
function SentenceTilesPage() {
    usePageTitle("Sentence Tiles");
    const slideNavigate = useSlideNavigate();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [games, setGames] = useState<SentenceTilesGameSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [friends, setFriends] = useState<FriendSummary[] | null>(null);
    const [creatingFor, setCreatingFor] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);

    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        setLoading(true);
        fetchSentenceTilesGames()
            .then((res) => {
                if (cancelled) return;
                setGames(res.games);
                setError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("SentenceTilesPage: failed to load games", err);
                setError(sentenceTilesErrorMessage(err, "Couldn't load your games. Please try again later."));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
        // Keyed on the stable auth identity, not `token` (CLAUDE.md ⛔ rule).
    }, [user?.id]);

    const openPicker = useCallback(() => {
        setPicking((open) => !open);
        setCreateError(null);
        if (friends === null) {
            fetchFriends()
                .then(setFriends)
                .catch((err) => {
                    console.error("SentenceTilesPage: failed to load friends", err);
                    setFriends([]);
                    setCreateError("Couldn't load your friends.");
                });
        }
    }, [friends]);

    const challenge = useCallback(async (friend: FriendSummary) => {
        setCreatingFor(friend.userId);
        setCreateError(null);
        try {
            const game = await createSentenceTilesGame(friend.userId);
            slideNavigate(`/sentence-tiles/${game.id}`);
        } catch (err) {
            console.error("SentenceTilesPage: failed to create a game", err);
            setCreateError(sentenceTilesErrorMessage(err));
        } finally {
            setCreatingFor(null);
        }
    }, [slideNavigate]);

    const groups = useMemo(() => {
        const live = (g: SentenceTilesGameSummary) => g.status === "draft" || g.status === "pending" || g.status === "active";
        return {
            yourTurn: games.filter((g) => live(g) && g.isYourTurn),
            theirTurn: games.filter((g) => live(g) && !g.isYourTurn),
            over: games.filter((g) => !live(g)),
        };
    }, [games]);

    return (
        <NodePage title="Sentence Tiles" contentClassName="sentence-tiles-page-root" onBack={() => navigateBackOr(navigate, "/")}>
            <Box className="sentence-tiles-toolbar" sx={{ display: "flex", alignItems: "center", gap: 1.5, padding: "13px 16px 0" }}>
                <Button className="sentence-tiles-toolbar__new-game" onClick={openPicker} sx={pillButtonSx(TILES_HUE.mid)}>
                    {picking ? "Close" : "New game"}
                </Button>
                <Typography className="sentence-tiles-toolbar__hint" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary }}>
                    Build sentences from word tiles. Every line must be a real sentence.
                </Typography>
            </Box>

            {picking && (
                <Box className="sentence-tiles-friend-picker" sx={{ padding: "10px 16px 0", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {friends === null && <Typography sx={mutedTextSx}>Loading friends…</Typography>}
                    {friends?.length === 0 && !createError && (
                        <Typography sx={mutedTextSx}>Add a friend first — Sentence Tiles is played against friends.</Typography>
                    )}
                    {friends?.map((f) => (
                        <Box
                            key={f.userId}
                            component="button"
                            type="button"
                            className="sentence-tiles-friend-picker__row"
                            disabled={creatingFor !== null}
                            onClick={() => challenge(f)}
                            sx={rowSx}
                        >
                            <Icon name="person" size={22} color={COLORS.onSurface} />
                            <Box sx={{ flex: 1, textAlign: "left" }}>
                                <Typography sx={rowTitleSx}>{playerName(f)}</Typography>
                                <Typography sx={rowMetaSx}>@{f.username}</Typography>
                            </Box>
                            <Typography sx={{ ...rowMetaSx, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                {creatingFor === f.userId ? "Starting…" : "Challenge"}
                            </Typography>
                        </Box>
                    ))}
                    {createError && <Typography className="sentence-tiles-friend-picker__error" sx={{ ...rowMetaSx, color: COLORS.dangerInk }}>{createError}</Typography>}
                </Box>
            )}

            {loading && <Typography className="sentence-tiles-loading" sx={mutedTextSx}>Loading…</Typography>}
            {!loading && error && <Typography className="sentence-tiles-error" sx={mutedTextSx}>{error}</Typography>}
            {!loading && !error && games.length === 0 && (
                <Typography className="sentence-tiles-empty" sx={mutedTextSx}>No games yet. Challenge a friend to start one.</Typography>
            )}

            <GameGroup label="Your move" games={groups.yourTurn} onOpen={(id) => slideNavigate(`/sentence-tiles/${id}`)} userId={user?.id} />
            <GameGroup label="Their move" games={groups.theirTurn} onOpen={(id) => slideNavigate(`/sentence-tiles/${id}`)} userId={user?.id} />
            <GameGroup label="Finished" games={groups.over} onOpen={(id) => slideNavigate(`/sentence-tiles/${id}`)} userId={user?.id} />
            <FooterSpacer />
        </NodePage>
    );
}

/** One labelled group of game rows; renders nothing when empty. */
function GameGroup({ label, games, onOpen, userId }: {
    label: string;
    games: SentenceTilesGameSummary[];
    onOpen: (id: string) => void;
    userId: string | undefined;
}) {
    if (games.length === 0) return null;
    return (
        <Box className="sentence-tiles-group">
            <Typography className="sentence-tiles-group__label" sx={sectionLabelSx}>{label}</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 16px" }}>
                {games.map((g) => (
                    <Box key={g.id} component="button" type="button" className="sentence-tiles-game-row" onClick={() => onOpen(g.id)} sx={rowSx}>
                        <Box sx={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, backgroundColor: g.isYourTurn ? TILES_HUE.mark : COLORS.card }} />
                        <Box sx={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                            <Typography sx={rowTitleSx}>{playerName(g.opponent)}</Typography>
                            <Typography sx={rowMetaSx}>{statusLine(g, userId)}</Typography>
                        </Box>
                        <Typography className="sentence-tiles-game-row__score" sx={{ ...rowTitleSx, fontVariantNumeric: "tabular-nums" }}>
                            {g.yourScore} – {g.opponent.score}
                        </Typography>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

/** The one-line state of a game, from the viewer's side. */
function statusLine(g: SentenceTilesGameSummary, userId: string | undefined): string {
    switch (g.status) {
        case "draft": return "Play your opening to send the challenge";
        case "pending": return g.youAreChallenger ? "Waiting for them to accept" : "Challenged you — play to accept";
        case "active": return g.isYourTurn ? "Your turn" : "Their turn";
        case "declined": return "Challenge declined";
        case "cancelled": return "Challenge withdrawn";
        case "finished":
            if (!g.winnerId) return "Draw";
            return g.winnerId === userId ? "You won" : "They won";
    }
}

const rowSx = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    padding: "12px 14px",
    backgroundColor: COLORS.white,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "14px",
    cursor: "pointer",
    font: "inherit",
    color: "inherit",
    touchAction: "manipulation",
} as const;

const rowTitleSx = { fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface } as const;
const rowMetaSx = { fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary } as const;

export default SentenceTilesPage;

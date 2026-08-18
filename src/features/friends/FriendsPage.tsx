import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import MarkEmailUnreadIcon from "@mui/icons-material/MarkEmailUnread";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import FriendPersonRow from "./FriendPersonRow";
import { fetchFriendsLeaderboard, fetchIncomingRequests } from "../../api/friends";
import { fetchChallengeBadge } from "../../api/studyChallenges";
import type { FriendLeaderboardEntry } from "../../api/friends";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { friendErrorMessage, netMinutesLabel } from "./friendLabels";
import { messageSx, mutedTextSx, navButtonSx, sectionCardSx, smallButtonSx } from "./friendStyles";

/**
 * The rank chip left of the avatar. The top three get the podium accents (the same
 * pastel family the rest of the app uses — gold-ish yellow, silver-ish blue, bronze-ish
 * red) so the head of the board is readable at a glance; everyone else gets the neutral
 * surface, because tinting all rows would make the tint meaningless.
 */
function RankBadge({ rank }: { rank: number }) {
    const podium: Record<number, string> = {
        1: COLORS.yellowAccent,
        2: COLORS.blueAccent,
        3: COLORS.redAccent,
    };
    return (
        <Box
            className={`friends-page__rank friends-page__rank--${rank}`}
            sx={{
                flexShrink: 0,
                minWidth: 28,
                height: 28,
                px: 0.5,
                borderRadius: "14px",
                backgroundColor: podium[rank] ?? COLORS.iconBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONTS.sans,
                fontSize: SIZE.caption,
                fontWeight: WEIGHT.bold,
                color: COLORS.onSurface,
            }}
        >
            {rank}
        </Box>
    );
}

/**
 * The ranked metric as one unit: the number large, the word "velocity" small beneath,
 * the two CENTRED ON EACH OTHER so the pair reads as a single stacked stat rather than
 * as two independently aligned lines (the number's width swings from 1 to 3 digits,
 * which a shared edge alignment makes look ragged).
 *
 * A zero is drawn muted rather than hidden — "0 this week" is information, and a
 * blank space would read as a rendering bug.
 */
function VelocityStat({ velocity }: { velocity: number }) {
    return (
        <Box
            className="friends-page__velocity"
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                lineHeight: 1.1,
            }}
        >
            <Typography
                className="friends-page__velocity-value"
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.subtitle,
                    fontWeight: WEIGHT.bold,
                    color: velocity > 0 ? COLORS.onSurface : COLORS.textSecondary,
                    lineHeight: 1.1,
                }}
            >
                {velocity.toLocaleString()}
            </Typography>
            <Typography
                className="friends-page__velocity-unit"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary }}
            >
                velocity
            </Typography>
        </Box>
    );
}

/**
 * Friends page (docs/FRIENDS_FEATURE.md) — a Home-hub drill-in (NodePage) showing
 * the viewer and their accepted friends as a LEADERBOARD ranked by velocity
 * (utcm band-steps climbed in the last 7 days; see docs/VELOCITY.md).
 *
 * Every row is scored in THAT person's own selected language, so each carries its
 * language's flag + name; the subtitle is that same language's net minute-point
 * wallet. The server owns the ranking — this page never re-sorts, so what it draws
 * is always the ranks the server assigned.
 *
 * The board itself is READ-ONLY. Three buttons across the top lead to the three
 * action screens — "Send" (compose + outgoing pending, revocable), "Accept"
 * (incoming, with a count badge so the user knows to look) and "Remove" (unfriend)
 * — so no mutation sits on a ranking row.
 *
 * The viewer's own user ID is shown here with a copy button because the ID *is*
 * the friend handle — there is no username column, so the only way for someone to
 * friend you is for you to hand them this string.
 */
function FriendsPage() {
    usePageTitle("Friends");
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    const [entries, setEntries] = useState<FriendLeaderboardEntry[]>([]);
    const [incomingCount, setIncomingCount] = useState(0);
    const [challengeCount, setChallengeCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Keyed on isAuthenticated, never on `token`: a silent 15-minute refresh must
    // not re-fetch and flash the list (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([
            fetchFriendsLeaderboard(),
            fetchIncomingRequests(),
            // The challenge badge must not be able to fail the whole page: it is the
            // newest of the three reads and the least important to the screen's purpose,
            // so it degrades to 0 rather than replacing the leaderboard with an error.
            fetchChallengeBadge().catch(() => ({ count: 0 })),
        ])
            .then(([board, incoming, badge]) => {
                if (cancelled) return;
                setEntries(board.entries);
                setIncomingCount(incoming.length);
                setChallengeCount(badge.count);
                setError(null);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(friendErrorMessage(err, "Could not load your friends"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [isAuthenticated]);

    const handleCopyId = useCallback(async () => {
        if (!user?.id) return;
        try {
            await navigator.clipboard.writeText(user.id);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can be denied (insecure origin / permission). The ID
            // is rendered in full above, so the user can still select it manually.
            setCopied(false);
        }
    }, [user?.id]);

    return (
        <NodePage title="Friends" activePage="home" onBack={() => navigate("/")} contentClassName="friends-page__content">
            <Box className="friends-page" sx={{ display: "flex", flexDirection: "column", gap: 2, px: 2, pt: 1 }}>

                {/* The three action screens. This board is READ-ONLY — every mutation
                    (send a request, answer one, unfriend) lives behind one of these
                    buttons, so no destructive control sits on a ranking row where it
                    can be mis-tapped while reading scores. Equal thirds, all
                    thumb-reachable; the icons carry the meaning the one-word labels
                    compress. */}
                <Box className="friends-page__nav-buttons" sx={{ display: "flex", gap: 1 }}>
                    <Button
                        className="friends-page__send-button"
                        onClick={() => slideNavigate("/friends/sent")}
                        startIcon={<SendIcon />}
                        sx={navButtonSx(COLORS.blueAccent)}
                    >
                        Send
                    </Button>
                    <Button
                        className="friends-page__accept-button"
                        onClick={() => slideNavigate("/friends/requests")}
                        startIcon={<MarkEmailUnreadIcon />}
                        sx={navButtonSx(COLORS.greenAccent)}
                    >
                        Accept
                        {incomingCount > 0 && (
                            <Box
                                className="friends-page__requests-badge"
                                sx={{
                                    ml: 0.75,
                                    minWidth: 20,
                                    height: 20,
                                    px: 0.5,
                                    borderRadius: "10px",
                                    backgroundColor: COLORS.redMain,
                                    color: "#fff",
                                    fontSize: SIZE.micro,
                                    fontWeight: WEIGHT.bold,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                {incomingCount}
                            </Box>
                        )}
                    </Button>
                    <Button
                        className="friends-page__remove-button"
                        onClick={() => slideNavigate("/friends/remove")}
                        startIcon={<PersonRemoveIcon />}
                        sx={navButtonSx(COLORS.redAccent)}
                    >
                        Remove
                    </Button>
                </Box>

                {/* Study Challenges (docs/STUDY_CHALLENGE.md § 1) — a fourth drill-in,
                    on its own row rather than as a fourth equal third, because it is a
                    FEATURE rather than one of the three friend-list actions, and
                    squeezing it into that row would make all four labels unreadable.

                    ⚠️ THE BADGE IS THE ONLY WAY A CHALLENGE IS EVER ANNOUNCED. There are
                    no notifications of any kind — no push, no email, no native badge — so
                    this dot, and the row's own dot inside it, are the entire discovery
                    mechanism (Q48). The count is deliberately LANGUAGE-BLIND: a challenge
                    in a language the viewer is not currently studying is invisible on the
                    challenges page itself, and this badge is the one thread back to it. */}
                <Button
                    className="friends-page__challenges-button"
                    onClick={() => slideNavigate("/friends/challenges")}
                    startIcon={<EmojiEventsIcon />}
                    sx={navButtonSx(COLORS.yellowAccent)}
                >
                    Challenges
                    {challengeCount > 0 && (
                        <Box
                            className="friends-page__challenges-badge"
                            sx={{
                                ml: 0.75,
                                minWidth: 20,
                                height: 20,
                                px: 0.5,
                                borderRadius: "10px",
                                backgroundColor: COLORS.redMain,
                                color: "#fff",
                                fontSize: SIZE.micro,
                                fontWeight: WEIGHT.bold,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            {challengeCount}
                        </Box>
                    )}
                </Button>

                {/* Your own ID — the shareable friend handle. */}
                <Box
                    className="friends-page__my-id"
                    sx={sectionCardSx}
                >
                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary }}>
                        Your friend ID — share this so others can add you
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                        <Typography
                            className="friends-page__my-id-value"
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                fontFamily: FONTS.mono,
                                fontSize: SIZE.caption,
                                color: COLORS.onSurface,
                                wordBreak: "break-all",
                                // The ID is meant to be copied by hand when the clipboard
                                // API is unavailable, so this one string opts out of the
                                // app-wide user-select:none (CLAUDE.md § Touch & Scroll).
                                userSelect: "text",
                            }}
                        >
                            {user?.id ?? "—"}
                        </Typography>
                        <Button
                            className="friends-page__copy-id-button"
                            onClick={handleCopyId}
                            startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
                            sx={{ ...smallButtonSx, flexShrink: 0 }}
                        >
                            {copied ? "Copied" : "Copy"}
                        </Button>
                    </Box>
                </Box>

                {error && (
                    <Typography className="friends-page__error" sx={messageSx}>
                        {error}
                    </Typography>
                )}

                {/* List / empty / loading. Loading text rather than a spinner: the list is
                    one small query and a spinner flashes more than it informs. */}
                {loading ? (
                    <Typography className="friends-page__loading" sx={mutedTextSx}>Loading…</Typography>
                ) : entries.length <= 1 ? (
                    // <= 1: the viewer's own row is always present, so a board of one
                    // person is the empty state — a leaderboard of yourself is not one.
                    <Typography className="friends-page__empty" sx={mutedTextSx}>
                        No friends yet. Tap <strong>Sent</strong> to add someone by their friend ID.
                    </Typography>
                ) : (
                    <Box className="friends-page__leaderboard" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        {entries.map((entry) => (
                            <FriendPersonRow
                                key={entry.userId}
                                className={`friends-page__friend${entry.isCurrentUser ? " friends-page__friend--self" : ""}`}
                                name={entry.isCurrentUser ? `${entry.name || entry.email} (you)` : entry.name}
                                email={entry.email}
                                avatarIconId={entry.avatarIconId}
                                highlighted={entry.isCurrentUser}
                                secondary={netMinutesLabel(entry.netMinutes, entry.language)}
                                leading={<RankBadge rank={entry.rank} />}
                                onPersonPress={() => slideNavigate(`/users/${entry.userId}`)}
                                // The board is read-only: the row's only right-hand
                                // element is the score it is ranked on. Unfriending
                                // moved to /friends/remove.
                                actions={<VelocityStat velocity={entry.velocity} />}
                            />
                        ))}
                    </Box>
                )}

                <FooterSpacer />
            </Box>
        </NodePage>
    );
}

export default FriendsPage;

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import MarkEmailUnreadIcon from "@mui/icons-material/MarkEmailUnread";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import FriendPersonRow from "./FriendPersonRow";
import { fetchFriends, fetchIncomingRequests, removeFriend } from "../../api/friends";
import type { FriendSummary } from "../../api/friends";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { friendErrorMessage, friendsSinceLabel } from "./friendLabels";
import { messageSx, mutedTextSx, navButtonSx, sectionCardSx, smallButtonSx } from "./friendStyles";

/**
 * Friends page (docs/FRIENDS_FEATURE.md) — a Home-hub drill-in (NodePage) listing
 * the viewer's accepted friends.
 *
 * Two buttons across the top lead to the two pending-request screens: "Sent"
 * (outgoing, revocable, and where new requests are composed) and "Requests"
 * (incoming, with a count badge so the user knows to look).
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

    const [friends, setFriends] = useState<FriendSummary[]>([]);
    const [incomingCount, setIncomingCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Keyed on isAuthenticated, never on `token`: a silent 15-minute refresh must
    // not re-fetch and flash the list (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([fetchFriends(), fetchIncomingRequests()])
            .then(([list, incoming]) => {
                if (cancelled) return;
                setFriends(list);
                setIncomingCount(incoming.length);
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

    // Optimistic unfriend: drop the row immediately, put it back if the call fails.
    // A friendship is symmetric and cheap to restore, so an optimistic remove is
    // the right trade — the alternative is a spinner on every row.
    const handleRemove = useCallback(async (friend: FriendSummary) => {
        setFriends((prev) => prev.filter((f) => f.userId !== friend.userId));
        try {
            await removeFriend(friend.userId);
        } catch (err: unknown) {
            setFriends((prev) => [friend, ...prev]);
            setError(friendErrorMessage(err, "Could not remove this friend"));
        }
    }, []);

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

                {/* The two request screens. Full-width pair so both are thumb-reachable. */}
                <Box className="friends-page__nav-buttons" sx={{ display: "flex", gap: 1 }}>
                    <Button
                        className="friends-page__sent-button"
                        onClick={() => slideNavigate("/friends/sent")}
                        startIcon={<SendIcon />}
                        sx={navButtonSx}
                    >
                        Sent
                    </Button>
                    <Button
                        className="friends-page__requests-button"
                        onClick={() => slideNavigate("/friends/requests")}
                        startIcon={<MarkEmailUnreadIcon />}
                        sx={navButtonSx}
                    >
                        Requests
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
                </Box>

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
                ) : friends.length === 0 ? (
                    <Typography className="friends-page__empty" sx={mutedTextSx}>
                        No friends yet. Tap <strong>Sent</strong> to add someone by their friend ID.
                    </Typography>
                ) : (
                    <Box className="friends-page__list" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        {friends.map((friend) => (
                            <FriendPersonRow
                                key={friend.userId}
                                className="friends-page__friend"
                                name={friend.name}
                                email={friend.email}
                                avatarIconId={friend.avatarIconId}
                                secondary={friendsSinceLabel(friend.friendsSince)}
                                actions={
                                    <Button
                                        className="friends-page__remove-button"
                                        onClick={() => handleRemove(friend)}
                                        startIcon={<PersonRemoveIcon sx={{ fontSize: 16 }} />}
                                        sx={{ ...smallButtonSx, color: COLORS.redMain }}
                                    >
                                        Remove
                                    </Button>
                                }
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

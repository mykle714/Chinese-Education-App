import { useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import FriendPersonRow from "./FriendPersonRow";
import { messageSx, mutedTextSx, smallButtonSx } from "./friendStyles";
import { friendErrorMessage, friendsSinceLabel } from "./friendLabels";
import { fetchFriends, removeFriend } from "../../api/friends";
import type { FriendSummary } from "../../api/friends";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";

/**
 * Unfriend screen (docs/FRIENDS_FEATURE.md) — the plain friend list, each row with
 * a Remove button. Reached from the "Remove" button on FriendsPage; the back arrow
 * returns there rather than to the Home hub.
 *
 * WHY THIS IS ITS OWN PAGE: `/friends` is a leaderboard, and a destructive action
 * sitting on every row of a ranking invites a mis-tap while reading scores. Moving
 * it here leaves the board read-only and puts unfriending on the same footing as
 * the other two mutations, each of which already has a screen.
 *
 * The secondary line is "Friends since …" rather than the board's scores: this
 * page answers "who are these people and when did we connect", not "who is ahead".
 */
function RemoveFriendsPage() {
    usePageTitle("Remove Friends");
    const slideNavigate = useSlideNavigate();
    const { isAuthenticated } = useAuth();

    const [friends, setFriends] = useState<FriendSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    // Keyed on isAuthenticated, never on `token` (CLAUDE.md § token refresh).
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchFriends()
            .then((list) => { if (!cancelled) { setFriends(list); setError(null); } })
            .catch((err: unknown) => { if (!cancelled) setError(friendErrorMessage(err, "Could not load your friends")); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isAuthenticated]);

    // Optimistic: drop the row immediately and put it back if the call fails. A
    // friendship is symmetric and cheap to restore, so this is the right trade —
    // the alternative is a spinner on every row. `busyId` still guards a double-tap,
    // whose second call would 404 ("you are not friends with this user") and surface
    // an error for something that actually succeeded.
    const handleRemove = useCallback(async (friend: FriendSummary) => {
        if (busyId) return;
        setBusyId(friend.userId);
        setFriends((prev) => prev.filter((f) => f.userId !== friend.userId));
        try {
            await removeFriend(friend.userId);
            setError(null);
        } catch (err: unknown) {
            setFriends((prev) => [friend, ...prev]);
            setError(friendErrorMessage(err, "Could not remove this friend"));
        } finally {
            setBusyId(null);
        }
    }, [busyId]);

    return (
        <NodePage
            title="Remove Friends"
            activePage="home"
            onBack={() => slideNavigate("/friends")}
            contentClassName="remove-friends-page__content"
        >
            <Box className="remove-friends-page" sx={{ display: "flex", flexDirection: "column", gap: 1, px: 2, pt: 1 }}>
                {error && (
                    <Typography className="remove-friends-page__error" sx={messageSx}>
                        {error}
                    </Typography>
                )}

                {loading ? (
                    <Typography className="remove-friends-page__loading" sx={mutedTextSx}>Loading…</Typography>
                ) : friends.length === 0 ? (
                    <Typography className="remove-friends-page__empty" sx={mutedTextSx}>
                        You have no friends to remove.
                    </Typography>
                ) : (
                    friends.map((friend) => (
                        <FriendPersonRow
                            key={friend.userId}
                            className="remove-friends-page__friend"
                            name={friend.name}
                            email={friend.email}
                            avatarIconId={friend.avatarIconId}
                            secondary={friendsSinceLabel(friend.friendsSince)}
                            actions={
                                <Button
                                    className="remove-friends-page__remove-button"
                                    disabled={busyId === friend.userId}
                                    onClick={() => handleRemove(friend)}
                                    startIcon={<PersonRemoveIcon sx={{ fontSize: 16 }} />}
                                    sx={{ ...smallButtonSx, color: COLORS.redMain }}
                                >
                                    Remove
                                </Button>
                            }
                        />
                    ))
                )}

                <FooterSpacer />
            </Box>
        </NodePage>
    );
}

export default RemoveFriendsPage;

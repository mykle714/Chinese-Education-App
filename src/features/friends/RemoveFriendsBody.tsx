import { useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import FriendPersonRow from "./FriendPersonRow";
import { messageSx, mutedTextSx, removeButtonSx } from "./friendStyles";
import { friendErrorMessage } from "./friendLabels";
import { fetchFriends, removeFriend } from "../../api/friends";
import type { FriendSummary } from "../../api/friends";
import type { FriendsActionBodyProps } from "./friendsView";
import { useAuth } from "../../AuthContext";

/**
 * Unfriend list (docs/FRIENDS_FEATURE.md § "The action tiles") — the plain friend list,
 * each row with a Remove button.
 *
 * A BODY, not a page: FriendsBody slides it in where the leaderboard was while the Remove
 * tile is selected (it was the `/friends/remove` NodePage until 2026-11-13). Rows are inert —
 * the profile page they used to open was deleted the same day.
 *
 * WHY IT IS NOT ON THE BOARD: a destructive action sitting on every row of a ranking
 * invites a mis-tap while reading scores. Keeping it behind its own tile leaves the board
 * read-only and puts unfriending on the same footing as the other two mutations.
 *
 * Rows carry no secondary line (the "Friends since …" line was dropped 2026-11-13): the
 * list answers only "who", and the row's one control is the red Remove box.
 */
function RemoveFriendsBody({ onChanged }: FriendsActionBodyProps) {
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
            onChanged?.();
        } catch (err: unknown) {
            setFriends((prev) => [friend, ...prev]);
            setError(friendErrorMessage(err, "Could not remove this friend"));
        } finally {
            setBusyId(null);
        }
    }, [busyId, onChanged]);

    return (
        <Box className="remove-friends-body" sx={{ display: "flex", flexDirection: "column", gap: 1, px: 2, pt: 2 }}>
            {error && (
                <Typography className="remove-friends-body__error" sx={messageSx}>
                    {error}
                </Typography>
            )}

            {loading ? (
                <Typography className="remove-friends-body__loading" sx={mutedTextSx}>Loading…</Typography>
            ) : friends.length === 0 ? (
                <Typography className="remove-friends-body__empty" sx={mutedTextSx}>
                    You have no friends to remove.
                </Typography>
            ) : (
                friends.map((friend) => (
                    <FriendPersonRow
                        key={friend.userId}
                        className="remove-friends-body__friend"
                        name={friend.name}
                        username={friend.username}
                        avatarIconId={friend.avatarIconId}
                        actions={
                            <Button
                                className="remove-friends-body__remove-button"
                                disabled={busyId === friend.userId}
                                onClick={() => handleRemove(friend)}
                                sx={removeButtonSx}
                            >
                                Remove
                            </Button>
                        }
                    />
                ))
            )}
        </Box>
    );
}

export default RemoveFriendsBody;

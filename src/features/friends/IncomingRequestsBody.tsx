import { useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import FriendPersonRow from "./FriendPersonRow";
import { acceptButtonSx, declineButtonSx, messageSx, mutedTextSx } from "./friendStyles";
import { friendErrorMessage } from "./friendLabels";
import { acceptFriendRequest, deleteFriendRequest, fetchIncomingRequests } from "../../api/friends";
import type { FriendRequestSummary } from "../../api/friends";
import type { FriendsActionBodyProps } from "./friendsView";
import { useAuth } from "../../AuthContext";

/**
 * Incoming friend requests (docs/FRIENDS_FEATURE.md § "The action tiles") — requests
 * awaiting the viewer's answer.
 *
 * A BODY, not a page: FriendsBody slides it in where the leaderboard was while the Accept
 * tile is selected (it was the `/friends/requests` NodePage until 2026-11-13). Rows are inert
 * — the profile page they used to open was deleted the same day.
 *
 * Accept and Decline both remove the row from this list, so a single `busyId`
 * guard covers both and prevents a double-tap firing two calls against the same
 * request (the server is idempotent, but the second call would 404 and surface a
 * pointless error).
 */
function IncomingRequestsBody({ onChanged }: FriendsActionBodyProps) {
    const { isAuthenticated } = useAuth();

    const [requests, setRequests] = useState<FriendRequestSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    // Keyed on isAuthenticated, never on `token` (CLAUDE.md § token refresh).
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchIncomingRequests()
            .then((list) => { if (!cancelled) { setRequests(list); setError(null); } })
            .catch((err: unknown) => { if (!cancelled) setError(friendErrorMessage(err, "Could not load your friend requests")); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isAuthenticated]);

    // One handler for both outcomes: they differ only in which call is made and
    // what the failure message says. The row is removed only AFTER the call
    // succeeds — unlike unfriending, a failed accept that had optimistically
    // vanished would leave the user thinking they had a friend they don't.
    const respond = useCallback(async (request: FriendRequestSummary, accept: boolean) => {
        if (busyId) return;
        setBusyId(request.requestId);
        try {
            if (accept) await acceptFriendRequest(request.requestId);
            else await deleteFriendRequest(request.requestId);
            setRequests((prev) => prev.filter((r) => r.requestId !== request.requestId));
            setError(null);
            // Both outcomes drop the incoming count (the Accept tile's pin); accepting also
            // adds a row to the leaderboard.
            onChanged?.();
        } catch (err: unknown) {
            setError(friendErrorMessage(err, accept ? "Could not accept the request" : "Could not decline the request"));
        } finally {
            setBusyId(null);
        }
    }, [busyId, onChanged]);

    return (
        <Box className="incoming-requests-body" sx={{ display: "flex", flexDirection: "column", gap: 1, px: 2, pt: 2 }}>
            {error && (
                <Typography className="incoming-requests-body__error" sx={messageSx}>
                    {error}
                </Typography>
            )}

            {loading ? (
                <Typography className="incoming-requests-body__loading" sx={mutedTextSx}>Loading…</Typography>
            ) : requests.length === 0 ? (
                <Typography className="incoming-requests-body__empty" sx={mutedTextSx}>
                    No pending requests.
                </Typography>
            ) : (
                requests.map((request) => (
                    <FriendPersonRow
                        key={request.requestId}
                        className="incoming-requests-body__request"
                        name={request.name}
                        username={request.username}
                        avatarIconId={request.avatarIconId}
                        actions={
                            <>
                                <Button
                                    className="incoming-requests-body__accept-button"
                                    disabled={busyId === request.requestId}
                                    onClick={() => respond(request, true)}
                                    sx={acceptButtonSx}
                                >
                                    Accept
                                </Button>
                                <Button
                                    className="incoming-requests-body__decline-button"
                                    disabled={busyId === request.requestId}
                                    onClick={() => respond(request, false)}
                                    sx={declineButtonSx}
                                >
                                    Decline
                                </Button>
                            </>
                        }
                    />
                ))
            )}
        </Box>
    );
}

export default IncomingRequestsBody;

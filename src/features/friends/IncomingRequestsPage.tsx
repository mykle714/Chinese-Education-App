import { useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import FriendPersonRow from "./FriendPersonRow";
import { messageSx, mutedTextSx, smallButtonSx } from "./friendStyles";
import { friendErrorMessage, requestedAtLabel } from "./friendLabels";
import { acceptFriendRequest, deleteFriendRequest, fetchIncomingRequests } from "../../api/friends";
import type { FriendRequestSummary } from "../../api/friends";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";

/**
 * Incoming friend requests (docs/FRIENDS_FEATURE.md) — requests awaiting the
 * viewer's answer. Reached from the "Requests" button on FriendsPage; the back
 * arrow returns there rather than to the Home hub.
 *
 * Accept and Decline both remove the row from this list, so a single `busyId`
 * guard covers both and prevents a double-tap firing two calls against the same
 * request (the server is idempotent, but the second call would 404 and surface a
 * pointless error).
 */
function IncomingRequestsPage() {
    usePageTitle("Friend Requests");
    const slideNavigate = useSlideNavigate();
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
        } catch (err: unknown) {
            setError(friendErrorMessage(err, accept ? "Could not accept the request" : "Could not decline the request"));
        } finally {
            setBusyId(null);
        }
    }, [busyId]);

    return (
        <NodePage
            title="Friend Requests"
            activePage="home"
            onBack={() => slideNavigate("/friends")}
            contentClassName="incoming-requests-page__content"
        >
            <Box className="incoming-requests-page" sx={{ display: "flex", flexDirection: "column", gap: 1, px: 2, pt: 1 }}>
                {error && (
                    <Typography className="incoming-requests-page__error" sx={messageSx}>
                        {error}
                    </Typography>
                )}

                {loading ? (
                    <Typography className="incoming-requests-page__loading" sx={mutedTextSx}>Loading…</Typography>
                ) : requests.length === 0 ? (
                    <Typography className="incoming-requests-page__empty" sx={mutedTextSx}>
                        No pending requests.
                    </Typography>
                ) : (
                    requests.map((request) => (
                        <FriendPersonRow
                            key={request.requestId}
                            className="incoming-requests-page__request"
                            name={request.name}
                            email={request.email}
                            avatarIconId={request.avatarIconId}
                            secondary={requestedAtLabel(request.requestedAt, "incoming")}
                            onPersonPress={() => slideNavigate(`/users/${request.userId}`)}
                            actions={
                                <>
                                    <Button
                                        className="incoming-requests-page__accept-button"
                                        disabled={busyId === request.requestId}
                                        onClick={() => respond(request, true)}
                                        startIcon={<CheckIcon sx={{ fontSize: 16 }} />}
                                        sx={{ ...smallButtonSx, color: COLORS.greenMain }}
                                    >
                                        Accept
                                    </Button>
                                    <Button
                                        className="incoming-requests-page__decline-button"
                                        disabled={busyId === request.requestId}
                                        onClick={() => respond(request, false)}
                                        startIcon={<CloseIcon sx={{ fontSize: 16 }} />}
                                        sx={{ ...smallButtonSx, color: COLORS.redMain }}
                                    >
                                        Decline
                                    </Button>
                                </>
                            }
                        />
                    ))
                )}

                <FooterSpacer />
            </Box>
        </NodePage>
    );
}

export default IncomingRequestsPage;

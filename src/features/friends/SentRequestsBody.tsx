import { displayName } from "../../utils/displayName";
import { useCallback, useEffect, useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import FriendPersonRow from "./FriendPersonRow";
import { SectionCard } from "../../components/primitives";
import { messageSx, mutedTextSx, sectionHeadingSx, sendButtonSx, withdrawButtonSx } from "./friendStyles";
import { friendErrorMessage } from "./friendLabels";
import { deleteFriendRequest, fetchOutgoingRequests, sendFriendRequest } from "../../api/friends";
import type { FriendRequestSummary } from "../../api/friends";
import type { FriendsActionBodyProps } from "./friendsView";
import { useAuth } from "../../AuthContext";
import { COLORS } from "../../theme/colors";
import { DATA_TYPE } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";

/**
 * Sent friend requests (docs/FRIENDS_FEATURE.md § "The action tiles") — the viewer's own
 * pending outgoing requests (name only, no "Sent …" date), each with a Withdraw pill, plus the compose field at the top.
 *
 * A BODY, not a page: FriendsBody slides it in where the leaderboard was while the Send tile
 * is selected (it was the `/friends/sent` NodePage until 2026-11-13). Rows are inert — the
 * profile page they used to open was deleted the same day.
 *
 * ADDING IS BY FRIEND CODE OR USERNAME (migrations 187, 188; docs/LOGIN_REWORK.md Q20):
 * a friend hands you the code on their Friends screen, or their @username, and it is typed
 * here. The server decides which it is (FriendsService → resolveTarget). The field is the only
 * entry point for creating a friendship, which is why it lives on this page rather
 * than behind another drill-in.
 *
 * The server may answer `auto-accepted` when the target had already requested the
 * viewer — that produces a friendship, not a pending row, so the success message
 * says so instead of adding a row that would never appear in this list.
 */
function SentRequestsBody({ onChanged }: FriendsActionBodyProps) {
    const { isAuthenticated } = useAuth();

    const [requests, setRequests] = useState<FriendRequestSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [friendCode, setFriendCode] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    // Keyed on isAuthenticated, never on `token` (CLAUDE.md § token refresh).
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchOutgoingRequests()
            .then((list) => { if (!cancelled) { setRequests(list); setError(null); } })
            .catch((err: unknown) => { if (!cancelled) setError(friendErrorMessage(err, "Could not load your sent requests")); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isAuthenticated]);

    const handleSend = useCallback(async () => {
        const target = friendCode.trim();
        if (!target || sending) return;
        setSending(true);
        setError(null);
        setNotice(null);
        try {
            const result = await sendFriendRequest(target);
            setFriendCode("");
            if (result.status === "auto-accepted" && result.friend) {
                // They had already requested us, so this call created a friendship.
                setNotice(`You are now friends with ${displayName(result.friend)}.`);
                onChanged?.();
            } else if (result.request) {
                setRequests((prev) => [result.request as FriendRequestSummary, ...prev]);
                setNotice("Friend request sent.");
            }
        } catch (err: unknown) {
            setError(friendErrorMessage(err, "Could not send the friend request"));
        } finally {
            setSending(false);
        }
    }, [friendCode, sending, onChanged]);

    // Revoke: same DELETE the decline path uses; the server checks the caller is
    // the requester. Removed only after the call succeeds so a failure can't leave
    // a request the user believes is gone.
    const handleRevoke = useCallback(async (request: FriendRequestSummary) => {
        if (busyId) return;
        setBusyId(request.requestId);
        try {
            await deleteFriendRequest(request.requestId);
            setRequests((prev) => prev.filter((r) => r.requestId !== request.requestId));
            setError(null);
        } catch (err: unknown) {
            setError(friendErrorMessage(err, "Could not withdraw the request"));
        } finally {
            setBusyId(null);
        }
    }, [busyId]);

    return (
        <Box className="sent-requests-body" sx={{ display: "flex", flexDirection: "column", gap: 2, px: 2, pt: 2 }}>

            {/* Compose — the app's only way to create a friendship. `SectionCard`
                carries its own `.card` gutters, which this page's own `px: 2` column
                already provides, so the margin is zeroed rather than doubled. */}
            <SectionCard className="sent-requests-body__compose" sx={{ margin: 0 }}>
                <Typography component="h2" className="sent-requests-body__compose-heading" sx={sectionHeadingSx}>
                    Add a friend
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                    <TextField
                        className="sent-requests-body__id-input"
                        value={friendCode}
                        onChange={(e) => setFriendCode(e.target.value)}
                        // Enter submits — the field holds a pasted ID, so the keyboard's
                        // return key is the natural send action on mobile.
                        onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                        // A friend code OR a username (docs/LOGIN_REWORK.md Q20); the server
                        // decides which (FriendsService → resolveTarget). No forced capitals:
                        // usernames are lowercase and codes are normalized server-side.
                        placeholder="Friend code or @username"
                        size="small"
                        fullWidth
                        inputProps={{ autoCapitalize: "none", autoCorrect: "off", spellCheck: false }}
                        sx={{
                            "& .MuiInputBase-input": { ...DATA_TYPE, fontSize: SIZE.caption },
                            "& .MuiOutlinedInput-root": { backgroundColor: COLORS.background, borderRadius: 2 },
                        }}
                    />
                    <Button
                        className="sent-requests-body__send-button"
                        onClick={handleSend}
                        disabled={sending || friendCode.trim().length === 0}
                        startIcon={<PersonAddIcon sx={{ fontSize: 18 }} />}
                        sx={sendButtonSx}
                    >
                        Send
                    </Button>
                </Box>
                {notice && (
                    <Typography className="sent-requests-body__notice" sx={{ ...messageSx, mt: 1, color: COLORS.successInk }}>
                        {notice}
                    </Typography>
                )}
                {error && (
                    <Typography className="sent-requests-body__error" sx={{ ...messageSx, mt: 1 }}>
                        {error}
                    </Typography>
                )}
            </SectionCard>

            {loading ? (
                <Typography className="sent-requests-body__loading" sx={mutedTextSx}>Loading…</Typography>
            ) : requests.length === 0 ? (
                <Typography className="sent-requests-body__empty" sx={mutedTextSx}>
                    No requests waiting for an answer.
                </Typography>
            ) : (
                <Box className="sent-requests-body__list" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {requests.map((request) => (
                        <FriendPersonRow
                            key={request.requestId}
                            className="sent-requests-body__request"
                            name={request.name}
                            username={request.username}
                            avatarIconId={request.avatarIconId}
                            actions={
                                <Button
                                    className="sent-requests-body__withdraw-button"
                                    disabled={busyId === request.requestId}
                                    onClick={() => handleRevoke(request)}
                                    sx={withdrawButtonSx}
                                >
                                    Withdraw
                                </Button>
                            }
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
}

export default SentRequestsBody;

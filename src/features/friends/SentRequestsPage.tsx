import { useCallback, useEffect, useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import UndoIcon from "@mui/icons-material/Undo";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import FriendPersonRow from "./FriendPersonRow";
import { SectionCard } from "../../components/primitives";
import { messageSx, mutedTextSx, sendButtonSx, smallButtonSx } from "./friendStyles";
import { friendErrorMessage, requestedAtLabel } from "./friendLabels";
import { deleteFriendRequest, fetchOutgoingRequests, sendFriendRequest } from "../../api/friends";
import type { FriendRequestSummary } from "../../api/friends";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Sent friend requests (docs/FRIENDS_FEATURE.md) — the viewer's own pending
 * outgoing requests, each revocable, plus the compose field at the top.
 *
 * ADDING IS BY USER ID. The app has no username column, so a friend hands you the
 * ID shown on their Friends screen and it is pasted here. The field is the only
 * entry point for creating a friendship, which is why it lives on this page rather
 * than behind another drill-in.
 *
 * The server may answer `auto-accepted` when the target had already requested the
 * viewer — that produces a friendship, not a pending row, so the success message
 * says so instead of adding a row that would never appear in this list.
 */
function SentRequestsPage() {
    usePageTitle("Sent Requests");
    const slideNavigate = useSlideNavigate();
    const { isAuthenticated } = useAuth();

    const [requests, setRequests] = useState<FriendRequestSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [friendId, setFriendId] = useState("");
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
        const target = friendId.trim();
        if (!target || sending) return;
        setSending(true);
        setError(null);
        setNotice(null);
        try {
            const result = await sendFriendRequest(target);
            setFriendId("");
            if (result.status === "auto-accepted" && result.friend) {
                // They had already requested us, so this call created a friendship.
                setNotice(`You are now friends with ${result.friend.name || result.friend.email}.`);
            } else if (result.request) {
                setRequests((prev) => [result.request as FriendRequestSummary, ...prev]);
                setNotice("Friend request sent.");
            }
        } catch (err: unknown) {
            setError(friendErrorMessage(err, "Could not send the friend request"));
        } finally {
            setSending(false);
        }
    }, [friendId, sending]);

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
            setError(friendErrorMessage(err, "Could not revoke the request"));
        } finally {
            setBusyId(null);
        }
    }, [busyId]);

    return (
        <NodePage
            title="Sent Requests"
            onBack={() => slideNavigate("/friends")}
            contentClassName="sent-requests-page__content"
        >
            <Box className="sent-requests-page" sx={{ display: "flex", flexDirection: "column", gap: 2, px: 2, pt: 1 }}>

                {/* Compose — the app's only way to create a friendship. `SectionCard`
                    carries its own `.card` gutters, which this page's own `px: 2` column
                    already provides, so the margin is zeroed rather than doubled. */}
                <SectionCard className="sent-requests-page__compose" sx={{ margin: 0 }}>
                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                        Add a friend by their friend ID
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                        <TextField
                            className="sent-requests-page__id-input"
                            value={friendId}
                            onChange={(e) => setFriendId(e.target.value)}
                            // Enter submits — the field holds a pasted ID, so the keyboard's
                            // return key is the natural send action on mobile.
                            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                            placeholder="Paste their friend ID"
                            size="small"
                            fullWidth
                            inputProps={{ autoCapitalize: "none", autoCorrect: "off", spellCheck: false }}
                            sx={{
                                "& .MuiInputBase-input": { fontFamily: FONTS.mono, fontSize: SIZE.caption },
                                "& .MuiOutlinedInput-root": { backgroundColor: COLORS.background, borderRadius: 2 },
                            }}
                        />
                        <Button
                            className="sent-requests-page__send-button"
                            onClick={handleSend}
                            disabled={sending || friendId.trim().length === 0}
                            startIcon={<PersonAddIcon sx={{ fontSize: 18 }} />}
                            sx={sendButtonSx}
                        >
                            Send
                        </Button>
                    </Box>
                    {notice && (
                        <Typography className="sent-requests-page__notice" sx={{ ...messageSx, mt: 1, color: COLORS.successInk }}>
                            {notice}
                        </Typography>
                    )}
                    {error && (
                        <Typography className="sent-requests-page__error" sx={{ ...messageSx, mt: 1 }}>
                            {error}
                        </Typography>
                    )}
                </SectionCard>

                {loading ? (
                    <Typography className="sent-requests-page__loading" sx={mutedTextSx}>Loading…</Typography>
                ) : requests.length === 0 ? (
                    <Typography className="sent-requests-page__empty" sx={mutedTextSx}>
                        No requests waiting for an answer.
                    </Typography>
                ) : (
                    <Box className="sent-requests-page__list" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        {requests.map((request) => (
                            <FriendPersonRow
                                key={request.requestId}
                                className="sent-requests-page__request"
                                name={request.name}
                                email={request.email}
                                avatarIconId={request.avatarIconId}
                                secondary={requestedAtLabel(request.requestedAt, "outgoing")}
                                onPersonPress={() => slideNavigate(`/users/${request.userId}`)}
                                actions={
                                    <Button
                                        className="sent-requests-page__revoke-button"
                                        disabled={busyId === request.requestId}
                                        onClick={() => handleRevoke(request)}
                                        startIcon={<UndoIcon sx={{ fontSize: 16 }} />}
                                        sx={{ ...smallButtonSx, color: COLORS.dangerInk }}
                                    >
                                        Revoke
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

export default SentRequestsPage;

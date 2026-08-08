/**
 * friends.ts — the client's typed calls against /api/friends/*.
 *
 * Mirrors server/types/friends.ts; keep the two in step. See docs/FRIENDS_FEATURE.md.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 none of these take a `token`: they go through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet, apiPost, apiDelete, withFallback } from './http';

/** One accepted friend — always the OTHER user, never the viewer. */
export interface FriendSummary {
    userId: string;
    name: string | null;
    email: string;
    avatarIconId: string | null;
    /** ISO timestamp of the accept; null for rows accepted before the column was stamped. */
    friendsSince: string | null;
}

/** Which way a pending request points, relative to the viewer. */
export type RequestDirection = 'incoming' | 'outgoing';

/** One pending request. `userId` etc. describe the other party in both directions. */
export interface FriendRequestSummary {
    /** The row id — what accept / decline / revoke address. */
    requestId: string;
    direction: RequestDirection;
    userId: string;
    name: string | null;
    email: string;
    avatarIconId: string | null;
    requestedAt: string;
}

/**
 * POST /api/friends/requests result. `auto-accepted` means the target had already
 * sent the caller a request, so the two are friends outright and `friend` is set.
 */
export interface SendFriendRequestResponse {
    status: 'requested' | 'auto-accepted';
    request: FriendRequestSummary | null;
    friend: FriendSummary | null;
}

/** The viewer's accepted friends, newest friendship first. */
export function fetchFriends(): Promise<FriendSummary[]> {
    return withFallback(apiGet<FriendSummary[]>('/api/friends'), 'Could not load your friends');
}

/** Pending requests awaiting the viewer's answer. */
export function fetchIncomingRequests(): Promise<FriendRequestSummary[]> {
    return withFallback(
        apiGet<FriendRequestSummary[]>('/api/friends/requests/incoming'),
        'Could not load your friend requests'
    );
}

/** Pending requests the viewer sent and can revoke. */
export function fetchOutgoingRequests(): Promise<FriendRequestSummary[]> {
    return withFallback(
        apiGet<FriendRequestSummary[]>('/api/friends/requests/outgoing'),
        'Could not load your sent requests'
    );
}

/**
 * Send a request by the target's user ID (the app has no username — the ID shown
 * on the Friends screen is the shareable handle).
 */
export function sendFriendRequest(userId: string): Promise<SendFriendRequestResponse> {
    return withFallback(
        apiPost<SendFriendRequestResponse>('/api/friends/requests', { userId }),
        'Could not send the friend request'
    );
}

/** Accept an incoming request; resolves with the new friend. */
export function acceptFriendRequest(requestId: string): Promise<FriendSummary> {
    return withFallback(
        apiPost<FriendSummary>(`/api/friends/requests/${encodeURIComponent(requestId)}/accept`),
        'Could not accept the friend request'
    );
}

/**
 * Remove a pending request — declining an incoming one or revoking an outgoing
 * one. Both delete the row server-side, so there is a single call.
 */
export function deleteFriendRequest(requestId: string): Promise<void> {
    return withFallback(
        apiDelete<void>(`/api/friends/requests/${encodeURIComponent(requestId)}`),
        'Could not remove the friend request'
    );
}

/** Unfriend. Symmetric — either side may do it. */
export function removeFriend(friendUserId: string): Promise<void> {
    return withFallback(
        apiDelete<void>(`/api/friends/${encodeURIComponent(friendUserId)}`),
        'Could not remove this friend'
    );
}

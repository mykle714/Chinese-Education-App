import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUserProfile } from "../../api/userProfile";
import type { UserProfile } from "../../api/userProfile";
import { useAuth } from "../../AuthContext";
import { friendErrorMessage } from "./friendLabels";

/**
 * useFriendProfiles — PREFETCHES the profile behind every friend's leaderboard row, so a
 * row's expand-in-place detail (FriendExpandedDetail) opens with its data already there
 * instead of opening on "Loading…" and jumping when the read lands
 * (docs/FRIENDS_FEATURE.md § "Expand in place").
 *
 * ── WHEN ──────────────────────────────────────────────────────────────────────
 * FriendsBody only mounts when the learner moves to the Friends tab (AccountSheet renders
 * a pane once it is visited or about to be swiped into), and it calls this hook with the
 * board's user ids the moment the leaderboard resolves. So every profile read fires as
 * soon as there are ids to read — one `GET /api/users/:userId/profile` per friend, all in
 * parallel. A friend list is small (tens of rows), so N reads is cheaper than a batch
 * endpoint would be to build; revisit if boards grow.
 *
 * ── CACHE ─────────────────────────────────────────────────────────────────────
 * Results live for the life of the tab: an id is read at most once while it succeeds.
 * Re-running with a changed id list (a friend added or removed — the board reloads) only
 * reads the ids not seen yet. A failed read is kept as an error, NOT retried in a loop;
 * `retry(id)` re-reads it, and FriendsBody calls that when the learner opens a row whose
 * prefetch failed.
 *
 * Each read catches its own error, so one friend's failure never blanks the others.
 *
 * Keyed on `isAuthenticated`, never on `token` (CLAUDE.md § token refresh): a silent
 * refresh must not re-read every profile.
 *
 * Layer: feature hook (src/features/friends). Server calls go through src/api/userProfile.
 * Used by: FriendsBody.
 */

export type FriendProfileState =
    | { status: "loading" }
    | { status: "ready"; profile: UserProfile }
    | { status: "error"; message: string };

const LOADING: FriendProfileState = { status: "loading" };

export function useFriendProfiles(userIds: readonly string[]) {
    const { isAuthenticated } = useAuth();
    const [states, setStates] = useState<Record<string, FriendProfileState>>({});
    // Ids with a read in flight or already succeeded — a ref, so the effect below can skip
    // them without listing `states` as a dependency (which would re-run it on every land).
    const requestedRef = useRef(new Set<string>());
    // False after unmount, so a read that lands late does not set state on a dead tab.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const load = useCallback((userId: string) => {
        requestedRef.current.add(userId);
        setStates((prev) => ({ ...prev, [userId]: LOADING }));
        fetchUserProfile(userId)
            .then((profile) => {
                if (mountedRef.current) setStates((prev) => ({ ...prev, [userId]: { status: "ready", profile } }));
            })
            .catch((err: unknown) => {
                // Forget the id so `retry` (or the next id-list change) may read it again.
                requestedRef.current.delete(userId);
                if (mountedRef.current) {
                    setStates((prev) => ({
                        ...prev,
                        [userId]: { status: "error", message: friendErrorMessage(err, "Could not load this friend's progress") },
                    }));
                }
            });
    }, []);

    // A stable key for the id list, so a re-render with an equal (but new) array is a no-op.
    const idsKey = userIds.join(",");
    useEffect(() => {
        if (!isAuthenticated) return;
        for (const id of idsKey ? idsKey.split(",") : []) {
            if (!requestedRef.current.has(id)) load(id);
        }
    }, [idsKey, isAuthenticated, load]);

    /** Re-read one profile whose read failed. A no-op while it is loading or ready. */
    const retry = useCallback((userId: string) => {
        if (!requestedRef.current.has(userId)) load(userId);
    }, [load]);

    return { profiles: states, retry };
}

/** Which view the Friends tab shows. Order = the slide order (the leaderboard is position 0). */
export type FriendsView = "board" | "send" | "accept" | "remove";

/** Carousel position of each view — drives the slide direction in FriendsBody. */
export const FRIENDS_VIEW_ORDER: Record<FriendsView, number> = { board: 0, send: 1, accept: 2, remove: 3 };

/**
 * The props contract shared by the Friends tab's three action bodies — SentRequestsBody,
 * IncomingRequestsBody and RemoveFriendsBody — which FriendsBody slides in while one of
 * its action tiles is selected (docs/FRIENDS_FEATURE.md § "The action tiles").
 *
 * These live in their own file because each component module may export only its
 * component (the react-refresh rule — see friendStyles.ts).
 */
export interface FriendsActionBodyProps {
    /**
     * Called after a mutation that changes the friend graph or the incoming-request count,
     * so the host re-reads the leaderboard and the Accept tile's pin. Optional: the body
     * keeps its own list in step either way.
     */
    onChanged?: () => void;
}

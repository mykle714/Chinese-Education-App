import { useCallback, useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import CommunityDesignCard from "../community/CommunityDesignCard";
import CommunityDesignZoom from "../community/CommunityDesignZoom";
import { fetchMyVotes } from "../community/communityApi";
import { fetchUserDesigns } from "../../api/userProfile";
import { designKey } from "../../types";
import type { CommunityDesign, Language } from "../../types";
import { useAuth } from "../../AuthContext";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";
import { profileMutedSx, profileSectionTitleSx } from "./profileStyles";

/** How many designs one page pulls. Matches the server's default page size. */
const PAGE_SIZE = 12;

/**
 * The profiled account's card designs, as a wrapping grid with infinite scroll
 * (docs/USER_PROFILE_PAGE.md § Card designs).
 *
 * ── WHY THIS IS NOT `CommunityFeedRow` ────────────────────────────────────────
 * It renders the same tile (`CommunityDesignCard`) and the same zoom, and the
 * vote/apply controls inside those are shared verbatim — but the two differ in the
 * two things a feed component actually encodes:
 *   1. AXIS. A feed is one horizontal strip of a much larger corpus; a profile shows
 *      ONE person's whole output, which wants a vertical grid you scroll to the end of.
 *   2. PAGINATION. The feeds page by exclude-arrays because their order is random or
 *      vote-ranked and therefore unstable. This list has a total, stable order, so it
 *      pages by KEYSET cursor — one `after` string instead of two arrays that grow
 *      without bound as a prolific designer's list is scrolled.
 * Forcing one component to do both would mean a prop for the axis and a second one
 * for the pagination strategy, which is two components wearing a trench coat.
 *
 * `votedKeys` is loaded here rather than passed in: this grid is the only design
 * surface on the profile page, so there is nothing to keep in sync with.
 */
const ProfileDesignGrid: React.FC<{
    userId: string;
    /** The PROFILED person's language — the designs are theirs, so the scope is theirs. */
    language: Language;
    /** Their display name, for the empty state's copy. */
    displayName: string;
    /** True when the viewer is looking at their own profile — changes the empty copy only. */
    isSelf: boolean;
}> = ({ userId, language, displayName, isSelf }) => {
    const { isAuthenticated } = useAuth();

    const [designs, setDesigns] = useState<CommunityDesign[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [loadedOnce, setLoadedOnce] = useState(false);
    const [zoomed, setZoomed] = useState<CommunityDesign | null>(null);
    const [votedKeys, setVotedKeys] = useState<Set<string>>(new Set());
    const [voteDeltas, setVoteDeltas] = useState<Map<string, number>>(new Map());

    // The keyset cursor — the last entryKey of the last page. A ref, not state, so the
    // loader closure always reads the current value without re-subscribing the observer.
    const cursorRef = useRef<string | null>(null);
    const loadingRef = useRef(false);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const loadMore = useCallback(async () => {
        if (loadingRef.current || !hasMore) return;
        loadingRef.current = true;
        setLoading(true);
        try {
            const page = await fetchUserDesigns(userId, cursorRef.current, PAGE_SIZE);
            setDesigns((prev) => [...prev, ...page]);
            // A short page means the list is exhausted — the server sends no hasMore flag,
            // deliberately, so there is no second signal that can disagree with the rows.
            if (page.length < PAGE_SIZE) setHasMore(false);
            else cursorRef.current = page[page.length - 1]?.entryKey ?? null;
        } catch {
            setHasMore(false); // stop hammering a failing endpoint
        } finally {
            loadingRef.current = false;
            setLoading(false);
            setLoadedOnce(true);
        }
    }, [hasMore, userId]);

    // Reset and load page one whenever the profile changes. Keyed on the stable auth
    // identity plus the target id, NEVER on `token` — a silent refresh must not wipe a
    // list the viewer has scrolled (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        cursorRef.current = null;
        loadingRef.current = false;
        setDesigns([]);
        setHasMore(true);
        setLoadedOnce(false);
        loadMore();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, isAuthenticated]);

    // The viewer's own votes this week → greys the designs they've already voted for.
    useEffect(() => {
        let cancelled = false;
        fetchMyVotes()
            .then((votes) => {
                if (!cancelled) setVotedKeys(new Set(votes.map((v) => designKey(v))));
            })
            .catch(() => {/* non-fatal: nothing greyed if the votes fail to load */});
        return () => { cancelled = true; };
    }, [isAuthenticated]);

    // Infinite scroll: the sentinel sits after the last tile, inside the page's own
    // scroll container, so the observer uses the viewport rather than a private root.
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
            { rootMargin: "200px 0px" }, // prefetch a little before the edge
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [loadMore]);

    const setVote = useCallback((design: CommunityDesign, voted: boolean) => {
        const key = designKey(design);
        setVotedKeys((prev) => {
            const next = new Set(prev);
            if (voted) next.add(key);
            else next.delete(key);
            return next;
        });
        setVoteDeltas((prev) => {
            const next = new Map(prev);
            next.set(key, (next.get(key) ?? 0) + (voted ? 1 : -1));
            return next;
        });
    }, []);

    return (
        <Box className="profile-design-grid" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography className="profile-design-grid__title" sx={profileSectionTitleSx}>
                Card designs
            </Typography>

            {loadedOnce && designs.length === 0 ? (
                <Typography className="profile-design-grid__empty" sx={{ ...profileMutedSx, py: 2 }}>
                    {isSelf
                        ? "You haven't decorated any cards yet. Open a card's back face to arrange its icons."
                        : `${displayName} hasn't decorated any cards yet.`}
                </Typography>
            ) : (
                <Box
                    className="profile-design-grid__grid"
                    sx={{
                        display: "grid",
                        // Fixed 92px columns to match the tile's own width, centred so a
                        // short final row doesn't hang off to one side.
                        gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
                        justifyItems: "center",
                        gap: 1.5,
                    }}
                >
                    {designs.map((d) => (
                        <CommunityDesignCard
                            key={designKey(d)}
                            design={d}
                            voted={votedKeys.has(designKey(d))}
                            voteDeltas={voteDeltas}
                            language={language}
                            onVoteChange={setVote}
                            onOpen={setZoomed}
                        />
                    ))}
                </Box>
            )}

            {/* Trailing sentinel / spinner. Always mounted while more pages may exist, so
                the observer has something to watch even on an empty first render. */}
            {hasMore && (
                <Box
                    ref={sentinelRef}
                    className="profile-design-grid__sentinel"
                    sx={{ display: "flex", justifyContent: "center", py: 2, minHeight: 40 }}
                >
                    {loading && <CircularProgress size={20} />}
                </Box>
            )}

            {!hasMore && designs.length > 0 && (
                <Typography
                    className="profile-design-grid__end"
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary, textAlign: "center", py: 1 }}
                >
                    {designs.length} design{designs.length === 1 ? "" : "s"}
                </Typography>
            )}

            {zoomed && (
                <CommunityDesignZoom
                    design={zoomed}
                    voted={votedKeys.has(designKey(zoomed))}
                    voteDeltas={voteDeltas}
                    language={language}
                    onClose={() => setZoomed(null)}
                    onVoteChange={setVote}
                />
            )}
        </Box>
    );
};

export default ProfileDesignGrid;

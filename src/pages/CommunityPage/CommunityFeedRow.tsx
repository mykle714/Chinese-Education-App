import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import CommunityDesignCard from "./CommunityDesignCard";
import CommunityDesignZoom from "./CommunityDesignZoom";
import { designKey } from "../../types";
import type { CommunityDesign, Language } from "../../types";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import { useDragScroll } from "../../hooks/useDragScroll";

const PAGE_SIZE = 10;

/**
 * A titled, horizontally-scrolling, infinitely-paginated feed of community designs
 * (docs/COMMUNITY_PAGE.md). Tracks the set of already-shown design keys and passes them as the
 * server's exclude lists so pages never repeat. A trailing sentinel + IntersectionObserver loads
 * the next page as it scrolls into view. Owns the zoom for a tapped design.
 */
const CommunityFeedRow: React.FC<{
  title: string;
  fetchPage: (excludeOwners: string[], excludeKeys: string[], limit: number) => Promise<CommunityDesign[]>;
  votedKeys: Set<string>;
  onVoteChange: (design: CommunityDesign, voted: boolean) => void;
  token: string | null;
  language: Language;
  emptyHint: string;
}> = ({ title, fetchPage, votedKeys, onVoteChange, token, language, emptyHint }) => {
  const [designs, setDesigns] = useState<CommunityDesign[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [zoomed, setZoomed] = useState<CommunityDesign | null>(null);

  // Seen design keys (ownerUserId|entryKey) — the no-duplicates contract. A ref so the loader
  // closure always reads the current set without re-subscribing the observer.
  const seenRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  // Desktop mouse click-and-drag panning (touch/trackpad already scroll natively via touchAction).
  useDragScroll(scrollRef);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const seen = seenRef.current;
      const excludeOwners: string[] = [];
      const excludeKeys: string[] = [];
      for (const d of designs) {
        excludeOwners.push(d.ownerUserId);
        excludeKeys.push(d.entryKey);
      }
      const page = await fetchPage(excludeOwners, excludeKeys, PAGE_SIZE);
      // Guard against any server-side overlap: only append genuinely-new designs.
      const fresh = page.filter((d) => !seen.has(designKey(d)));
      fresh.forEach((d) => seen.add(designKey(d)));
      setDesigns((prev) => [...prev, ...fresh]);
      if (page.length < PAGE_SIZE) setHasMore(false);
    } catch {
      setHasMore(false); // stop hammering a failing endpoint
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadedOnce(true);
    }
  }, [designs, fetchPage, hasMore]);

  // Initial page.
  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll: load the next page when the trailing sentinel enters the scroll viewport.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root, rootMargin: "0px 200px 0px 0px" }, // prefetch a bit before the edge
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <Box className="community-feed-row" sx={{ mb: 3 }}>
      {title && (
        <Typography
          className="community-feed-row__title"
          sx={{ fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, color: COLORS.onSurface, px: 2, mb: 1 }}
        >
          {title}
        </Typography>
      )}

      {loadedOnce && designs.length === 0 ? (
        <Typography
          className="community-feed-row__empty"
          sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, px: 2, py: 2 }}
        >
          {emptyHint}
        </Typography>
      ) : (
        <Box
          ref={scrollRef}
          className="community-feed-row__scroll"
          sx={{
            display: "flex",
            gap: 1.5,
            px: 2,
            py: 1,
            overflowX: "auto",
            // Horizontal scrolling is opt-in here (the app shell uses touchAction: none).
            touchAction: "pan-x",
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          {designs.map((d) => (
            <CommunityDesignCard
              key={designKey(d)}
              design={d}
              voted={votedKeys.has(designKey(d))}
              token={token}
              language={language}
              onVoteChange={onVoteChange}
              onOpen={setZoomed}
            />
          ))}

          {/* Trailing sentinel / loading spinner. */}
          <Box
            ref={sentinelRef}
            className="community-feed-row__sentinel"
            sx={{ flexShrink: 0, width: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {loading && hasMore && <CircularProgress size={20} />}
          </Box>
        </Box>
      )}

      {zoomed && (
        <CommunityDesignZoom
          design={zoomed}
          voted={votedKeys.has(designKey(zoomed))}
          token={token}
          language={language}
          onClose={() => setZoomed(null)}
          onVoteChange={onVoteChange}
        />
      )}
    </Box>
  );
};

export default CommunityFeedRow;

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import NodePage from "../../components/NodePage";
import CommunityFeedRow from "./CommunityFeedRow";
import CommunitySearchBar from "./CommunitySearchBar";
import { fetchLearningFeed, fetchTopFeed, fetchMyVotes } from "./communityApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useAuth } from "../../AuthContext";
import { designKey } from "../../types";
import type { CommunityDesign, Language } from "../../types";

/**
 * Community page (docs/COMMUNITY_PAGE.md) — a Home-hub drill-in (NodePage) with a dictionary
 * search bar (`CommunitySearchBar`) above two horizontally-scrolling, infinitely-paginated feeds
 * of other users' advanced card-icon layouts:
 *   1. "For words you're learning" — designs for the viewer's non-mastered library words.
 *   2. "Top this week" — designs ranked by upvotes this week.
 * While the search bar has a non-empty term, its own per-entry "highest rated designs" rows
 * replace the two feeds below (`searchActive`). All three share the zoom/vote/apply flow.
 * `votedKeys` is loaded once and lifted here so a vote in any of them greys the design everywhere.
 */
function CommunityPage() {
  usePageTitle();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const language: Language = user?.selectedLanguage ?? "zh";

  // Design keys (ownerUserId|entryKey) the viewer has voted on this week → greyed everywhere.
  const [votedKeys, setVotedKeys] = useState<Set<string>>(new Set());

  // Shared per-design vote-count delta (designKey → net ±1 the viewer applied this session).
  // Lifted here so the SAME design shown in multiple rows/the zoom keeps a single, consistent
  // count. Previously each VoteButton owned a private `count`, so voting on one instance left the
  // duplicate in another horizontal feed stale (coloured-but-unchanged). Each VoteButton renders
  // `design.voteCountThisWeek + (delta ?? 0)`.
  const [voteDeltas, setVoteDeltas] = useState<Map<string, number>>(new Map());

  // While the search bar has a non-empty term, its per-entry design rows replace the two
  // default feeds below (see docs/COMMUNITY_PAGE.md).
  const [searchActive, setSearchActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyVotes()
      .then((votes) => {
        if (!cancelled) setVotedKeys(new Set(votes.map((v) => designKey(v))));
      })
      .catch(() => {/* non-fatal: nothing greyed if votes fail to load */});
    return () => { cancelled = true; };
  // Keyed on isAuthenticated, never on `token`: a silent refresh must not re-fetch
  // votes. This no longer needs an exhaustive-deps suppression — communityApi reads
  // the token itself at call time, so `token` is not a dependency of this effect at
  // all. See CLAUDE.md "Never reload on token refresh" and
  // docs/ARCHITECTURE_REVIEW.md finding 5.
  }, [isAuthenticated]);

  // Toggle a design's voted state + count delta in the shared stores so every surface it appears
  // in (both feeds, search rows, and the zoom) stays in sync.
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
    <NodePage title="Community" onBack={() => navigate("/")} contentClassName="community-page__content">
      <CommunitySearchBar
        language={language}
        votedKeys={votedKeys}
        voteDeltas={voteDeltas}
        onVoteChange={setVote}
        onActiveChange={setSearchActive}
      />
      {!searchActive && (
        <>
          <CommunityFeedRow
            title="For words you're learning"
            fetchPage={(authors, keys, limit) => fetchLearningFeed(language, authors, keys, limit)}
            votedKeys={votedKeys}
            voteDeltas={voteDeltas}
            onVoteChange={setVote}
            language={language}
            emptyHint="No community designs yet for the words you're learning. Check back as more learners decorate their cards!"
          />
          <CommunityFeedRow
            title="Top designs this week"
            fetchPage={(authors, keys, limit) => fetchTopFeed(language, authors, keys, limit)}
            votedKeys={votedKeys}
            voteDeltas={voteDeltas}
            onVoteChange={setVote}
            language={language}
            emptyHint="No shared designs yet this week."
          />
        </>
      )}
    </NodePage>
  );
}

export default CommunityPage;

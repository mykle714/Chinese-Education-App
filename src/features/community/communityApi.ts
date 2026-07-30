// Thin client for the Community page endpoints (docs/COMMUNITY_PAGE.md). All are auth-gated.
//
// Every call goes through src/api/http.ts, which supplies the base URL, the JSON
// envelope, `credentials: 'include'` and the Authorization header (read fresh at call
// time via authHeader(), so a silent token refresh never changes a caller's identity —
// see CLAUDE.md "Never reload/reset a page on a silent token refresh"). These functions
// therefore take NO `token` parameter: passing one around was how the token leaked into
// component dependency arrays. A non-2xx throws ApiError. See
// docs/ARCHITECTURE_REVIEW.md finding 5.

import { apiGet, apiPost } from "../../api/http";
import type {
  CommunityDesign,
  VotedDesignKey,
  VoteResult,
  ApplyDesignResult,
  Language,
} from "../../types";

/**
 * A page of designs. Already-shown designs are excluded via the parallel author/key arrays —
 * keyed on the design's AUTHOR so other users' copies of a shown design are suppressed too.
 */
async function fetchFeed(
  path: string,
  language: Language,
  excludeAuthors: string[],
  excludeKeys: string[],
  limit: number,
): Promise<CommunityDesign[]> {
  const data = await apiPost<{ designs?: CommunityDesign[] }>(path, {
    language,
    excludeAuthors,
    excludeKeys,
    limit,
  });
  return data.designs ?? [];
}

/** Feed 1 — random page of other users' advanced layouts for words the viewer is learning. */
export function fetchLearningFeed(
  language: Language,
  excludeAuthors: string[],
  excludeKeys: string[],
  limit: number,
): Promise<CommunityDesign[]> {
  return fetchFeed("/api/community/learningFeed", language, excludeAuthors, excludeKeys, limit);
}

/** Feed 2 — page of advanced layouts ranked by votes this week. */
export function fetchTopFeed(
  language: Language,
  excludeAuthors: string[],
  excludeKeys: string[],
  limit: number,
): Promise<CommunityDesign[]> {
  return fetchFeed("/api/community/topFeed", language, excludeAuthors, excludeKeys, limit);
}

/** Feed 3 — page of advanced layouts for one specific word, ranked by votes this week. */
export async function fetchEntryFeed(
  language: Language,
  entryKey: string,
  excludeAuthors: string[],
  excludeKeys: string[],
  limit: number,
): Promise<CommunityDesign[]> {
  const data = await apiPost<{ designs?: CommunityDesign[] }>("/api/community/entryFeed", {
    entryKey,
    language,
    excludeAuthors,
    excludeKeys,
    limit,
  });
  return data.designs ?? [];
}

/** The design keys the viewer voted on this week (drives the greyed/voted state). */
export async function fetchMyVotes(): Promise<VotedDesignKey[]> {
  const data = await apiGet<{ votes?: VotedDesignKey[] }>("/api/community/myVotes");
  return data.votes ?? [];
}

/** Cast an upvote. Returns 'recorded' or 'already-voted' (blocked until next week). */
export async function voteForDesign(
  ownerUserId: string,
  entryKey: string,
  language: Language,
): Promise<VoteResult> {
  const data = await apiPost<{ result: VoteResult }>("/api/community/vote", {
    ownerUserId,
    entryKey,
    language,
  });
  return data.result;
}

/** Toggle a vote off — remove this week's vote for the design. Returns whether one was removed. */
export async function unvoteDesign(
  ownerUserId: string,
  entryKey: string,
  language: Language,
): Promise<boolean> {
  const data = await apiPost<{ removed: boolean }>("/api/community/unvote", {
    ownerUserId,
    entryKey,
    language,
  });
  return data.removed;
}

/**
 * Copy a design onto the viewer's card. Without `override`, an existing advanced layout on the
 * viewer's card returns 'would-override' (no write) so the UI can confirm first.
 */
export async function applyDesign(
  ownerUserId: string,
  entryKey: string,
  language: Language,
  override = false,
): Promise<ApplyDesignResult> {
  const data = await apiPost<{ result: ApplyDesignResult }>("/api/community/applyDesign", {
    ownerUserId,
    entryKey,
    language,
    override,
  });
  return data.result;
}

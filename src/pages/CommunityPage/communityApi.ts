// Thin client for the Community page endpoints (docs/COMMUNITY_PAGE.md). All are auth-gated;
// the caller passes the bearer token from useAuth(). Mirrors the fetch+authHeaders style of
// cardIconApi.ts.

import { API_BASE_URL } from "../../constants";
import type {
  CommunityDesign,
  VotedDesignKey,
  VoteResult,
  ApplyDesignResult,
  Language,
} from "../../types";

function authHeaders(token: string | null): HeadersInit {
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

/** A page of designs already-shown designs are excluded via the parallel owner/key arrays. */
async function fetchFeed(
  path: string,
  token: string | null,
  language: Language,
  excludeOwners: string[],
  excludeKeys: string[],
  limit: number,
): Promise<CommunityDesign[]> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(token),
    body: JSON.stringify({ language, excludeOwners, excludeKeys, limit }),
  });
  if (!res.ok) throw new Error(`Community feed failed (${res.status})`);
  const data = await res.json();
  return data.designs ?? [];
}

/** Feed 1 — random page of other users' advanced layouts for words the viewer is learning. */
export function fetchLearningFeed(
  token: string | null,
  language: Language,
  excludeOwners: string[],
  excludeKeys: string[],
  limit: number,
): Promise<CommunityDesign[]> {
  return fetchFeed("/api/community/learning-feed", token, language, excludeOwners, excludeKeys, limit);
}

/** Feed 2 — page of advanced layouts ranked by votes this week. */
export function fetchTopFeed(
  token: string | null,
  language: Language,
  excludeOwners: string[],
  excludeKeys: string[],
  limit: number,
): Promise<CommunityDesign[]> {
  return fetchFeed("/api/community/top-feed", token, language, excludeOwners, excludeKeys, limit);
}

/** The design keys the viewer voted on this week (drives the greyed/voted state). */
export async function fetchMyVotes(token: string | null): Promise<VotedDesignKey[]> {
  const res = await fetch(`${API_BASE_URL}/api/community/my-votes`, {
    credentials: "include",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load votes (${res.status})`);
  const data = await res.json();
  return data.votes ?? [];
}

/** Cast an upvote. Returns 'recorded' or 'already-voted' (blocked until next week). */
export async function voteForDesign(
  token: string | null,
  ownerUserId: string,
  entryKey: string,
  language: Language,
): Promise<VoteResult> {
  const res = await fetch(`${API_BASE_URL}/api/community/vote`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(token),
    body: JSON.stringify({ ownerUserId, entryKey, language }),
  });
  if (!res.ok) throw new Error(`Vote failed (${res.status})`);
  const data = await res.json();
  return data.result;
}

/** Toggle a vote off — remove this week's vote for the design. Returns whether one was removed. */
export async function unvoteDesign(
  token: string | null,
  ownerUserId: string,
  entryKey: string,
  language: Language,
): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/api/community/unvote`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(token),
    body: JSON.stringify({ ownerUserId, entryKey, language }),
  });
  if (!res.ok) throw new Error(`Unvote failed (${res.status})`);
  const data = await res.json();
  return data.removed;
}

/**
 * Copy a design onto the viewer's card. Without `override`, an existing advanced layout on the
 * viewer's card returns 'would-override' (no write) so the UI can confirm first.
 */
export async function applyDesign(
  token: string | null,
  ownerUserId: string,
  entryKey: string,
  language: Language,
  override = false,
): Promise<ApplyDesignResult> {
  const res = await fetch(`${API_BASE_URL}/api/community/apply-design`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(token),
    body: JSON.stringify({ ownerUserId, entryKey, language, override }),
  });
  if (!res.ok) throw new Error(`Apply design failed (${res.status})`);
  const data = await res.json();
  return data.result;
}

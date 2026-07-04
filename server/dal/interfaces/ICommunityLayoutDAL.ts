import { CommunityDesign, VotedDesignKey, VoteResult } from '../../types/community.js';

/**
 * Data-access contract for community-shared advanced card-icon layouts and their upvotes
 * (community_layout_votes, migration 86). See docs/COMMUNITY_PAGE.md.
 *
 * "This week" everywhere means: since the VIEWER's most-recent-Sunday-04:00 in their local
 * timezone — the same boundary the wins/weeklies system uses (server/dal/shared/weekBoundary.ts).
 * Every feed/vote query is language-scoped and reads only OTHER users' advanced layouts
 * (server/dal/shared/advancedLayout.ts). `excludeOwners`/`excludeKeys` are parallel arrays
 * naming (ownerUserId, entryKey) pairs already shown to the client, so infinite scroll never
 * repeats a design.
 */
export interface ICommunityLayoutDAL {
  /**
   * Feed 1 — a random page of other users' advanced layouts for words in the viewer's
   * non-mastered library. Excludes already-shown designs. `inLibrary` is always true here.
   */
  getLearningFeed(
    viewerUserId: string,
    language: string,
    excludeOwners: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]>;

  /**
   * Feed 2 — a page of other users' advanced layouts ranked by votes this week (descending,
   * stable tiebreak), excluding already-shown designs. `inLibrary` reflects whether the viewer
   * already owns each word.
   */
  getTopFeed(
    viewerUserId: string,
    language: string,
    excludeOwners: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]>;

  /**
   * Feed 3 — a page of other users' advanced layouts for ONE specific word (`entryKey`), ranked
   * by votes this week (descending, stable tiebreak), excluding already-shown designs. Backs the
   * Community page's search bar: "highest rated designs for this entry." `inLibrary` reflects
   * whether the viewer already owns the word.
   */
  getDesignsForEntry(
    viewerUserId: string,
    language: string,
    entryKey: string,
    excludeOwners: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]>;

  /** The design keys the viewer has voted on since their current week boundary. */
  getMyVotesThisWeek(viewerUserId: string): Promise<VotedDesignKey[]>;

  /**
   * Cast a vote for a design, but only if the voter hasn't already voted for it this week.
   * Returns 'recorded' if inserted, 'already-voted' if a vote already exists in the window.
   */
  recordVote(
    voterUserId: string,
    ownerUserId: string,
    entryKey: string,
    language: string,
  ): Promise<VoteResult>;

  /**
   * Remove the voter's vote for a design cast this week (the toggle/unvote action). Returns true
   * if a vote row was deleted, false if there was nothing to remove.
   */
  removeVote(
    voterUserId: string,
    ownerUserId: string,
    entryKey: string,
    language: string,
  ): Promise<boolean>;

  /** The owner's saved iconLayout for one design, or null if the row/layout is gone. */
  getDesignLayout(
    ownerUserId: string,
    entryKey: string,
    language: string,
  ): Promise<unknown[] | null>;

  /**
   * The viewer's own vet row for a word (id + current layout), or null if they don't have it.
   * Used by the apply flow to detect an override without the side effects of add-to-library.
   */
  findViewerEntry(
    viewerUserId: string,
    entryKey: string,
    language: string,
  ): Promise<{ id: number; iconLayout: unknown[] | null } | null>;
}

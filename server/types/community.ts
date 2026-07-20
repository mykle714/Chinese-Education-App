import { IconLayoutItem } from './index.js';

/**
 * A community-shared advanced card-icon design surfaced in the Community feeds.
 * A ROW's identity is (ownerUserId, entryKey, language) — one user's saved layout on one word —
 * and that is still what votes/apply are keyed on. The DESIGN's identity is
 * (authorUserId, entryKey, iconLayout): rows matching on all three are the same artwork copied
 * around, and the feeds show only one of them (migration 119). Carries just enough det-derived fields to render the read-only mini card / zoom
 * (entryKey + pronunciation + definition + iconLayout). See docs/COMMUNITY_PAGE.md.
 */
export interface CommunityDesign {
  ownerUserId: string;
  ownerName: string | null;
  /** Who DESIGNED this layout (the row's owner when unattributed). Drives dedupe + credit. */
  authorUserId: string;
  /** The author's display name; null if their account is gone — clients fall back to ownerName. */
  authorName: string | null;
  entryKey: string;
  language: string;
  iconLayout: IconLayoutItem[] | null;
  pronunciation: string | null;
  tone: string | null;
  script: string | null;
  definition: string | null;
  /** Votes this design has received since the VIEWER's current week boundary. */
  voteCountThisWeek: number;
  /** Whether the viewer already has this word saved (drives the apply-button label). */
  inLibrary: boolean;
}

/** A design the viewer has already voted on (identity key only) — used to grey voted designs. */
export interface VotedDesignKey {
  ownerUserId: string;
  entryKey: string;
  language: string;
}

/** Result of casting a vote: 'recorded' on success, 'already-voted' if blocked this week. */
export type VoteResult = 'recorded' | 'already-voted';

/** Result of applying a design to the viewer's card. */
export type ApplyDesignResult = 'applied' | 'added-and-applied' | 'would-override';

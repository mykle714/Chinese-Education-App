/**
 * Row + wire types for Study Challenge (`study_challenges`, migration 148).
 *
 * See docs/STUDY_CHALLENGE.md. Depended on by:
 *   server/dal/interfaces/IStudyChallengeDAL.ts
 *   server/dal/implementations/StudyChallengeDAL.ts
 *   server/services/StudyChallengeService.ts
 *   server/controllers/StudyChallengeController.ts
 *   src/api/studyChallenges.ts (client mirror — keep the two in step)
 *
 * The primitive shapes a challenge is BUILT from — `ChallengeWord`,
 * `ChallengeRound`, `ChallengeGameRef`, `ChallengeStatus`, `ChallengeVariant`,
 * the scoring spec and breakdown — live in `server/contracts/wire.ts`, because the
 * games registry on the client declares scoring specs against them and the two
 * sides must not be able to drift. What lives HERE is the challenge as the server
 * assembles and serves it: the row, the view models, and the request bodies.
 */

import type {
  ChallengeGameRef,
  ChallengeRound,
  ChallengeStatus,
  ChallengeVariant,
  ChallengeWord,
  Language,
} from '../contracts/wire.js';

/**
 * A raw `study_challenges` row, as the DAL returns it.
 *
 * `words`, `rounds` and `presetDeckIds` are all keyed by USER ID so one shape
 * serves both variants and no read path has to branch on `variant`. A same-word
 * challenge simply stores the same ten entries under both keys.
 */
export interface StudyChallengeRow {
  id: string;
  challengerId: string;
  challengeeId: string;
  variant: ChallengeVariant;
  challengerLanguage: Language;
  challengeeLanguage: Language;
  status: ChallengeStatus;
  /** The three (gameId, mode) pairs, in order. Drawn at issue, revealed at window open. */
  gameSequence: ChallengeGameRef[];
  /** userId → that player's ten words. */
  words: Record<string, ChallengeWord[]>;
  /** userId → roundIndex ("1".."3") → the submitted round. */
  rounds: Record<string, Record<string, ChallengeRound>>;
  /** userId → the generated deck created for them on accept. */
  presetDeckIds: Record<string, number>;
  issuedAt: string;
  /**
   * The challenger's Monday 04:00 local, as a UTC instant — the challenge's WEEK
   * IDENTITY, not a deadline. Every deadline is recomputed per read from
   * `issuedAt`/`weekStart` plus the player's CURRENT timezone (Q50); this one field
   * is snapshotted because the unique index keys on it and an identity must not
   * move. See shared/challengeWeek.ts.
   */
  weekStart: string;
  acceptedAt: string | null;
  completedAt: string | null;
  /** Null for a draw and for no_contest. Always one of the two players otherwise. */
  winnerUserId: string | null;
}

/**
 * The per-player deadlines a client needs, all resolved to UTC instants so the
 * client renders countdowns without repeating the boundary maths.
 *
 * Computed for the REQUESTING player: `testOpensAt`/`testClosesAt` are their own
 * window, not their opponent's, because in async mode the two do not coincide.
 */
export interface ChallengeDeadlines {
  /** Wednesday 04:00 in the CHALLENGEE's zone — when the invitation lapses. */
  acceptDeadline: string;
  /** Friday 04:00 in the requesting player's zone. */
  testOpensAt: string;
  /** The following Monday 04:00 in the requesting player's zone. */
  testClosesAt: string;
}

/**
 * One challenge as the challenges page renders it, from one player's point of view.
 *
 * ⚠️ `gameSequence` is OMITTED (undefined) until the requesting player's own test
 * window opens (Q63). The rule is enforced HERE, in the serializer, not in the UI —
 * a client that merely declines to render the field still ships the answer to
 * anyone who opens the network tab. It is the only time-gated field in the feature.
 */
export interface ChallengeSummary {
  id: string;
  variant: ChallengeVariant;
  status: ChallengeStatus;
  /** True when the requesting player is the challenger (they may withdraw, not decline). */
  isChallenger: boolean;
  /** The other player's public identity. */
  opponent: ChallengeOpponent;
  /** The language THIS player plays in — theirs, which may differ in a cross-language challenge. */
  language: Language;
  /** This player's ten words. Empty for a challenge whose set they have not picked yet. */
  words: ChallengeWord[];
  /** This player's submitted rounds, keyed by round index. */
  rounds: Record<string, ChallengeRound>;
  /**
   * Whether the OPPONENT has finished — progress only, never a score (§ 6). A
   * player who plays second must play against the game, not against a number, so
   * no opponent score is serialized until both players are done.
   */
  opponentFinished: boolean;
  /** The opponent's rounds and totals, present ONLY once both players have finished. */
  opponentRounds?: Record<string, ChallengeRound>;
  /** This player's generated study deck, or null once it has been dropped. */
  presetDeckId: number | null;
  /** See the warning above: absent until this player's window opens. */
  gameSequence?: ChallengeGameRef[];
  /** How many rounds this challenge is — may be fewer than 3 (§ 5.1, § 8.3). */
  roundCount: number;
  deadlines: ChallengeDeadlines;
  issuedAt: string;
  completedAt: string | null;
  winnerUserId: string | null;
}

/** The other player, as a challenge row renders them. */
export interface ChallengeOpponent {
  userId: string;
  name: string | null;
  email: string;
  avatarIconId: string | null;
}

/**
 * One row of the challenges page, which is a LIST OF FRIENDS, not a list of
 * challenges (§ 1, Q43). The friend is the unit: the row carries everything about
 * your standing with that person, so there is never a second place to look.
 */
export interface ChallengeFriendRow {
  friend: ChallengeOpponent;
  /** The pair's live challenge, if any. */
  challenge: ChallengeSummary | null;
  /**
   * Whoever won the pair's most recent RESOLVED challenge — the reigning champion
   * (👑). A draw or a no_contest leaves the previous champion in place: the crown
   * changes hands only when someone wins.
   */
  championUserId: string | null;
  /**
   * Whether this friend can be challenged right now, and if not, why. Only the
   * cap reason is disclosed to the user — it is the one unavailable state that is
   * genuinely their own doing (§ 1). A block is deliberately NOT disclosed to the
   * blocked friend, so it surfaces as the neutral 'unavailable'.
   */
  canChallenge: boolean;
  blockedReason: 'at-cap' | 'declined-this-week' | 'unavailable' | null;
  /** Whether the VIEWER has set their own half of the per-pair opt-out (§ 1). */
  viewerBlocked: boolean;
}

/** The challenges page payload. */
export interface ChallengesPageResponse {
  rows: ChallengeFriendRow[];
  /** How many of the viewer's `MAX_ACTIVE_CHALLENGES` slots are spent in this language. */
  activeCount: number;
  maxActive: number;
}

/**
 * A candidate word offered in the confirmation flow (§ 3.2), before it is
 * materialised as a vet row.
 *
 * `dictionaryEntryId` is what a strike ("I already know this") is submitted
 * against, because at this point there may be no vet row to name.
 */
export interface ChallengeCandidate {
  dictionaryEntryId: number;
  word1: string;
  language: Language;
  pronunciation: string | null;
  definition: string | null;
  difficulty: number | null;
  frequencyScore: number | null;
}

/** Body of `POST /api/studyChallenges`. */
export interface IssueChallengeBody {
  friendUserId: string;
  variant: ChallengeVariant;
}

/** Body of `POST /api/studyChallenges/:id/accept`. */
export interface AcceptChallengeBody {
  /** The det ids the challengee struck as already known, in the order they struck them. */
  struckEntryIds?: number[];
}

/** Body of `POST /api/studyChallenges/:id/rounds`. */
export interface SubmitRoundBody {
  roundIndex: number;
  score: number;
  breakdown: unknown;
}

/**
 * The counted, per-(user, language) commitment total behind
 * `MAX_ACTIVE_CHALLENGES` — challenges you ISSUED that are still pending, plus
 * ones you ACCEPTED, in either role. Incoming invitations are deliberately not
 * counted (Q65).
 */
export interface ActiveChallengeCount {
  userId: string;
  language: string;
  count: number;
}

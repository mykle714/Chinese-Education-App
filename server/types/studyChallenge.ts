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
  ChallengeTaunt,
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
  /**
   * userId → the one taunt that player sent, or absent (migration 156).
   *
   * Keyed by SENDER, not by target. The results screen shows a taunt on the card of
   * whoever it is AIMED at, but "who sent it" is the durable fact and the target is
   * derivable from it — storing it by target would make the one-per-player rule an
   * invariant nothing enforces.
   */
  taunts: Record<string, ChallengeTaunt>;
  issuedAt: string;
  /**
   * Whole weeks since Monday 2026-01-05 00:00 UTC — the challenge's WEEK IDENTITY,
   * not a deadline, and the second half of the pair-week unique index.
   *
   * A COUNTER RATHER THAN AN INSTANT because both players must agree on it: the
   * previous `weekStart` timestamptz was the CHALLENGER's local Monday, so a pair in
   * two timezones stored two different values for the same week and the unique index
   * never fired. Every deadline is still recomputed per read from this index plus
   * the player's CURRENT timezone (Q50). See shared/challengeWeek.ts, migration 150.
   */
  weekIndex: number;
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
  /** Whether the OPPONENT has finished all their rounds. */
  opponentFinished: boolean;
  /**
   * The opponent's SUBMITTED rounds — revealed one at a time, as each is completed
   * (§ 6, design F15b/F15d). Always present; empty until they submit their first.
   *
   * ⚠️ THIS USED TO BE WITHHELD until both players finished, to stop the second
   * player anchoring on a target score. That gate was dropped when View Challenge
   * became two pages: a page that stays blank for four days is not a page. A round
   * IN PROGRESS is still invisible, because `rounds` only ever holds submitted ones.
   */
  opponentRounds: Record<string, ChallengeRound>;
  /**
   * Both players' taunts, keyed by SENDER's user id (§ 6a, migration 156). Absent
   * key = not sent. Only renderable on a completed challenge — the client enforces
   * that, since there is nothing here worth protecting.
   */
  taunts: Record<string, ChallengeTaunt>;
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
  /** icons8 icon for the mini preview card (migration 72); null when unassigned. */
  iconId: string | null;
}

/**
 * The det-resolved fields a stored challenge word needs in order to DRAW.
 *
 * A challenge row stores identity only (Q49), so these are looked up on the way out
 * (`findDisplayFieldsByWords`). Deliberately the same fields a `ChallengeCandidate`
 * carries, so the review screen renders a stored word and a freshly drawn
 * replacement through one card component with no branch.
 */
export interface ChallengeWordDisplayFields {
  dictionaryEntryId: number;
  pronunciation: string | null;
  definition: string | null;
  frequencyScore: number | null;
  iconId: string | null;
}

/**
 * What a strike needs in order to hand back a replacement word (§ 3.2).
 *
 * Exactly one of `friendUserId` (the challenger, before the challenge exists) or
 * `challengeId` (the challengee, reviewing a stored set) identifies the draw's
 * "other player"; `exclude` is every word already on the reviewer's screen plus
 * every word they have struck this session. Omitting the whole object keeps the
 * strike a bare Mastered write with no replacement.
 */
export interface StrikeReplacementContext {
  friendUserId?: string;
  challengeId?: string;
  variant?: ChallengeVariant;
  exclude?: string[];
}

/** Body of `POST /api/studyChallenges`. */
export interface IssueChallengeBody {
  friendUserId: string;
  variant: ChallengeVariant;
}

/**
 * Body of `POST /api/studyChallenges/:id/accept`.
 *
 * WORDS, NOT DET IDS (Q49): a challenge stores its set as the denormalised
 * (language, word1) pair, which survives a det data deploy, so the picker submits
 * the same handle. (This interface previously declared `struckEntryIds: number[]`,
 * which no caller ever sent and no handler ever read.)
 */
export interface AcceptChallengeBody {
  /** The words the challengee struck as already known, in the order they struck them. */
  struckWords?: string[];
  /**
   * The replacements the server handed back for those strikes, so the committed set
   * is the set the challengee had on screen. Every word is re-resolved against the
   * det before it is honoured; anything unresolvable is topped up by a fresh draw.
   */
  replacementWords?: string[];
}

/** Body of `POST /api/studyChallenges/:id/rounds`. */
export interface SubmitRoundBody {
  roundIndex: number;
  score: number;
  breakdown: unknown;
  /**
   * false = a claim/progress write, leaving the round open (`completedAt: null`);
   * true (the default when omitted) = finish the round and close it forever.
   */
  final?: boolean;
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

/**
 * Everything a GAME needs to build one challenge round's board
 * (docs/STUDY_CHALLENGE.md § 5.2).
 *
 * Resolved by `StudyChallengeService.getRoundContext` and consumed by the pool
 * reads in `OnDeckVocabService` — the game itself never sees it. It is the answer
 * to three questions the pool cannot ask the client for, because a client could
 * lie about any of them: WHICH challenge, WHICH round, and WHICH nine words.
 *
 * `vocabEntryIds` is positional against `words` and is re-materialised on the way
 * out, so a player who deleted a contested card mid-week still gets a playable
 * board (Q54).
 */
export interface ChallengeRoundContext {
  challengeId: string;
  /** The round this player is next allowed to play — 1-based. */
  roundIndex: number;
  /** The game this round is drawn as. The caller's game must match it. */
  game: import('../contracts/wire.js').ChallengeGameRef;
  /** THIS player's language — a cross-language challenge has two (§ 8). */
  language: import('../contracts/wire.js').Language;
  /** The contested words, in their stored order. */
  words: string[];
  /** The vet ids behind `words`, positionally. */
  vocabEntryIds: number[];
}

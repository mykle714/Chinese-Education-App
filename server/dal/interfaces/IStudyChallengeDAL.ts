import type { PoolClient } from 'pg';
import type { ChallengeRound, ChallengeGameRef, ChallengeStatus, ChallengeVariant, ChallengeWord } from '../../contracts/wire.js';
import type {
  StudyChallengeRow,
  ChallengeCandidate,
  ChallengeWordDisplayFields,
} from '../../types/studyChallenge.js';

/**
 * Data access for Study Challenge (`study_challenges`, migration 148).
 *
 * LAYER: DAL. Owns every statement against `study_challenges` and the challenge
 * candidate query; owns NO policy — windows, timezones, caps, eligibility and
 * winner resolution all live in StudyChallengeService
 * (docs/BACKEND_LAYERING.md § 3).
 *
 * ⚠️⚠️ THE ONE RULE THIS INTERFACE EXISTS TO PROTECT ⚠️⚠️
 * `rounds` is written by `recordRound` AND NOTHING ELSE. Both players write that
 * jsonb column on the same row, possibly in the same instant, and the safety comes
 * entirely from the fact that `recordRound` is a SINGLE STATEMENT: one statement
 * takes the row lock and performs the read-modify-write inside it, so concurrent
 * submissions serialise and neither can be lost. Its path guard — the slot is
 * absent, or present and still `completedAt: null` — enforces the one-attempt rule
 * in the same breath: a FINALISED round can never be written again.
 *
 * The danger is therefore NOT concurrency — it is somebody later adding a
 * convenient read-modify-write helper ("fetch the challenge, splice a round in,
 * write the whole blob back"). That helper would be correct in every test and
 * lossy in production. Do not add it. If the discipline ever feels unreliable, the
 * fallback is a `study_challenge_rounds` child table where the same guarantee
 * comes from a unique constraint instead — see STUDY_CHALLENGE.md § 9, Q53.
 *
 * Every method takes an optional PoolClient so a caller inside a transaction can
 * enlist the query. This feature genuinely needs it: the accept path flips the
 * status, materialises vet rows and creates two decks atomically (§ 3.3), and the
 * unfriend path resolves in-flight challenges in the same transaction as the
 * friendship delete (§ 6).
 */
export interface IStudyChallengeDAL {
  /** One challenge by id, or null. */
  findById(id: string, client?: PoolClient): Promise<StudyChallengeRow | null>;

  /**
   * The pair's challenge for one week, in either direction — the read behind
   * "may these two be matched again this week".
   *
   * Matches ANY status, including `declined`, `expired` and `no_contest`: a
   * resolved row still holds its week, which is what makes the decline cooldown
   * (§ 1) fall out of the unique index rather than needing a rate limiter.
   */
  findForPairInWeek(
    userA: string,
    userB: string,
    weekIndex: number,
    client?: PoolClient
  ): Promise<StudyChallengeRow | null>;

  /**
   * Every challenge the user is a party to that is still live (`pending` or
   * `accepted`), in either role and in ANY language.
   *
   * Deliberately not language-scoped: the challenges PAGE is language-scoped but
   * the badge is not (Q48), and the badge is the only thread back to a challenge in
   * a language the user is not currently studying. Callers scope it themselves.
   */
  listLiveForUser(userId: string, client?: PoolClient): Promise<StudyChallengeRow[]>;

  /**
   * Every challenge the user is a party to that RESOLVED (`complete` or
   * `no_contest`) inside the given challenge week, in either role and in any
   * language.
   *
   * Why the challenges page needs this alongside `listLiveForUser`: a challenge
   * stops being live the moment it resolves, but its results stay the answer to
   * "what happened with Bob this week" until the next challenge period opens
   * (docs/STUDY_CHALLENGE.md § 1). Without this the friend row would drop straight
   * back to "Challenge" — a button that is refused anyway, because a resolved row
   * still occupies the pair's week — and the results would be reachable only
   * through History.
   *
   * `declined` and `expired` are NOT included: nothing was played, so there is no
   * result to open.
   */
  listResolvedForUserInWeek(
    userId: string,
    weekIndex: number,
    client?: PoolClient
  ): Promise<StudyChallengeRow[]>;

  /**
   * Take transaction-scoped advisory locks on a set of users, so that any two
   * challenge operations touching an overlapping set of users run one after the
   * other rather than interleaving.
   *
   * WHY AN ADVISORY LOCK AND NOT A CONSTRAINT. Two of the issue-time invariants
   * cannot be expressed in SQL:
   *   * "at most one UNFINISHED challenge per pair, whatever week it is named
   *     after" — `unfinished` is derived from both players' timezones, so no index
   *     can compute it; and
   *   * "at most MAX_ACTIVE_CHALLENGES per (user, language)" — a COUNT, which no
   *     unique index expresses either.
   * Both were read-then-write, and both are reachable: a crossing pair in two
   * timezones can compute DIFFERENT week indices (so `study_challenges_pair_week_uniq`
   * does not collide) and end up with two live challenges, two decks and two cap
   * slots — the migration-150 defect, re-opened by a race.
   *
   * Locks are ACQUIRED IN SORTED ORDER, which is what makes concurrent A→B and B→A
   * requests deadlock-free: both take the same lock first.
   *
   * `pg_advisory_xact_lock` releases on commit or rollback, so there is no unlock
   * path to forget. Must be called inside a transaction.
   */
  lockUsersForChallenge(userIds: string[], client: PoolClient): Promise<void>;

  /**
   * How many challenges the user is COMMITTED to in one language — issued and
   * still pending, plus accepted, in either role. Incoming pending invitations are
   * excluded, because a slot must only ever be spent by the user's own decision
   * (Q65).
   */
  countActiveForUser(userId: string, language: string, client?: PoolClient): Promise<number>;

  /**
   * The pair's most recently RESOLVED challenge, for the reigning-champion crown.
   * Not language-scoped: the crown is a standing claim about the pair, and the
   * history it is drawn from is deliberately language-blind (§ 1).
   */
  findLastResolvedForPair(
    userA: string,
    userB: string,
    client?: PoolClient
  ): Promise<StudyChallengeRow | null>;

  /**
   * Keyset page of the user's resolved challenges, newest first — the History log.
   * `before` is the previous page's last `completedAt`; omit it for the first page.
   * Keyset rather than offset because the log only grows.
   */
  listHistoryForUser(
    userId: string,
    limit: number,
    before?: string | null,
    client?: PoolClient
  ): Promise<StudyChallengeRow[]>;

  /** Insert a `pending` challenge. The caller supplies the already-computed week identity. */
  createChallenge(
    input: {
      challengerId: string;
      challengeeId: string;
      variant: ChallengeVariant;
      challengerLanguage: string;
      challengeeLanguage: string;
      gameSequence: ChallengeGameRef[];
      words: Record<string, ChallengeWord[]>;
      weekIndex: number;
    },
    client?: PoolClient
  ): Promise<StudyChallengeRow>;

  /**
   * Flip a `pending` challenge to `accepted`, storing the final word sets and the
   * two generated deck ids.
   *
   * `status = 'pending'` in the WHERE makes it idempotent — a second accept matches
   * nothing and returns null rather than re-stamping `acceptedAt` and orphaning the
   * first pair of decks.
   */
  acceptChallenge(
    id: string,
    words: Record<string, ChallengeWord[]>,
    presetDeckIds: Record<string, number>,
    client?: PoolClient
  ): Promise<StudyChallengeRow | null>;

  /**
   * Move a challenge to a terminal status. `winnerUserId` is null for a draw and
   * for `no_contest`; `completedAt` is stamped for every terminal status so the
   * history log has one sort key.
   *
   * `fromStatuses` guards the transition, so every caller — the accept-deadline
   * pass, the window-close pass, the unfriend hook — is idempotent under the
   * re-runs `Persistent=true` produces after a missed tick.
   */
  resolveChallenge(
    id: string,
    status: ChallengeStatus,
    winnerUserId: string | null,
    fromStatuses: ChallengeStatus[],
    client?: PoolClient
  ): Promise<StudyChallengeRow | null>;

  /**
   * Delete a `pending` challenge outright — the challenger's withdraw (§ 1).
   *
   * A withdraw leaves NO history entry and no `withdrawn` status: nothing was
   * agreed and no decks exist, so there is nothing to record. Deleting also frees
   * the pair's (pair, week) slot immediately, which is the stated behaviour and the
   * one repair for a challenge issued to the wrong friend or into the wrong
   * language.
   */
  deletePending(id: string, challengerId: string, client?: PoolClient): Promise<boolean>;

  /**
   * ⚠️ THE ONLY WRITER OF `rounds`. See the interface header.
   *
   * Writes a round CLAIM (`completedAt: null`, at the player's first mark), a
   * progress update to a claim, or the FINAL row — all three are the same
   * statement, differing only in the `completedAt` the service stamps.
   *
   * Returns false when the slot holds a round that is already FINAL — which the
   * service turns into a rejection, not an overwrite (Q40: a completed round is
   * final, there are no replays).
   */
  recordRound(
    id: string,
    userId: string,
    roundIndex: number,
    round: ChallengeRound,
    client?: PoolClient
  ): Promise<boolean>;

  /** Forget one player's generated deck id, after that deck has been dropped (§ 4). */
  clearPresetDeckId(id: string, userId: string, client?: PoolClient): Promise<void>;

  /**
   * Rank challenge candidates for a pair (§ 3.1), newest exclusions applied.
   *
   * The DAL owns this query rather than the service because it is one ranked SQL
   * read over the det and both players' vet rows; the service owns the POLICY
   * around it — the level band, band widening on short supply, and the replacement
   * loop as words are struck.
   *
   * Contract:
   *  * only `discoverable` det rows, `difficulty` within [minLevel, maxLevel];
   *  * excludes any word EITHER user holds banded Target/Comfortable/Mastered on
   *    the CORE bar (the feature is core-only, Q3) — an Unfamiliar holding survives;
   *  * excludes `excludeWords` (already shown, or struck);
   *  * ranks words in BOTH players' libraries and Unfamiliar for both first (no
   *    half-credit tier, Q4), then `frequencyScore DESC NULLS LAST`, then `id ASC`
   *    so the same pair asking twice gets the same set.
   *
   * `userB` may be null for the per-player pass a different-word challenge uses,
   * in which case the band and the exclusions consult one player only (§ 8.1).
   */
  findCandidates(
    input: {
      userA: string;
      userB: string | null;
      language: string;
      minLevel: number;
      maxLevel: number;
      limit: number;
      excludeWords?: string[];
    },
    client?: PoolClient
  ): Promise<ChallengeCandidate[]>;

  /**
   * Resolve a challenge word back to its det id, or null.
   *
   * Needed because the challenge stores words as the denormalised (language, word1)
   * pair (Q49) while the shared "I already know this" write
   * (`StarterPacksService.sortCard`) is keyed by det id. The CHALLENGEE reviews a
   * stored set, so without this they could not strike at all — only the challenger,
   * who is looking at candidates that still carry their ids, could.
   *
   * Resolving late rather than storing the id is the right direction: the stored
   * identity has to survive a det data deploy, and this lookup simply misses (returns
   * null) if the word is gone — which degrades a strike to a no-op instead of writing
   * a mark against the wrong entry.
   */
  findEntryIdByWord(word1: string, language: string, client?: PoolClient): Promise<number | null>;

  /**
   * Everything needed to DRAW a stored challenge's words, as a `word1 -> fields` map.
   *
   * The challenge row stores word IDENTITY only (Q49), so every read path that has
   * to draw a word — the review screen the challengee accepts from, the detail
   * page's word set — has to resolve its display fields late, exactly like
   * `findEntryIdByWord` resolves the det id late. A word missing from the det
   * (un-flagged or removed by a data deploy) is simply absent from the map, which
   * renders as a bare word rather than failing the read.
   *
   * The set is the same one a candidate carries, so a stored word and a freshly
   * drawn replacement render through ONE card component: pronunciation, the lead
   * gloss, the conversation-frequency badge, the icon, and the det id.
   *
   * (Was `findPronunciationsByWords`, which returned pinyin alone — renamed when the
   * review screen moved to mini preview cards and needed the English too.)
   */
  findDisplayFieldsByWords(
    word1s: string[],
    language: string,
    client?: PoolClient
  ): Promise<Record<string, ChallengeWordDisplayFields>>;

  /**
   * Record one player's taunt on a RESOLVED challenge (§ 6a, migration 156).
   *
   * ⚠️ REPLACES the sender's slot; it is NOT write-once (that rule was dropped on
   * 2026-09-02 when the Taunt button became a cycler — see § 6a). Callers may write
   * as often as they like and the last write is what the opponent reads.
   *
   * The one rule still enforced in SQL is that the challenge must be `complete` or
   * `no_contest`, so "not before it is over" cannot be lost to a service that forgets
   * to check. Returns the updated row, or NULL when nothing matched — which the caller
   * must read as "not resolved yet", never as a failure to write.
   *
   * `tauntId` is a CHALLENGE_TAUNTS key; this layer does not validate it, the service
   * does, because the list is a contract and not a database concern.
   */
  setTaunt(
    id: string,
    userId: string,
    tauntId: string,
    client?: PoolClient
  ): Promise<StudyChallengeRow | null>;

  /**
   * Every `pending` challenge, for the maintenance job's accept-deadline pass.
   * Returns both players' timezones alongside the row, because the deadline is the
   * CHALLENGEE's local Wednesday 04:00 and the job cannot compute that without it.
   */
  listPendingWithTimezones(client?: PoolClient): Promise<StudyChallengeWithTimezones[]>;

  /**
   * Every `accepted` challenge, for the maintenance job's window-close pass. Same
   * reason for the timezones: the window closes on the LATER of the two players'
   * Monday 04:00, so both are needed.
   */
  listAcceptedWithTimezones(client?: PoolClient): Promise<StudyChallengeWithTimezones[]>;
}

/** A challenge row plus the two players' current timezones, for the time-triggered passes. */
export interface StudyChallengeWithTimezones extends StudyChallengeRow {
  challengerTimezone: string | null;
  challengeeTimezone: string | null;
}

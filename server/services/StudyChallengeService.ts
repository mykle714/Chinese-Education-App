import type { IStudyChallengeDAL } from '../dal/interfaces/IStudyChallengeDAL.js';
import type { IFriendshipDAL } from '../dal/interfaces/IFriendshipDAL.js';
import type { IDeckDAL } from '../dal/interfaces/IDeckDAL.js';
import type { StarterPacksService } from './StarterPacksService.js';
import type { DeckService } from './DeckService.js';
import { dbManager } from '../dal/base/DatabaseManager.js';
import type { TransactionRunner } from '../types/dal.js';
import { ValidationError, NotFoundError, DuplicateError } from '../types/dal.js';
import {
  CHALLENGE_WORD_COUNT,
  CHALLENGE_ROUND_COUNT,
  MAX_ACTIVE_CHALLENGES,
  challengeGamesForLanguages,
  challengeTauntText,
} from '../contracts/wire.js';
import type {
  ChallengeGameRef,
  ChallengeRound,
  ChallengeScoreBreakdown,
  ChallengeStatus,
  ChallengeVariant,
  ChallengeWord,
  Language,
} from '../contracts/wire.js';
import {
  acceptDeadline,
  isAcceptWindowOpen,
  isTestWindowOpen,
  latestTestWindowClose,
  localChallengeWeekIndex,
  resolveTimezone,
  testWindowClose,
  testWindowOpen,
} from '../shared/challengeWeek.js';
import type {
  ChallengeCandidate,
  ChallengeFriendRow,
  ChallengeRoundContext,
  ChallengeOpponent,
  ChallengeSummary,
  ChallengesPageResponse,
  ChallengeWordDisplayFields,
  StrikeReplacementContext,
  StudyChallengeRow,
} from '../types/studyChallenge.js';

/** A `users.id` is a v4 UUID; anything else can't be an account and is rejected before we query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How far the candidate band may widen before we accept a short set.
 *
 * The band widens outward one difficulty level at a time in BOTH directions when a
 * pair does not yield ten candidates (§ 3.1). Six is the number of difficulty
 * levels, so this bound can only be reached when the level range is already the
 * whole dictionary — at which point the supply really is exhausted and a short set
 * is the correct answer, not a refusal.
 */
const MAX_BAND_WIDENINGS = 6;

/**
 * Only the rounds a player has FINISHED (§ 5.1a).
 *
 * A round is claimed at its first mark and stays in `rounds` with a null
 * `completedAt` while it is being played, so any payload that shows one player's
 * rounds to the OTHER has to filter — otherwise the opponent watches a live score
 * climb mark by mark, which is exactly what the reveal-per-round rule (§ 6) does
 * not permit.
 */
function completedRounds(
  rounds: Record<string, ChallengeRound> | undefined
): Record<string, ChallengeRound> {
  const out: Record<string, ChallengeRound> = {};
  for (const [index, round] of Object.entries(rounds ?? {})) {
    if (round?.completedAt) out[index] = round;
  }
  return out;
}

/**
 * The narrow slice of the user table this feature reads — the CURRENT timezone (for
 * every boundary), the selected language (for a cross-language challengee), and the
 * public identity a challenge row renders.
 *
 * Declared as its own interface rather than taking the whole `IUserDAL`, following
 * ArenaService's `ArenaUserLookup` precedent: a feature that needs four fields
 * should not be coupled to every user write path. `timezone` is not on `UserProfile`
 * — it is a column the DAL returns but the wire contract deliberately never exposes
 * — which is the same reason ArenaService declares its own shape.
 */
export interface ChallengeUserLookup {
  findById(id: string): Promise<{
    id: string;
    name?: string;
    email?: string;
    timezone?: string;
    selectedLanguage?: string;
    avatarIconId?: string | null;
    /**
     * The TESTER flag (migration 104). Read here for one reason only: it is what
     * authorizes the `anytime` escape hatch below. A validator asking for it gets
     * it; anybody else asking for it is ignored, silently and without an error.
     */
    isValidator?: boolean;
  } | null>;
}

/**
 * THE TESTER ESCAPE HATCH — "allow anytime" (docs/STUDY_CHALLENGE.md § 2a).
 *
 * Study Challenge is a WEEKLY feature: issue on Monday, accept by Wednesday, play
 * Friday to Monday, one challenge per friend per week. That is the product, and it
 * makes the feature almost untestable — a change to the round runner can only be
 * exercised on a Friday, against a friend you have not already challenged this week.
 *
 * `anytime` lifts exactly the gates that are about the CALENDAR, plus the commitment
 * cap that would otherwise strand a tester mid-session:
 *
 *   * the accept deadline (Wednesday 04:00 local)
 *   * the test window (Friday 04:00 → Monday 04:00 local), including the rule that
 *     hides `gameSequence` until it opens
 *   * one challenge per pair per week
 *   * MAX_ACTIVE_CHALLENGES
 *
 * And nothing else. These stay enforced, because they are not clocks and lifting
 * them would test a game nobody plays:
 *
 *   * you must still be FRIENDS, and the per-pair block still suppresses challenges
 *   * rounds are still strictly sequential, still one attempt each, still claimed at
 *     the first mark and immutable once final
 *   * a round is still scored, stored and resolved exactly as it is in a real week
 *
 * ⚠️ IT IS A REQUEST, NOT A STATE. The client asks per call (`?anytime=1`, held in
 * that browser's localStorage) and the server honours it only for a validator. There
 * is deliberately no column: the flag is a testing convenience, not a property of the
 * account, and a stored one would eventually be left on by somebody and silently turn
 * a real week into a free-for-all. The consequence is accepted and stated in the UI —
 * the toggle is per-device, so turning it on for one player does not turn it on for
 * their opponent.
 *
 * Every method that enforces a window takes `anytime` as its last parameter and
 * resolves it through `resolveAnytime` — the ONLY place the validator check lives.
 */

/**
 * Study Challenge policy (docs/STUDY_CHALLENGE.md).
 *
 * LAYER: service. Owns every rule about a challenge — windows and timezones, the
 * commitment cap, candidate selection and replacement, the accept transaction,
 * round submission, winner resolution, and what each player is allowed to SEE.
 * Writes no SQL and touches no Express types (docs/BACKEND_LAYERING.md § 2).
 *
 * The rules, in one place:
 *   • ONE CHALLENGE PER PAIR PER WEEK, unordered. Enforced by a unique index on
 *     (pair key, weekIndex) — so the decline cooldown falls out of it for free: a
 *     declined row still holds its week. A withdraw DELETES the row and frees the
 *     slot, which is the only repair for a challenge sent to the wrong friend.
 *   • SIX ACTIVE, per (user, language), and only ever spent by your own decisions —
 *     checked on issue AND again on accept, never consumed by an invitation you did
 *     not ask for.
 *   • EVERY BOUNDARY IS RECOMPUTED from the challenge's anchor plus the player's
 *     CURRENT timezone. Nothing about a zone is snapshotted, so a player who
 *     travels sees correct deadlines immediately (Q50).
 *   • THE GAME SEQUENCE IS SERVER-GATED. It is drawn at issue and must not be
 *     serialized to a player before their own test window opens (Q63) — see
 *     `toSummary`, which is the only place a challenge becomes a payload.
 *   • THE CLIENT REPORTS THE SCORE AND THE SERVER STORES IT VERBATIM (§ 5.6). This
 *     is knowingly unverifiable: a challenge is between two people who chose each
 *     other as friends, and the mode is already on the honor system for "I already
 *     know this word". The upgrade path is to post the round's EVENTS and score them
 *     here; the stored round shape does not have to change for that.
 *   • A COMPLETED ROUND IS FINAL and rounds are strictly sequential (Q40). Both are
 *     enforced server-side: the DAL's path guard refuses a finalised slot, and round
 *     n+1 is refused until n is final, so a tampered client cannot skip to the last
 *     round nor run two rounds at once.
 *   • A ROUND IS CLAIMED AT THE PLAYER'S FIRST MARK, not when the run ends (§ 5.1a).
 *     The row exists with `completedAt: null` for the whole run, which is what makes
 *     the one-attempt rule survive a client that quits: `nextRoundIndex` walks past a
 *     claimed round, so its board is never issued again. Leaving the game finalises
 *     it where it stands.
 *
 * Depends on: StudyChallengeDAL (the table), FriendshipDAL (the friend graph and
 * the two block booleans), UserDAL (timezones + public identity), DeckService and
 * DeckDAL (the generated study decks), StarterPacksService (level estimate, and the
 * shared "already known" write).
 */
export class StudyChallengeService {
  constructor(
    private studyChallengeDAL: IStudyChallengeDAL,
    private friendshipDAL: IFriendshipDAL,
    private userDAL: ChallengeUserLookup,
    private deckDAL: IDeckDAL,
    private deckService: DeckService,
    private starterPacksService: StarterPacksService,
    /**
     * Injected, not the imported singleton — docs/BACKEND_LAYERING.md § 3. Defaulted
     * to `dbManager` so the composition root and every existing caller are unchanged.
     */
    private txRunner: TransactionRunner = dbManager
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The challenges page: ONE ROW PER FRIEND, always present, whether or not a
   * challenge is active (§ 1, Q43). The friend is the unit — the row is the whole
   * lifecycle of your standing with that person, so there is never a second place
   * to look.
   *
   * Language-scoped, deliberately: the row set is "friends who study this
   * language", matching the per-language partitioning decks, minute points and the
   * whole vet layer already use. The BADGE is the one thing that is not scoped
   * (Q48) — see `countBadge`.
   */
  async getChallengesPage(
    userId: string,
    language: Language,
    anytime = false
  ): Promise<ChallengesPageResponse> {
    if (!userId) throw new ValidationError('User ID is required');

    const now = new Date();
    const viewerTz = await this.timezoneOf(userId);
    // THE VIEWER'S OWN week, not the UTC counter's: "have we already had our turn
    // this week" is a question about this player's Monday, and their week opens at
    // 04:00 local like every other boundary in the app (shared/challengeWeek.ts).
    // Needed before the fetch below, because the resolved-rows query is scoped to it.
    const weekIndex = localChallengeWeekIndex(viewerTz, now);

    const [friends, live, resolvedThisWeek, activeCount] = await Promise.all([
      this.friendshipDAL.listFriends(userId),
      this.studyChallengeDAL.listLiveForUser(userId),
      // This week's already-finished challenges. They are not live, but their
      // results stay on the row until the next challenge period opens (§ 1).
      this.studyChallengeDAL.listResolvedForUserInWeek(userId, weekIndex),
      this.studyChallengeDAL.countActiveForUser(userId, language),
    ]);

    // Resolved ONCE for the whole page, not per row: it is one account-level question
    // and asking it per friend would be one user lookup per row.
    const anytimeOn = await this.resolveAnytime(userId, anytime);

    // Index the challenges by the OTHER player, so each friend row is a map lookup
    // rather than a scan of every challenge per friend.
    //
    // ORDER MATTERS: this week's RESOLVED rows go in first and a live row overwrites
    // one. The two can coexist only under the tester hatch, which parks a new
    // challenge in a future week while this week's is already finished (§ 2a) — and
    // when they do, the live one is the row's real lifecycle step; last week's
    // scoreboard is not.
    const rowByOpponent = new Map<string, StudyChallengeRow>();
    for (const row of [...resolvedThisWeek, ...live]) {
      const other = row.challengerId === userId ? row.challengeeId : row.challengerId;
      // A pair can hold at most one live challenge and at most one row per week (the
      // unique index), so a second hit within either list would be a data bug rather
      // than a case to merge.
      rowByOpponent.set(other, row);
    }

    const rows: ChallengeFriendRow[] = [];
    for (const friend of friends) {
      const row = rowByOpponent.get(friend.userId);
      const opponent: ChallengeOpponent = {
        userId: friend.userId,
        name: friend.name,
        email: friend.email,
        avatarIconId: friend.avatarIconId,
      };

      // The crown marks whoever won the pair's most recent RESOLVED challenge. A
      // draw or a no_contest leaves the previous champion in place, so this walks
      // back to the last row that actually named a winner rather than reading the
      // most recent row's (possibly null) winner.
      const lastResolved = await this.studyChallengeDAL.findLastResolvedForPair(userId, friend.userId);
      const championUserId = lastResolved?.winnerUserId ?? null;

      const { canChallenge, blockedReason, viewerBlocked } = await this.challengeability(
        userId, friend.userId, language, weekIndex, activeCount, row, anytimeOn
      );

      rows.push({
        friend: opponent,
        challenge: row ? await this.toSummary(row, userId, now, anytimeOn) : null,
        championUserId,
        canChallenge,
        blockedReason,
        viewerBlocked,
      });
    }

    return { rows, activeCount, maxActive: MAX_ACTIVE_CHALLENGES };
  }

  /**
   * How many challenges want the viewer's attention — the badge count.
   *
   * ⚠️ DELIBERATELY LANGUAGE-BLIND, and this is the one place in the feature where
   * the language scoping must be violated (Q48). The badge is a "look over here"
   * signal, not a challenge listing: there are no notifications of any kind, so
   * this badge chain (hp Friends row → Challenges row → the friend's row) is the
   * ONLY way a player learns a challenge exists. Scoping it would hide exactly the
   * cross-language challenge that is otherwise invisible, and the player would miss
   * their window in silence.
   */
  async countBadge(userId: string, anytime = false): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    const live = await this.studyChallengeDAL.listLiveForUser(userId);
    const now = new Date();
    const anytimeOn = await this.resolveAnytime(userId, anytime);
    const tz = await this.timezoneOf(userId);

    let count = 0;
    for (const row of live) {
      // An invitation awaiting THIS user's answer.
      if (row.status === 'pending' && row.challengeeId === userId
          && (anytimeOn || isAcceptWindowOpen(row.weekIndex, tz, now))) {
        count += 1;
        continue;
      }
      // An accepted challenge whose test window is open and which this user has not
      // finished — "your test is open".
      if (row.status === 'accepted' && (anytimeOn || isTestWindowOpen(row.weekIndex, tz, now))
          && !this.hasFinished(row, userId)) {
        count += 1;
      }
    }
    return count;
  }

  /** One challenge, from the caller's point of view, or NotFound. */
  async getChallenge(userId: string, challengeId: string, anytime = false): Promise<ChallengeSummary> {
    const row = await this.requireParty(userId, challengeId);
    return this.toSummary(row, userId, new Date(), await this.resolveAnytime(userId, anytime));
  }

  /**
   * Resolve the board context for the round this player is next allowed to play
   * (docs/STUDY_CHALLENGE.md § 5.2).
   *
   * ⚠️ THIS IS THE GATE FOR THE WHOLE TEST, and it is the only one — the game pool
   * reads call it before they will hand a challenge board out, and `submitRound`
   * re-checks the same invariants at the other end. Three things a client cannot be
   * trusted with, checked here rather than in the game page:
   *
   *  1. **Which round.** The round is DERIVED (the first unplayed one), never taken
   *     from the caller, so a tampered client cannot pull round 3's board and post
   *     it as round 1 — or replay a round it has already banked.
   *  2. **Which game.** The caller states the game it is about to run and it must
   *     equal the drawn sequence entry, mode included. Without this a player could
   *     play whichever of the three games they are best at, three times.
   *  3. **When.** `gameSequence` is hidden until the window opens (Q63) and a board
   *     is the sequence, one round at a time — so refusing outside the window is
   *     what stops the board read leaking what the payload withholds.
   *
   * The contested words are RE-MATERIALISED on the way out. They were materialised
   * once on accept, but `vocabEntryId` is a convenience pointer that may dangle
   * (Q54): a player who deleted a contested card during the study week must still
   * play it, so the ladder is idempotent-ensure rather than trust-the-pointer.
   */
  async getRoundContext(
    userId: string,
    challengeId: string,
    game?: ChallengeGameRef | null,
    anytime = false
  ): Promise<ChallengeRoundContext> {
    const row = await this.requireParty(userId, challengeId);
    if (row.status !== 'accepted') {
      throw new ValidationError('This challenge is not in its test window');
    }

    const now = new Date();
    const myTz = await this.timezoneOf(userId);
    // The WHEN gate, and the only one `anytime` touches here. The other two — which
    // round, which game — are about the shape of the test, not the calendar, so a
    // tester plays the same three rounds in the same order as everybody else.
    if (!await this.resolveAnytime(userId, anytime)
        && !isTestWindowOpen(row.weekIndex, myTz, now)) {
      throw new ValidationError('Your test window is not open');
    }

    const sequence = row.gameSequence ?? [];
    const roundCount = Math.min(sequence.length, CHALLENGE_ROUND_COUNT);
    const roundIndex = this.nextRoundIndex(row, userId);
    if (roundIndex > roundCount) {
      throw new ValidationError('You have already played every round of this test');
    }

    const drawn = sequence[roundIndex - 1];
    // `mode` is compared with `?? null` on both sides: a game with one mode stores
    // null and a query string cannot express it, so the two spellings must meet.
    if (game && (game.gameId !== drawn.gameId || (game.mode ?? null) !== (drawn.mode ?? null))) {
      throw new ValidationError(`Round ${roundIndex} of this test is not that game`);
    }

    const language = row.challengerId === userId ? row.challengerLanguage : row.challengeeLanguage;
    const words = (row.words?.[userId] ?? []) as ChallengeWord[];

    // One transaction for the whole set: `ensureLibraryEntry` promotes a provisional
    // row in place and touches nothing on a card the learner already owns, so this
    // is idempotent and safe to run before every round.
    const ids = await this.txRunner.executeInTransaction(async (tx) =>
      this.materialiseWords(userId, language, words, tx.getClient())
    );

    return {
      challengeId: row.id,
      roundIndex,
      game: drawn,
      language,
      // Positional pairing is the contract: a word whose det row has gone away
      // resolves to no vet id, and BOTH lists drop it so they stay aligned.
      words: words.filter((_, i) => ids[i] != null).map((w) => w.word1),
      vocabEntryIds: ids.filter((id): id is number => id != null),
    };
  }

  /**
   * The History log — every challenge the user has played, paginated.
   *
   * NOT language-scoped: it is a record of what you did, and hiding half of it
   * behind the active language would make a page whose whole purpose is
   * completeness lie about it.
   */
  async getHistory(
    userId: string,
    limit = 20,
    before?: string | null,
    anytime = false
  ): Promise<ChallengeSummary[]> {
    if (!userId) throw new ValidationError('User ID is required');
    const rows = await this.studyChallengeDAL.listHistoryForUser(userId, limit, before ?? null);
    const now = new Date();
    // Threaded so the log agrees with the page: without it a tester's live parked
    // challenge would read `expired` here and `pending` two taps away.
    const anytimeOn = await this.resolveAnytime(userId, anytime);
    return Promise.all(rows.map((row) => this.toSummary(row, userId, now, anytimeOn)));
  }

  /**
   * The ten words to review, for whichever side is looking.
   *
   * The challenger sees this before issuing; the challengee sees the set the
   * challenger confirmed. Both may strike words they already know, and every strike
   * is replaced from the same ranked list.
   */
  async getCandidates(
    userId: string,
    friendUserId: string,
    variant: ChallengeVariant,
    language: Language,
    struckWords: string[] = []
  ): Promise<ChallengeCandidate[]> {
    await this.requireFriend(userId, friendUserId);
    // A different-word set is built per player, so the band collapses to this one
    // player's level and the exclusions consult only them (§ 8.1).
    const otherId = variant === 'same_word' ? friendUserId : null;
    return this.buildCandidateSet(userId, otherId, language, struckWords);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Writes
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Issue a challenge. The challenger's ACTIVE language is the challenge's language
   * (Q38) — there is no language picker in the invite flow.
   *
   * `struckWords` are the words the challenger marked "I already know this" while
   * reviewing; each has already been written to their own card by `strikeWord`, and
   * they are excluded from the set that ships.
   */
  async issueChallenge(
    userId: string,
    friendUserId: string,
    variant: ChallengeVariant,
    language: Language,
    struckWords: string[] = [],
    anytime = false
  ): Promise<ChallengeSummary> {
    if (variant !== 'same_word' && variant !== 'different_word') {
      throw new ValidationError('Unknown challenge variant');
    }
    await this.requireFriend(userId, friendUserId);

    const now = new Date();
    const anytimeOn = await this.resolveAnytime(userId, anytime);
    const challengerTz = await this.timezoneOf(userId);
    // THE WEEK OPENS ON THE CHALLENGER'S OWN MONDAY 04:00, like every other boundary
    // in the app — not at the UTC counter's roll. The counter still NAMES the week
    // (it is the unique index's third column and must be one value for both
    // players); `localChallengeWeekIndex` only decides WHICH name a challenge issued
    // right now should carry. Stamping it from UTC instead meant an east-of-UTC
    // challenger issuing in the gap before the roll got the OUTGOING week, whose
    // accept deadline was five days in the past — a challenge born expired. See
    // shared/challengeWeek.ts.
    //
    // ANYTIME PARKS THE CHALLENGE IN THE PAIR'S NEXT FREE WEEK, and it has to: the
    // pair-week rule is not only an app check, it is a UNIQUE INDEX
    // (`study_challenges_pair_week_uniq`). Skipping the check alone would just move
    // the refusal from a clear message to a constraint violation, so a tester issuing
    // a second challenge to the same friend gets the next unused counter value
    // instead. Its deadlines then sit in the future, which is exactly the state
    // `anytime` ignores. The accepted cost, stated so it is not a surprise: a parked
    // challenge OCCUPIES that future week for that pair, so a genuine challenge in it
    // is refused until the parked one is deleted.
    const currentWeek = localChallengeWeekIndex(challengerTz, now);
    const weekIndex = anytimeOn
      ? await this.nextFreeWeekForPair(userId, friendUserId, currentWeek)
      : currentWeek;

    // A cross-language pair can only play different-word, because a shared set is
    // impossible for them (Q29). The challengee's language is their own current one.
    const challengeeLanguage = await this.selectedLanguageOf(friendUserId);
    if (variant === 'same_word' && challengeeLanguage !== language) {
      // NOT a hard failure of the request: a same-word challenge is defined in the
      // challenger's language and the challengee simply cannot see it until they
      // switch (Q39, the accepted silent expiry). We still store THEIR language as
      // the challenger's, because a same-word challenge is one language by
      // definition — the two must not diverge on the row.
    }
    const storedChallengeeLanguage: Language =
      variant === 'same_word' ? language : (challengeeLanguage ?? language);

    // The draw happens NOW, at issue, so one draw is shared by both players — a
    // score comparison across different games is not a comparison. It is hidden
    // until each player's window opens (§ 5.1b), which `toSummary` enforces.
    const gameSequence = this.drawGameSequence(language, storedChallengeeLanguage);

    // The challenger's set. A same-word challenge writes the SAME ten entries under
    // both keys so one shape serves both variants and no read path branches; the
    // challengee's own set replaces theirs if they strike anything on accept.
    const candidates = await this.buildCandidateSet(
      userId,
      variant === 'same_word' ? friendUserId : null,
      language,
      struckWords
    );
    const challengerWords = this.toWordSet(candidates, language);
    const words: Record<string, ChallengeWord[]> = { [userId]: challengerWords };
    if (variant === 'same_word') {
      words[friendUserId] = challengerWords.map((w) => ({ ...w }));
    }

    // Everything above is computed BEFORE the transaction opens. It depends on none
    // of the gates, and the candidate draw is several queries — holding two advisory
    // locks across it would serialise unrelated pairs for no benefit.

    // ── The four gates, in the order a user would hit them ──
    //
    // ALL OF THEM, AND THE INSERT, RUN INSIDE ONE TRANSACTION HOLDING BOTH PLAYERS'
    // ADVISORY LOCKS. Gates 1a and 3 are a COUNT and a derived predicate — neither is
    // expressible as a constraint, so both were plain read-then-write and both were
    // reachable by two concurrent requests. Gate 1 has an index behind it and would
    // survive on its own; it is inside the same critical section because splitting the
    // gates across two transactions is how the next person reintroduces the bug.
    // See IStudyChallengeDAL.lockUsersForChallenge.
    const row = await this.txRunner.executeInTransaction(async (tx) => {
    const client = tx.getClient();
    await this.studyChallengeDAL.lockUsersForChallenge([userId, friendUserId], client);

    // 1. The pair's week. Any status counts, including declined/expired, which is
    //    what makes the decline cooldown work without a rate limiter. Under `anytime`
    //    the week chosen above is free by construction, so this cannot fire.
    const existing = await this.studyChallengeDAL.findForPairInWeek(userId, friendUserId, weekIndex, client);
    if (existing) {
      throw new DuplicateError('You already have a challenge with this friend this week');
    }

    // 1a. AT MOST ONE UNFINISHED CHALLENGE PER PAIR, whatever week it is named after.
    //     This is the guard that replaces what the UTC counter used to provide for
    //     free. Now that each player's week opens on their own Monday, a pair in two
    //     zones spends a few hours disagreeing about which week it is — and two
    //     different week indices never collide on `study_challenges_pair_week_uniq`,
    //     so without this check a crossing pair could once again end up with two live
    //     challenges, two decks and two cap slots (the migration-150 defect).
    //
    //     "Unfinished" is DERIVED, never the stored status: a challenge whose test
    //     window has closed is over even if the hourly job has not rewritten it yet,
    //     and reading `status` alone would block the new week's challenge until the
    //     job ran (forever on dev, where the timer is not installed). Same rule as
    //     everywhere else in this service — the read path never waits for the job.
    //     Not lifted by `anytime`: it is a data invariant the read path depends on
    //     (`getChallengesPage` keys live challenges by opponent), not a calendar.
    const live = await this.studyChallengeDAL.listLiveForUser(userId, client);
    const challengeeTz = await this.timezoneOf(friendUserId);
    const unfinished = live.find((row) => {
      const other = row.challengerId === userId ? row.challengeeId : row.challengerId;
      if (other !== friendUserId) return false;
      const tzA = row.challengerId === userId ? challengerTz : challengeeTz;
      const tzB = row.challengerId === userId ? challengeeTz : challengerTz;
      return latestTestWindowClose(row.weekIndex, tzA, tzB).getTime() > now.getTime();
    });
    if (unfinished) {
      throw new DuplicateError('You already have a challenge running with this friend');
    }

    // 2. The per-pair opt-out. Either player's flag suppresses challenges BOTH ways,
    //    which is the honest reading of opting out of a mutual commitment.
    if (await this.pairIsBlocked(userId, friendUserId)) {
      // Deliberately not "Bob blocked you" — a block is never disclosed to the
      // blocked friend (§ 1). The controller renders this as a neutral unavailable.
      throw new ValidationError('Challenges are not available with this friend');
    }

    // 3. The commitment cap, in THIS language. Lifted by `anytime` so a tester
    //    working through the flow repeatedly is not stranded six challenges in.
    const active = await this.studyChallengeDAL.countActiveForUser(userId, language, client);
    if (!anytimeOn && active >= MAX_ACTIVE_CHALLENGES) {
      throw new ValidationError(
        `You're already in ${MAX_ACTIVE_CHALLENGES} challenges this week`
      );
    }

      return this.studyChallengeDAL.createChallenge({
        challengerId: userId,
        challengeeId: friendUserId,
        variant,
        challengerLanguage: language,
        challengeeLanguage: storedChallengeeLanguage,
        gameSequence,
        words,
        weekIndex,
      }, client);
    });

    return this.toSummary(row, userId, now, anytimeOn);
  }

  /**
   * Accept a challenge — the ONE transaction that turns an agreement into state
   * (§ 3.3).
   *
   * Atomically: flip to `accepted`, materialise every contested word the player does
   * not already hold as a real `library` vet row, and create the generated study deck
   * on BOTH accounts. All three or none: a challenge that was accepted but whose
   * decks failed to appear would leave two players with no way to study and no way
   * to repair it.
   *
   * Why `library` and not `provisional` (Q8): accepting the set IS the sorting
   * decision. Both players saw all ten words, were invited to strike any they
   * already knew, and confirmed the rest — a stronger act of choosing than a
   * discover swipe, so there is nothing left for a later "keep these cards?" prompt
   * to ask. It is also the cheap option: `library` rows are visible to every
   * existing read, so the deck, All Cards, search, the flp and every game pool work
   * with no clause changes at all.
   */
  async acceptChallenge(
    userId: string,
    challengeId: string,
    struckWords: string[] = [],
    replacementWords: string[] = [],
    anytime = false
  ): Promise<ChallengeSummary> {
    const row = await this.requireParty(userId, challengeId);
    if (row.status !== 'pending') {
      throw new ValidationError('This challenge is no longer open');
    }
    if (row.challengeeId !== userId) {
      throw new ValidationError('Only the challenged player can accept');
    }

    const now = new Date();
    const anytimeOn = await this.resolveAnytime(userId, anytime);
    const myTz = await this.timezoneOf(userId);
    if (!anytimeOn && !isAcceptWindowOpen(row.weekIndex, myTz, now)) {
      throw new ValidationError('The time to accept this challenge has passed');
    }

    const myLanguage = row.challengeeLanguage;

    // The challengee's rejections reshape the set, and the FINAL set is the one they
    // accept — the challenger does not get a second veto (Q7). Safe because the
    // challengee can only ever REMOVE a word; every replacement comes from the same
    // server-ranked list.
    let myWords = row.words[userId] ?? [];
    if (struckWords.length > 0) {
      const kept = myWords.filter((w) => !struckWords.includes(w.word1));

      // THE WORDS THE CHALLENGEE SAW ARE THE WORDS THEY GET. Each strike already
      // asked the server for a named replacement and the reviewer accepted the set
      // WITH it on screen, so re-drawing here would swap words out from under a
      // decision that was just made. `replacementWords` is therefore honoured, not
      // recomputed — the client can only echo back words this server handed it.
      const seen = new Set([...struckWords, ...kept.map((w) => w.word1)]);
      const honoured: ChallengeCandidate[] = [];
      for (const word of replacementWords) {
        if (seen.has(word)) continue;                 // a dupe or a word already kept
        if (honoured.length >= CHALLENGE_WORD_COUNT - kept.length) break;
        // Resolve against the det so a fabricated word cannot enter the set. Not
        // filtered on `discoverable`, matching every other read of a challenge's
        // words (see StudyChallengeDAL.findEntryIdByWord).
        const entryId = await this.studyChallengeDAL.findEntryIdByWord(word, myLanguage);
        if (!entryId) continue;
        seen.add(word);
        honoured.push({
          dictionaryEntryId: entryId,
          word1: word,
          language: myLanguage,
          pronunciation: null,
          definition: null,
          difficulty: null,
          frequencyScore: null,
          iconId: null,
        });
      }

      // Top up only what the echo could not cover — an old client that sends no
      // replacements at all still gets a full set, which is the pre-existing
      // behaviour and the reason this is a fallback rather than a hard requirement.
      const short = CHALLENGE_WORD_COUNT - kept.length - honoured.length;
      const drawn = short > 0
        ? await this.buildCandidateSet(
            userId,
            row.variant === 'same_word' ? row.challengerId : null,
            myLanguage,
            [...seen],
            short
          )
        : [];

      myWords = this.toWordSet(
        [...kept.map(this.wordToCandidate), ...honoured, ...drawn],
        myLanguage
      );
    }

    const opponentId = row.challengerId;
    const words: Record<string, ChallengeWord[]> = {
      ...row.words,
      [userId]: myWords,
    };
    // A same-word challenge must keep ONE set. The challengee's strikes therefore
    // reshape both sides, which is exactly what "the final set is the one the
    // challengee accepts" means.
    if (row.variant === 'same_word') {
      words[opponentId] = myWords.map((w) => ({ ...w }));
    }

    const summary = await this.txRunner.executeInTransaction(async (tx) => {
      const client = tx.getClient();

      // Serialise against this player's other challenge operations before counting.
      // Both players are locked, not just the accepter, so this transaction cannot
      // interleave with an issue involving either of them.
      await this.studyChallengeDAL.lockUsersForChallenge([userId, opponentId], client);

      // The cap is checked AGAIN here, not only on issue (Q65). This is the second
      // half of "a slot is only ever spent by your own decisions": accepting is the
      // decision, and between issue and accept the user may have accepted five others.
      //
      // INSIDE the transaction, and inside the lock. It used to run before
      // `executeInTransaction` opened, so N simultaneous accepts all read the same
      // pre-accept count, all passed, and all created their decks — the cap is a
      // COUNT, which no constraint can enforce, so the critical section is the only
      // thing holding it.
      const active = await this.studyChallengeDAL.countActiveForUser(userId, myLanguage, client);
      if (!anytimeOn && active >= MAX_ACTIVE_CHALLENGES) {
        throw new ValidationError(
          `You're already in ${MAX_ACTIVE_CHALLENGES} challenges this week`
        );
      }

      // Materialise both players' sets and create both decks inside the same
      // transaction as the status flip. Note the deck insert and the
      // `presetDeckIds` write are therefore atomic, which is what makes the
      // maintenance job's orphan sweep (pass 4) a backstop rather than a fix for a
      // window this code would otherwise leave open.
      const presetDeckIds: Record<string, number> = {};
      for (const [playerId, playerWords] of Object.entries(words)) {
        const playerLanguage =
          playerId === row.challengerId ? row.challengerLanguage : row.challengeeLanguage;

        const vocabEntryIds = await this.materialiseWords(
          playerId, playerLanguage, playerWords, client
        );
        // Stamp the pointers back onto the word entries — a convenience pointer,
        // never an identity (Q54). It may dangle later and the challenge will not
        // care.
        playerWords.forEach((word, index) => {
          word.vocabEntryId = vocabEntryIds[index] ?? null;
        });

        const opponentName = await this.displayNameOf(
          playerId === row.challengerId ? row.challengeeId : row.challengerId
        );
        const deckId = await this.deckService.createPresetDeck(
          playerId,
          playerLanguage,
          `vs ${opponentName}`,
          vocabEntryIds.filter((id): id is number => id != null),
          client
        );
        presetDeckIds[playerId] = deckId;
      }

      const accepted = await this.studyChallengeDAL.acceptChallenge(
        challengeId, words, presetDeckIds, client
      );
      // Null means the row was no longer `pending` — another accept won the race.
      // Throwing rolls back the decks this attempt just created, which is precisely
      // why they are in the transaction.
      if (!accepted) throw new ValidationError('This challenge is no longer open');
      return accepted;
    });

    return this.toSummary(summary, userId, now, anytimeOn);
  }

  /**
   * Decline a pending challenge (challengee only).
   *
   * The row is KEPT, as `declined`, because it still holds the pair's (pair, week)
   * slot — that is the decline cooldown (§ 1). Any Mastered writes the challengee
   * made while reviewing the set persist; they were real statements about their own
   * knowledge (Q25).
   */
  async declineChallenge(userId: string, challengeId: string): Promise<void> {
    const row = await this.requireParty(userId, challengeId);
    if (row.challengeeId !== userId) {
      throw new ValidationError('Only the challenged player can decline');
    }
    const resolved = await this.studyChallengeDAL.resolveChallenge(
      challengeId, 'declined', null, ['pending']
    );
    if (!resolved) throw new ValidationError('This challenge is no longer open');
  }

  /**
   * Withdraw a pending challenge (challenger only) — the row is DELETED outright.
   *
   * No `withdrawn` status and no history entry: nothing was agreed and no decks
   * exist, so there is nothing to record. Deleting also frees the pair's slot
   * immediately, which makes this the only repair for a challenge issued to the
   * wrong friend or into a language the challengee does not study (Q39).
   */
  /**
   * Set this player's taunt on a resolved challenge (§ 6a, design F17).
   *
   * ⚠️ REPEATABLE since 2026-09-02: the results screen's Taunt button cycles the line
   * on every tap and posts the latest one (throttled client-side), so this overwrites
   * rather than refusing. "One taunt per player" survives only as a shape — the
   * sender owns exactly one slot — not as a write-once rule.
   *
   * Two rules, and only the first is enforced here:
   *   1. the id must be one this build knows — a client that sends anything else is
   *      either stale or hand-rolled, and storing an unresolvable key would put a
   *      permanently blank speech bubble on someone's results screen;
   *   2. only on a `complete` or `no_contest` challenge.
   *
   * Rule 2 lives in the DAL's WHERE clause rather than in a read-then-write here, so
   * two taps in flight at once cannot race past it. A no-op therefore means "not
   * resolved yet" and is NOT an error — there is nothing the caller can do about it
   * and nothing was lost.
   */
  async sendTaunt(
    userId: string,
    challengeId: string,
    tauntId: string,
    anytime = false
  ): Promise<ChallengeSummary> {
    const row = await this.requireParty(userId, challengeId);
    if (!challengeTauntText(tauntId)) {
      throw new ValidationError('Unknown taunt');
    }
    const updated = await this.studyChallengeDAL.setTaunt(challengeId, userId, tauntId);
    const anytimeOn = await this.resolveAnytime(userId, anytime);
    return this.toSummary(updated ?? row, userId, new Date(), anytimeOn);
  }

  async withdrawChallenge(userId: string, challengeId: string): Promise<void> {
    const row = await this.requireParty(userId, challengeId);
    if (row.challengerId !== userId) {
      throw new ValidationError('Only the challenger can withdraw');
    }
    const deleted = await this.studyChallengeDAL.deletePending(challengeId, userId);
    if (!deleted) throw new ValidationError('This challenge can no longer be withdrawn');
  }

  /**
   * Write one round — the CLAIM at the player's first mark, each subsequent
   * progress write, and the FINAL score, all through this one call (§ 5.1a). The
   * client reports, the server stores verbatim (§ 5.6) — nothing is recomputed here.
   *
   * `final` is what separates the three: false leaves `completedAt` null, which
   * marks the attempt as SPENT BUT STILL WRITABLE; true stamps it and closes the
   * round forever.
   *
   * ⚠️ WHY THE FIRST MARK WRITES A ROW AT ALL. The attempt has to exist in the
   * database before the run ends, or quitting the app is a free re-roll: the round
   * would still be missing, `nextRoundIndex` would still point at it, and the board
   * would be issued again. Claiming on the first mark moves the one-attempt rule out
   * of the client entirely — reloading, force-quitting or clearing local state all
   * leave the claim standing.
   *
   * Four invariants enforced server-side, because a client cannot be trusted with
   * any of them:
   *   1. the player's own test window must be open;
   *   2. rounds are STRICTLY SEQUENTIAL — round n+1 is refused until n is FINAL, so
   *      a tampered client cannot skip straight to the last round, nor run two
   *      rounds at once;
   *   3. a completed round is FINAL — the DAL's path guard refuses it, and a repeat
   *      is a rejection rather than an overwrite (Q40);
   *   4. `startedAt` is preserved by the DAL, so a later write cannot backdate the
   *      claim.
   *
   * On the player's LAST round the deck is dropped immediately and the challenge is
   * resolved if the opponent has also finished. Both happen here rather than in the
   * hourly job because both should be immediate rather than up to an hour late —
   * and both only on a FINAL write, since a claimed round is still being played.
   */
  async submitRound(
    userId: string,
    challengeId: string,
    roundIndex: number,
    score: number,
    breakdown: ChallengeScoreBreakdown,
    final = true,
    anytime = false
  ): Promise<ChallengeSummary> {
    const row = await this.requireParty(userId, challengeId);
    if (row.status !== 'accepted') {
      // Named rather than lumped under "not in its test window", which is what a
      // finished challenge used to be told — technically true (its window is over)
      // and useless to a player looking at a completed result.
      throw new ValidationError(
        row.status === 'complete' || row.status === 'no_contest'
          ? 'This challenge is already finished'
          : 'This challenge is not in its test window'
      );
    }
    if (!Number.isFinite(score)) throw new ValidationError('score must be a number');

    const now = new Date();
    const anytimeOn = await this.resolveAnytime(userId, anytime);
    const myTz = await this.timezoneOf(userId);
    if (!anytimeOn && !isTestWindowOpen(row.weekIndex, myTz, now)) {
      throw new ValidationError('Your test window is not open');
    }

    const sequence = row.gameSequence ?? [];
    const roundCount = Math.min(sequence.length, CHALLENGE_ROUND_COUNT);
    if (!Number.isInteger(roundIndex) || roundIndex < 1 || roundIndex > roundCount) {
      throw new ValidationError(`roundIndex must be between 1 and ${roundCount}`);
    }

    // PRESENCE, not completion — the same test `nextRoundIndex` and the round list on
    // the challenge card apply, so all three agree on which round is next.
    //
    // Requiring the previous round to be FINAL was tried and is wrong: a round whose
    // app was killed mid-run stays claimed forever (its board can never be re-issued,
    // so nothing can ever finalise it), and the player would be locked out of the rest
    // of their test by a crash. Two rounds being open at once is the lesser problem —
    // each writes its own slot, the order they finish in does not affect scoring, and
    // it takes a second tab to arrange.
    const mine = row.rounds[userId] ?? {};
    if (roundIndex > 1 && !mine[String(roundIndex - 1)]) {
      throw new ValidationError(`Round ${roundIndex - 1} has not been submitted yet`);
    }

    const game = sequence[roundIndex - 1];
    const round: ChallengeRound = {
      gameId: game.gameId,
      mode: game.mode,
      score,
      breakdown,
      // Overridden by the stored value when the slot already exists, so this is only
      // ever the CLAIM's timestamp (see StudyChallengeDAL.recordRound).
      startedAt: now.toISOString(),
      completedAt: final ? now.toISOString() : null,
    };

    const written = await this.studyChallengeDAL.recordRound(challengeId, userId, roundIndex, round);
    // False means the slot holds a round that is already final. A rejection, never
    // an overwrite — this is what makes the running total in the between-games
    // scoreboard mean something rather than being a provisional best-so-far.
    if (!written) throw new DuplicateError('That round has already been submitted');

    // Re-read: the row we hold predates our own write, and the opponent may have
    // finished in the meantime.
    const fresh = await this.studyChallengeDAL.findById(challengeId);
    if (!fresh) throw new NotFoundError('Challenge not found');

    // A claim/progress write ends here: the player is mid-round, so there is no deck
    // to drop and nothing to resolve.
    if (final && this.hasFinished(fresh, userId)) {
      // The deck's job is done the moment this player finishes; leaving it on the
      // decks list is clutter. Per PLAYER, not per challenge — the opponent's deck
      // may well still be live (§ 4).
      await this.dropPresetDeck(fresh, userId);
      const opponentId = fresh.challengerId === userId ? fresh.challengeeId : fresh.challengerId;
      if (this.hasFinished(fresh, opponentId)) {
        await this.resolveCompleted(fresh);
      }
    }

    const latest = await this.studyChallengeDAL.findById(challengeId);
    return this.toSummary(latest ?? fresh, userId, now, anytimeOn);
  }

  /**
   * Mark a word "I already know this" while reviewing a set (§ 3.2).
   *
   * ⚠️ THIS WRITES TO THE USER'S OWN CARD, through the SAME path discover's
   * Already-Learned bucket uses (`StarterPacksService.sortCard`, which fills the
   * core bar 8/8 and leaves reading and writing at 0). Two ways to say "I know this
   * word" that produced two different card states would be a bug waiting to be
   * discovered months later.
   *
   * There is deliberately NO CAP on strikes (Q44). The mechanism polices itself:
   * every strike permanently inflates the striker's own mastery record and removes
   * the word from discover and from every future challenge. The player who games
   * the picker is the only one harmed by it.
   */
  async strikeWord(
    userId: string,
    target: { dictionaryEntryId?: number; word1?: string },
    language: Language,
    replacement?: StrikeReplacementContext
  ): Promise<ChallengeCandidate | null> {
    // A word may be named EITHER way, because the two sides of the review flow hold
    // different handles: the challenger is looking at candidates that still carry
    // their det ids, while the challengee is looking at a STORED set that carries
    // only (language, word1) — the denormalised identity that survives a det data
    // deploy (Q49). Without the word1 path the challengee could not strike at all,
    // which would silently make § 3.2's "both players may strike" false.
    let entryId = target.dictionaryEntryId;
    if (!entryId && target.word1) {
      entryId = (await this.studyChallengeDAL.findEntryIdByWord(target.word1, language)) ?? undefined;
    }
    if (!Number.isInteger(entryId) || (entryId as number) <= 0) {
      throw new ValidationError('Invalid dictionary entry id');
    }

    // 'already-learned' is the bucket NAME the sort endpoint accepts; it persists as
    // the internal 'library' bucket plus the perfect core history.
    await this.starterPacksService.sortCard(userId, entryId as number, 'already-learned', language);

    // ── The replacement, drawn AFTER the Mastered write ──
    // Order matters: the sort above removes the struck word from this player's
    // discoverable supply, so drawing afterwards can never rank the same word
    // straight back in. Without a context the endpoint is still the old fire-and-
    // forget strike (the caller just wants the mark), so this stays optional.
    if (!replacement) return null;
    return this.drawReplacement(userId, language, replacement);
  }

  /**
   * One replacement word for a struck one — the per-strike half of § 3.2's
   * replacement loop.
   *
   * BOTH SIDES OF THE REVIEW FLOW USE THIS, which is the point: the challenger and
   * the challengee see a struck word swapped for a named word at the same moment,
   * instead of the challengee's list silently shrinking and the real replacement
   * appearing only inside the accept transaction. What differs is only where the
   * "other player" for the band comes from — a friend id before the challenge
   * exists, the stored row afterwards.
   *
   * `exclude` is everything currently on the reviewer's screen plus everything they
   * have struck this session, so the draw cannot return a word they can already see.
   */
  private async drawReplacement(
    userId: string,
    language: Language,
    context: StrikeReplacementContext
  ): Promise<ChallengeCandidate | null> {
    let otherUserId: string | null = null;
    let drawLanguage: Language = language;

    if (context.challengeId) {
      // Reviewing a stored set: the band and the language must come from the ROW,
      // not from the caller's current language — a same-word challenge is one
      // language by definition and the reviewer may have switched since.
      const row = await this.requireParty(userId, context.challengeId);
      drawLanguage = row.challengeeId === userId ? row.challengeeLanguage : row.challengerLanguage;
      if (row.variant === 'same_word') {
        otherUserId = row.challengerId === userId ? row.challengeeId : row.challengerId;
      }
    } else if (context.friendUserId) {
      await this.requireFriend(userId, context.friendUserId);
      if (context.variant !== 'different_word') otherUserId = context.friendUserId;
    } else {
      return null;
    }

    const drawn = await this.buildCandidateSet(
      userId,
      otherUserId,
      drawLanguage,
      context.exclude ?? [],
      1
    );
    // Null, not a throw: the discoverable supply can genuinely be exhausted (§ 3.1
    // lets a set be SHORT rather than refusing), and the strike itself succeeded.
    return drawn[0] ?? null;
  }

  /**
   * Set or clear the caller's half of the per-pair challenge opt-out (§ 1).
   *
   * OWNERSHIP IS SPLIT, THE EFFECT IS SYMMETRIC: each player may only touch their
   * own flag, so a blocked person cannot unblock themselves; but a challenge goes
   * through only when NEITHER flag is set, so setting yours also stops your own
   * outgoing challenges to that person. That is the honest reading — it means "I do
   * not want to play challenges with this person", not "don't let them challenge me".
   *
   * Setting it mid-challenge only blocks NEW challenges; the in-flight one plays out
   * (Q57). Unfriending remains the hard exit.
   */
  async setChallengeBlock(userId: string, friendUserId: string, blocked: boolean): Promise<void> {
    const friendship = await this.requireFriend(userId, friendUserId);
    const endpoint = friendship.requesterId === userId ? 'requester' : 'addressee';
    await this.friendshipDAL.setChallengesBlocked(friendship.id, endpoint, blocked);
  }

  /**
   * Resolve every in-flight challenge for a pair as `no_contest` and drop both
   * decks — the unfriend hook (§ 6, Q41).
   *
   * ⚠️ CALLED FROM INSIDE FriendsService's delete transaction, and it takes the
   * caller's client for exactly that reason: there must be no window in which a
   * challenge outlives the friendship it depended on.
   *
   * The unfriend itself is NEVER blocked by an active challenge — it is a
   * social-safety action and must always succeed on the first tap. The accepted cost
   * is that this is a rage-quit button: a player who is losing can unfriend to erase
   * the result. It resolves to `no_contest` rather than a forfeit win, so the escape
   * works; the mitigation is social, not technical.
   *
   * A RESOLVED challenge is untouched — the history entry and the crown survive,
   * because the record is of something that actually happened.
   */
  async resolveForUnfriend(
    userA: string,
    userB: string,
    client?: import('pg').PoolClient
  ): Promise<void> {
    const live = await this.studyChallengeDAL.listLiveForUser(userA, client);
    for (const row of live) {
      const other = row.challengerId === userA ? row.challengeeId : row.challengerId;
      if (other !== userB) continue;

      await this.studyChallengeDAL.resolveChallenge(
        row.id, 'no_contest', null, ['pending', 'accepted'], client
      );
      // Both decks go, not just the unfriender's: the challenge is over for both
      // sides, so neither deck has a purpose. The words stay on both accounts —
      // they are `library` cards now and are not challenge state.
      for (const [playerId, deckId] of Object.entries(row.presetDeckIds ?? {})) {
        await this.deckDAL.deleteDeck(playerId, deckId, client);
        // Forget the pointer as well as dropping the deck, so `presetDeckIds` only
        // ever names decks that exist. A stale id would be harmless (cleanup treats
        // it as a no-op, and the orphan sweep is defined the other way round), but a
        // column that lies is a column the next reader has to be warned about.
        await this.studyChallengeDAL.clearPresetDeckId(row.id, playerId, client);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Turn a row into the payload one player is allowed to see.
   *
   * ⚠️ THIS IS THE ONLY PLACE A CHALLENGE BECOMES A PAYLOAD, and it is where two
   * visibility rules are enforced. Both must be here rather than in the client:
   *
   *  1. `gameSequence` is OMITTED until this player's own test window opens (Q63).
   *     A client that merely declines to render it still ships the answer to anyone
   *     who opens the network tab.
   *  2. The opponent's SCORES are omitted until BOTH players have finished (§ 6).
   *     Only their PROGRESS ("has played") is ever visible beforehand, because
   *     whoever plays second must play against the game and never against a number
   *     — otherwise the mode quietly rewards playing late.
   *
   * It is also where the LAPSED-ACCEPT state is derived. See `status` below.
   */
  private async toSummary(
    row: StudyChallengeRow,
    userId: string,
    now: Date,
    /** Tester escape hatch, ALREADY RESOLVED (see `resolveAnytime`). */
    anytime = false
  ): Promise<ChallengeSummary> {
    const isChallenger = row.challengerId === userId;
    const opponentId = isChallenger ? row.challengeeId : row.challengerId;
    const myLanguage = isChallenger ? row.challengerLanguage : row.challengeeLanguage;

    const myWords = row.words?.[userId] ?? [];

    const [myTz, challengeeTz, opponent, display] = await Promise.all([
      this.timezoneOf(userId),
      this.timezoneOf(row.challengeeId),
      this.opponentOf(opponentId),
      // The stored word set is identity only (Q49), so everything needed to DRAW a
      // word is resolved HERE, on the way out — otherwise the review screen the
      // challengee accepts from renders Chinese with no pinyin and no English, while
      // the challenger's identical screen (built from candidates) shows both. One
      // query per challenge, and a word whose det row has gone away simply misses.
      myWords.length > 0
        ? this.studyChallengeDAL.findDisplayFieldsByWords(
            myWords.map((w) => w.word1),
            myLanguage
          )
        : Promise.resolve({} as Record<string, ChallengeWordDisplayFields>),
    ]);

    const acceptDeadlineAt = acceptDeadline(row.weekIndex, challengeeTz);

    /**
     * THE STATUS IS DERIVED, NOT READ (§ 2, Q50). A `pending` row whose accept
     * deadline has passed is ALREADY expired — the maintenance job
     * (`database/cron/expire-study-challenges.sql`, pass 1) only writes that fact
     * down durably, it does not create it. Trusting the stored value here made the
     * challenge lapse *at the hourly cron's convenience*: the challengee's row kept
     * offering "Review words" in green after their Wednesday 04:00, and tapping it
     * ran into `acceptChallenge`'s own deadline check — a control that exists only
     * to produce an error. On a machine where the timer is not installed at all
     * (dev, and prod until `install-timers.sh` re-renders the unit) it never
     * lapsed at all.
     *
     * Deriving it here fixes every surface at once, because this is the only place
     * a row becomes a payload. The same rule already governed `countBadge`, which
     * is why the badge and the row disagreed.
     */
    const status: ChallengeStatus = row.status === 'pending'
      && !anytime
      && now.getTime() >= acceptDeadlineAt.getTime()
        ? 'expired'
        : row.status;

    // `anytime` opens the window rather than skipping the check, so everything
    // downstream — `gameSequence` visibility included — follows from one boolean.
    const windowOpen = anytime || isTestWindowOpen(row.weekIndex, myTz, now);
    const opponentFinished = this.hasFinished(row, opponentId);
    const sequence = row.gameSequence ?? [];

    return {
      id: row.id,
      variant: row.variant,
      status,
      isChallenger,
      opponent,
      language: myLanguage,
      words: myWords.map((word) => ({
        ...word,
        // Spread the det fields rather than picking them one by one, so adding a
        // field to ChallengeWordDisplayFields reaches the client without a second
        // edit here. `?? {}` keeps a word whose det row is gone as a bare word.
        ...(display[word.word1] ?? {}),
      })),
      rounds: row.rounds?.[userId] ?? {},
      opponentFinished,
      /**
       * ⚠️ RULE 2 WAS REVERSED (design F15b/F15d). A round is now revealed AS SOON AS
       * IT IS COMPLETE, rather than being withheld until both players finished.
       *
       * The old rule existed to stop the second player anchoring on a target score.
       * It was dropped because View Challenge is now two pages — yours, then theirs —
       * and a page that stayed blank for four days is not a page, it is a promise. The
       * cost is real and accepted: whoever plays second can see what they are chasing.
       * What is still protected is a round IN PROGRESS. Since the claim model (§ 5.1a)
       * `rounds` DOES hold unfinished rounds, so this is no longer free: the opponent's
       * side is filtered to COMPLETED rounds only (`completedRounds`), or a player
       * could watch their opponent's score climb mark by mark.
       *
       * If anchoring turns out to matter, the narrow fix is to gate each round on the
       * viewer having submitted the same index — not to restore the all-or-nothing
       * gate, which is what made the page empty.
       */
      opponentRounds: completedRounds(row.rounds?.[opponentId]),
      /**
       * Both taunts, keyed by user id — the same shape as `words` and `rounds`, so the
       * results screen reads either side without an `isChallenger` branch (§ 6a).
       * Always present: a taunt is only renderable once the challenge is complete, and
       * the client is what enforces that, since there is nothing here to protect.
       */
      taunts: row.taunts ?? {},
      presetDeckId: row.presetDeckIds?.[userId] ?? null,
      // Rule 1. `undefined`, not an empty array: an empty array would read as "this
      // challenge has no games" and a client could not tell the two apart.
      gameSequence: windowOpen || row.completedAt ? sequence : undefined,
      roundCount: Math.min(sequence.length, CHALLENGE_ROUND_COUNT),
      deadlines: {
        acceptDeadline: acceptDeadlineAt.toISOString(),
        testOpensAt: testWindowOpen(row.weekIndex, myTz).toISOString(),
        testClosesAt: testWindowClose(row.weekIndex, myTz).toISOString(),
      },
      issuedAt: row.issuedAt,
      completedAt: row.completedAt,
      winnerUserId: row.winnerUserId,
    };
  }

  /**
   * Build a ranked set of `CHALLENGE_WORD_COUNT` candidates, WIDENING THE BAND
   * rather than ever refusing (§ 3.1).
   *
   * The band starts at [min(levelA, levelB), max(...)] — order-independent — and
   * widens outward one level at a time in BOTH directions until ten candidates
   * exist or the discoverable supply is exhausted. Widening is symmetric so it does
   * not quietly become one player's challenge; if the supply runs out entirely the
   * set is SHORT, and being short it is worth fewer points to both sides equally.
   *
   * New players are never gated. A cold-start `estimateLevel` is just a band anchor;
   * the "in both libraries" preference finds nothing and falls straight through to
   * commonality, which is the right answer for a beginner anyway — the most common
   * words are the correct challenge set.
   */
  private async buildCandidateSet(
    userId: string,
    otherUserId: string | null,
    language: Language,
    excludeWords: string[] = [],
    limit = CHALLENGE_WORD_COUNT
  ): Promise<ChallengeCandidate[]> {
    const levels = await Promise.all([
      this.starterPacksService.estimateLevel(userId, language),
      otherUserId ? this.starterPacksService.estimateLevel(otherUserId, language) : null,
    ]);
    const levelA = levels[0];
    const levelB = levels[1] ?? levels[0];

    let minLevel = Math.min(levelA, levelB);
    let maxLevel = Math.max(levelA, levelB);

    for (let widening = 0; widening <= MAX_BAND_WIDENINGS; widening += 1) {
      const candidates = await this.studyChallengeDAL.findCandidates({
        userA: userId,
        userB: otherUserId,
        language,
        minLevel,
        maxLevel,
        limit,
        excludeWords,
      });
      if (candidates.length >= limit) return candidates.slice(0, limit);

      // Nothing left to widen INTO — the band already spans the whole dictionary, so
      // the supply is genuinely exhausted and the short set is the answer.
      if (minLevel <= 1 && maxLevel >= 6) return candidates;
      minLevel = Math.max(1, minLevel - 1);
      maxLevel = Math.min(6, maxLevel + 1);
    }

    // Unreachable in practice (the bound above returns first); kept so the function
    // has one exit type rather than relying on the loop to always return.
    return this.studyChallengeDAL.findCandidates({
      userA: userId, userB: otherUserId, language, minLevel: 1, maxLevel: 6, limit, excludeWords,
    });
  }

  /**
   * Draw the game sequence: without repetition, capped at `CHALLENGE_ROUND_COUNT`,
   * from the games playable in BOTH players' languages (§ 5.1, § 8.3).
   *
   * If fewer than three qualify the test is simply that many rounds — the format
   * bends, it does not block. That is why the count is derived from the drawn
   * sequence everywhere downstream rather than assumed to be 3.
   */
  private drawGameSequence(languageA: Language, languageB: Language): ChallengeGameRef[] {
    const pool = challengeGamesForLanguages(languageA, languageB);
    // Fisher-Yates over a copy. With three eligible entries today the draw has one
    // possible answer as a SET but a real order, and it is genuinely random the day
    // a fourth recognition/production game ships — with no code change here.
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled
      .slice(0, CHALLENGE_ROUND_COUNT)
      .map((game) => ({ gameId: game.gameId, mode: game.mode }));
  }

  /** Candidates → the stored word entries, positioned 1..n. `vocabEntryId` fills in on accept. */
  private toWordSet(candidates: ChallengeCandidate[], language: Language): ChallengeWord[] {
    return candidates.slice(0, CHALLENGE_WORD_COUNT).map((candidate, index) => ({
      position: index + 1,
      word1: candidate.word1,
      language,
      vocabEntryId: null,
    }));
  }

  /** A stored word back into candidate shape, so a kept word and a replacement rank alike. */
  private wordToCandidate = (word: ChallengeWord): ChallengeCandidate => ({
    dictionaryEntryId: 0,
    word1: word.word1,
    language: word.language,
    pronunciation: null,
    definition: null,
    difficulty: null,
    frequencyScore: null,
    iconId: null,
  });

  /**
   * Ensure each contested word exists as a `library` vet row for this player, and
   * return their ids positionally (null where the word could not be resolved).
   *
   * Idempotent per word: a player who already holds the card keeps it exactly as it
   * is — same bucket, same marks, same selected sense. Materialising must never
   * reset a card the learner already owns.
   */
  private async materialiseWords(
    userId: string,
    language: string,
    words: ChallengeWord[],
    client: import('pg').PoolClient
  ): Promise<(number | null)[]> {
    const ids: (number | null)[] = [];
    for (const word of words) {
      const id = await this.starterPacksService.ensureLibraryEntry(
        userId, word.word1, language, client
      );
      ids.push(id);
    }
    return ids;
  }

  /**
   * The 1-based round this player plays next — one past their last submitted round.
   *
   * Derived by walking UP from 1 rather than counting the keys, because rounds are
   * strictly sequential (§ 5.1a) and a count would answer "3" for a rounds object
   * holding {1,3} — a shape the server refuses to create but which a future replay
   * or repair path could. Walking finds the first hole, which is the only safe
   * answer.
   *
   * ⚠️ PRESENCE, NOT COMPLETION — and that is the anti-manipulation rule. A round
   * CLAIMED at its first mark is present, so this walks past it and its board is
   * never issued again. Reloading the tab mid-round therefore does not hand the
   * player a fresh board; the attempt is spent where it stands (§ 5.1a).
   */
  private nextRoundIndex(row: StudyChallengeRow, userId: string): number {
    const mine = row.rounds?.[userId] ?? {};
    let index = 1;
    while (mine[String(index)]) index += 1;
    return index;
  }

  /**
   * Has this player FINISHED every round of the test?
   *
   * A claimed-but-unfinished round does not count. It is a spent attempt, but the
   * player is still in it, and treating it as finished would drop their deck and
   * resolve the whole challenge out from under a live game.
   */
  private hasFinished(row: StudyChallengeRow, userId: string): boolean {
    const sequence = row.gameSequence ?? [];
    const roundCount = Math.min(sequence.length, CHALLENGE_ROUND_COUNT);
    if (roundCount === 0) return false;
    const mine = row.rounds?.[userId] ?? {};
    for (let i = 1; i <= roundCount; i += 1) {
      if (!mine[String(i)]?.completedAt) return false;
    }
    return true;
  }

  /**
   * A player's total across their rounds. May be negative — scores are unclamped (Q15).
   *
   * Counts a CLAIMED round's banked score too. The points are real — they were
   * earned by marks the player actually made — and a player who walked away from
   * their last round must still be scored on it when the window-close pass resolves
   * the challenge, or abandoning would be cheaper than finishing.
   */
  private totalFor(row: StudyChallengeRow, userId: string): number {
    return Object.values(row.rounds?.[userId] ?? {}).reduce((sum, r) => sum + (r.score ?? 0), 0);
  }

  /**
   * Both players finished: declare the winner, or a DRAW.
   *
   * Ties are a plain draw with no hidden tiebreak (Q16), and a draw stores a null
   * `winnerUserId` — which is also what leaves the reigning champion in place.
   */
  private async resolveCompleted(row: StudyChallengeRow): Promise<void> {
    const challengerTotal = this.totalFor(row, row.challengerId);
    const challengeeTotal = this.totalFor(row, row.challengeeId);
    const winnerUserId =
      challengerTotal === challengeeTotal
        ? null
        : challengerTotal > challengeeTotal ? row.challengerId : row.challengeeId;

    await this.studyChallengeDAL.resolveChallenge(row.id, 'complete', winnerUserId, ['accepted']);
  }

  /** Drop one player's generated deck and forget its id. Safe to call twice. */
  private async dropPresetDeck(row: StudyChallengeRow, userId: string): Promise<void> {
    const deckId = row.presetDeckIds?.[userId];
    if (!deckId) return;
    await this.deckDAL.deleteDeck(userId, deckId);
    await this.studyChallengeDAL.clearPresetDeckId(row.id, userId);
  }

  /**
   * Whether this friend can be challenged right now, and what to tell the user.
   *
   * Only the CAP is disclosed with its real reason — it is the one unavailable state
   * that is genuinely the user's own doing, so unlike a block it should explain
   * itself. A block surfaces as the neutral 'unavailable', because a visible
   * "Bob blocked you" is worse than a quiet absence (§ 1).
   */
  private async challengeability(
    userId: string,
    friendUserId: string,
    language: Language,
    weekIndex: number,
    activeCount: number,
    /**
     * The pair's current row, if any — live (`pending`/`accepted`) OR resolved this
     * week. Either way it means "this row already has its own lifecycle control".
     */
    currentRow: StudyChallengeRow | undefined,
    /** Tester escape hatch, ALREADY RESOLVED — lifts the cap and the pair-week rule. */
    anytime = false
  ): Promise<Pick<ChallengeFriendRow, 'canChallenge' | 'blockedReason' | 'viewerBlocked'>> {
    const friendship = await this.friendshipDAL.findBetween(userId, friendUserId);
    const viewerBlocked = friendship
      ? (friendship.requesterId === userId
          ? !!friendship.requesterChallengesBlocked
          : !!friendship.addresseeChallengesBlocked)
      : false;
    const eitherBlocked = friendship
      ? !!friendship.requesterChallengesBlocked || !!friendship.addresseeChallengesBlocked
      : false;

    // A current challenge is not a "blocked" state — the row already shows its own
    // lifecycle control (Review words / Play test / Waiting on them / See results),
    // so there is nothing to explain. This covers a challenge that has already
    // RESOLVED this week: it cannot be re-issued either, but "See results" is a far
    // better answer than the 'declined-this-week' reason below.
    if (currentRow) return { canChallenge: false, blockedReason: null, viewerBlocked };
    // The block is NOT lifted by `anytime` — it is a person's decision about another
    // person, not a clock, and a tester flag must never override it.
    if (eitherBlocked) return { canChallenge: false, blockedReason: 'unavailable', viewerBlocked };
    if (!anytime && activeCount >= MAX_ACTIVE_CHALLENGES) {
      return { canChallenge: false, blockedReason: 'at-cap', viewerBlocked };
    }

    // A resolved row still occupies the pair's week — the decline cooldown, and the
    // "already played this week" rule, are the same fact. Lifted by `anytime`, and it
    // is the gate that matters most to a tester: without it you get ONE challenge per
    // friend per week and then cannot exercise the flow again until Monday.
    if (!anytime) {
      const thisWeek = await this.studyChallengeDAL.findForPairInWeek(userId, friendUserId, weekIndex);
      if (thisWeek) return { canChallenge: false, blockedReason: 'declined-this-week', viewerBlocked };
    }

    return { canChallenge: true, blockedReason: null, viewerBlocked };
  }

  /** True when either player has opted out of challenges with the other. */
  private async pairIsBlocked(userA: string, userB: string): Promise<boolean> {
    const friendship = await this.friendshipDAL.findBetween(userA, userB);
    if (!friendship) return false;
    // The OR is where the symmetry lives: one flag suppresses challenges both ways.
    return !!friendship.requesterChallengesBlocked || !!friendship.addresseeChallengesBlocked;
  }

  /** Load a challenge the caller is a party to, or 404. */
  private async requireParty(userId: string, challengeId: string): Promise<StudyChallengeRow> {
    if (!challengeId || !UUID_RE.test(challengeId)) {
      throw new ValidationError('Invalid challenge ID');
    }
    const row = await this.studyChallengeDAL.findById(challengeId);
    // A caller who guesses another pair's challenge id gets 404, never someone
    // else's challenge — the same rule FriendsService applies to request ids.
    if (!row || (row.challengerId !== userId && row.challengeeId !== userId)) {
      throw new NotFoundError('Challenge not found');
    }
    return row;
  }

  /** The pair must be accepted friends. Returns the friendship so callers can read its flags. */
  private async requireFriend(userId: string, friendUserId: string) {
    if (!friendUserId || !UUID_RE.test(friendUserId)) {
      throw new ValidationError('Invalid user ID');
    }
    if (friendUserId === userId) throw new ValidationError('You cannot challenge yourself');
    const friendship = await this.friendshipDAL.findBetween(userId, friendUserId);
    if (!friendship || friendship.status !== 'accepted') {
      throw new NotFoundError('You are not friends with this user');
    }
    return friendship;
  }

  /**
   * A player's CURRENT timezone — never a snapshot (Q50). Falls back to UTC via
   * `resolveTimezone`, so a garbage client-set value degrades to a defined boundary
   * rather than failing a read the user cannot repair.
   */
  /**
   * May THIS caller have the tester escape hatch, and did they ask for it?
   *
   * Both halves matter. A non-validator asking is ignored **silently** — no error,
   * no hint — because a 403 here would be a probe for who holds the flag; they simply
   * get the ordinary weekly rules, which is what they would have got anyway.
   *
   * See the `anytime` block at the top of this file for exactly what it lifts.
   */
  private async resolveAnytime(userId: string, requested: boolean): Promise<boolean> {
    if (!requested) return false;
    const user = await this.userDAL.findById(userId);
    return !!user?.isValidator;
  }

  /**
   * The first week counter at or after `from` in which this pair holds no challenge.
   *
   * ONLY for the `anytime` tester path — see `issueChallenge`. Walks forward one week
   * at a time because the pair-week unique index is the thing being satisfied, and a
   * pair has at most a handful of rows; the bound is a runaway guard, not a limit
   * anybody should reach. If it IS reached the caller gets the ordinary duplicate
   * error, which is the honest answer at that point.
   */
  private async nextFreeWeekForPair(
    userId: string,
    friendUserId: string,
    from: number
  ): Promise<number> {
    const MAX_LOOKAHEAD_WEEKS = 52;
    for (let week = from; week < from + MAX_LOOKAHEAD_WEEKS; week += 1) {
      const taken = await this.studyChallengeDAL.findForPairInWeek(userId, friendUserId, week);
      if (!taken) return week;
    }
    return from;
  }

  private async timezoneOf(userId: string): Promise<string> {
    const user = await this.userDAL.findById(userId);
    return resolveTimezone(user?.timezone);
  }

  /** A player's selected language, defaulting to the app-wide default. */
  private async selectedLanguageOf(userId: string): Promise<Language | null> {
    const user = await this.userDAL.findById(userId);
    return (user?.selectedLanguage as Language) ?? null;
  }

  /** What a generated deck is named after — the opponent, which is what learners remember. */
  private async displayNameOf(userId: string): Promise<string> {
    const user = await this.userDAL.findById(userId);
    return user?.name || user?.email?.split('@')[0] || 'friend';
  }

  /** The opponent's public identity for a challenge row. */
  private async opponentOf(userId: string): Promise<ChallengeOpponent> {
    const user = await this.userDAL.findById(userId);
    return {
      userId,
      name: user?.name ?? null,
      email: user?.email ?? '',
      avatarIconId: user?.avatarIconId ?? null,
    };
  }
}

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
  challengeWeekStart,
  isAcceptWindowOpen,
  isTestWindowOpen,
  latestTestWindowClose,
  resolveTimezone,
  testWindowClose,
  testWindowOpen,
} from '../shared/challengeWeek.js';
import type {
  ChallengeCandidate,
  ChallengeFriendRow,
  ChallengeOpponent,
  ChallengeSummary,
  ChallengesPageResponse,
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
  } | null>;
}

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
 *     (pair key, weekStart) — so the decline cooldown falls out of it for free: a
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
 *   • A SUBMITTED ROUND IS FINAL and rounds are strictly sequential (Q40). Both are
 *     enforced server-side: the DAL's write is insert-only, and round n+1 is refused
 *     until n is present, so a tampered client cannot skip to the last round.
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
  async getChallengesPage(userId: string, language: Language): Promise<ChallengesPageResponse> {
    if (!userId) throw new ValidationError('User ID is required');

    const [friends, live, activeCount] = await Promise.all([
      this.friendshipDAL.listFriends(userId),
      this.studyChallengeDAL.listLiveForUser(userId),
      this.studyChallengeDAL.countActiveForUser(userId, language),
    ]);

    const now = new Date();
    const viewerTz = await this.timezoneOf(userId);
    const weekStart = challengeWeekStart(now, viewerTz);

    // Index the live challenges by the OTHER player, so each friend row is a map
    // lookup rather than a scan of every challenge per friend.
    const liveByOpponent = new Map<string, StudyChallengeRow>();
    for (const row of live) {
      const other = row.challengerId === userId ? row.challengeeId : row.challengerId;
      // A pair can hold at most one live challenge (the unique index), so a second
      // hit would be a data bug rather than a case to merge.
      liveByOpponent.set(other, row);
    }

    const rows: ChallengeFriendRow[] = [];
    for (const friend of friends) {
      const row = liveByOpponent.get(friend.userId);
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
        userId, friend.userId, language, weekStart, activeCount, row
      );

      rows.push({
        friend: opponent,
        challenge: row ? await this.toSummary(row, userId, now) : null,
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
  async countBadge(userId: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    const live = await this.studyChallengeDAL.listLiveForUser(userId);
    const now = new Date();
    const tz = await this.timezoneOf(userId);

    let count = 0;
    for (const row of live) {
      const weekStart = new Date(row.weekStart);
      // An invitation awaiting THIS user's answer.
      if (row.status === 'pending' && row.challengeeId === userId
          && isAcceptWindowOpen(weekStart, tz, now)) {
        count += 1;
        continue;
      }
      // An accepted challenge whose test window is open and which this user has not
      // finished — "your test is open".
      if (row.status === 'accepted' && isTestWindowOpen(weekStart, tz, now)
          && !this.hasFinished(row, userId)) {
        count += 1;
      }
    }
    return count;
  }

  /** One challenge, from the caller's point of view, or NotFound. */
  async getChallenge(userId: string, challengeId: string): Promise<ChallengeSummary> {
    const row = await this.requireParty(userId, challengeId);
    return this.toSummary(row, userId, new Date());
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
    before?: string | null
  ): Promise<ChallengeSummary[]> {
    if (!userId) throw new ValidationError('User ID is required');
    const rows = await this.studyChallengeDAL.listHistoryForUser(userId, limit, before ?? null);
    const now = new Date();
    return Promise.all(rows.map((row) => this.toSummary(row, userId, now)));
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
    struckWords: string[] = []
  ): Promise<ChallengeSummary> {
    if (variant !== 'same_word' && variant !== 'different_word') {
      throw new ValidationError('Unknown challenge variant');
    }
    await this.requireFriend(userId, friendUserId);

    const now = new Date();
    const challengerTz = await this.timezoneOf(userId);
    const weekStart = challengeWeekStart(now, challengerTz);

    // ── The three gates, in the order a user would hit them ──
    // 1. The pair's week. Any status counts, including declined/expired, which is
    //    what makes the decline cooldown work without a rate limiter.
    const existing = await this.studyChallengeDAL.findForPairInWeek(userId, friendUserId, weekStart);
    if (existing) {
      throw new DuplicateError('You already have a challenge with this friend this week');
    }

    // 2. The per-pair opt-out. Either player's flag suppresses challenges BOTH ways,
    //    which is the honest reading of opting out of a mutual commitment.
    if (await this.pairIsBlocked(userId, friendUserId)) {
      // Deliberately not "Bob blocked you" — a block is never disclosed to the
      // blocked friend (§ 1). The controller renders this as a neutral unavailable.
      throw new ValidationError('Challenges are not available with this friend');
    }

    // 3. The commitment cap, in THIS language.
    const active = await this.studyChallengeDAL.countActiveForUser(userId, language);
    if (active >= MAX_ACTIVE_CHALLENGES) {
      throw new ValidationError(
        `You're already in ${MAX_ACTIVE_CHALLENGES} challenges this week`
      );
    }

    // A cross-language pair can only play different-word, because a shared set is
    // impossible for them (Q29). The challengee's language is their own current one.
    const challengeeTz = await this.timezoneOf(friendUserId);
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

    const row = await this.studyChallengeDAL.createChallenge({
      challengerId: userId,
      challengeeId: friendUserId,
      variant,
      challengerLanguage: language,
      challengeeLanguage: storedChallengeeLanguage,
      gameSequence,
      words,
      weekStart,
    });

    void challengeeTz; // resolved above so a bad tz fails here, not at deadline render
    return this.toSummary(row, userId, now);
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
    struckWords: string[] = []
  ): Promise<ChallengeSummary> {
    const row = await this.requireParty(userId, challengeId);
    if (row.status !== 'pending') {
      throw new ValidationError('This challenge is no longer open');
    }
    if (row.challengeeId !== userId) {
      throw new ValidationError('Only the challenged player can accept');
    }

    const now = new Date();
    const weekStart = new Date(row.weekStart);
    const myTz = await this.timezoneOf(userId);
    if (!isAcceptWindowOpen(weekStart, myTz, now)) {
      throw new ValidationError('The time to accept this challenge has passed');
    }

    // The cap is checked AGAIN here, not only on issue (Q65). This is the second
    // half of "a slot is only ever spent by your own decisions": accepting is the
    // decision, and between issue and accept the user may have accepted five others.
    const myLanguage = row.challengeeLanguage;
    const active = await this.studyChallengeDAL.countActiveForUser(userId, myLanguage);
    if (active >= MAX_ACTIVE_CHALLENGES) {
      throw new ValidationError(
        `You're already in ${MAX_ACTIVE_CHALLENGES} challenges this week`
      );
    }

    // The challengee's rejections reshape the set, and the FINAL set is the one they
    // accept — the challenger does not get a second veto (Q7). Safe because the
    // challengee can only ever REMOVE a word; every replacement comes from the same
    // server-ranked list.
    let myWords = row.words[userId] ?? [];
    if (struckWords.length > 0) {
      const kept = myWords.filter((w) => !struckWords.includes(w.word1));
      const replacements = await this.buildCandidateSet(
        userId,
        row.variant === 'same_word' ? row.challengerId : null,
        myLanguage,
        [...struckWords, ...kept.map((w) => w.word1)],
        CHALLENGE_WORD_COUNT - kept.length
      );
      myWords = this.toWordSet(
        [...kept.map(this.wordToCandidate), ...replacements],
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

    return this.toSummary(summary, userId, now);
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
  async withdrawChallenge(userId: string, challengeId: string): Promise<void> {
    const row = await this.requireParty(userId, challengeId);
    if (row.challengerId !== userId) {
      throw new ValidationError('Only the challenger can withdraw');
    }
    const deleted = await this.studyChallengeDAL.deletePending(challengeId, userId);
    if (!deleted) throw new ValidationError('This challenge can no longer be withdrawn');
  }

  /**
   * Submit one round's score. The client reports, the server stores verbatim
   * (§ 5.6) — nothing is recomputed here.
   *
   * Three invariants enforced server-side, because a client cannot be trusted with
   * any of them:
   *   1. the player's own test window must be open;
   *   2. rounds are STRICTLY SEQUENTIAL — round n+1 is refused until n exists, so a
   *      tampered client cannot skip straight to the last round;
   *   3. a submitted round is FINAL — the DAL's write is insert-only, and a repeat
   *      is a rejection rather than an overwrite (Q40).
   *
   * On the player's LAST round the deck is dropped immediately and the challenge is
   * resolved if the opponent has also finished. Both happen here rather than in the
   * hourly job because both should be immediate rather than up to an hour late.
   */
  async submitRound(
    userId: string,
    challengeId: string,
    roundIndex: number,
    score: number,
    breakdown: ChallengeScoreBreakdown
  ): Promise<ChallengeSummary> {
    const row = await this.requireParty(userId, challengeId);
    if (row.status !== 'accepted') {
      throw new ValidationError('This challenge is not in its test window');
    }
    if (!Number.isFinite(score)) throw new ValidationError('score must be a number');

    const now = new Date();
    const weekStart = new Date(row.weekStart);
    const myTz = await this.timezoneOf(userId);
    if (!isTestWindowOpen(weekStart, myTz, now)) {
      throw new ValidationError('Your test window is not open');
    }

    const sequence = row.gameSequence ?? [];
    const roundCount = Math.min(sequence.length, CHALLENGE_ROUND_COUNT);
    if (!Number.isInteger(roundIndex) || roundIndex < 1 || roundIndex > roundCount) {
      throw new ValidationError(`roundIndex must be between 1 and ${roundCount}`);
    }

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
      completedAt: now.toISOString(),
    };

    const written = await this.studyChallengeDAL.recordRound(challengeId, userId, roundIndex, round);
    // False means the slot was already filled. A rejection, never an overwrite —
    // this is what makes the running total in the between-games scoreboard mean
    // something rather than being a provisional best-so-far.
    if (!written) throw new DuplicateError('That round has already been submitted');

    // Re-read: the row we hold predates our own write, and the opponent may have
    // finished in the meantime.
    const fresh = await this.studyChallengeDAL.findById(challengeId);
    if (!fresh) throw new NotFoundError('Challenge not found');

    if (this.hasFinished(fresh, userId)) {
      // The deck's job is done the moment this player finishes; leaving it on the
      // decks list is clutter. Per PLAYER, not per challenge — the opponent's deck
      // may well still be live (§ 4).
      await this.dropPresetDeck(fresh, userId);
      const opponentId = fresh.challengerId === userId ? fresh.challengeeId : fresh.challengerId;
      if (this.hasFinished(fresh, opponentId)) {
        await this.resolveCompleted(fresh);
      }
    }

    const final = await this.studyChallengeDAL.findById(challengeId);
    return this.toSummary(final ?? fresh, userId, now);
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
    language: Language
  ): Promise<void> {
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
   */
  private async toSummary(
    row: StudyChallengeRow,
    userId: string,
    now: Date
  ): Promise<ChallengeSummary> {
    const isChallenger = row.challengerId === userId;
    const opponentId = isChallenger ? row.challengeeId : row.challengerId;
    const myLanguage = isChallenger ? row.challengerLanguage : row.challengeeLanguage;

    const [myTz, challengeeTz, opponent] = await Promise.all([
      this.timezoneOf(userId),
      this.timezoneOf(row.challengeeId),
      this.opponentOf(opponentId),
    ]);

    const weekStart = new Date(row.weekStart);
    const windowOpen = isTestWindowOpen(weekStart, myTz, now);
    const opponentFinished = this.hasFinished(row, opponentId);
    const bothFinished = opponentFinished && this.hasFinished(row, userId);
    const sequence = row.gameSequence ?? [];

    return {
      id: row.id,
      variant: row.variant,
      status: row.status,
      isChallenger,
      opponent,
      language: myLanguage,
      words: row.words?.[userId] ?? [],
      rounds: row.rounds?.[userId] ?? {},
      opponentFinished,
      // Rule 2. Present only once the comparison is legitimate — which includes
      // every resolved challenge, since a resolved one is either complete (both
      // played) or over (nothing left to protect).
      opponentRounds: bothFinished || row.completedAt
        ? row.rounds?.[opponentId] ?? {}
        : undefined,
      presetDeckId: row.presetDeckIds?.[userId] ?? null,
      // Rule 1. `undefined`, not an empty array: an empty array would read as "this
      // challenge has no games" and a client could not tell the two apart.
      gameSequence: windowOpen || row.completedAt ? sequence : undefined,
      roundCount: Math.min(sequence.length, CHALLENGE_ROUND_COUNT),
      deadlines: {
        acceptDeadline: acceptDeadline(weekStart, challengeeTz).toISOString(),
        testOpensAt: testWindowOpen(weekStart, myTz).toISOString(),
        testClosesAt: testWindowClose(weekStart, myTz).toISOString(),
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

  /** Has this player submitted every round of the test? */
  private hasFinished(row: StudyChallengeRow, userId: string): boolean {
    const sequence = row.gameSequence ?? [];
    const roundCount = Math.min(sequence.length, CHALLENGE_ROUND_COUNT);
    if (roundCount === 0) return false;
    const mine = row.rounds?.[userId] ?? {};
    for (let i = 1; i <= roundCount; i += 1) {
      if (!mine[String(i)]) return false;
    }
    return true;
  }

  /** A player's total across their submitted rounds. May be negative — scores are unclamped (Q15). */
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
    weekStart: Date,
    activeCount: number,
    liveRow: StudyChallengeRow | undefined
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

    // A live challenge is not a "blocked" state — the row already shows its own
    // lifecycle control (Review words / Play test / Waiting on them), so there is
    // nothing to explain.
    if (liveRow) return { canChallenge: false, blockedReason: null, viewerBlocked };
    if (eitherBlocked) return { canChallenge: false, blockedReason: 'unavailable', viewerBlocked };
    if (activeCount >= MAX_ACTIVE_CHALLENGES) {
      return { canChallenge: false, blockedReason: 'at-cap', viewerBlocked };
    }

    // A resolved row still occupies the pair's week — the decline cooldown, and the
    // "already played this week" rule, are the same fact.
    const thisWeek = await this.studyChallengeDAL.findForPairInWeek(userId, friendUserId, weekStart);
    if (thisWeek) return { canChallenge: false, blockedReason: 'declined-this-week', viewerBlocked };

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

import {
  SENTENCE_TILES_DAILY_JUDGE_LIMIT,
  SENTENCE_TILES_GLOBAL_DAILY_JUDGE_LIMIT,
  SENTENCE_TILES_MAX_ACTIVE_GAMES,
  SENTENCE_TILES_MAX_REJECTED_PER_TURN,
  SENTENCE_TILES_RACK_SIZE,
  SENTENCE_TILES_SCORELESS_END,
} from '../contracts/sentenceTiles.js';
import type {
  SentenceTilesDirection,
  SentenceTilesGameSummary,
  SentenceTilesGameView,
  SentenceTilesMoveResponse,
  SentenceTilesMoveView,
  SentenceTilesPlacement,
  SentenceTilesRackTile,
  SentenceTilesWordInfo,
} from '../contracts/sentenceTiles.js';
import type {
  ISentenceTilesDAL,
  SentenceTilesGameRow,
  SentenceTilesGameState,
  SentenceTilesVerdictRow,
} from '../dal/interfaces/ISentenceTilesDAL.js';
import type { IFriendshipDAL } from '../dal/interfaces/IFriendshipDAL.js';
import type { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { dbManager } from '../dal/base/DatabaseManager.js';
import {
  ConflictError,
  DALError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  type TransactionRunner,
} from '../types/dal.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation } from '../utils/definitions.js';
import { buildBag, draw, refillInPlace, shuffle, sumPoints, tilePoints } from './sentenceTiles/bag.js';
import { PlayRuleError, lineKey, resolvePlay, scoreLine } from './sentenceTiles/rules.js';
import { judgeLine } from './sentenceTiles/sentenceJudge.js';
import { ZH_TILES } from './sentenceTiles/tileSet.zh.js';

/**
 * Sentence Tiles — game policy (docs/SENTENCE_TILES_GAME.md).
 *
 * A correspondence game between two friends. playerA (the challenger) creates the game and
 * plays the opening; the game stays invisible to the opponent until then ('draft'). The
 * opponent's first move of any kind is the accept ('pending' → 'active'); they may decline
 * instead. The server holds the bag and both racks; a client only ever sees its own rack.
 *
 * ── Who may play (testing phase) ──
 * Feature testers only (`users.isFeatureTester`), checked on every endpoint. Both players must
 * be testers and accepted friends.
 *
 * ── AI spend protection (§ "Abuse protection") ──
 * Only a line never judged before costs a model call; every verdict is cached by line. Before a
 * call, in order:
 *   1. the line is built server-side from rack + board tiles (no client text reaches the model);
 *   2. the player has fewer than MAX_REJECTED_PER_TURN rejections this turn;
 *   3. the rolling 24 h global ceiling has room;
 *   4. the game has no judge call in flight (claimJudge — one atomic UPDATE with a version check);
 *   5. the player's daily budget has room (reserveJudgeCall — one atomic conditional upsert).
 * A call that never reached Anthropic is refunded. The global write limiter
 * (middleware/rateLimits.ts → writeLimiter) bounds raw request volume behind all of this.
 *
 * ── Concurrency ──
 * Every state change runs in a transaction holding the game row (`FOR UPDATE`). A play is
 * judged OUTSIDE any transaction (a model call takes seconds), then applied in a second one
 * that re-checks the version it was judged against; if the game moved on meanwhile the play is
 * refused with a 409.
 *
 * LAYER: service. Depends on ISentenceTilesDAL, IFriendshipDAL, IDictionaryDAL (word display
 * facts), a user lookup (tester flag), and a TransactionRunner.
 */

/** The slice of IUserDAL this service reads. */
export interface SentenceTilesUserLookup {
  findById(userId: string): Promise<{ isFeatureTester?: boolean } | null>;
}

/** A judge marker older than this is treated as abandoned (server restart mid-call). */
const JUDGE_STALE_SECONDS = 60;
/** Games returned by the list. */
const LIST_LIMIT = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SentenceTilesService {
  /** word → display facts, loaded once per process for the whole tile set (see wordInfo). */
  private wordInfoPromise: Promise<Map<string, SentenceTilesWordInfo>> | null = null;

  constructor(
    private dal: ISentenceTilesDAL,
    private friendshipDAL: IFriendshipDAL,
    private dictionaryDAL: IDictionaryDAL,
    private userDAL: SentenceTilesUserLookup,
    private txRunner: TransactionRunner = dbManager
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  async listGames(userId: string): Promise<SentenceTilesGameSummary[]> {
    await this.assertTester(userId);
    const rows = await this.dal.listGamesForUser(userId, LIST_LIMIT);
    return rows.map(({ game, opponent }) => {
      const isA = game.playerAId === userId;
      return {
        id: game.id,
        status: game.status,
        opponent: { ...opponent, score: isA ? game.scoreB : game.scoreA },
        yourScore: isA ? game.scoreA : game.scoreB,
        youAreChallenger: isA,
        isYourTurn: game.turnUserId === userId,
        winnerId: game.winnerId,
        updatedAt: new Date(game.updatedAt).toISOString(),
      };
    });
  }

  /**
   * The game as `userId` may see it. With `sinceVersion`, returns null when nothing changed —
   * the heartbeat poll's cheap path (the controller answers 204).
   */
  async getGame(userId: string, gameId: string, usageDate: string, sinceVersion?: number): Promise<SentenceTilesGameView | null> {
    await this.assertTester(userId);
    const game = await this.loadParticipantGame(userId, gameId);
    if (sinceVersion !== undefined && game.version === sinceVersion) return null;
    return this.buildView(userId, game, usageDate);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  /** Create a draft against a friend and deal both racks. The challenger moves first. */
  async createGame(userId: string, opponentId: string, usageDate: string): Promise<SentenceTilesGameView> {
    await this.assertTester(userId);
    if (typeof opponentId !== 'string' || !UUID_RE.test(opponentId)) throw new ValidationError('opponentId is required');
    if (opponentId === userId) throw new ValidationError("You can't challenge yourself");

    const friendship = await this.friendshipDAL.findBetween(userId, opponentId);
    if (!friendship || friendship.status !== 'accepted') {
      throw new ValidationError('You can only challenge a friend');
    }
    const opponent = await this.userDAL.findById(opponentId);
    if (!opponent?.isFeatureTester) {
      throw new ValidationError("Sentence Tiles is still in testing; your friend can't play yet");
    }

    const game = await this.txRunner.executeInTransaction(async (tx) => {
      const client = tx.getClient();
      // The cap is a COUNT, so it is checked under an advisory lock on both users
      // (docs/API_ABUSE_HARDENING.md § 1a).
      await this.dal.lockUsers([userId, opponentId], client);
      if ((await this.dal.countUnfinishedGames(userId, client)) >= SENTENCE_TILES_MAX_ACTIVE_GAMES) {
        throw new ValidationError(`You already have ${SENTENCE_TILES_MAX_ACTIVE_GAMES} games going. Finish one first.`);
      }
      if ((await this.dal.countUnfinishedGames(opponentId, client)) >= SENTENCE_TILES_MAX_ACTIVE_GAMES) {
        throw new ValidationError('Your friend has too many games going right now.');
      }
      const bag = buildBag();
      const rackA = draw(bag, SENTENCE_TILES_RACK_SIZE);
      const rackB = draw(bag, SENTENCE_TILES_RACK_SIZE);
      return this.dal.insertGame(
        { language: 'zh', playerAId: userId, playerBId: opponentId, turnUserId: userId, rackA, rackB, bag },
        client
      );
    });
    return this.buildView(userId, game, usageDate);
  }

  /** The opponent turns down a challenge they have not answered yet. */
  async decline(userId: string, gameId: string, usageDate: string): Promise<SentenceTilesMoveResponse> {
    return this.endEarly(userId, gameId, usageDate, (game) => {
      if (game.status !== 'pending' || game.playerBId !== userId) throw new ValidationError('There is no challenge to decline');
      return 'declined';
    });
  }

  /** The challenger withdraws a game the opponent has not accepted yet. */
  async cancel(userId: string, gameId: string, usageDate: string): Promise<SentenceTilesMoveResponse> {
    return this.endEarly(userId, gameId, usageDate, (game) => {
      if (!(game.status === 'draft' || game.status === 'pending') || game.playerAId !== userId) {
        throw new ValidationError('Only an unaccepted challenge can be withdrawn');
      }
      return 'cancelled';
    });
  }

  /** Concede an active game. The opponent wins. */
  async resign(userId: string, gameId: string, usageDate: string): Promise<SentenceTilesMoveResponse> {
    await this.assertTester(userId);
    const game = await this.txRunner.executeInTransaction(async (tx) => {
      const client = tx.getClient();
      const g = await this.requireGameForUpdate(userId, gameId, client);
      if (g.status !== 'active') throw new ValidationError('Only a game in progress can be resigned');
      const turnNumber = (await this.dal.countCompletedTurns(g.id, client)) + 1;
      await this.dal.insertMove(
        { gameId: g.id, userId, turnNumber, kind: 'resign', placements: null, lineWords: null, points: 0 },
        client
      );
      return this.dal.saveState(
        g.id,
        { ...stateOf(g), status: 'finished', turnUserId: null, winnerId: otherPlayer(g, userId), finished: true },
        client
      );
    });
    return { outcome: 'accepted', game: await this.buildView(userId, game, usageDate) };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Moves
  // ───────────────────────────────────────────────────────────────────────────

  /** Place tiles. The line is judged (cache first), then applied or logged as rejected. */
  async playTiles(
    userId: string,
    gameId: string,
    placements: SentenceTilesPlacement[],
    direction: SentenceTilesDirection,
    usageDate: string
  ): Promise<SentenceTilesMoveResponse> {
    await this.assertTester(userId);

    // ── Phase 1: validate against a snapshot (no lock; phase 3 re-checks the version) ──
    const snapshot = await this.loadParticipantGame(userId, gameId);
    assertYourMove(snapshot, userId);
    const turnNumber = (await this.dal.countCompletedTurns(snapshot.id)) + 1;
    const rejected = await this.dal.countRejected(snapshot.id, userId, turnNumber);
    if (rejected >= SENTENCE_TILES_MAX_REJECTED_PER_TURN) {
      throw new ValidationError(`That's ${SENTENCE_TILES_MAX_REJECTED_PER_TURN} rejected lines this turn. Exchange tiles or pass.`);
    }
    const { lineWords } = this.resolveOrThrow(snapshot, userId, placements, direction, turnNumber);
    const key = lineKey(lineWords);

    // ── Phase 2: the verdict — cached, or one guarded model call ──
    const verdict = (await this.dal.findVerdict(snapshot.language, key)) ?? (await this.judgeFresh(snapshot, userId, lineWords, usageDate));

    // ── Phase 3: apply against the locked row, if it has not moved on ──
    let points = 0;
    const game = await this.txRunner.executeInTransaction(async (tx) => {
      const client = tx.getClient();
      const g = await this.requireGameForUpdate(userId, gameId, client);
      if (g.version !== snapshot.version) {
        await this.dal.releaseJudge(g.id, client);
        throw new ConflictError('The game changed while your line was being judged. Reload and try again.');
      }
      const resolved = this.resolveOrThrow(g, userId, placements, direction, turnNumber);

      if (!verdict.legal) {
        await this.dal.insertMove(
          {
            gameId: g.id, userId, turnNumber, kind: 'rejected',
            placements: resolved.placed.map(({ tileId, row, col, word }) => ({ tileId, row, col, word })),
            lineWords, points: 0,
          },
          client
        );
        await this.dal.releaseJudge(g.id, client);
        return g; // a rejection does not change the game, so no version bump
      }

      points = scoreLine(lineWords);
      const isA = g.playerAId === userId;
      const placedIds = new Set(resolved.placed.map((t) => t.tileId));
      const bag = [...g.bag];
      // Each placed tile's slot gets the new draw, so the kept tiles stay where they were.
      const rack = refillInPlace(isA ? g.rackA : g.rackB, placedIds, bag);

      const state: SentenceTilesGameState = {
        ...stateOf(g),
        board: [...g.board, ...resolved.placed],
        bag,
        rackA: isA ? rack : g.rackA,
        rackB: isA ? g.rackB : rack,
        scoreA: g.scoreA + (isA ? points : 0),
        scoreB: g.scoreB + (isA ? 0 : points),
        scorelessTurns: 0,
      };
      await this.dal.insertMove(
        {
          gameId: g.id, userId, turnNumber, kind: 'play',
          placements: resolved.placed.map(({ tileId, row, col, word }) => ({ tileId, row, col, word })),
          lineWords, points,
        },
        client
      );
      // Going out: the mover's rack and the bag are both empty.
      const wentOut = rack.length === 0 && bag.length === 0;
      return this.dal.saveState(g.id, advanceTurn(g, userId, state, wentOut ? 'wentOut' : null), client);
    });

    return {
      outcome: verdict.legal ? 'accepted' : 'rejected',
      lineWords,
      reason: verdict.reason,
      points,
      game: await this.buildView(userId, game, usageDate),
    };
  }

  /** Swap tiles with the bag. Scores nothing; counts toward the scoreless-turn end. */
  async exchange(userId: string, gameId: string, tileIds: number[], usageDate: string): Promise<SentenceTilesMoveResponse> {
    await this.assertTester(userId);
    if (!Array.isArray(tileIds) || tileIds.length === 0 || !tileIds.every(Number.isInteger)) {
      throw new ValidationError('Pick at least one tile to exchange');
    }
    if (new Set(tileIds).size !== tileIds.length) throw new ValidationError('A tile was picked twice');

    const game = await this.txRunner.executeInTransaction(async (tx) => {
      const client = tx.getClient();
      const g = await this.requireGameForUpdate(userId, gameId, client);
      assertYourMove(g, userId);
      const isA = g.playerAId === userId;
      const rack = isA ? g.rackA : g.rackB;
      const returning = tileIds.map((id) => rack.find((t) => t.id === id));
      if (returning.some((t) => !t)) throw new ValidationError('That tile is not in your rack');
      if (g.bag.length < tileIds.length) throw new ValidationError(`Only ${g.bag.length} tiles are left in the bag`);

      // Draw first, then return the old tiles, so a player never redraws what they gave back.
      const bag = [...g.bag];
      const newRack = refillInPlace(rack, new Set(tileIds), bag);
      bag.push(...(returning as SentenceTilesRackTile[]));
      shuffle(bag);

      const turnNumber = (await this.dal.countCompletedTurns(g.id, client)) + 1;
      await this.dal.insertMove(
        {
          gameId: g.id, userId, turnNumber, kind: 'exchange',
          placements: (returning as SentenceTilesRackTile[]).map((t) => ({ tileId: t.id, word: t.word })),
          lineWords: null, points: 0,
        },
        client
      );
      const state: SentenceTilesGameState = {
        ...stateOf(g),
        bag,
        rackA: isA ? newRack : g.rackA,
        rackB: isA ? g.rackB : newRack,
        scorelessTurns: g.scorelessTurns + 1,
      };
      return this.dal.saveState(g.id, advanceTurn(g, userId, state, null), client);
    });
    return { outcome: 'accepted', game: await this.buildView(userId, game, usageDate) };
  }

  /** Skip the turn. Scores nothing; counts toward the scoreless-turn end. */
  async pass(userId: string, gameId: string, usageDate: string): Promise<SentenceTilesMoveResponse> {
    await this.assertTester(userId);
    const game = await this.txRunner.executeInTransaction(async (tx) => {
      const client = tx.getClient();
      const g = await this.requireGameForUpdate(userId, gameId, client);
      assertYourMove(g, userId);
      const turnNumber = (await this.dal.countCompletedTurns(g.id, client)) + 1;
      await this.dal.insertMove(
        { gameId: g.id, userId, turnNumber, kind: 'pass', placements: null, lineWords: null, points: 0 },
        client
      );
      const state: SentenceTilesGameState = { ...stateOf(g), scorelessTurns: g.scorelessTurns + 1 };
      return this.dal.saveState(g.id, advanceTurn(g, userId, state, null), client);
    });
    return { outcome: 'accepted', game: await this.buildView(userId, game, usageDate) };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * One guarded model call for a line with no cached verdict (checks 3–5 of the header).
   * Returns the stored verdict; throws when a guard refuses or the judge is unavailable.
   */
  private async judgeFresh(
    game: SentenceTilesGameRow,
    userId: string,
    lineWords: string[],
    usageDate: string
  ): Promise<SentenceTilesVerdictRow> {
    if ((await this.dal.countVerdictsLastDay()) >= SENTENCE_TILES_GLOBAL_DAILY_JUDGE_LIMIT) {
      throw new RateLimitError('Judging is paused for today. Lines that were judged before still work.');
    }
    if (!(await this.dal.claimJudge(game.id, game.version, JUDGE_STALE_SECONDS))) {
      throw new ConflictError('Your last line is still being judged.');
    }
    if (!(await this.dal.reserveJudgeCall(userId, usageDate, SENTENCE_TILES_DAILY_JUDGE_LIMIT))) {
      await this.dal.releaseJudge(game.id);
      throw new RateLimitError(
        `You've used today's ${SENTENCE_TILES_DAILY_JUDGE_LIMIT} new-line checks. Lines that were judged before still work.`
      );
    }

    const result = await judgeLine(lineWords);
    if (result.kind === 'unavailable') {
      if (!result.billed) await this.dal.refundJudgeCall(userId, usageDate);
      await this.dal.releaseJudge(game.id);
      throw new DALError('Judging is unavailable right now. Try again in a minute.', 'ERR_JUDGE_UNAVAILABLE', 503);
    }
    // The judge marker stays set until phase 3's saveState / releaseJudge clears it, so a second
    // submission cannot slip in between the verdict and the apply.
    return this.dal.saveVerdict({
      language: game.language,
      line: lineKey(lineWords),
      legal: result.legal,
      reason: result.reason,
      model: result.model,
      requestedBy: userId,
    });
  }

  /** resolvePlay with the mover's rack, translating rule failures to 400s. */
  private resolveOrThrow(
    game: SentenceTilesGameRow,
    userId: string,
    placements: SentenceTilesPlacement[],
    direction: SentenceTilesDirection,
    turnNumber: number
  ) {
    try {
      return resolvePlay(game.board, game.playerAId === userId ? game.rackA : game.rackB, placements, direction, turnNumber);
    } catch (error) {
      if (error instanceof PlayRuleError) throw new ValidationError(error.message);
      throw error;
    }
  }

  /** Shared body of decline / cancel: end an unaccepted game without a winner. */
  private async endEarly(
    userId: string,
    gameId: string,
    usageDate: string,
    decide: (game: SentenceTilesGameRow) => 'declined' | 'cancelled'
  ): Promise<SentenceTilesMoveResponse> {
    await this.assertTester(userId);
    const game = await this.txRunner.executeInTransaction(async (tx) => {
      const client = tx.getClient();
      const g = await this.requireGameForUpdate(userId, gameId, client);
      const status = decide(g);
      return this.dal.saveState(g.id, { ...stateOf(g), status, turnUserId: null, winnerId: null, finished: true }, client);
    });
    return { outcome: 'accepted', game: await this.buildView(userId, game, usageDate) };
  }

  /** Testing phase: every endpoint is feature-tester only. */
  private async assertTester(userId: string): Promise<void> {
    const user = await this.userDAL.findById(userId);
    if (!user?.isFeatureTester) throw new ForbiddenError('Sentence Tiles is only open to feature testers right now');
  }

  /** The game, if the caller plays in it and may see it. A draft is hidden from the opponent. */
  private async loadParticipantGame(userId: string, gameId: string): Promise<SentenceTilesGameRow> {
    if (typeof gameId !== 'string' || !UUID_RE.test(gameId)) throw new NotFoundError('Game not found');
    const game = await this.dal.findGame(gameId);
    if (!game || !canSee(game, userId)) throw new NotFoundError('Game not found');
    return game;
  }

  private async requireGameForUpdate(userId: string, gameId: string, client: any): Promise<SentenceTilesGameRow> {
    if (typeof gameId !== 'string' || !UUID_RE.test(gameId)) throw new NotFoundError('Game not found');
    const game = await this.dal.findGame(gameId, client, true);
    if (!game || !canSee(game, userId)) throw new NotFoundError('Game not found');
    return game;
  }

  /** Pinyin + dd for every tile word, read from det once per process. */
  private wordInfo(): Promise<Map<string, SentenceTilesWordInfo>> {
    if (!this.wordInfoPromise) {
      this.wordInfoPromise = this.dictionaryDAL
        .findMultipleByWord1(ZH_TILES.map((t) => t.word), 'zh')
        .then((entries) => {
          const map = new Map<string, SentenceTilesWordInfo>();
          for (const e of entries) {
            if (map.has(e.word1)) continue; // first row per headword (the DAL's relevance order)
            map.set(e.word1, {
              pinyin: resolveDisplayPronunciation(e) ?? e.pronunciation ?? '',
              definition: resolveDisplayDefinition({ definition: e.definitions?.[0], definitionClusters: e.definitionClusters }),
              points: tilePoints(e.word1),
            });
          }
          return map;
        })
        .catch((error) => {
          this.wordInfoPromise = null; // retry on the next read rather than caching a failure
          throw error;
        });
    }
    return this.wordInfoPromise;
  }

  private async buildView(userId: string, game: SentenceTilesGameRow, usageDate: string): Promise<SentenceTilesGameView> {
    const isA = game.playerAId === userId;
    const opponentId = isA ? game.playerBId : game.playerAId;
    const [identities, moves, judgeUsedToday, info] = await Promise.all([
      this.dal.getPlayerIdentities([userId, opponentId]),
      this.dal.listMoves(game.id),
      this.dal.getJudgeUsage(userId, usageDate),
      this.wordInfo().catch(() => new Map<string, SentenceTilesWordInfo>()),
    ]);
    const identity = (id: string) => identities.find((p) => p.userId === id) ?? { userId: id, name: null, username: '' };
    const rack = isA ? game.rackA : game.rackB;
    const completedTurns = moves.filter((m) => m.kind !== 'rejected').length;
    const finished = game.turnUserId === null;
    const turnNumber = finished ? Math.max(1, completedTurns) : completedTurns + 1;

    const words: Record<string, SentenceTilesWordInfo> = {};
    const fallback = (word: string): SentenceTilesWordInfo => ({ pinyin: '', definition: '', points: tilePoints(word) });
    for (const t of [...rack, ...game.board]) words[t.word] = info.get(t.word) ?? fallback(t.word);
    for (const m of moves) for (const w of m.lineWords ?? []) words[w] ??= info.get(w) ?? fallback(w);

    const moveViews: SentenceTilesMoveView[] = moves
      // The opponent's rejected attempts are private; your own show in your log.
      .filter((m) => m.kind !== 'rejected' || m.userId === userId)
      .map((m) => ({
        turnNumber: m.turnNumber,
        userId: m.userId,
        kind: m.kind,
        lineWords: m.lineWords,
        points: m.points,
        tileCount: m.kind === 'exchange' ? (m.placements?.length ?? 0) : 0,
        createdAt: new Date(m.createdAt).toISOString(),
      }));

    return {
      id: game.id,
      status: game.status,
      version: game.version,
      language: game.language,
      you: { ...identity(userId), score: isA ? game.scoreA : game.scoreB },
      opponent: { ...identity(opponentId), score: isA ? game.scoreB : game.scoreA, rackCount: (isA ? game.rackB : game.rackA).length },
      youAreChallenger: isA,
      isYourTurn: game.turnUserId === userId,
      turnNumber,
      rack,
      board: game.board,
      bagCount: game.bag.length,
      rejectedThisTurn: moves.filter((m) => m.kind === 'rejected' && m.userId === userId && m.turnNumber === completedTurns + 1).length,
      judgeUsedToday,
      moves: moveViews,
      winnerId: game.winnerId,
      words,
      createdAt: new Date(game.createdAt).toISOString(),
      updatedAt: new Date(game.updatedAt).toISOString(),
    };
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function otherPlayer(game: SentenceTilesGameRow, userId: string): string {
  return game.playerAId === userId ? game.playerBId : game.playerAId;
}

/** A draft is the challenger's alone; every other status is visible to both players. */
function canSee(game: SentenceTilesGameRow, userId: string): boolean {
  if (game.playerAId === userId) return true;
  return game.playerBId === userId && game.status !== 'draft';
}

/** Refuse a move unless the game is live and it is the caller's turn. */
function assertYourMove(game: SentenceTilesGameRow, userId: string): void {
  if (!['draft', 'pending', 'active'].includes(game.status)) throw new ValidationError('This game is over');
  if (game.turnUserId !== userId) throw new ValidationError("It's not your turn");
}

function stateOf(g: SentenceTilesGameRow): SentenceTilesGameState {
  return {
    status: g.status, turnUserId: g.turnUserId, board: g.board, rackA: g.rackA, rackB: g.rackB, bag: g.bag,
    scoreA: g.scoreA, scoreB: g.scoreB, scorelessTurns: g.scorelessTurns, winnerId: g.winnerId, finished: false,
  };
}

/**
 * After a completed move by `userId`: step the challenge lifecycle (draft → pending on the
 * challenger's opening, pending → active on the opponent's first move — the accept), then
 * either end the game or pass the turn.
 *
 * Endings (§ "Ending"):
 *   - wentOut: the mover emptied their rack with the bag empty. They gain the opponent's
 *     remaining tile points and the opponent loses the same.
 *   - SCORELESS_END consecutive scoreless turns: each player loses their own rack's points.
 */
export function advanceTurn(
  g: SentenceTilesGameRow,
  userId: string,
  state: SentenceTilesGameState,
  ending: 'wentOut' | null
): SentenceTilesGameState {
  let status = state.status;
  if (status === 'draft') status = 'pending';
  else if (status === 'pending' && userId === g.playerBId) status = 'active';

  const stalled = state.scorelessTurns >= SENTENCE_TILES_SCORELESS_END;
  if (!ending && !stalled) {
    return { ...state, status, turnUserId: otherPlayer(g, userId) };
  }

  let { scoreA, scoreB } = state;
  const leftA = sumPoints(state.rackA);
  const leftB = sumPoints(state.rackB);
  if (ending === 'wentOut') {
    const isA = userId === g.playerAId;
    const left = isA ? leftB : leftA;
    scoreA += isA ? left : -left;
    scoreB += isA ? -left : left;
  } else {
    scoreA -= leftA;
    scoreB -= leftB;
  }
  const winnerId = scoreA === scoreB ? null : scoreA > scoreB ? g.playerAId : g.playerBId;
  return { ...state, status: 'finished', turnUserId: null, scoreA, scoreB, winnerId, finished: true };
}

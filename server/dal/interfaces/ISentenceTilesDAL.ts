import type { PoolClient } from 'pg';
import type {
  SentenceTilesBoardTile,
  SentenceTilesMoveKind,
  SentenceTilesRackTile,
  SentenceTilesStatus,
} from '../../contracts/sentenceTiles.js';

/**
 * Data-access contract for Sentence Tiles (migration 204, docs/SENTENCE_TILES_GAME.md
 * § "Data model"): `sentence_tile_games`, `sentence_tile_moves`, `sentence_tile_verdicts`,
 * `sentence_tile_judge_usage`.
 *
 * NO POLICY HERE. Whose turn it is, what a legal play is and every limit live in
 * SentenceTilesService; the DAL only reads and writes rows. Methods that take a PoolClient are
 * meant to run inside the service's transaction (docs/BACKEND_LAYERING.md § 3).
 */

/** A full `sentence_tile_games` row — includes the server-only bag and both racks. */
export interface SentenceTilesGameRow {
  id: string;
  language: string;
  playerAId: string;
  playerBId: string;
  status: SentenceTilesStatus;
  turnUserId: string | null;
  board: SentenceTilesBoardTile[];
  rackA: SentenceTilesRackTile[];
  rackB: SentenceTilesRackTile[];
  bag: SentenceTilesRackTile[];
  scoreA: number;
  scoreB: number;
  scorelessTurns: number;
  version: number;
  judgeStartedAt: Date | null;
  winnerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

/** The mutable part of a game, written back whole after a move. */
export type SentenceTilesGameState = Pick<
  SentenceTilesGameRow,
  'status' | 'turnUserId' | 'board' | 'rackA' | 'rackB' | 'bag' | 'scoreA' | 'scoreB' | 'scorelessTurns' | 'winnerId'
> & { finished: boolean };

export interface SentenceTilesMoveRow {
  id: number;
  gameId: string;
  userId: string;
  turnNumber: number;
  kind: SentenceTilesMoveKind;
  placements: unknown[] | null;
  lineWords: string[] | null;
  points: number;
  createdAt: Date;
}

export interface SentenceTilesVerdictRow {
  language: string;
  line: string;
  legal: boolean;
  reason: string | null;
  model: string;
}

export interface SentenceTilesPlayerIdentity {
  userId: string;
  name: string | null;
  username: string;
}

export interface ISentenceTilesDAL {
  /**
   * Serialize game creation for these users (pg_advisory_xact_lock, ids sorted so concurrent
   * A→B / B→A requests cannot deadlock). Held until the transaction ends.
   */
  lockUsers(userIds: string[], client: PoolClient): Promise<void>;

  /** Games the user is in whose status is draft / pending / active. */
  countUnfinishedGames(userId: string, client?: PoolClient): Promise<number>;

  insertGame(
    game: Pick<SentenceTilesGameRow, 'language' | 'playerAId' | 'playerBId' | 'turnUserId' | 'rackA' | 'rackB' | 'bag'>,
    client: PoolClient
  ): Promise<SentenceTilesGameRow>;

  /** One game, or null. `forUpdate` row-locks it for the rest of the transaction. */
  findGame(id: string, client?: PoolClient, forUpdate?: boolean): Promise<SentenceTilesGameRow | null>;

  /** Write the mutable state back, bump `version`, clear `judgeStartedAt`. Returns the new row. */
  saveState(id: string, state: SentenceTilesGameState, client: PoolClient): Promise<SentenceTilesGameRow>;

  /**
   * Mark a judge call in flight. Succeeds only when the game is still at `expectedVersion` and
   * no call started in the last `staleSeconds`. Returns false if someone else holds it.
   */
  claimJudge(id: string, expectedVersion: number, staleSeconds: number, client?: PoolClient): Promise<boolean>;

  /** Clear the in-flight marker without changing anything else (judge failed or was refused). */
  releaseJudge(id: string, client?: PoolClient): Promise<void>;

  /** The user's games, newest activity first, with the OTHER player's identity. */
  listGamesForUser(userId: string, limit: number): Promise<{ game: SentenceTilesGameRow; opponent: SentenceTilesPlayerIdentity }[]>;

  getPlayerIdentities(userIds: string[]): Promise<SentenceTilesPlayerIdentity[]>;

  insertMove(
    move: Pick<SentenceTilesMoveRow, 'gameId' | 'userId' | 'turnNumber' | 'kind' | 'placements' | 'lineWords' | 'points'>,
    client?: PoolClient
  ): Promise<void>;

  /** Every move of a game, oldest first. */
  listMoves(gameId: string, client?: PoolClient): Promise<SentenceTilesMoveRow[]>;

  /** Moves that ended a turn (anything but 'rejected'). The current turn number is this + 1. */
  countCompletedTurns(gameId: string, client?: PoolClient): Promise<number>;

  /** Rejected attempts by `userId` on turn `turnNumber`. */
  countRejected(gameId: string, userId: string, turnNumber: number, client?: PoolClient): Promise<number>;

  findVerdict(language: string, line: string): Promise<SentenceTilesVerdictRow | null>;

  /** Insert a verdict; a concurrent insert of the same line wins and is returned instead. */
  saveVerdict(
    verdict: SentenceTilesVerdictRow & { requestedBy: string }
  ): Promise<SentenceTilesVerdictRow>;

  /** Verdicts created in the last 24 hours — every one cost a judge call (global ceiling). */
  countVerdictsLastDay(): Promise<number>;

  /**
   * Atomically take one judge call from the user's daily budget. Returns false (and changes
   * nothing) when they already hold `limit` calls for `usageDate`.
   */
  reserveJudgeCall(userId: string, usageDate: string, limit: number): Promise<boolean>;

  /** Give a reserved call back (the request never reached the model). */
  refundJudgeCall(userId: string, usageDate: string): Promise<void>;

  getJudgeUsage(userId: string, usageDate: string): Promise<number>;
}

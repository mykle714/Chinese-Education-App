/**
 * Sentence Tiles — the wire contract and the rule constants both halves read
 * (docs/SENTENCE_TILES_GAME.md).
 *
 * A two-player correspondence word-tile game between friends: each tile is one HSK 1–3 det word,
 * a play is a straight line of tiles, and the line must read as a natural Chinese sentence —
 * judged by an AI call on the server. Lives in server/contracts/ because the client reads the
 * same board size / rack size / limits it renders against (see featureFlags.ts for why
 * contracts live here).
 *
 * The server is authoritative for everything: the client sends tile ids + cells, never words.
 *
 * Referenced by: server/services/SentenceTilesService.ts, server/services/sentenceTiles/rules.ts,
 * server/controllers/SentenceTilesController.ts, src/api/sentenceTiles.ts,
 * src/features/sentenceTiles/*.
 */

// ── Rules ────────────────────────────────────────────────────────────────────

/** The board is BOARD_SIZE × BOARD_SIZE cells; one tile per cell, whatever its character count. */
export const SENTENCE_TILES_BOARD_SIZE = 13;
/** The centre cell (row = col = this). The first line on an empty board must cover it. */
export const SENTENCE_TILES_CENTRE = 6;
/**
 * Tiles per rack. The pilot (round 3) measured 11 (it beat 9 and matched 13); the owner raised it
 * to 12 on 2026-11-22 so the rack lays out as two even rows of 6. Games dealt before the change
 * keep 11 (slots are refilled in place, never added).
 */
export const SENTENCE_TILES_RACK_SIZE = 12;
/** Tiles per bag. */
export const SENTENCE_TILES_BAG_SIZE = 100;
/** The first line on an empty board must hold at least this many tiles. */
export const SENTENCE_TILES_MIN_OPENING_TILES = 2;
/** A line of at least this many tiles earns LONG_LINE_BONUS (fires on ~15% of rack-11 turns). */
export const SENTENCE_TILES_LONG_LINE_TILES = 6;
export const SENTENCE_TILES_LONG_LINE_BONUS = 10;
/** Consecutive scoreless turns (passes / exchanges, both players) that end the game. */
export const SENTENCE_TILES_SCORELESS_END = 4;

// ── AI spend limits (docs/SENTENCE_TILES_GAME.md § "Abuse protection") ──────────

/** Judge calls (cache misses only) one player may cause per local day. */
export const SENTENCE_TILES_DAILY_JUDGE_LIMIT = 40;
/** Rejected lines per turn before the player must exchange or pass. */
export const SENTENCE_TILES_MAX_REJECTED_PER_TURN = 3;
/** Unfinished games (draft / pending / active) one player may be in at once. */
export const SENTENCE_TILES_MAX_ACTIVE_GAMES = 8;
/** Judge calls across ALL players in a rolling 24 hours before judging pauses. */
export const SENTENCE_TILES_GLOBAL_DAILY_JUDGE_LIMIT = 1000;

/** How often an open game page asks "has anything changed?" (ms). Paused while hidden. */
export const SENTENCE_TILES_POLL_MS = 10_000;

// ── Wire types ───────────────────────────────────────────────────────────────

export type SentenceTilesStatus = 'draft' | 'pending' | 'active' | 'finished' | 'declined' | 'cancelled';
export type SentenceTilesDirection = 'across' | 'down';
export type SentenceTilesMoveKind = 'play' | 'exchange' | 'pass' | 'resign' | 'rejected';

/** A tile in the caller's own rack. `id` is the tile's number within this game's bag (0–99). */
export interface SentenceTilesRackTile {
  id: number;
  word: string;
}

/** A tile on the board. `turn` is the turn number that placed it (lets the client tint the last play). */
export interface SentenceTilesBoardTile {
  row: number;
  col: number;
  tileId: number;
  word: string;
  turn: number;
}

/** Display facts for a word, from det: pinyin + the display definition (dd). */
export interface SentenceTilesWordInfo {
  pinyin: string;
  definition: string;
  points: number;
}

export interface SentenceTilesPlayerView {
  userId: string;
  name: string | null;
  username: string;
  score: number;
}

export interface SentenceTilesMoveView {
  turnNumber: number;
  userId: string;
  kind: SentenceTilesMoveKind;
  /** play / rejected: the line in reading order. */
  lineWords: string[] | null;
  points: number;
  /** exchange: how many tiles went back. */
  tileCount: number;
  createdAt: string;
}

/** GET /api/sentenceTiles/games/:id — the whole game as the caller may see it. */
export interface SentenceTilesGameView {
  id: string;
  status: SentenceTilesStatus;
  version: number;
  language: string;
  you: SentenceTilesPlayerView;
  opponent: SentenceTilesPlayerView & { rackCount: number };
  /** True when the caller is playerA, who created the game and plays the opening. */
  youAreChallenger: boolean;
  isYourTurn: boolean;
  /** 1-based number of the turn being played now (or the last one, once finished). */
  turnNumber: number;
  rack: SentenceTilesRackTile[];
  board: SentenceTilesBoardTile[];
  bagCount: number;
  /** Lines the caller has had rejected on the current turn (resets each turn). */
  rejectedThisTurn: number;
  /** Judge calls the caller has used today / the daily cap. */
  judgeUsedToday: number;
  /** Newest last. */
  moves: SentenceTilesMoveView[];
  winnerId: string | null;
  /** Pinyin + dd + points for every word on the board and in the caller's rack. */
  words: Record<string, SentenceTilesWordInfo>;
  createdAt: string;
  updatedAt: string;
}

/** One row of GET /api/sentenceTiles/games. */
export interface SentenceTilesGameSummary {
  id: string;
  status: SentenceTilesStatus;
  opponent: SentenceTilesPlayerView;
  yourScore: number;
  youAreChallenger: boolean;
  isYourTurn: boolean;
  winnerId: string | null;
  updatedAt: string;
}

export interface SentenceTilesListResponse {
  games: SentenceTilesGameSummary[];
}

/** POST /api/sentenceTiles/games */
export interface SentenceTilesCreateBody {
  opponentId: string;
}

export interface SentenceTilesPlacement {
  tileId: number;
  row: number;
  col: number;
}

/** POST /api/sentenceTiles/games/:id/play */
export interface SentenceTilesPlayBody {
  placements: SentenceTilesPlacement[];
  direction: SentenceTilesDirection;
  /** The caller's IANA timezone — decides which local day the judge call counts against. */
  tz?: string;
}

/** POST /api/sentenceTiles/games/:id/exchange */
export interface SentenceTilesExchangeBody {
  tileIds: number[];
}

/** Every move endpoint answers with the new state, plus the verdict for a play. */
export interface SentenceTilesMoveResponse {
  /** play only: whether the judge accepted the line. Non-play moves are always 'accepted'. */
  outcome: 'accepted' | 'rejected';
  /** play: the line as judged. */
  lineWords?: string[];
  /** play: the judge's one-sentence reason (always on a rejection). */
  reason?: string | null;
  /** play: points scored (0 on a rejection). */
  points?: number;
  game: SentenceTilesGameView;
}

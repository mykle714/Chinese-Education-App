import type { MemoryMapPlacement } from '../../contracts/wire.js';
import type { TypedMarkHistory } from '../../types/index.js';

/**
 * A placed word as it comes back from the database: the placement plus everything
 * needed to draw and prompt it.
 *
 * `definitionClusters` / `selectedSense` travel raw so the SERVICE can resolve the dd
 * through `resolveDisplayDefinition` — resolving in SQL is not possible and resolving
 * on the client would mean shipping the whole cluster set for 100 words.
 */
export interface MemoryMapPlacedRow extends MemoryMapPlacement {
  entryKey: string;
  language: string;
  pronunciation: string | null;
  definition: string | null;
  definitionClusters: unknown;
  selectedSense: string | null;
}

/**
 * A card eligible for the map but not yet on it — a spawn candidate.
 *
 * Carries the two things the ranking needs (`typedMarkHistory` for cooldown/queue
 * position, `readingCategory` for the ladder and the cooldown window) and nothing
 * else: the DAL fetches the full row only for the candidates that actually get placed.
 */
export interface MemoryMapCandidateRow {
  vocabEntryId: number;
  entryKey: string;
  language: string;
  typedMarkHistory?: TypedMarkHistory;
  /** The card's per-type utcm category on the READING track (never 'Mastered' here). */
  readingCategory: string;
  /** Unresolved dd inputs — the service resolves them (`resolveDisplayDefinition` needs
      the clusters AND the learner's sense pick together, which SQL cannot express) to
      keep two same-reading words off one map. See MemoryMapService.spawnInto. */
  selectedSense?: string | null;
  definition?: string | null;
  definitionClusters?: unknown;
}

/**
 * Data access for Memory Map (docs/MEMORY_MAP_GAME.md).
 *
 * LAYER: DAL. Placement reads/writes and the eligible-card query — no geometry (that
 * is services/memoryMapSpawn.ts) and no policy (that is MemoryMapService).
 *
 * Every method takes `language` and routes to the matching per-language placements
 * table. The two tables are structurally identical by design (migration 151), so one
 * method body serves both by swapping a whitelisted table name.
 */
export interface IMemoryMapDAL {
  /** Every word currently on this user's map, oldest placement first. */
  getPlacements(userId: string, language: string): Promise<MemoryMapPlacedRow[]>;

  /**
   * Cards eligible for the map that do NOT yet have a placement — playable, not
   * reading-mastered, and not already placed. Unranked: the ordering rule is app-level
   * (services/cardQueueRanking.ts) because it reads `typedMarkHistory` timestamps that
   * SQL would have to re-implement over jsonb.
   */
  getUnplacedCandidates(userId: string, language: string): Promise<MemoryMapCandidateRow[]>;

  /**
   * Persist newly spawned placements and return them fully hydrated for the wire.
   *
   * Upserts on (userId, vocabEntryId): a placement is written ONCE and never moved, so
   * a concurrent duplicate load must leave the first spawn's coordinates alone rather
   * than teleporting a word the learner has already seen.
   */
  insertPlacements(
    userId: string,
    language: string,
    placements: MemoryMapPlacement[]
  ): Promise<MemoryMapPlacedRow[]>;

  /** Remove one word's placement (it graduated, or the card is gone). */
  deletePlacement(userId: string, language: string, vocabEntryId: number): Promise<boolean>;

  /** Whether one card's READING track is mastered — the graduation test. */
  isReadingMastered(userId: string, language: string, vocabEntryId: number): Promise<boolean>;
}

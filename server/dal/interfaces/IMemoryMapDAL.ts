import type { MemoryMapLink } from '../../contracts/wire.js';
import type { TypedMarkHistory } from '../../types/index.js';

/**
 * One slot of a map as it comes back from the database, with its occupant (if any)
 * joined on. Ordered reads return these by `slotId` ascending — the layout depends on it.
 *
 * Every occupant column is null for an EMPTY slot (its card was deleted, or a refill
 * found nothing to lend). `definitionClusters` / `selectedSense` travel raw so the
 * SERVICE can resolve the dd through `resolveDisplayDefinition`, which SQL cannot do.
 */
export interface MemoryMapSlotRow {
  slotId: number;
  parentSlotId: number | null;
  link: MemoryMapLink;
  angle: number | null;
  tilt: number;
  bow: number;
  scale: number;
  vocabEntryId: number | null;
  entryKey: string | null;
  language: string;
  pronunciation: string | null;
  definition: string | null;
  definitionClusters: unknown;
  selectedSense: string | null;
}

/**
 * A card eligible for the map but not on it — a spawn/refill candidate.
 *
 * Carries what the ranking needs (`typedMarkHistory` for cooldown/queue position,
 * `readingCategory` for the ladder) and the unresolved dd inputs for the "two words
 * never read the same" guard.
 */
export interface MemoryMapCandidateRow {
  vocabEntryId: number;
  entryKey: string;
  language: string;
  typedMarkHistory?: TypedMarkHistory;
  /** The card's per-type utcm category on the READING track (never 'Mastered' here). */
  readingCategory: string;
  /** True for a lent (provisional) card — ranked after every card the learner chose. */
  isLent: boolean;
  selectedSense?: string | null;
  definition?: string | null;
  definitionClusters?: unknown;
}

/** A new slot to insert. `parentSlotId` may name an existing slot or another plan entry's `tempId`. */
export interface NewSlot {
  tempId: number;
  parentSlotId: number | null;
  link: MemoryMapLink;
  angle: number | null;
  tilt: number;
  bow: number;
  scale: number;
  vocabEntryId: number;
}

/**
 * Data access for Memory Map (docs/MEMORY_MAP_GAME.md § 8, § 9).
 *
 * LAYER: DAL. Slot reads/writes and the eligible-card query — no geometry (that is
 * services/memoryMapLayout.ts + memoryMapSpawn.ts) and no policy (MemoryMapService).
 *
 * Every method takes `language` and routes to the matching per-language slots table
 * (`memory_map_slots_zh` / `_es`, migration 173). The two are structurally identical,
 * so one method body serves both by swapping a whitelisted table name.
 */
export interface IMemoryMapDAL {
  /** Every slot on this user's map, empty ones included, by `slotId` ascending. */
  getSlots(userId: string, language: string): Promise<MemoryMapSlotRow[]>;

  /**
   * Cards eligible for the map that do NOT occupy a slot: not reading-mastered, not
   * already placed, and either SORTED by the learner or named in `lentIds` (a
   * provisional row this request just lent for the map — selection reads are
   * sorted-only, so a lent card enters only by being named). Unranked: ordering is
   * app-level (services/cardQueueRanking.ts).
   */
  getUnplacedCandidates(
    userId: string,
    language: string,
    lentIds?: number[]
  ): Promise<MemoryMapCandidateRow[]>;

  /**
   * Write one spawn atomically: fill empty slots, then insert new ones.
   *
   * Runs in a transaction under a per-(user, table) advisory lock, and first checks the
   * map still has `expectedSlotCount` slots — the count the plan was computed against.
   * If a concurrent load already changed it, nothing is written and this returns false;
   * the caller re-reads and serves that map instead. Without the guard two concurrent
   * loads would each plan against the same tree and the map would overshoot capacity.
   *
   * New slots are inserted one at a time in plan order, so database ids ascend in the
   * same order as the temp ids the layout was computed with, and a plan entry whose
   * parent is another plan entry gets that entry's real id.
   */
  writeSpawn(
    userId: string,
    language: string,
    expectedSlotCount: number,
    fills: { slotId: number; vocabEntryId: number }[],
    inserts: NewSlot[]
  ): Promise<boolean>;

  /**
   * Swap a slot's occupant: `fromVocabEntryId` leaves, `toVocabEntryId` (or nobody)
   * moves in. Returns the slot id, or null when the card held no slot.
   */
  replaceOccupant(
    userId: string,
    language: string,
    fromVocabEntryId: number,
    toVocabEntryId: number | null
  ): Promise<number | null>;

  /** Whether one card's READING track is mastered — the graduation test. */
  isReadingMastered(userId: string, language: string, vocabEntryId: number): Promise<boolean>;
}

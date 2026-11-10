import type {
  BreakdownMap, DefinitionCluster, DifficultyLevel, ExampleSentence, Language,
} from '../../types/index.js';

/**
 * The det columns a discover card is built from (`StarterPacksService._rowsToDiscoverCards`).
 * Raw as stored: `definitions` is the det jsonb array, and `pronunciation` is the unreviewed
 * column, which the service sense-resolves before it reaches the wire.
 */
export interface DiscoverDetRow {
  id: number;
  word1: string;
  word2: string | null;
  pronunciation: string | null;
  tone: string | null;
  /** The det jsonb array (a bare string only on legacy rows). */
  definitions: string[] | string | null;
  definitionClusters: DefinitionCluster[] | null;
  language: Language;
  script: string | null;
  difficulty: DifficultyLevel | null;
  frequencyScore: number | null;
  breakdown: BreakdownMap | null;
  synonyms: string[] | null;
  exampleSentences: ExampleSentence[] | null;
  iconId: string | null;
}

/** A card of an authored pack, tagged with the user's state on it (`findCardsWithPackState`). */
export interface PackCardRow extends DiscoverDetRow {
  /** The user holds a SORTED vet row for the word (locked + "sorted!" in the pack). */
  sorted: boolean;
  /** The card is in the user's discover_skips (draggable again inside the pack). */
  skipped: boolean;
}

/** Per-level CORE-bar counts of the user's sorted cards — `estimateLevel`'s input. */
export interface LevelMasteryCount {
  level: number;
  mastered: number;
  /** Sorted but not Mastered (U + T + C): the "don't know yet" frontier signal. */
  learning: number;
}

/**
 * Data access for the discover / add-cards flow: the det supply queries, the per-user
 * `discover_skips` deferrals and `users."seenPacks"`.
 *
 * LAYER: DAL. Every method is one statement. The POLICY stays in `StarterPacksService`:
 * the cold-start level walk, the nearest-level drift, authored-packs-before-singles,
 * which phase recycles skips, and the bucket semantics of a sort. Vet writes are NOT
 * here — a sort creates / promotes / undoes its vet row through `IVocabEntryDAL`
 * (`insertLibraryRow`, `promoteRowToLibrary`, `undoSortedRow`), the same methods the
 * cdp's add-to-Learning toggle uses.
 *
 * Every supply read applies two gates: `discoverSupplyGate` (dal/shared/dictTable.ts —
 * shared with ProvisionalCardDAL) and the valid-difficulty band `1..6`. "Already sorted"
 * means a SORTED vet row (`vetSortedClause`): a provisional card is still offered, which
 * is how a lent card gets promoted (docs/PROVISIONAL_CARDS.md).
 *
 * Referenced by: docs/DISCOVER_FLOW.md § "Card supply gate", docs/BACKEND_LAYERING.md § 4,
 * docs/SORT_PACKS_IMPLEMENTATION.md § 3.
 */
export interface IStarterPacksDAL {
  // ── Supply ────────────────────────────────────────────────────────────

  /** Sorted cards per difficulty level, split Mastered vs not on the CORE bar. */
  countSortedByLevel(userId: string, language: string): Promise<LevelMasteryCount[]>;

  /**
   * Up to `limit` unsorted discoverable rows, nearest-level-first around `level`
   * (then frequency DESC, then id), excluding `excludeIds`.
   *   includeSkips false → excludes cards in discover_skips (the fresh supply);
   *   includeSkips true  → ONLY skipped cards, oldest skip first (the recycle phase).
   * `exactLevel` pins the result to one difficulty band.
   */
  findSupplyRows(
    language: string,
    userId: string,
    level: number,
    excludeIds: number[],
    opts: { includeSkips: boolean; limit: number; exactLevel?: number }
  ): Promise<DiscoverDetRow[]>;

  /**
   * Quick Mark page: up to `limit` unsorted rows at EXACTLY `level`, skips NOT excluded,
   * strictly after the keyset `cursor` under (frequencyScore DESC NULLS LAST, id ASC).
   * The caller over-fetches by one to learn `hasMore`.
   */
  findQuickMarkPage(
    language: string,
    userId: string,
    level: number,
    cursor: { score: number | null; id: number } | null,
    limit: number
  ): Promise<DiscoverDetRow[]>;

  /** Every discoverable det row in `language` — the progress bar's denominator. */
  countDiscoverable(language: string): Promise<number>;

  /** Sorted vet rows + current skips — the progress bar's numerator. */
  countSortedOrSkipped(userId: string, language: string): Promise<number>;

  // ── Card lookups ──────────────────────────────────────────────────────

  /**
   * `word1` + `language` of a det id, ONLY if it is discoverable. The sort write path's
   * guard against a hand-rolled `POST /sort` naming an arbitrary det id
   * (docs/API_ABUSE_HARDENING.md § 1b).
   */
  findDiscoverableWordById(cardId: number, language: string): Promise<{ word1: string; language: string } | null>;

  /** `word1` of a det id, ungated (undo must reverse a sort even if the row lost the flag). */
  findWordById(cardId: number, language: string): Promise<string | null>;

  /** Discoverable rows for `words`, in the given order; unknown words are dropped. */
  findDiscoverableByWords(words: string[], language: string): Promise<DiscoverDetRow[]>;

  /** Rows for det `ids`, in the given order, tagged sorted/skipped for `userId`. Ungated. */
  findCardsWithPackState(ids: number[], userId: string, language: string): Promise<PackCardRow[]>;

  /** The user's skipped cards, newest skip first. */
  findSkippedCards(userId: string, language: string): Promise<DiscoverDetRow[]>;

  // ── discover_skips (migration 80) ─────────────────────────────────────

  /** Record skips; idempotent per (user, language, card). */
  insertSkips(userId: string, language: string, cardIds: number[]): Promise<void>;

  /** Delete one skip. True when a row was removed. */
  deleteSkip(userId: string, language: string, cardId: number): Promise<boolean>;

  /** Delete every skip in `language`. Returns how many were removed. */
  deleteAllSkips(userId: string, language: string): Promise<number>;

  // ── users."seenPacks" ─────────────────────────────────────────────────

  /** Authored pack ids the user has finished or skipped. */
  findSeenPackIds(userId: string): Promise<number[]>;

  /** Append `packId` unless already present. */
  addSeenPack(userId: string, packId: number): Promise<void>;

  /** Remove `packId` (a no-op when absent). */
  removeSeenPack(userId: string, packId: number): Promise<void>;
}

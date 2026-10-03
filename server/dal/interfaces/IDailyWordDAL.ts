import type { WordOfTheDayContent } from '../../contracts/wordOfTheDay.js';

/** One `daily_words` row joined to the det fields the card needs. */
export interface DailyWordRow {
  day: string;
  detId: number;
  content: unknown | null;
  word1: string;
  pronunciation: string | null;
  /** det `definitions->>0` — the legacy dd input. */
  definition: string | null;
  definitionClusters: unknown[] | null;
  /** det `components` — NULL when the components backfill has not run for this row. */
  components: string[] | null;
}

/**
 * Data-access contract for `daily_words` (migration 169) — the global Word of the Day.
 *
 * NO POLICY HERE: which characters qualify, how far back "recently used" reaches and
 * when the model is called are WordOfTheDayService's business. The DAL only reads,
 * pins and fills rows. See docs/READING_WRITING_CENTERS.md § Phase 3.
 */
export interface IDailyWordDAL {
  /** The pinned word for `day` (YYYY-MM-DD), with its det fields, or null. */
  findByDay(day: string): Promise<DailyWordRow | null>;

  /**
   * A random discoverable single-character `dictionaryentries_zh` id that was not the
   * word of any day in the last `excludeRecentDays` days, or null if none qualifies.
   */
  pickCandidateDetId(excludeRecentDays: number): Promise<number | null>;

  /**
   * Pin `detId` as `day`'s word. First writer wins (ON CONFLICT DO NOTHING): two
   * concurrent first requests for a day both call this, and both then read back the
   * one row that landed.
   */
  pinDay(day: string, detId: number): Promise<void>;

  /** Store the card body for `day`, only if it is still NULL (first fill wins). */
  fillContent(day: string, content: WordOfTheDayContent): Promise<void>;
}

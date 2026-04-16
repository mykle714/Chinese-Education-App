import { ReviewMark, VocabEntry } from '../types/index.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { DictionaryService } from './DictionaryService.js';
import { ValidationError } from '../types/dal.js';
import db from '../db.js';
import { DICT_COLS, DICT_JOIN } from '../dal/shared/dictJoin.js';

/**
 * OnDeck Vocabulary Service
 * Handles business logic for retrieving cards based on starterPackBucket.
 */
export class OnDeckVocabService {
  constructor(
    private vocabEntryDAL: IVocabEntryDAL,
    private dictionaryService: DictionaryService
  ) {}

  private getDateKeyInTimeZone(date: Date, timeZone: string): string {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    } catch {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    }
  }

  private hasCorrectMarkOnDate(markHistory: ReviewMark[] | undefined, dateKey: string, timeZone: string): boolean {
    if (!Array.isArray(markHistory) || markHistory.length === 0) {
      return false;
    }

    return markHistory.some(mark => {
      if (!mark?.isCorrect || !mark.timestamp) {
        return false;
      }

      const timestampDate = new Date(mark.timestamp);
      if (Number.isNaN(timestampDate.getTime())) {
        return false;
      }

      return this.getDateKeyInTimeZone(timestampDate, timeZone) === dateKey;
    });
  }

  private pickNewestCardNotCorrectToday(cards: VocabEntry[], timeZone: string): VocabEntry | null {
    if (cards.length === 0) {
      return null;
    }

    const todayDateKey = this.getDateKeyInTimeZone(new Date(), timeZone);
    const newestNotCorrectToday = cards.find(card => {
      return !this.hasCorrectMarkOnDate(card.markHistory, todayDateKey, timeZone);
    });

    return newestNotCorrectToday ?? cards[0];
  }

  /**
   * Enrich a vocab entry with related words that share characters.
   * Only applies to Chinese words.
   */
  private async enrichWithRelatedWords(userId: string, entry: VocabEntry): Promise<VocabEntry> {
    if (entry.language !== 'zh') {
      return entry;
    }

    try {
      const relatedWords = await this.vocabEntryDAL.findRelatedBySharedCharacters(
        userId,
        entry.entryKey,
        entry.language,
        4
      );

      return {
        ...entry,
        relatedWords
      };
    } catch (error) {
      console.error(`Failed to find related words for "${entry.entryKey}":`, error);
      return entry;
    }
  }

  /**
   * Enrich multiple vocab entries with related words.
   */
  private async enrichMultipleWithRelatedWords(userId: string, entries: VocabEntry[]): Promise<VocabEntry[]> {
    return Promise.all(entries.map(entry => this.enrichWithRelatedWords(userId, entry)));
  }

  /**
   * Run the standard three-stage enrichment pipeline on a list of vocab entries.
   * Adds example sentence metadata, expansion metadata, and synonym metadata in sequence.
   * All three stages must run in order since each stage's output feeds the next.
   */
  private async enrichEntriesPipeline(entries: VocabEntry[]): Promise<VocabEntry[]> {
    const withExampleMeta = await this.dictionaryService.enrichExampleSentencesMetadataBatch(entries);
    const withExpansionMeta = await this.dictionaryService.enrichExpansionMetadataBatch(withExampleMeta);
    return this.dictionaryService.enrichEntriesWithSynonymMetadata(withExpansionMeta);
  }

  /**
   * Get all library cards (cards with starterPackBucket = 'library').
   */
  async getLibraryCards(userId: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}
        FROM vocabentries ve ${DICT_JOIN}
        WHERE ve."userId" = $1
        AND ve."starterPackBucket" = 'library'
        ORDER BY ve."createdAt" DESC
      `, [userId]);

      return await this.enrichEntriesPipeline(result.rows);
    } finally {
      client.release();
    }
  }

  /**
   * Get all learn later cards (cards with starterPackBucket = 'learn-later').
   */
  async getLearnLaterCards(userId: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}
        FROM vocabentries ve ${DICT_JOIN}
        WHERE ve."userId" = $1
        AND ve."starterPackBucket" = 'learn-later'
        ORDER BY ve."createdAt" DESC
      `, [userId]);

      return await this.enrichEntriesPipeline(result.rows);
    } finally {
      client.release();
    }
  }

  /**
   * Get mastered library cards (library cards with category = 'Mastered').
   */
  async getMasteredLibraryCards(userId: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}
        FROM vocabentries ve ${DICT_JOIN}
        WHERE ve."userId" = $1
        AND ve."starterPackBucket" = 'library'
        AND ve.category = 'Mastered'
        ORDER BY ve."createdAt" DESC
      `, [userId]);

      return await this.enrichEntriesPipeline(result.rows);
    } finally {
      client.release();
    }
  }

  /**
   * Get non-mastered library cards (library cards without category = 'Mastered').
   */
  async getNonMasteredLibraryCards(userId: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}
        FROM vocabentries ve ${DICT_JOIN}
        WHERE ve."userId" = $1
        AND ve."starterPackBucket" = 'library'
        AND (ve.category IS NULL OR ve.category != 'Mastered')
        ORDER BY ve."createdAt" DESC
      `, [userId]);

      return await this.enrichEntriesPipeline(result.rows);
    } finally {
      client.release();
    }
  }

  /**
   * Get library cards filtered by a specific category.
   */
  async getLibraryCardsByCategory(userId: string, category: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!category) {
      throw new ValidationError('Category is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}
        FROM vocabentries ve ${DICT_JOIN}
        WHERE ve."userId" = $1
        AND ve."starterPackBucket" = 'library'
        AND ve.category = $2
        ORDER BY ve."createdAt" DESC
      `, [userId, category]);

      // Run the three-stage enrichment pipeline, then add related words
      const enriched = await this.enrichEntriesPipeline(result.rows);
      return await this.enrichMultipleWithRelatedWords(userId, enriched);
    } finally {
      client.release();
    }
  }

  /**
   * Get next library card with fallback priority.
   * Priority order when preferred category has no cards: Target -> Unfamiliar -> Comfortable -> Mastered.
   */
  async getNextLibraryCardWithFallback(
    userId: string,
    preferredCategory: string,
    timeZone: string = 'UTC'
  ): Promise<VocabEntry | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!preferredCategory) {
      throw new ValidationError('Preferred category is required');
    }

    // Try preferred category first
    let cards: VocabEntry[] = await this.getLibraryCardsByCategory(userId, preferredCategory);
    if (cards.length > 0) {
      return this.pickNewestCardNotCorrectToday(cards, timeZone);
    }

    // Fallback priority: Target -> Unfamiliar -> Comfortable -> Mastered
    const fallbackOrder: string[] = ['Target', 'Unfamiliar', 'Comfortable', 'Mastered']
      .filter(cat => cat !== preferredCategory);

    for (const category of fallbackOrder) {
      cards = await this.getLibraryCardsByCategory(userId, category);
      if (cards.length > 0) {
        return this.pickNewestCardNotCorrectToday(cards, timeZone);
      }
    }

    // No cards available at all
    return null;
  }

  /**
   * Get distributed working loop with specific card distribution.
   * Distribution: 1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target.
   * If category filter is applied, only return cards from that category (up to 10).
   * Enriches cards with related words that share characters.
   */
  async getDistributedWorkingLoop(
    userId: string,
    categoryFilter?: string | null
  ): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      let workingLoop: VocabEntry[];

      // If category filter is applied, just get 10 cards from that category
      if (categoryFilter) {
        const result = await client.query<VocabEntry>(`
          SELECT ve.*, ${DICT_COLS}
          FROM vocabentries ve ${DICT_JOIN}
          WHERE ve."userId" = $1
          AND ve."starterPackBucket" = 'library'
          AND ve.category = $2
          ORDER BY RANDOM()
          LIMIT 10
        `, [userId, categoryFilter]);

        workingLoop = result.rows;
      } else {
        // No filter - get distributed cards (1-2-2-5 distribution)
        workingLoop = [];

        // Fetch 1 Mastered card
        const masteredResult = await client.query<VocabEntry>(`
          SELECT ve.*, ${DICT_COLS}
          FROM vocabentries ve ${DICT_JOIN}
          WHERE ve."userId" = $1
          AND ve."starterPackBucket" = 'library'
          AND ve.category = 'Mastered'
          ORDER BY RANDOM()
          LIMIT 1
        `, [userId]);
        workingLoop.push(...masteredResult.rows);

        // Fetch 2 Comfortable cards
        const comfortableResult = await client.query<VocabEntry>(`
          SELECT ve.*, ${DICT_COLS}
          FROM vocabentries ve ${DICT_JOIN}
          WHERE ve."userId" = $1
          AND ve."starterPackBucket" = 'library'
          AND ve.category = 'Comfortable'
          ORDER BY RANDOM()
          LIMIT 2
        `, [userId]);
        workingLoop.push(...comfortableResult.rows);

        // Fetch 2 Unfamiliar cards
        const unfamiliarResult = await client.query<VocabEntry>(`
          SELECT ve.*, ${DICT_COLS}
          FROM vocabentries ve ${DICT_JOIN}
          WHERE ve."userId" = $1
          AND ve."starterPackBucket" = 'library'
          AND ve.category = 'Unfamiliar'
          ORDER BY RANDOM()
          LIMIT 2
        `, [userId]);
        workingLoop.push(...unfamiliarResult.rows);

        // Fetch 5 Target cards
        const targetResult = await client.query<VocabEntry>(`
          SELECT ve.*, ${DICT_COLS}
          FROM vocabentries ve ${DICT_JOIN}
          WHERE ve."userId" = $1
          AND ve."starterPackBucket" = 'library'
          AND ve.category = 'Target'
          ORDER BY RANDOM()
          LIMIT 5
        `, [userId]);
        workingLoop.push(...targetResult.rows);

        // If we don't have 10 cards, fill remaining slots by priority: Target → Comfortable → Unfamiliar → Mastered
        if (workingLoop.length < 10) {
          const fillPriorityOrder: string[] = ['Target', 'Comfortable', 'Unfamiliar', 'Mastered'];

          for (const category of fillPriorityOrder) {
            if (workingLoop.length >= 10) break;

            const existingIds: number[] = workingLoop.map(card => card.id);
            const neededCount: number = 10 - workingLoop.length;

            const fillResult = await client.query<VocabEntry>(`
              SELECT ve.*, ${DICT_COLS}
              FROM vocabentries ve ${DICT_JOIN}
              WHERE ve."userId" = $1
              AND ve."starterPackBucket" = 'library'
              AND ve.category = $2
              AND ve.id != ALL($3::int[])
              ORDER BY RANDOM()
              LIMIT $4
            `, [userId, category, existingIds, neededCount]);

            workingLoop.push(...fillResult.rows);
          }
        }

        // Shuffle the working loop to randomize card order
        workingLoop.sort(() => Math.random() - 0.5);
      }

      // Run the three-stage enrichment pipeline, then add related words
      const enriched = await this.enrichEntriesPipeline(workingLoop);
      return await this.enrichMultipleWithRelatedWords(userId, enriched);
    } finally {
      client.release();
    }
  }
}

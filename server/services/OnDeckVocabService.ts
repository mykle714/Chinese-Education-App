import { VocabEntry } from '../types/index.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { ValidationError } from '../types/dal.js';
import db from '../db.js';

/**
 * OnDeck Vocabulary Service
 * Handles business logic for retrieving cards based on their starter pack bucket
 * Simplified to use starterPackBucket column instead of OnDeckVocabSets
 */
export class OnDeckVocabService {
  constructor(
    private vocabEntryDAL: IVocabEntryDAL
  ) {}

  /**
   * Enrich a vocab entry with related words that share characters
   * Only applies to Chinese words
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
   * Enrich multiple vocab entries with related words
   */
  private async enrichMultipleWithRelatedWords(userId: string, entries: VocabEntry[]): Promise<VocabEntry[]> {
    return Promise.all(entries.map(entry => this.enrichWithRelatedWords(userId, entry)));
  }

  /**
   * Get all library cards (cards with starterPackBucket = 'library')
   */
  async getLibraryCards(userId: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT * FROM vocabentries
        WHERE "userId" = $1
        AND "starterPackBucket" = 'library'
        ORDER BY "createdAt" DESC
      `, [userId]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get all learn later cards (cards with starterPackBucket = 'learn-later')
   */
  async getLearnLaterCards(userId: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT * FROM vocabentries
        WHERE "userId" = $1
        AND "starterPackBucket" = 'learn-later'
        ORDER BY "createdAt" DESC
      `, [userId]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get mastered library cards (library cards with category = 'Mastered')
   */
  async getMasteredLibraryCards(userId: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT * FROM vocabentries
        WHERE "userId" = $1
        AND "starterPackBucket" = 'library'
        AND category = 'Mastered'
        ORDER BY "createdAt" DESC
      `, [userId]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get non-mastered library cards (library cards without category = 'Mastered')
   */
  async getNonMasteredLibraryCards(userId: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT * FROM vocabentries
        WHERE "userId" = $1
        AND "starterPackBucket" = 'library'
        AND (category IS NULL OR category != 'Mastered')
        ORDER BY "createdAt" DESC
      `, [userId]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get library cards filtered by a specific category
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
        SELECT * FROM vocabentries
        WHERE "userId" = $1
        AND "starterPackBucket" = 'library'
        AND category = $2
        ORDER BY "createdAt" DESC
      `, [userId, category]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get next library card with fallback priority
   * Priority order when preferred category has no cards: Target → Unfamiliar → Comfortable → Mastered
   */
  async getNextLibraryCardWithFallback(
    userId: string,
    preferredCategory: string
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
      const randomIndex: number = Math.floor(Math.random() * cards.length);
      return cards[randomIndex];
    }

    // Fallback priority: Target → Unfamiliar → Comfortable → Mastered
    const fallbackOrder: string[] = ['Target', 'Unfamiliar', 'Comfortable', 'Mastered']
      .filter(cat => cat !== preferredCategory);

    for (const category of fallbackOrder) {
      cards = await this.getLibraryCardsByCategory(userId, category);
      if (cards.length > 0) {
        const randomIndex: number = Math.floor(Math.random() * cards.length);
        return cards[randomIndex];
      }
    }

    // No cards available at all
    return null;
  }

  /**
   * Get distributed working loop with specific card distribution
   * Distribution: 1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target
   * If category filter is applied, only return cards from that category (up to 10)
   * Enriches cards with related words that share characters
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
          SELECT * FROM vocabentries
          WHERE "userId" = $1
          AND "starterPackBucket" = 'library'
          AND category = $2
          ORDER BY RANDOM()
          LIMIT 10
        `, [userId, categoryFilter]);

        workingLoop = result.rows;
      } else {
        // No filter - get distributed cards (1-2-2-5 distribution)
        workingLoop = [];

        // Fetch 1 Mastered card
        const masteredResult = await client.query<VocabEntry>(`
          SELECT * FROM vocabentries
          WHERE "userId" = $1
          AND "starterPackBucket" = 'library'
          AND category = 'Mastered'
          ORDER BY RANDOM()
          LIMIT 1
        `, [userId]);
        workingLoop.push(...masteredResult.rows);

        // Fetch 2 Comfortable cards
        const comfortableResult = await client.query<VocabEntry>(`
          SELECT * FROM vocabentries
          WHERE "userId" = $1
          AND "starterPackBucket" = 'library'
          AND category = 'Comfortable'
          ORDER BY RANDOM()
          LIMIT 2
        `, [userId]);
        workingLoop.push(...comfortableResult.rows);

        // Fetch 2 Unfamiliar cards
        const unfamiliarResult = await client.query<VocabEntry>(`
          SELECT * FROM vocabentries
          WHERE "userId" = $1
          AND "starterPackBucket" = 'library'
          AND category = 'Unfamiliar'
          ORDER BY RANDOM()
          LIMIT 2
        `, [userId]);
        workingLoop.push(...unfamiliarResult.rows);

        // Fetch 5 Target cards
        const targetResult = await client.query<VocabEntry>(`
          SELECT * FROM vocabentries
          WHERE "userId" = $1
          AND "starterPackBucket" = 'library'
          AND category = 'Target'
          ORDER BY RANDOM()
          LIMIT 5
        `, [userId]);
        workingLoop.push(...targetResult.rows);

        // If we don't have 10 cards, fill remaining slots with any available library cards
        if (workingLoop.length < 10) {
          const existingIds: number[] = workingLoop.map(card => card.id);
          const neededCount: number = 10 - workingLoop.length;

          const fillQuery = existingIds.length > 0
            ? `
              SELECT * FROM vocabentries
              WHERE "userId" = $1
              AND "starterPackBucket" = 'library'
              AND id NOT IN (${existingIds.join(',')})
              ORDER BY RANDOM()
              LIMIT $2
            `
            : `
              SELECT * FROM vocabentries
              WHERE "userId" = $1
              AND "starterPackBucket" = 'library'
              ORDER BY RANDOM()
              LIMIT $2
            `;

          const fillResult = await client.query<VocabEntry>(
            fillQuery,
            [userId, neededCount]
          );
          workingLoop.push(...fillResult.rows);
        }

        // Shuffle the working loop to randomize card order
        for (let i: number = workingLoop.length - 1; i > 0; i--) {
          const j: number = Math.floor(Math.random() * (i + 1));
          [workingLoop[i], workingLoop[j]] = [workingLoop[j], workingLoop[i]];
        }
      }

      // Enrich all cards with related words
      return await this.enrichMultipleWithRelatedWords(userId, workingLoop);
    } finally {
      client.release();
    }
  }
}

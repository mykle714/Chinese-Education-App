import { ReviewMark, VocabEntry } from '../types/index.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { DictionaryService } from './DictionaryService.js';
import { ValidationError } from '../types/dal.js';
import db from '../db.js';
import { DICT_COLS, DICT_JOIN } from '../dal/shared/dictJoin.js';
import { ttsService } from './TTSService.js';

/**
 * OnDeck Vocabulary Service
 * Handles business logic for retrieving cards based on starterPackBucket.
 */
export class OnDeckVocabService {
  constructor(
    private vocabEntryDAL: IVocabEntryDAL,
    private dictionaryService: DictionaryService
  ) {}

  // Per-category cooldown after a correct mark: a card that was recently marked
  // correct should not reappear in the working loop until its cooldown elapses.
  // Shorter windows for weaker categories so the user gets more repetition.
  private static readonly COOLDOWN_MS_BY_CATEGORY: Record<string, number> = {
    Unfamiliar: 5 * 60 * 1000,            // 5 minutes
    Target: 24 * 60 * 60 * 1000,          // 24 hours
    Comfortable: 7 * 24 * 60 * 60 * 1000, // 7 days
    Mastered: 30 * 24 * 60 * 60 * 1000,   // 30 days
  };

  private getLastCorrectMarkTimestamp(markHistory: ReviewMark[] | undefined): number | null {
    if (!Array.isArray(markHistory) || markHistory.length === 0) {
      return null;
    }

    let latest: number | null = null;
    for (const mark of markHistory) {
      if (!mark?.isCorrect || !mark.timestamp) continue;
      const ts = new Date(mark.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      if (latest === null || ts > latest) latest = ts;
    }
    return latest;
  }

  private isCardOnCooldown(card: VocabEntry, now: number): boolean {
    const cooldownMs = OnDeckVocabService.COOLDOWN_MS_BY_CATEGORY[card.category ?? ''];
    if (cooldownMs === undefined) return false;

    const lastCorrect = this.getLastCorrectMarkTimestamp(card.markHistory);
    if (lastCorrect === null) return false;

    return now - lastCorrect < cooldownMs;
  }

  // Returns the newest eligible card (not on cooldown), or null if every card
  // in the list is still cooling down. Callers use null to trigger fallback.
  private pickNewestCardNotOnCooldown(cards: VocabEntry[]): VocabEntry | null {
    if (cards.length === 0) {
      return null;
    }

    const now = Date.now();
    return cards.find(card => !this.isCardOnCooldown(card, now)) ?? null;
  }

  // Among cooled-down cards, prefer the one whose cooldown is closest to expiring
  // (smallest remaining cooldown = largest elapsed time since last correct mark).
  private pickLeastRecentlyCorrect(cards: VocabEntry[]): VocabEntry | null {
    if (cards.length === 0) return null;

    let best: VocabEntry | null = null;
    let bestLastCorrect = Infinity;
    for (const card of cards) {
      const lastCorrect = this.getLastCorrectMarkTimestamp(card.markHistory);
      // Treat "never marked correct" as oldest possible.
      const ts = lastCorrect ?? -Infinity;
      if (ts < bestLastCorrect) {
        bestLastCorrect = ts;
        best = card;
      }
    }
    return best;
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
   * For a single-character zh entry, attach up to 5 multi-char words containing this character
   * (user's vet first, then det fallback). No-op for multi-char or non-zh entries — those
   * continue to use the precomputed `breakdown` map for the bt tab.
   */
  private async enrichWithUsedIn(userId: string, entry: VocabEntry): Promise<VocabEntry> {
    if (entry.language !== 'zh') return entry;
    if ([...entry.entryKey].length !== 1) return entry;

    try {
      const usedIn = await this.vocabEntryDAL.findUsedInForCharacter(
        userId,
        entry.entryKey,
        entry.language,
        4
      );
      return { ...entry, usedIn };
    } catch (error) {
      console.error(`Failed to find usedIn for "${entry.entryKey}":`, error);
      return entry;
    }
  }

  private async enrichMultipleWithUsedIn(userId: string, entries: VocabEntry[]): Promise<VocabEntry[]> {
    return Promise.all(entries.map(entry => this.enrichWithUsedIn(userId, entry)));
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
   * Optionally excludes cards whose ids appear in `excludeIds` — used by the
   * mark endpoint to avoid handing back cards already present in the client's
   * working loop.
   */
  async getLibraryCardsByCategory(
    userId: string,
    category: string,
    excludeIds: number[] = []
  ): Promise<VocabEntry[]> {
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
        AND ve.id != ALL($3::int[])
        ORDER BY ve."createdAt" DESC
      `, [userId, category, excludeIds]);

      // Run the three-stage enrichment pipeline, then add related words + single-char usedIn
      const enriched = await this.enrichEntriesPipeline(result.rows);
      const withRelated = await this.enrichMultipleWithRelatedWords(userId, enriched);
      return await this.enrichMultipleWithUsedIn(userId, withRelated);
    } finally {
      client.release();
    }
  }

  /**
   * Get next library card with fallback priority.
   * Priority order when preferred category has no cards: Target -> Unfamiliar -> Comfortable -> Mastered.
   * Skips cards still on per-category cooldown (see COOLDOWN_MS_BY_CATEGORY).
   */
  async getNextLibraryCardWithFallback(
    userId: string,
    preferredCategory: string,
    excludeIds: number[] = []
  ): Promise<VocabEntry | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!preferredCategory) {
      throw new ValidationError('Preferred category is required');
    }

    // Try the preferred category first, then fall back. At each step we prefer
    // an eligible (non-cooldown) card. Only if EVERY category's cards are on
    // cooldown do we emit a cooled-down card, picking the one whose last correct
    // mark is furthest in the past. `excludeIds` keeps cards already in the
    // client's working loop out of the replacement pool.
    const categoryOrder: string[] = [
      preferredCategory,
      ...['Target', 'Unfamiliar', 'Comfortable', 'Mastered'].filter(cat => cat !== preferredCategory),
    ];

    const cooledDownPool: VocabEntry[] = [];

    for (const category of categoryOrder) {
      const cards = await this.getLibraryCardsByCategory(userId, category, excludeIds);
      if (cards.length === 0) continue;

      const eligible = this.pickNewestCardNotOnCooldown(cards);
      if (eligible) return eligible;

      // Every card in this category is on cooldown; remember them for last-resort.
      cooledDownPool.push(...cards);
    }

    // No eligible card anywhere — return the least-recently-correct cooled-down
    // card so the loop never stalls on an empty response.
    return this.pickLeastRecentlyCorrect(cooledDownPool);
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

      // Run the three-stage enrichment pipeline, then add related words + single-char usedIn
      const enriched = await this.enrichEntriesPipeline(workingLoop);
      const withRelated = await this.enrichMultipleWithRelatedWords(userId, enriched);
      const withUsedIn = await this.enrichMultipleWithUsedIn(userId, withRelated);

      // Pre-warm the TTS disk cache for every card before responding. The client
      // still fetches MP3s via /api/tts/synthesize after this returns, but those
      // calls are now guaranteed cache hits (~1ms each) so the speaker button
      // and auto-play feel instant. Per-entry failures degrade gracefully:
      // hasAudio=false signals the client to fall back to Web Speech for that
      // card. We don't fail the whole loop if Google has a hiccup on one entry.
      return await this.prewarmAudio(withUsedIn);
    } finally {
      client.release();
    }
  }

  /**
   * Count library cards per category for the requested categories. Used by the
   * decks page (per-bucket counts) and to gate game entry.
   */
  async getCategoryCounts(
    userId: string,
    categories: string[] = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered']
  ): Promise<Record<string, number>> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const client = await db.getClient();
    try {
      const result = await client.query<{ category: string; n: number }>(`
        SELECT category, COUNT(*)::int AS n
        FROM vocabentries
        WHERE "userId" = $1
        AND "starterPackBucket" = 'library'
        AND category = ANY($2::text[])
        GROUP BY category
      `, [userId, categories]);

      const counts: Record<string, number> = {};
      for (const cat of categories) counts[cat] = 0;
      for (const row of result.rows) counts[row.category] = row.n;
      return counts;
    } finally {
      client.release();
    }
  }

  /**
   * Build the bubble-match game pool: for each requested bucket, pull up to
   * `count` library cards (same `definition` source + RANDOM ordering as the
   * category-filtered working loop the flashcards use) and report how many were
   * available so the client can block entry when the user lacks enough words.
   * Cards are enriched and have their TTS pre-warmed so in-game autoplay is
   * instant, mirroring the distributed-working-loop endpoint.
   */
  async getGameVocabPool(
    userId: string,
    distribution: Record<string, number>
  ): Promise<{
    cards: VocabEntry[];
    requested: Record<string, number>;
    available: Record<string, number>;
    sufficient: boolean;
  }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const categories = Object.keys(distribution);
    const available = await this.getCategoryCounts(userId, categories);

    const client = await db.getClient();
    try {
      const cards: VocabEntry[] = [];
      for (const [category, count] of Object.entries(distribution)) {
        const result = await client.query<VocabEntry>(`
          SELECT ve.*, ${DICT_COLS}
          FROM vocabentries ve ${DICT_JOIN}
          WHERE ve."userId" = $1
          AND ve."starterPackBucket" = 'library'
          AND ve.category = $2
          ORDER BY RANDOM()
          LIMIT $3
        `, [userId, category, count]);
        cards.push(...result.rows);
      }

      const sufficient = Object.entries(distribution).every(
        ([cat, n]) => (available[cat] ?? 0) >= n
      );

      // Enrich (long defs / parts of speech etc.) then pre-warm audio. We skip
      // the related-words / used-in passes the EIC needs — the game only renders
      // the word, its pinyin, and the flashcard definition.
      const enriched = await this.enrichEntriesPipeline(cards);
      const withAudio = await this.prewarmAudio(enriched);

      return { cards: withAudio, requested: { ...distribution }, available, sufficient };
    } finally {
      client.release();
    }
  }

  /**
   * Awaits TTS synthesis for each entry's entryKey in parallel, stamping
   * `hasAudio` on the result. Used to pre-warm both the working-loop endpoint
   * and the mark endpoint's replacement card.
   *
   * Also stamps `dictionaryentries.ttsVoice` so the column accurately reflects
   * "this row has cached audio". The UPDATE is gated by `ttsVoice IS NULL` so
   * already-stamped rows are no-ops; this single path handles fresh synths,
   * cache hits whose column was never written (legacy gap), and is cheap
   * enough to run unconditionally in parallel with the synth call.
   */
  async prewarmAudio<T extends { entryKey: string; language?: string; pronunciation?: string | null; hasAudio?: boolean }>(
    entries: T[]
  ): Promise<T[]> {
    await Promise.all(entries.map(async entry => {
      const lang = entry.language || 'zh';
      const ttsLang = lang === 'zh' ? 'zh-CN' : lang;
      try {
        // Pass tone-marked pinyin so the audio matches the displayed pronunciation
        // (and polyphones cache separately). buildPinyinSsml inside TTSService
        // gracefully falls back to plain text if the pinyin doesn't align.
        const result = await ttsService.synthesize(entry.entryKey, ttsLang, entry.pronunciation);
        entry.hasAudio = true;
        // Stamp the column when it's still NULL — covers new synths and any
        // pre-existing disk-cached rows that never went through the controller.
        // Stored language is the short code (e.g. 'zh') to match how the rest
        // of the schema references languages.
        const c = await db.getClient();
        try {
          await c.query(
            'UPDATE dictionaryentries SET "ttsVoice" = $1 WHERE word1 = $2 AND language = $3 AND "ttsVoice" IS NULL',
            [result.voice, entry.entryKey, lang]
          );
        } catch (stampErr) {
          console.warn(`[OnDeckVocabService.prewarmAudio] failed to stamp ttsVoice for "${entry.entryKey}":`, stampErr);
        } finally {
          c.release();
        }
      } catch (err) {
        console.warn(`[OnDeckVocabService.prewarmAudio] synthesis failed for "${entry.entryKey}":`, err);
        entry.hasAudio = false;
      }
    }));
    return entries;
  }
}

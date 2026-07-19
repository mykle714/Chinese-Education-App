import { PoolClient } from 'pg';
import { VocabEntry, TypedMarkHistory, MarkType } from '../types/index.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { DictionaryService } from './DictionaryService.js';
import { StarterPacksService } from './StarterPacksService.js';
import { ValidationError } from '../types/dal.js';
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';
import { vetTableForLanguage, vetReadFrom, UTCM_USERS_JOIN, UTCM_CATEGORY_EXPR, UTCM_CATEGORY_SELECT } from '../dal/shared/vetTable.js';
import { DICT_COLS, DICT_JOIN } from '../dal/shared/dictJoin.js';
import { ttsService } from './TTSService.js';
import {
  generateWordSearchGrid,
  type GridCell,
  type WordSearchInput,
  type WordSearchGrid,
} from './wordSearchGrid.js';
import { resolveSenseGloss } from '../utils/definitions.js';

// Difficulty-targeted study modes launched from the decks page (Easy/Hard
// buttons). Each mode shapes BOTH the initial working-loop distribution and the
// replacement-card pool handed back by the mark endpoint, so banned categories
// never leak in via a correct-mark refill.
export type StudyMode = 'easy' | 'hard';

interface ModeLoopConfig {
  // Ordered initial fetch quotas (summing to the loop total).
  quotas: { category: string; count: number }[];
  // Priority order used to top the loop up to its total when a quota underfills.
  fillOrder: string[];
  // The only categories this mode may ever serve (initial loop + refills).
  allowed: string[];
}

// Single source of truth for mode distributions, shared by the working-loop
// builder and the mark route's replacement picker.
export const MODE_CONFIGS: Record<StudyMode, ModeLoopConfig> = {
  // Easy: ease the learner with cards they mostly know.
  easy: {
    quotas: [{ category: 'Comfortable', count: 7 }, { category: 'Mastered', count: 3 }],
    fillOrder: ['Comfortable', 'Mastered'],
    allowed: ['Comfortable', 'Mastered'],
  },
  // Hard: drill the cards the learner struggles with.
  hard: {
    quotas: [{ category: 'Unfamiliar', count: 7 }, { category: 'Target', count: 3 }],
    fillOrder: ['Target', 'Unfamiliar'],
    allowed: ['Unfamiliar', 'Target'],
  },
};

// Default (Mix) working-loop shape — the historical 1-2-2-5 distribution with a
// Target-first top-up. Lives alongside the mode configs so the loop builder is
// fully data-driven.
const DEFAULT_LOOP_CONFIG: Omit<ModeLoopConfig, 'allowed'> = {
  quotas: [
    { category: 'Mastered', count: 1 },
    { category: 'Comfortable', count: 2 },
    { category: 'Unfamiliar', count: 2 },
    { category: 'Target', count: 5 },
  ],
  fillOrder: ['Target', 'Comfortable', 'Unfamiliar', 'Mastered'],
};

// Total cards in a working loop, regardless of distribution.
const WORKING_LOOP_SIZE = 10;

// Per-category candidate overfetch cap for the cooldown-aware initial loop: we
// pull a random pool this large per category and keep the first N flp-eligible
// cards. Bounds memory for very large libraries while almost always finding
// enough eligible cards to fill a quota.
const LOOP_CANDIDATE_CAP = 100;

/**
 * OnDeck Vocabulary Service
 * Handles business logic for retrieving cards based on starterPackBucket.
 */
export class OnDeckVocabService {
  constructor(
    private vocabEntryDAL: IVocabEntryDAL,
    private dictionaryService: DictionaryService,
    // Used only by Word Search, to bound the filler pool to the user's estimated
    // difficulty level (and below) — see getWordSearchGrid.
    private starterPacksService: StarterPacksService
  ) {}

  // Per-category cooldown after a correct mark: a card that was recently marked
  // correct should not reappear in the working loop until its cooldown elapses.
  // Shorter windows for weaker categories so the user gets more repetition.
  //
  // The window DURATION is keyed on the card's overall utcm category, but the
  // timer is applied PER MARK TYPE (see isTypeOnCooldown): recognition and
  // production cool down on independent clocks. See docs/MASTERY_REWORK.md
  // (§ Per-type cooldown).
  private static readonly COOLDOWN_MS_BY_CATEGORY: Record<string, number> = {
    Unfamiliar: 5 * 60 * 1000,            // 5 minutes
    Target: 24 * 60 * 60 * 1000,          // 24 hours
    Comfortable: 7 * 24 * 60 * 60 * 1000, // 7 days
    Mastered: 30 * 24 * 60 * 60 * 1000,   // 30 days
  };

  // The mark types the flp can actually present (docs/MASTERY_REWORK.md § 1): a
  // foreign-first prompt is a RECOGNITION review, an English-first prompt is a
  // PRODUCTION review. Reading/Writing marks come from other games (Word Search /
  // Practice Writing) and are never shown in the working loop, so flp cooldown
  // eligibility consults only these two tracks — a correct mark earned in another
  // game no longer suppresses a card from the flp.
  private static readonly FLP_MARK_TYPES: readonly MarkType[] = ['recognition', 'production'];

  // Newest correct-mark timestamp within ONE type's track (null if that track has
  // no valid correct mark). Per-type so each mark type cools down on its own clock.
  private getLastCorrectMarkTimestampForType(
    typedMarkHistory: TypedMarkHistory | undefined,
    type: MarkType
  ): number | null {
    const track = typedMarkHistory?.[type];
    if (!Array.isArray(track)) return null;

    let latest: number | null = null;
    for (const mark of track) {
      if (!mark?.isCorrect || !mark.timestamp) continue;
      const ts = new Date(mark.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      if (latest === null || ts > latest) latest = ts;
    }
    return latest;
  }

  // Whether ONE mark type of a card is still cooling down. The window duration is
  // chosen by the card's overall utcm category; the elapsed time is measured from
  // that type's own last correct mark.
  private isTypeOnCooldown(card: VocabEntry, type: MarkType, now: number): boolean {
    const cooldownMs = OnDeckVocabService.COOLDOWN_MS_BY_CATEGORY[card.category ?? ''];
    if (cooldownMs === undefined) return false;

    const lastCorrect = this.getLastCorrectMarkTimestampForType(card.typedMarkHistory, type);
    if (lastCorrect === null) return false;

    return now - lastCorrect < cooldownMs;
  }

  // The flp-reviewable mark types whose per-type cooldown has elapsed. Empty ⇒ the
  // card is fully on cooldown for the flp and should be skipped. Stamped onto the
  // returned card as `readyMarkTypes` so the client can steer which face it shows.
  private flpReadyMarkTypes(card: VocabEntry, now: number): MarkType[] {
    return OnDeckVocabService.FLP_MARK_TYPES.filter(type => !this.isTypeOnCooldown(card, type, now));
  }

  // The single flp mark type whose cooldown is CLOSEST TO EXPIRING (oldest last
  // correct mark). Used for last-resort presentation when every flp type of a card
  // is still cooling down, so the client always has a face to show.
  private closestToExpiringFlpType(card: VocabEntry): MarkType {
    let bestType: MarkType = OnDeckVocabService.FLP_MARK_TYPES[0];
    let oldest = Infinity;
    for (const type of OnDeckVocabService.FLP_MARK_TYPES) {
      // "Never correct in this track" = oldest possible.
      const ts = this.getLastCorrectMarkTimestampForType(card.typedMarkHistory, type) ?? -Infinity;
      if (ts < oldest) {
        oldest = ts;
        bestType = type;
      }
    }
    return bestType;
  }

  // Returns the newest flp-eligible card (≥1 mark type off cooldown), stamped with
  // its ready mark types, or null if every card in the list is fully cooling down.
  // Callers pass cards ordered `createdAt DESC`, so "first eligible" = "newest".
  private pickNewestFlpEligibleCard(cards: VocabEntry[]): VocabEntry | null {
    const now = Date.now();
    for (const card of cards) {
      const ready = this.flpReadyMarkTypes(card, now);
      if (ready.length > 0) return { ...card, readyMarkTypes: ready };
    }
    return null;
  }

  // Last-resort pick when EVERY candidate is fully on cooldown: choose the card
  // whose flp cooldown is closest to expiring (smallest remaining = oldest last
  // correct mark), stamped with the single type we'll present. Keeps the loop from
  // stalling on an all-cooled library.
  private pickLeastRecentlyCorrectFlp(cards: VocabEntry[]): VocabEntry | null {
    let best: VocabEntry | null = null;
    let bestType: MarkType = OnDeckVocabService.FLP_MARK_TYPES[0];
    let bestLastCorrect = Infinity;
    for (const card of cards) {
      for (const type of OnDeckVocabService.FLP_MARK_TYPES) {
        const ts = this.getLastCorrectMarkTimestampForType(card.typedMarkHistory, type) ?? -Infinity;
        if (ts < bestLastCorrect) {
          bestLastCorrect = ts;
          best = card;
          bestType = type;
        }
      }
    }
    return best ? { ...best, readyMarkTypes: [bestType] } : null;
  }

  // A card is playable in a game when ≥1 of that game's mark types is off its
  // per-type cooldown. Single-type games reduce to "that one type is off
  // cooldown" (bubble-match = recognition; word-search = reading in No-Pinyin
  // mode, production in Pinyin mode). See docs/MASTERY_REWORK.md § Per-type
  // cooldown ("Games").
  private isCardGameEligible(card: VocabEntry, markTypes: readonly MarkType[], now: number): boolean {
    return markTypes.some(type => !this.isTypeOnCooldown(card, type, now));
  }

  /**
   * Fetch per-category library candidates for a game, split into `eligible`
   * (≥1 of the game's mark types off cooldown = fresh) vs `cooled` (all of the
   * game's mark types still cooling). Each partition preserves the SQL RANDOM()
   * order. Games fill their pool from `eligible` first — requested categories,
   * then fallback categories — and only dip into `cooled` as a last resort to
   * reach the required count, so the per-type cooldown is honored without ever
   * blocking entry more than an un-cooled library would.
   *
   * `maxEntryKeyLen` (Word Search) restricts candidates to short words the grid
   * can place; omit for no length cap.
   */
  private async fetchGameCandidates(
    client: PoolClient,
    userId: string,
    language: string,
    categories: string[],
    markTypes: readonly MarkType[],
    now: number,
    cap: number,
    maxEntryKeyLen?: number
  ): Promise<{ eligible: Record<string, VocabEntry[]>; cooled: Record<string, VocabEntry[]> }> {
    const eligible: Record<string, VocabEntry[]> = {};
    const cooled: Record<string, VocabEntry[]> = {};
    // maxEntryKeyLen is a caller-supplied constant (never user input); coerce to a
    // safe integer before inlining, since it isn't a bind param.
    const lenClause = maxEntryKeyLen != null
      ? `AND LENGTH(ve."entryKey") <= ${Math.max(0, Math.floor(maxEntryKeyLen))}`
      : '';
    for (const category of categories) {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}, ${UTCM_CATEGORY_SELECT}
        FROM ${vetReadFrom(language)} ${DICT_JOIN} ${UTCM_USERS_JOIN}
        WHERE ve."userId" = $1
        AND ve."language" = $4
        AND ve."starterPackBucket" = 'library'
        AND ${UTCM_CATEGORY_EXPR} = $2
        ${lenClause}
        ORDER BY RANDOM()
        LIMIT $3
      `, [userId, category, cap, language]);

      const fresh: VocabEntry[] = [];
      const stale: VocabEntry[] = [];
      for (const row of result.rows) {
        (this.isCardGameEligible(row, markTypes, now) ? fresh : stale).push(row);
      }
      eligible[category] = fresh;
      cooled[category] = stale;
    }
    return { eligible, cooled };
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
   * Adds example sentence metadata, long-definition metadata, and synonym metadata in
   * sequence. All three stages must run in order since each stage's output feeds the next.
   */
  private async enrichEntriesPipeline(entries: VocabEntry[], language: string): Promise<VocabEntry[]> {
    const withExampleMeta = await this.dictionaryService.enrichExampleSentencesMetadataBatch(entries, language);
    const withLongDefMeta = await this.dictionaryService.enrichLongDefinitionMetadataBatch(withExampleMeta, language);
    const withDefsApproval = await this.dictionaryService.enrichDefinitionsApprovalBatch(withLongDefMeta, language);
    return this.dictionaryService.enrichEntriesWithSynonymMetadata(withDefsApproval, language);
  }

  /**
   * Get all library cards (cards with starterPackBucket = 'library').
   */
  async getLibraryCards(userId: string, language: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}, ${UTCM_CATEGORY_SELECT}
        FROM ${vetReadFrom(language)} ${DICT_JOIN} ${UTCM_USERS_JOIN}
        WHERE ve."userId" = $1
        AND ve."language" = $2
        AND ve."starterPackBucket" = 'library'
        ORDER BY ve."createdAt" DESC
      `, [userId, language]);

      return await this.enrichEntriesPipeline(result.rows, language);
    } finally {
      client.release();
    }
  }

  /**
   * Get mastered library cards (library cards with category = 'Mastered').
   */
  async getMasteredLibraryCards(userId: string, language: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}, ${UTCM_CATEGORY_SELECT}
        FROM ${vetReadFrom(language)} ${DICT_JOIN} ${UTCM_USERS_JOIN}
        WHERE ve."userId" = $1
        AND ve."language" = $2
        AND ve."starterPackBucket" = 'library'
        AND ${UTCM_CATEGORY_EXPR} = 'Mastered'
        ORDER BY ve."createdAt" DESC
      `, [userId, language]);

      return await this.enrichEntriesPipeline(result.rows, language);
    } finally {
      client.release();
    }
  }

  /**
   * Get non-mastered library cards (library cards without category = 'Mastered').
   */
  async getNonMasteredLibraryCards(userId: string, language: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}, ${UTCM_CATEGORY_SELECT}
        FROM ${vetReadFrom(language)} ${DICT_JOIN} ${UTCM_USERS_JOIN}
        WHERE ve."userId" = $1
        AND ve."language" = $2
        AND ve."starterPackBucket" = 'library'
        AND ${UTCM_CATEGORY_EXPR} != 'Mastered'
        ORDER BY ve."createdAt" DESC
      `, [userId, language]);

      return await this.enrichEntriesPipeline(result.rows, language);
    } finally {
      client.release();
    }
  }

  /**
   * Fetch library candidate rows of one category (DICT-joined, category-stamped,
   * UN-enriched), newest first. Shared by the flp refill picker and the initial
   * loop's cooled last-resort fallback — both do their eligibility filtering /
   * ranking in app code, so enrichment is deferred to only the chosen cards.
   * `excludeIds` keeps already-chosen cards out; `limitRows` caps the scan (omit
   * for a full scan, which the refill needs to reach the newest eligible card).
   */
  private async fetchLibraryCandidatesByCategory(
    client: PoolClient,
    userId: string,
    category: string,
    language: string,
    excludeIds: number[],
    limitRows?: number
  ): Promise<VocabEntry[]> {
    // limitRows is coerced to a non-negative integer and inlined (it can be
    // omitted, so it isn't a bind param); never interpolate untrusted input here.
    const limitClause = limitRows != null ? `LIMIT ${Math.max(0, Math.floor(limitRows))}` : '';
    const result = await client.query<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${UTCM_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN} ${UTCM_USERS_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $4
      AND ve."starterPackBucket" = 'library'
      AND ${UTCM_CATEGORY_EXPR} = $2
      AND ve.id != ALL($3::int[])
      ORDER BY ve."createdAt" DESC
      ${limitClause}
    `, [userId, category, excludeIds, language]);
    return result.rows;
  }

  /**
   * Get the next library card for a correct-mark refill, honoring PER-TYPE
   * cooldowns (docs/MASTERY_REWORK.md § Per-type cooldown).
   *
   * Priority: the preferred category first, then Target -> Unfamiliar ->
   * Comfortable -> Mastered. At each step we take the newest card with ≥1 flp mark
   * type off cooldown (recognition/production), stamping `readyMarkTypes` so the
   * client shows a face for a ready type. Only if EVERY candidate everywhere is
   * fully cooling down do we emit the least-recently-correct cooled card (so the
   * loop never stalls). `excludeIds` keeps cards already in the loop out.
   *
   * `allowedCategories` (Easy/Hard modes) restricts the pool to the given
   * categories only — a banned category is never served, even as a last resort.
   * When the allowed pool is empty, returns null so the caller can wind the loop
   * down ("no more easy/hard cards remaining"). Enriches only the chosen card.
   */
  async getNextLibraryCardWithFallback(
    userId: string,
    preferredCategory: string,
    language: string,
    excludeIds: number[] = [],
    allowedCategories?: string[]
  ): Promise<VocabEntry | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!preferredCategory) {
      throw new ValidationError('Preferred category is required');
    }

    // In a mode session, `allowedCategories` caps the pool: the preferred category
    // is honored only if it's allowed, and the fallback list is the remaining
    // allowed categories.
    const fallbackBase = allowedCategories ?? ['Target', 'Unfamiliar', 'Comfortable', 'Mastered'];
    const preferredFirst = !allowedCategories || allowedCategories.includes(preferredCategory)
      ? [preferredCategory]
      : [];
    const categoryOrder: string[] = [
      ...preferredFirst,
      ...fallbackBase.filter(cat => cat !== preferredCategory),
    ];

    const client = await db.getClient();
    try {
      const cooledDownPool: VocabEntry[] = [];
      let winner: VocabEntry | null = null;

      for (const category of categoryOrder) {
        const cards = await this.fetchLibraryCandidatesByCategory(client, userId, category, language, excludeIds);
        if (cards.length === 0) continue;

        const eligible = this.pickNewestFlpEligibleCard(cards);
        if (eligible) { winner = eligible; break; }

        // Every card in this category is on cooldown; remember for last-resort.
        cooledDownPool.push(...cards);
      }

      if (!winner) winner = this.pickLeastRecentlyCorrectFlp(cooledDownPool);
      if (!winner) return null;

      // Enrich only the chosen card (candidates were fetched un-enriched), then
      // re-apply the readyMarkTypes stamp defensively so face-steering survives
      // any enrichment step that rebuilds the object.
      const readyMarkTypes = winner.readyMarkTypes;
      const enriched = await this.enrichEntriesPipeline([winner], language);
      const withRelated = await this.enrichMultipleWithRelatedWords(userId, enriched);
      const withUsedIn = await this.enrichMultipleWithUsedIn(userId, withRelated);
      return { ...withUsedIn[0], readyMarkTypes };
    } finally {
      client.release();
    }
  }

  /**
   * Fetch up to `limit` flp-eligible library cards of one category for the initial
   * working loop: overfetch a shuffled candidate pool (bounded by
   * LOOP_CANDIDATE_CAP), then keep only cards with ≥1 flp mark type off cooldown
   * (per-type cooldown; docs/MASTERY_REWORK.md), stamping `readyMarkTypes` for
   * client face-steering. `excludeIds` keeps already-picked cards out.
   */
  private async fetchEligibleCategoryCards(
    client: PoolClient,
    userId: string,
    language: string,
    category: string,
    limit: number,
    excludeIds: number[],
    now: number
  ): Promise<VocabEntry[]> {
    if (limit <= 0) return [];
    const result = await client.query<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${UTCM_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN} ${UTCM_USERS_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $5
      AND ve."starterPackBucket" = 'library'
      AND ${UTCM_CATEGORY_EXPR} = $2
      AND ve.id != ALL($3::int[])
      ORDER BY RANDOM()
      LIMIT $4
    `, [userId, category, excludeIds, LOOP_CANDIDATE_CAP, language]);

    const eligible: VocabEntry[] = [];
    for (const card of result.rows) {
      const ready = this.flpReadyMarkTypes(card, now);
      if (ready.length === 0) continue;
      eligible.push({ ...card, readyMarkTypes: ready });
      if (eligible.length >= limit) break;
    }
    return eligible;
  }

  /**
   * Last-resort initial-loop fill when NO flp-eligible card exists (the whole
   * allowed pool is cooling down): pull candidates from `categoryOrder`, keep the
   * `limit` whose flp cooldown is closest to expiring, each stamped with the
   * single type to present. Mirrors the refill's never-stall guarantee.
   */
  private async fetchCooledFallbackCards(
    client: PoolClient,
    userId: string,
    language: string,
    categoryOrder: string[],
    limit: number,
    excludeIds: number[]
  ): Promise<VocabEntry[]> {
    if (limit <= 0) return [];
    const pool: VocabEntry[] = [];
    const seen = new Set<number>(excludeIds);
    for (const category of categoryOrder) {
      const rows = await this.fetchLibraryCandidatesByCategory(
        client, userId, category, language, [...seen], LOOP_CANDIDATE_CAP
      );
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        pool.push(row);
      }
    }
    // Rank by oldest last-correct across flp types (closest to expiring first).
    return pool
      .map(card => ({
        card,
        oldest: Math.min(
          ...OnDeckVocabService.FLP_MARK_TYPES.map(
            t => this.getLastCorrectMarkTimestampForType(card.typedMarkHistory, t) ?? -Infinity
          )
        ),
      }))
      .sort((a, b) => a.oldest - b.oldest)
      .slice(0, limit)
      .map(({ card }) => ({ ...card, readyMarkTypes: [this.closestToExpiringFlpType(card)] }));
  }

  /**
   * Get distributed working loop with a category distribution.
   * - Default (Mix): 1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target.
   * - `mode` 'easy'/'hard': the difficulty-targeted distributions in MODE_CONFIGS
   *   (Easy = 7 Comfortable + 3 Mastered; Hard = 7 Unfamiliar + 3 Target), each
   *   topping up only from its allowed categories.
   * - `categoryFilter`: returns up to 10 cards from that single category (legacy
   *   deck-tap path), ignoring distribution.
   *
   * PER-TYPE COOLDOWN (docs/MASTERY_REWORK.md § Per-type cooldown): every fetch is
   * eligibility-filtered — a card is only offered if ≥1 flp mark type
   * (recognition/production) is off cooldown, and it's stamped with
   * `readyMarkTypes` so the client steers the shown face. Only if the whole
   * (allowed) pool is cooling down do we fall back to least-recently-correct
   * cooled cards, so the loop never comes back empty for a user who has cards.
   * Enriches cards with related words that share characters.
   */
  async getDistributedWorkingLoop(
    userId: string,
    language: string,
    categoryFilter?: string | null,
    mode?: StudyMode
  ): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const now = Date.now();
    const client = await db.getClient();
    try {
      let workingLoop: VocabEntry[];

      // The categories this loop may draw from, in fallback priority — also the
      // pool for the cooled last-resort fill below.
      let loopCategories: string[];

      if (categoryFilter) {
        // Legacy deck-tap path: up to WORKING_LOOP_SIZE eligible cards from the
        // single tapped category.
        loopCategories = [categoryFilter];
        workingLoop = await this.fetchEligibleCategoryCards(
          client, userId, language, categoryFilter, WORKING_LOOP_SIZE, [], now
        );
      } else {
        // Data-driven distribution: pick the per-mode config (or the Mix default),
        // fetch each quota in order, then top up to WORKING_LOOP_SIZE using the
        // mode's fill order. Mode loops only ever draw from their config's
        // categories; Mix may draw from all four.
        const config = mode ? MODE_CONFIGS[mode] : DEFAULT_LOOP_CONFIG;
        loopCategories = mode ? MODE_CONFIGS[mode].allowed : ['Target', 'Unfamiliar', 'Comfortable', 'Mastered'];
        workingLoop = [];

        // Initial quota fetches (eligibility-filtered).
        for (const { category, count } of config.quotas) {
          const rows = await this.fetchEligibleCategoryCards(
            client, userId, language, category, count, workingLoop.map(c => c.id), now
          );
          workingLoop.push(...rows);
        }

        // Top up toward the loop size by fill-order priority.
        if (workingLoop.length < WORKING_LOOP_SIZE) {
          for (const category of config.fillOrder) {
            if (workingLoop.length >= WORKING_LOOP_SIZE) break;
            const rows = await this.fetchEligibleCategoryCards(
              client, userId, language, category,
              WORKING_LOOP_SIZE - workingLoop.length, workingLoop.map(c => c.id), now
            );
            workingLoop.push(...rows);
          }
        }

        // Shuffle the working loop to randomize card order
        workingLoop.sort(() => Math.random() - 0.5);
      }

      // If everything eligible is on cooldown, don't strand the user with an empty
      // loop — fall back to least-recently-correct cooled cards (mirrors the
      // refill's never-stall guarantee). Only triggers when NO eligible card
      // exists in the loop's categories.
      if (workingLoop.length === 0) {
        workingLoop = await this.fetchCooledFallbackCards(
          client, userId, language, loopCategories, WORKING_LOOP_SIZE, []
        );
      }

      // Preserve each card's readyMarkTypes stamp across enrichment (enrichment
      // steps spread the entry, but we re-apply defensively so face-steering is
      // never dropped by a rebuild).
      const readyByCardId = new Map<number, MarkType[]>();
      for (const card of workingLoop) {
        if (card.readyMarkTypes) readyByCardId.set(card.id, card.readyMarkTypes);
      }

      // Run the three-stage enrichment pipeline, then add related words + single-char usedIn
      const enriched = await this.enrichEntriesPipeline(workingLoop, language);
      const withRelated = await this.enrichMultipleWithRelatedWords(userId, enriched);
      const withUsedIn = await this.enrichMultipleWithUsedIn(userId, withRelated);

      // Pre-warm the TTS disk cache for every card before responding. The client
      // still fetches MP3s via /api/tts/synthesize after this returns, but those
      // calls are now guaranteed cache hits (~1ms each) so the speaker button
      // and auto-play feel instant. Per-entry failures degrade gracefully:
      // hasAudio=false signals the client to fall back to Web Speech for that
      // card. We don't fail the whole loop if Google has a hiccup on one entry.
      const withAudio = await this.prewarmAudio(withUsedIn);

      // Re-apply the readyMarkTypes stamp (see readyByCardId above) as the final
      // step, so client face-steering data is guaranteed present on the response.
      return withAudio.map(card => {
        const ready = readyByCardId.get(card.id);
        return ready ? { ...card, readyMarkTypes: ready } : card;
      });
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
    language: string,
    categories: string[] = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered']
  ): Promise<Record<string, number>> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const client = await db.getClient();
    try {
      // category is computed per row from typedMarkHistory + the account's goal
      // flags (migration 101), so we group by the derived expression and join users
      // for the goal flags. `ve` alias is required by UTCM_CATEGORY_EXPR/JOIN.
      const result = await client.query<{ category: string; n: number }>(`
        SELECT ${UTCM_CATEGORY_EXPR} AS category, COUNT(*)::int AS n
        FROM ${vetTableForLanguage(language)} ve
        ${UTCM_USERS_JOIN}
        WHERE ve."userId" = $1
        AND ve."language" = $3
        AND ve."starterPackBucket" = 'library'
        AND ${UTCM_CATEGORY_EXPR} = ANY($2::text[])
        GROUP BY ${UTCM_CATEGORY_EXPR}
      `, [userId, categories, language]);

      const counts: Record<string, number> = {};
      for (const cat of categories) counts[cat] = 0;
      for (const row of result.rows) counts[row.category] = row.n;
      return counts;
    } finally {
      client.release();
    }
  }

  // Fallback buckets (in priority order) used to top the game pool up to its
  // total when one or more requested categories can't fill their quota. Per the
  // game design: borrow extra Target cards first, then Comfortable, Unfamiliar,
  // and finally Mastered.
  private static readonly GAME_FALLBACK_ORDER = ['Target', 'Comfortable', 'Unfamiliar', 'Mastered'];

  // Per-category candidate overfetch cap for the cooldown-aware game pool: we
  // pull a shuffled pool this large per category, partition it into fresh/cooled
  // (fetchGameCandidates), and fill fresh-first. Bounds memory for large
  // libraries while comfortably covering a 20–25 card game.
  private static readonly GAME_CANDIDATE_CAP = 200;

  /**
   * Build the bubble-match game pool. The game needs `total` (= sum of the
   * requested distribution) cards to function, so this is a best-effort fill
   * rather than a hard per-category gate:
   *
   *   1. Pull up to `count` library cards from each requested bucket (same
   *      `definition` source + RANDOM ordering as the category-filtered working
   *      loop the flashcards use).
   *   2. If the buckets came up short (a category had fewer than its quota),
   *      top the pool up to `total` by borrowing extra cards from the fallback
   *      buckets in priority order (Target → Comfortable → Unfamiliar →
   *      Mastered), excluding cards already collected.
   *
   * `sufficient` now means "we assembled enough cards to play" (>= total), not
   * "every requested quota was met exactly". Cards are enriched and have their
   * TTS pre-warmed so in-game autoplay is instant, mirroring the
   * distributed-working-loop endpoint.
   *
   * PER-TYPE COOLDOWN (docs/MASTERY_REWORK.md § Per-type cooldown, "Games"):
   * `gameMarkTypes` is the mark type(s) this game emits (bubble-match =
   * ['recognition']). The pool is filled FRESH-FIRST — cards whose game mark type
   * is off cooldown, drawn from the requested categories then the fallback
   * categories — and only tops up with COOLED cards (same category order) as a
   * last resort, so a recently-played library still yields a full board.
   */
  async getGameVocabPool(
    userId: string,
    language: string,
    distribution: Record<string, number>,
    gameMarkTypes: readonly MarkType[]
  ): Promise<{
    cards: VocabEntry[];
    requested: Record<string, number>;
    available: Record<string, number>;
    total: number;
    sufficient: boolean;
  }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const now = Date.now();
    const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);
    // Count availability across both the requested buckets and the fallback
    // buckets so the client can show accurate "you have N" hints.
    const countCategories = Array.from(
      new Set([...Object.keys(distribution), ...OnDeckVocabService.GAME_FALLBACK_ORDER])
    );
    const available = await this.getCategoryCounts(userId, language, countCategories);

    const client = await db.getClient();
    try {
      // Per-category candidates split fresh (game type off cooldown) vs cooled.
      const { eligible, cooled } = await this.fetchGameCandidates(
        client, userId, language, countCategories, gameMarkTypes, now,
        OnDeckVocabService.GAME_CANDIDATE_CAP
      );

      const selectedIds = new Set<number>();
      const cards: VocabEntry[] = [];
      // Pop up to `limit` not-yet-selected cards off one category queue.
      const drain = (queue: VocabEntry[], limit: number): void => {
        while (limit > 0 && queue.length > 0) {
          const card = queue.shift()!;
          if (selectedIds.has(card.id)) continue;
          selectedIds.add(card.id);
          cards.push(card);
          limit--;
        }
      };

      // 1. Fill each requested bucket up to its quota from FRESH cards.
      for (const [category, count] of Object.entries(distribution)) {
        drain(eligible[category] ?? [], count);
      }
      // 2. Still short → top up to `total` with FRESH cards from the fallback
      //    buckets (Target → Comfortable → Unfamiliar → Mastered).
      for (const category of OnDeckVocabService.GAME_FALLBACK_ORDER) {
        if (cards.length >= total) break;
        drain(eligible[category] ?? [], total - cards.length);
      }
      // 3. Last resort → COOLED cards (requested buckets first, then fallback),
      //    so a just-played library still assembles a full board.
      for (const category of [...Object.keys(distribution), ...OnDeckVocabService.GAME_FALLBACK_ORDER]) {
        if (cards.length >= total) break;
        drain(cooled[category] ?? [], total - cards.length);
      }

      const sufficient = cards.length >= total;

      // Enrich (long defs / parts of speech etc.) then pre-warm audio. We skip
      // the related-words / used-in passes the EIC needs — the game only renders
      // the word, its pinyin, and the flashcard definition.
      const enriched = await this.enrichEntriesPipeline(cards, language);
      const withAudio = await this.prewarmAudio(enriched);

      return { cards: withAudio, requested: { ...distribution }, available, total, sufficient };
    } finally {
      client.release();
    }
  }

  // ---- Word Search game ----------------------------------------------------

  // Grid dimensions: 7 columns wide × 7 rows tall (portrait play area).
  // See docs/WORD_SEARCH_GAME.md §2.
  static readonly WORD_SEARCH_ROWS = 7;
  static readonly WORD_SEARCH_COLS = 7;
  // Cap on how many library candidates we pull per category up front. Word Search
  // needs a working set to run the substring de-dup / replacement loop against;
  // this bounds memory for users with very large libraries.
  private static readonly WORD_SEARCH_CANDIDATE_CAP = 500;

  /**
   * Build the Word Search game payload: a clean 10-word set (no word's Chinese
   * text is a substring of another's) hidden as snaking paths in an 8×8 grid of
   * filler characters.
   *
   * Selection reuses the bubble-match pool shape (requested distribution + the
   * same fallback top-up order), restricted to `entryKey` <= 4 characters (the
   * template fallback in wordSearchGrid.ts guarantees a fit only up to that
   * length — see docs/WORD_SEARCH_TEMPLATES.md), then adds a de-dup pass
   * unique to this game:
   *
   *   1. Assemble `total` cards (distribution → fallback top-up), each already
   *      <= 4 characters via the per-category candidate query.
   *   2. While any selected word's `entryKey` is a substring of another's, drop
   *      the shorter word and pull a replacement — same category first, then the
   *      fallback order — from the remaining library candidates. Repeat until the
   *      set is clean or the library is exhausted.
   *   3. If a clean set of `total` can't be assembled, return `sufficient: false`
   *      so the client can block entry with the "20 distinct-character cards"
   *      message.
   *
   * The final words are enriched + TTS-prewarmed (so the found-word audio is
   * instant), the empty cells are flooded with filler characters harvested from
   * real words at or below the user's estimated level (each `dictionaryentries_zh`
   * word split into its component chars, so filler stays level-appropriate yet
   * carries real chars + pinyin), and the snaking grid is generated.
   *
   * Word Search is Chinese-only for now (the grid is a cpcd character lattice);
   * non-`zh` languages return `sufficient: false` with a language note.
   *
   * PER-TYPE COOLDOWN (docs/MASTERY_REWORK.md § Per-type cooldown, "Games"):
   * `gameMarkTypes` is the mode's mark type — ['reading'] for No-Pinyin,
   * ['production'] for Pinyin. Both the initial selection and the substring-dedup
   * replacements prefer FRESH cards (that type off cooldown) across the requested
   * then fallback categories, dipping into COOLED cards only as a last resort so
   * the game never blocks a just-played library.
   */
  async getWordSearchGrid(
    userId: string,
    language: string,
    distribution: Record<string, number>,
    gameMarkTypes: readonly MarkType[]
  ): Promise<{
    grid: GridCell[][] | null;
    words: WordSearchGrid['words'];
    bonusWords: { entryKey: string; pinyin: string; definition: string }[];
    rows: number;
    cols: number;
    total: number;
    available: Record<string, number>;
    sufficient: boolean;
    reason?: string;
    templateIndex?: number | null;
  }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const rows = OnDeckVocabService.WORD_SEARCH_ROWS;
    const cols = OnDeckVocabService.WORD_SEARCH_COLS;
    const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);

    const countCategories = Array.from(
      new Set([...Object.keys(distribution), ...OnDeckVocabService.GAME_FALLBACK_ORDER])
    );
    const available = await this.getCategoryCounts(userId, language, countCategories);
    const emptyResult = { grid: null, words: [], bonusWords: [], rows, cols, total, available };

    // The grid is a Chinese-character lattice with per-character pinyin, so the
    // game only makes sense for zh. Block other languages cleanly.
    if (language !== 'zh') {
      return { ...emptyResult, sufficient: false, reason: 'language' };
    }

    const client = await db.getClient();
    try {
      const now = Date.now();
      // Per-category candidates split fresh (mode's mark type off cooldown) vs
      // cooled, capped to short (<= 4 char) words the grid can place. We pop from
      // these both for the initial selection and for substring replacements, so a
      // card is never reused across passes.
      const { eligible, cooled } = await this.fetchGameCandidates(
        client, userId, language, countCategories, gameMarkTypes, now,
        OnDeckVocabService.WORD_SEARCH_CANDIDATE_CAP, 4
      );

      const selectedIds = new Set<number>();
      const selected: VocabEntry[] = [];

      // Pop up to `limit` unused cards from one queue into `selected`.
      const drain = (queue: VocabEntry[], limit: number): void => {
        while (limit > 0 && queue.length > 0) {
          const card = queue.shift()!;
          if (selectedIds.has(card.id)) continue;
          selectedIds.add(card.id);
          selected.push(card);
          limit--;
        }
      };

      // Pull ONE replacement for a dropped word, preferring FRESH cards
      // (preferred category → fallback order), then COOLED cards (same order)
      // only if no fresh card is left. Returns the added card, or null if the
      // whole library is exhausted.
      const pullReplacement = (preferredCategory: string): VocabEntry | null => {
        const order = [preferredCategory, ...OnDeckVocabService.GAME_FALLBACK_ORDER];
        for (const source of [eligible, cooled]) {
          for (const category of order) {
            const before = selected.length;
            drain(source[category] ?? [], 1);
            if (selected.length > before) return selected[selected.length - 1];
          }
        }
        return null;
      };

      // 1. Fill each requested bucket up to its quota from FRESH cards, then
      //    2. top up to `total` with FRESH fallback cards, then 3. backfill any
      //    remaining shortfall with COOLED cards (requested buckets → fallback).
      for (const [category, count] of Object.entries(distribution)) drain(eligible[category] ?? [], count);
      for (const category of OnDeckVocabService.GAME_FALLBACK_ORDER) {
        if (selected.length >= total) break;
        drain(eligible[category] ?? [], total - selected.length);
      }
      for (const category of [...Object.keys(distribution), ...OnDeckVocabService.GAME_FALLBACK_ORDER]) {
        if (selected.length >= total) break;
        drain(cooled[category] ?? [], total - selected.length);
      }

      // 3. Substring de-dup. Find any pair where one entryKey is contained in the
      //    other, drop the shorter (substring) word, and replace it. Re-scan until
      //    clean or no replacement is available. The iteration cap is a safety net;
      //    the natural terminator is the queues emptying.
      const findSubstringVictim = (): number => {
        for (let i = 0; i < selected.length; i++) {
          for (let j = 0; j < selected.length; j++) {
            if (i === j) continue;
            // selected[i] is contained in selected[j] → drop i (the shorter/equal one).
            if (selected[j].entryKey.includes(selected[i].entryKey)) return i;
          }
        }
        return -1;
      };

      let iterations = 0;
      const MAX_DEDUP_ITERATIONS = 1000;
      while (iterations++ < MAX_DEDUP_ITERATIONS) {
        const victimIdx = findSubstringVictim();
        if (victimIdx === -1) break; // clean set

        const victim = selected[victimIdx];
        selected.splice(victimIdx, 1);
        selectedIds.delete(victim.id);

        const replacement = pullReplacement(victim.category);
        if (!replacement) break; // library exhausted — can't reach a clean `total`
      }

      const clean = findSubstringVictim() === -1;
      if (!clean || selected.length < total) {
        return { ...emptyResult, sufficient: false, reason: 'insufficient-distinct' };
      }

      // Enrich + prewarm audio for the final set (found-word narration is instant).
      const enriched = await this.enrichEntriesPipeline(selected.slice(0, total), language);
      const withAudio = await this.prewarmAudio(enriched);

      // Filler pool: characters harvested from real words at or below the user's
      // estimated difficulty level, so the noise stays level-appropriate (a
      // beginner never sees advanced characters as filler). We pull whole words
      // (single- AND multi-character) with difficulty <= the estimate and break
      // each into its component characters, keeping duplicates so frequent
      // characters naturally recur (reads as authentic filler). We deliberately
      // discard the source word's `pronunciation` here — a character's reading
      // inside a specific word can be a context-specific tone-sandhi/erhua/neutral-
      // tone variant, not the character's own standalone reading. Pinyin is
      // resolved in a second pass below by looking each unique character back up
      // in `dictionaryentries_zh` as its own headword, so filler always shows the
      // character's most common reading.
      const wordChars = withAudio.reduce((sum, w) => sum + [...w.entryKey].length, 0);
      const fillerNeeded = rows * cols - wordChars;
      const level = await this.starterPacksService.estimateLevel(userId, language);

      // Break a batch of level-bounded words into a char-only bag (no pinyin yet).
      const harvestFillerChars = (wordRows: { word1: string }[]): string[] => {
        const bag: string[] = [];
        for (const row of wordRows) {
          bag.push(...[...row.word1]);
        }
        return bag;
      };

      // Pull generously so the bag has variety even after the char split; each
      // word yields >= 1 character, so this comfortably covers `fillerNeeded`.
      const fillerWordResult = await client.query<{ word1: string }>(`
        SELECT word1
        FROM dictionaryentries_zh
        WHERE language = 'zh' AND difficulty BETWEEN 1 AND $1
        ORDER BY RANDOM()
        LIMIT $2
      `, [level, Math.max(fillerNeeded, 100)]);
      let fillerChars = harvestFillerChars(fillerWordResult.rows);

      // Fallback: if no level-tagged words exist (e.g. difficulty un-backfilled),
      // fall back to any single-character rows so the grid can still be built.
      if (fillerChars.length === 0) {
        const fallback = await client.query<{ word1: string }>(`
          SELECT word1
          FROM dictionaryentries_zh
          WHERE language = 'zh' AND char_length(word1) = 1
          ORDER BY RANDOM()
          LIMIT $1
        `, [Math.max(fillerNeeded, 50)]);
        fillerChars = harvestFillerChars(fallback.rows);
      }
      if (fillerChars.length === 0) {
        // Nothing to draw from at all — can't build a grid.
        return { ...emptyResult, sufficient: false, reason: 'no-filler' };
      }

      // Resolve each unique harvested character's own canonical pinyin by
      // looking it up as a standalone headword (word1 = char), rather than
      // reusing the pronunciation it happened to carry inside its source word.
      const uniqueChars = [...new Set(fillerChars)];
      const charPinyinResult = await client.query<{ word1: string; pronunciation: string | null }>(`
        SELECT word1, pronunciation
        FROM dictionaryentries_zh
        WHERE language = 'zh' AND word1 = ANY($1)
      `, [uniqueChars]);
      const charPinyinMap = new Map<string, string>();
      for (const row of charPinyinResult.rows) {
        if (!charPinyinMap.has(row.word1)) {
          charPinyinMap.set(row.word1, (row.pronunciation ?? '').trim().split(/\s+/)[0] ?? '');
        }
      }

      // Drop any harvested character with no standalone det entry (no pinyin to
      // show), then build the final GridCell bag.
      const fillerPool: GridCell[] = fillerChars
        .filter((char) => charPinyinMap.has(char))
        .map((char) => ({ char, pinyin: charPinyinMap.get(char)! }));

      if (fillerPool.length === 0) {
        return { ...emptyResult, sufficient: false, reason: 'no-filler' };
      }

      // Per-character context-correct senses for the target words. A character's
      // gloss inside a specific word is the ddt of THAT character's own det cluster
      // keyed by the word's stored `breakdown[char].sense` label (backfill-breakdown-
      // senses.js). We resolve it live from each character's definitionClusters so a
      // tap on a placed character shows its meaning IN THIS WORD, not its generic
      // standalone gloss. One batched clusters query over every distinct target
      // component character; fall back to the char's stored breakdown definition when
      // the row/label doesn't resolve.
      const targetChars = [...new Set(withAudio.flatMap((w) => [...w.entryKey]))];
      const charClusters = new Map<string, Array<{ sense?: string | null; glosses?: string[] | null }>>();
      if (targetChars.length > 0) {
        const clustersResult = await client.query<{ word1: string; definitionClusters: unknown }>(`
          SELECT word1, "definitionClusters"
          FROM dictionaryentries_zh
          WHERE language = 'zh' AND word1 = ANY($1)
        `, [targetChars]);
        for (const row of clustersResult.rows) {
          if (!charClusters.has(row.word1) && Array.isArray(row.definitionClusters)) {
            charClusters.set(row.word1, row.definitionClusters as Array<{ sense?: string | null; glosses?: string[] | null }>);
          }
        }
      }

      const inputs: WordSearchInput[] = withAudio.map((w) => {
        const breakdown = w.breakdown ?? null;
        const charSenses = [...w.entryKey].map((char) => {
          const sense = breakdown?.[char]?.sense ?? null;
          // Live-resolve ddt from the char's own clusters keyed by sense; fall back
          // to the (already sense-resolved) stored breakdown definition.
          const definition = resolveSenseGloss(charClusters.get(char), sense) ?? breakdown?.[char]?.definition ?? null;
          return { sense, definition };
        });
        return {
          id: w.id,
          entryKey: w.entryKey,
          pinyin: w.pronunciation ?? '',
          definition: w.definition ?? '',
          charSenses,
        };
      });
      const generated = generateWordSearchGrid(inputs, fillerPool, rows, cols);

      // Bonus words: every det headword whose ENTIRE character sequence is
      // drawn exclusively from characters that appear somewhere on the
      // finished grid (the `^[...]+$` regex anchors both ends, so a word with
      // even one character outside the grid's set is excluded — it is not
      // enough for a word to merely contain a grid character). Sent so the
      // client can recognize when a player traces a real dictionary word that
      // isn't one of the 10 targets (§4 blue-highlight review popup); the
      // client still verifies the player's actual dragged path spells the
      // word, since this list makes no claim about adjacency/traceability.
      const gridChars = Array.from(new Set(generated.grid.flatMap((row) => row.map((cell) => cell.char))));
      // Escape regex metacharacters that would be meaningful inside a `[...]`
      // class, in case a future filler source ever contains one — none of the
      // Chinese characters we use today need it, so this is purely defensive.
      const charClass = gridChars.map((ch) => ch.replace(/[\^\]\\-]/g, '\\$&')).join('');
      const bonusWordsResult = await client.query<{ word1: string; pronunciation: string | null; definition: string | null }>(`
        SELECT word1, pronunciation, definitions->>0 AS definition
        FROM dictionaryentries_zh
        WHERE language = 'zh'
          AND word1 ~ ('^[' || $1 || ']+$')
        -- Safety net, not a product requirement: bounds the payload if the
        -- grid's character set happens to match an unusually large number of
        -- headwords (e.g. it's dominated by very common characters).
        LIMIT 1000
      `, [charClass]);
      const bonusWords = bonusWordsResult.rows
        .filter((r) => !!r.definition)
        .map((r) => ({ entryKey: r.word1, pinyin: r.pronunciation ?? '', definition: r.definition! }));

      return {
        grid: generated.grid,
        words: generated.words,
        bonusWords,
        rows,
        cols,
        total,
        available,
        sufficient: true,
        templateIndex: generated.templateIndex,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Awaits TTS synthesis for each entry's entryKey in parallel, stamping
   * `hasAudio` on the result. Used to pre-warm both the working-loop endpoint
   * and the mark endpoint's replacement card.
   *
   * Also stamps `dictionaryentries_zh.ttsVoice` so the column accurately reflects
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
        // of the schema references languages. Route to the per-language det
        // table so Spanish rows (dictionaryentries_es) actually get stamped
        // instead of silently no-op'ing against the Chinese table.
        const detTable = dictTableForLanguage(lang);
        const c = await db.getClient();
        try {
          await c.query(
            `UPDATE ${detTable} SET "ttsVoice" = $1 WHERE word1 = $2 AND language = $3 AND "ttsVoice" IS NULL`,
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

import type { PoolClient } from 'pg';
import type { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import type { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import type { ISortPacksDAL } from '../dal/interfaces/ISortPacksDAL.js';
import type { IStarterPacksDAL, DiscoverDetRow } from '../dal/interfaces/IStarterPacksDAL.js';
import { DiscoverCard, StarterPackBucket, SortPack } from '../types/index.js';
import { NotFoundError, ValidationError } from '../types/dal.js';
import { SortPackRow } from '../types/sortPacks.js';
import { coreSeededTypedMarkHistory, SORT_BUCKET_CORE_POSITIVES } from '../utils/masteryCompute.js';
import { DISCOVER_SORT_BUCKETS, type DiscoverSortBucket } from '../contracts/wire.js';
import { LazyEnrichmentService } from './LazyEnrichmentService.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation } from '../utils/definitions.js';

/**
 * Starter Packs Service
 * Business logic for the discover / "sort cards" flow.
 *
 * DESIGN (see docs/SORT_CARDS_REQUIREMENTS.md §6 — adaptive leveling): the
 * CLIENT owns the adaptive level once the session starts. The server's only leveling
 * job is (a) a one-time COLD-START seed via `estimateLevel` when the client enters the
 * flow with no level yet, and (b) serving supply centered on whatever level the client
 * asks for next, drifting to adjacent levels when that level's supply runs out (unless
 * the request is a manual dropdown pin, which never drifts). The client tracks its own
 * running target level and moves it ±1 per completed SortPack — see
 * `AddCardsPage.tsx` — because the level must react to a SortPack's outcome as soon as
 * it completes, not on the next server round-trip.
 *
 * Card source is the per-language dictionaryentries table, gated by `discoverSupplyGate`
 * (dal/shared/dictTable.ts): `discoverable = TRUE`, for every language. Per-user
 * sort state lives in two places:
 *   - vocabentries (vet): "Add to Learning" / "Already Learned" rows persist what the
 *     user did with a card; the CORE-bar band derived from `typedMarkHistory`
 *     (`CORE_CATEGORY_EXPR`, migration 143) is what `estimateLevel`'s cold-start seed reads.
 *   - discover_skips: "Skip for now" deferrals (migration 80). Deliberately separate
 *     so a skip carries NO level signal and never enters the library.
 *
 * Difficulty is ONE generalized integer scale '1'..'6' (migration 79) stored in the
 * dict table's difficulty column, ceiling 6 for every language:
 *   - Chinese (dictionaryentries_zh): '1'..'6' — these ARE HSK proficiency levels
 *     (1 = HSK1 .. 6 = HSK6); migration 79 dropped the old 'HSK' prefix only.
 *   - Spanish (dictionaryentries_es): '1'..'6' learner-acquisition difficulty.
 * The encoding is centralized in `MAX_LEVEL` + StarterPacksDAL's LEVEL_EXPR so the level math stays
 * language-agnostic. The UI draws the value as a six-hexagon meter in every language
 * (src/components/ScoreMeters.tsx → DifficultyMeter) and never names HSK.
 *
 * LAYER: service — no SQL. Supply, skips and seen packs go through `IStarterPacksDAL`;
 * the vet row a sort creates, promotes or undoes goes through `IVocabEntryDAL`; authored
 * packs through `ISortPacksDAL` (docs/BACKEND_LAYERING.md).
 */
export class StarterPacksService {
  /**
   * Cold-start tuning knobs for `estimateLevel` (docs/SORT_CARDS_REQUIREMENTS.md §6.1).
   * Used ONLY to seed the level the very first time a user enters the flow (no client
   * target level yet). A level L is "cleared" (so the cold-start seed skips past it)
   * when:
   *     mastered[L] >= MIN_MASTERED_TO_ADVANCE  AND  learning[L] <= LEARN_LATER_TOLERANCE
   * - MIN_MASTERED_TO_ADVANCE: master at least this many cards at L before advancing.
   * - LEARN_LATER_TOLERANCE: how many "Add to Learning" (not-yet-mastered) cards a
   *   level may carry and still clear. One stray "I'll learn this later" never strands
   *   the user; the second one settles them at L until review drains the pile.
   */
  private static readonly MIN_MASTERED_TO_ADVANCE = 3;
  private static readonly LEARN_LATER_TOLERANCE = 1;

  /**
   * The difficulty ceiling — one generalized 1..6 scale for every language (migration 79;
   * for zh the integer IS the HSK level). Must match `StarterPacksDAL`'s VALID_LEVEL band.
   */
  private static readonly MAX_LEVEL = 6;

  constructor(
    private vocabEntryDAL: IVocabEntryDAL,
    private dictionaryDAL: IDictionaryDAL,
    private sortPacksDAL: ISortPacksDAL,
    private starterPacksDAL: IStarterPacksDAL,
    // Request-time lazy-enrichment trigger (docs/DISCOVER_LAZY_ENRICHMENT.md §5).
    // Sorting a zh card into Learning / Already-Learned tops up its enrichment when
    // the sorter is a validator. Optional so non-DI test construction still works.
    private lazyEnrichmentService?: LazyEnrichmentService
  ) {}

  /**
   * Get the initial queue of ready-to-show cards for a language. The client holds a
   * short FIFO queue (size 2: head + one buffer), so the default limit is 2.
   * Returns `exhausted: true` only when the user has genuinely sorted the entire
   * discoverable dictionary (an extreme edge case — see getNextCards).
   */
  async getStarterPackCards(language: string, userId: string, limit = 2): Promise<{ cards: DiscoverCard[]; exhausted: boolean; level: number }> {
    return this.getNextCards(language, userId, [], limit);
  }

  /**
   * Select the next batch of ready-to-show cards (server is the sole owner of card
   * selection — the client does NO filtering). Supply order (docs §5):
   *   1. In-level first, then NEAREST-level-first — a single SQL `ORDER BY
   *      ABS(level - estimate)` gives in-level cards, then ±1, ±2, … so the user
   *      drifts away from their level only as gradually as the data allows.
   *   2. Recycle skips: only once non-skip supply is exhausted do skipped cards
   *      re-enter (oldest skip first), filling any remaining slots.
   * Excludes cards the user has already sorted (vet row) and any `excludeIds` the
   * client already holds. `exhausted` is true only when nothing is left at all.
   *
   * `level` is the user's estimated difficulty level (docs §6), returned for
   * DISPLAY ONLY — the client shows it as a chip but must never filter on it.
   */
  async getNextCards(language: string, userId: string, excludeIds: number[] = [], limit = 2): Promise<{ cards: DiscoverCard[]; exhausted: boolean; level: number }> {
    const level = await this.estimateLevel(userId, language);

    // Step 1: fresh (non-skipped) cards, nearest-level-first.
    let rows = await this.starterPacksDAL.findSupplyRows(language, userId, level, excludeIds, { includeSkips: false, limit });

    // Step 2: backfill from recycled skips only if fresh supply ran short.
    if (rows.length < limit) {
      const have = new Set([...excludeIds, ...rows.map((r) => r.id)]);
      const skipRows = await this.starterPacksDAL.findSupplyRows(language, userId, level, [...have], { includeSkips: true, limit: limit - rows.length });
      rows = rows.concat(skipRows);
    }

    const enriched = await this._enrichDiscoverCards(this._rowsToDiscoverCards(rows), language);
    return { cards: enriched, exhausted: enriched.length === 0, level };
  }

  /**
   * Map raw dictionaryentries rows into DiscoverCard DTOs. Shared by both the
   * Chinese and Spanish flows so the row→card shape stays in one place.
   *
   * `definition` and `pronunciation` are SENSE-RESOLVED here rather than read straight off
   * the row. A discover card is a bare det row — it has no vet row yet, so there is no
   * `selectedSense` to honor and both resolvers land on the entry's default (highest-
   * frequency) sense. That still matters: the det `pronunciation` column is the unreviewed
   * CEDICT seed the clusterer was given, so a heteronym whose clusters were corrected keeps
   * the wrong reading in the column forever (重点 = `chóng diǎn` in the column,
   * `zhòng diǎn` in its clusters). Resolving here is what keeps the sort flow agreeing with
   * the flashcard the learner gets the moment they sort the card.
   *
   * The clusters themselves deliberately do NOT travel — `DiscoverCard` is unchanged and the
   * payload stays the same size. See docs/DEFINITION_CLUSTERS.md.
   */
  private _rowsToDiscoverCards(rows: DiscoverDetRow[]): DiscoverCard[] {
    return rows.map(row => ({
      id: row.id,
      entryKey: row.word1,
      definition: resolveDisplayDefinition({
        definition: Array.isArray(row.definitions) ? row.definitions[0] : row.definitions,
        definitionClusters: row.definitionClusters,
      }),
      pronunciation: resolveDisplayPronunciation(row),
      tone: row.tone,
      language: row.language,
      word2: row.word2,
      script: row.script,
      difficulty: row.difficulty,
      frequencyScore: row.frequencyScore ?? null,
      breakdown: row.breakdown,
      synonyms: row.synonyms,
      exampleSentences: row.exampleSentences,
      exampleSentencesMetadata: null, // Computed on-the-fly in _enrichDiscoverCards
      // Optional icons8 icon for the card; client renders it via /api/icons8/<iconId>/image.
      iconId: row.iconId ?? null,
    }));
  }

  /**
   * Compute example-sentence enrichment metadata on-the-fly, in batch.
   * The enrichment method dispatches internally on language (Spanish uses
   * whitespace tokenization; Chinese uses greedy segmentation).
   */
  private async _enrichDiscoverCards(cards: DiscoverCard[], language: string): Promise<DiscoverCard[]> {
    return this.dictionaryDAL.enrichExampleSentencesMetadataBatch(cards, language);
  }

  /**
   * COLD-START ONLY (docs §6.1): the lowest level the user has NOT yet cleared, used to
   * seed the client's adaptive target level the first time it enters the flow with no
   * level of its own to send. Once seeded, the client tracks and moves its own target
   * level per-SortPack-signal (§6) — this is never called again mid-session
   * to re-derive or override that running estimate. Pure function of vet mastery state,
   * so it still picks up flashcard-review progress (and demotions) automatically for
   * the NEXT cold start (e.g. a fresh session after time away).
   *
   * For each level L we count, in ONE grouped query:
   *   - mastered[L]: vet rows at L with category = 'Mastered'.
   *   - learning[L]: vet rows at L in the library but NOT mastered (the "don't know"
   *     / frontier signal). Skips are in discover_skips, not vet, so they never count.
   * A level is cleared when mastered[L] >= MIN_MASTERED_TO_ADVANCE AND
   * learning[L] <= LEARN_LATER_TOLERANCE. The same rule gives both the fast cold-start
   * climb and the slow settled climb, because learning[L] self-shrinks as cards are
   * mastered. A brand-new user (all zero) is not-cleared at L1 → estimate 1.
   */
  async estimateLevel(userId: string, language: string): Promise<number> {
    // Banded on the CORE bar (migration 143) — see StarterPacksDAL.countSortedByLevel.
    // Index the per-level counts so missing levels read as 0.
    const mastered = new Map<number, number>();
    const learning = new Map<number, number>();
    for (const row of await this.starterPacksDAL.countSortedByLevel(userId, language)) {
      mastered.set(row.level, row.mastered);
      learning.set(row.level, row.learning);
    }

    // Walk up from the bottom; return the first uncleared level.
    for (let L = 1; L <= StarterPacksService.MAX_LEVEL; L++) {
      const cleared =
        (mastered.get(L) ?? 0) >= StarterPacksService.MIN_MASTERED_TO_ADVANCE &&
        (learning.get(L) ?? 0) <= StarterPacksService.LEARN_LATER_TOLERANCE;
      if (!cleared) return L;
    }
    return StarterPacksService.MAX_LEVEL; // everything cleared → top of the scale
  }

  /**
   * The sort-progress bar: discoverable cards vs the ones the user has acted on (sorted
   * vet rows + current skips).
   */
  async getProgress(language: string, userId: string): Promise<{
    total: number; sorted: number; remaining: number; percentComplete: number;
  }> {
    const [total, sorted] = await Promise.all([
      this.starterPacksDAL.countDiscoverable(language),
      this.starterPacksDAL.countSortedOrSkipped(userId, language),
    ]);
    return {
      total,
      sorted,
      remaining: total - sorted,
      percentComplete: total > 0 ? Math.round((sorted / total) * 100) : 0,
    };
  }

  /**
   * QUICK MARK (docs/QUICK_MARK.md) — bulk-triage supply. Unlike the Add Cards pack
   * supply, this returns a full PAGE of not-yet-sorted discoverable words at ONE EXACT
   * level, ordered by vernacular score (most colloquial first), paginated by offset.
   *
   * Differences from `StarterPacksDAL.findSupplyRows`:
   *   - exact level only (no nearest-level ± drift);
   *   - `discover_skips` is NOT excluded — a skipped word has no vet row, so it is
   *     offered here for a second triage pass (docs §5, resolved decision);
   *   - KEYSET (cursor) pagination with a `hasMore` probe (fetch limit+1).
   *
   * Pagination is keyset, NOT offset: the batch save creates vet rows for the cards
   * the user marked, which drops them out of this (vet-excluding) result set. A numeric
   * OFFSET would then skip that many still-unsorted cards on the next page. A cursor on
   * the stable sort key — `(frequencyScore DESC NULLS LAST, id ASC)` — always resumes
   * exactly after the last card shown, regardless of rows removed above it. The cursor
   * is the last-seen `{ score, id }`; null (first page) means no lower bound.
   *
   * `level == null` seeds from the user's adaptive frontier (estimateLevel) so opening
   * the page with no chosen level lands on their current level.
   */
  async listQuickMarkCards(
    language: string,
    userId: string,
    level: number | null,
    cursor: { score: number | null; id: number } | null,
    limit = 100,
  ): Promise<{ cards: DiscoverCard[]; level: number; hasMore: boolean }> {
    const resolvedLevel = level ?? await this.estimateLevel(userId, language);

    // Over-fetch by one: the extra row only answers "is there another page?".
    const rows = await this.starterPacksDAL.findQuickMarkPage(language, userId, resolvedLevel, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const cards = await this._enrichDiscoverCards(this._rowsToDiscoverCards(pageRows), language);
    return { cards, level: resolvedLevel, hasMore };
  }

  /**
   * QUICK MARK batch save (docs/QUICK_MARK.md §6). Reconciles each card's vet state to
   * its on-screen mark in one request — this is NOT append-only, because Quick Mark
   * leaves saved cards on-page and re-savable, so cycling a card back to empty must
   * DELETE the vet row an earlier Save created.
   *   - 'library' / 'already-learned' → `sortCard` (same bucket effects as Add Cards).
   *     Passing opts={packId:null} takes sortCard's lightweight pack-mode return path:
   *     it writes the vet row and clears any skip WITHOUT computing a replacement card.
   *   - 'empty' → `undoSort` (non-skip branch) deletes any vet row for the card; a
   *     no-op when none exists (a card the user marked and cleared without ever saving).
   * Failures are logged per-card and skipped so one bad id can't abort the whole save.
   */
  async quickMarkBatch(
    userId: string,
    language: string,
    marks: Array<{ cardId: number; state: 'empty' | 'library' | 'already-learned' }>,
  ): Promise<{ success: boolean; applied: number }> {
    let applied = 0;
    for (const { cardId, state } of marks) {
      try {
        if (state === 'empty') {
          await this.undoSort(userId, cardId, 'library', language);
        } else {
          await this.sortCard(userId, cardId, state, language, [], { packId: null });
        }
        applied++;
      } catch (err) {
        console.error(`[QuickMark] Failed to apply mark for card ${cardId} (${state}):`, err);
      }
    }
    return { success: true, applied };
  }

  /**
   * Sort a card into a bucket and return the single replacement card for the client's
   * FIFO tail (a sort always shrinks the queue by one, so it carries its own refill —
   * there is no separate "load more" call). `excludeIds` are the ids the client still
   * holds, so the replacement is never a duplicate.
   *
   * Bucket effects (docs §8):
   *   - skip            → INSERT discover_skips (NO vet row → no level signal).
   *   - library         → "Add to Learning": upsert vet row, empty history (Unfamiliar).
   *   - target          → upsert vet row + 3/3 core history → Target (pbh 4.0).
   *   - comfortable     → upsert vet row + 5/5 core history → Comfortable (pbh 6.67).
   *   - already-learned → upsert vet row + perfect 8/8 history → GENERATED category Mastered.
   * Per-bucket counts: SORT_BUCKET_CORE_POSITIVES (contracts/mastery.ts).
   */
  async sortCard(
    userId: string,
    cardId: number,
    bucket: string,
    language: string,
    excludeIds: number[] = [],
    // Pack mode: when `packId` is present (number OR null), the caller is the sort-pack
    // flow — it manages its own pack queue, so we DON'T compute a legacy replacement
    // card. When `lastInPack` is true the final card of an authored pack was just
    // sorted, so the pack is marked seen (never shown again). Legacy single-card
    // callers (and the Skipped-page popup) omit `opts` entirely and get `nextCard`.
    opts: { packId?: number | null; lastInPack?: boolean } = {}
  ): Promise<any> {
    const inPackMode = opts.packId !== undefined;
    if (!(DISCOVER_SORT_BUCKETS as readonly string[]).includes(bucket)) {
      throw new ValidationError(`Invalid bucket: ${bucket}`);
    }

    // Skip is signal-free: it lives in discover_skips, never in vet. Record it and
    // return — no dictionary lookup or vet upsert needed.
    if (bucket === 'skip') {
      await this._recordSkip(userId, cardId, language);
      const { cards, exhausted, level } = await this.getNextCards(language, userId, excludeIds, 1);
      return { success: true, message: 'Card skipped', bucket: 'skip', nextCard: cards[0] ?? null, exhausted, level };
    }

    // Every card bucket (library / target / comfortable / already-learned) persists as
    // the internal 'library' bucket (per CLAUDE.md "Learning" is UI text only). The
    // three above Unfamiliar additionally seed a core history that lands the card in
    // the band the learner chose (SORT_BUCKET_CORE_POSITIVES); library seeds nothing.
    const actualBucket: StarterPackBucket = 'library';
    const seedPositives = SORT_BUCKET_CORE_POSITIVES[bucket as Exclude<DiscoverSortBucket, 'skip'>];

    // Look up the card in the language-appropriate dictionary table. Card ids are
    // per-table surrogate serials that collide across languages, so we must scope
    // the lookup by language (DictionaryDAL.findById is hardcoded to _zh).
    //
    // A miss is a 404, not a 500: it means the id is unknown OR names a det row that is
    // not discoverable (the gate in findDiscoverableWordById). Neither is a server fault,
    // and the message is the same for both, so it does not reveal which rows exist
    // undiscoverable (docs/API_ABUSE_HARDENING.md § 1b).
    const dictEntry = await this._findDiscoverCardById(cardId, language);
    if (!dictEntry) {
      throw new NotFoundError(`Card ${cardId} not found`);
    }

    // Find or create the corresponding VocabEntry. Identity is
    // (userId, entryKey, language) for BOTH languages — Spanish dropped `pos` from the
    // key in migration 123, so one Spanish word is one card carrying all its senses.
    const existing = await this.vocabEntryDAL.findBucketRowByUserAndKey(
      userId, dictEntry.word1, dictEntry.language
    );

    let vocabEntryId: number;

    if (!existing) {
      // No `category` to insert: it is derived on read from "typedMarkHistory"
      // (compute_core_category, migration 143). A fresh row's empty history reads
      // 'Unfamiliar'; the seedPositives branch below seeds the band the learner chose.
      vocabEntryId = await this.vocabEntryDAL.insertLibraryRow(userId, dictEntry.word1, dictEntry.language);
      console.log(`[StarterPacks] Created VocabEntry id=${vocabEntryId} for entryKey=${dictEntry.word1}`);
    } else {
      vocabEntryId = existing.id;
      // A row already exists. The interesting case is a PROVISIONAL row (migration
      // 140): a temporary card a game handed the user, which they have now chosen to
      // keep. Promote it IN PLACE — flip the bucket and touch nothing else — so every
      // mark they earned on it while it was temporary survives being sorted. That is
      // the whole reason provisional cards are real vet rows rather than an ephemeral
      // list: progress is never lost to sorting. See docs/PROVISIONAL_CARDS.md.
      //
      // An already-'library' row is left completely alone (re-sorting a card the user
      // already holds must not reset anything).
      if (existing.starterPackBucket === 'provisional') {
        await this.vocabEntryDAL.promoteRowToLibrary(vocabEntryId, dictEntry.language);
        console.log(`[StarterPacks] Promoted provisional VocabEntry id=${vocabEntryId} to '${actualBucket}' for entryKey=${dictEntry.word1} (marks preserved)`);
      } else {
        console.log(`[StarterPacks] VocabEntry already exists id=${vocabEntryId} for entryKey=${dictEntry.word1}`);
      }
    }

    if (seedPositives > 0) {
      // Fill the CORE bar's two tracks to the chosen band (8/8 for Mastered) and
      // leave reading/writing at 0. The learner is declaring how well they know the
      // word, not that they can read or write it — those bars stay honest and start
      // from zero. See coreSeededTypedMarkHistory and docs/MASTERY_REWORK.md
      // § "Declaring a card already known".
      //
      // ⚠️ Like the Mastered seed always has, this REPLACES the row's history — so a
      // promoted provisional card's earned marks are overwritten by the declared band.
      const currentTimestamp: string = new Date().toISOString();
      await this.vocabEntryDAL.updateTypedMarkHistory(
        vocabEntryId,
        coreSeededTypedMarkHistory(seedPositives, currentTimestamp)
      );
      console.log(`[StarterPacks] Seeded VocabEntry id=${vocabEntryId} for bucket '${bucket}' (${seedPositives}/track core history)`);
    }

    // Sorting a card OVERRIDES any prior "skip for now" on it: a card that was skipped
    // and later sorted (from an authored pack, or the Skipped-page popup) must leave
    // discover_skips so it no longer shows in the skipped-cards sheet.
    await this._clearSkip(userId, cardId, language);

    // On-sort lazy-enrichment trigger (docs/DISCOVER_LAZY_ENRICHMENT.md §5). A skip
    // never reaches here (it returned early above), so this fires only for a real sort
    // into Learning / Already-Learned. Fire-and-forget: it self-gates to validators +
    // incomplete zh rows and never throws, so it can't affect the sort response.
    this.lazyEnrichmentService?.triggerForWord({
      word: dictEntry.word1,
      language: dictEntry.language,
      userId,
    });

    // Pack mode: the client owns its pack queue AND its own adaptive target level
    // (docs §6) — it derives the pack's signal from the buckets it already
    // knows client-side, so there is nothing level-related for the server to compute or
    // echo back here. Mark the pack seen when its last card was just sorted.
    if (inPackMode) {
      if (opts.packId != null && opts.lastInPack) {
        await this.markPackSeen(userId, opts.packId);
      }
      return { success: true, message: 'Card sorted successfully', bucket: actualBucket };
    }

    // Legacy single-card flow: compute the one replacement card AFTER the sort is
    // persisted, so the new vet row is reflected in the estimate and the exclusions.
    const { cards, exhausted, level } = await this.getNextCards(language, userId, excludeIds, 1);
    return { success: true, message: 'Card sorted successfully', bucket: actualBucket, nextCard: cards[0] ?? null, exhausted, level };
  }

  /**
   * Ensure `entryKey` exists as a `library` vet row for this user, and return its id.
   *
   * Keyed by WORD, not by det id, because the caller that needs it — Study Challenge's
   * accept transaction (docs/STUDY_CHALLENGE.md § 3.3) — stores its words as the
   * denormalised (language, word1) pair precisely so history survives a det data
   * deploy. A det id would be the wrong handle there.
   *
   * Shares `sortCard`'s three-way semantics deliberately, because "make sure this
   * word is in the learner's library" must mean exactly one thing app-wide:
   *   * no row        → create it in the `library` bucket;
   *   * provisional   → promote IN PLACE, so every mark earned while it was a lent
   *                     card survives (docs/PROVISIONAL_CARDS.md);
   *   * already library → touch NOTHING. Re-materialising a card the learner already
   *                     owns must not reset its bucket, its marks, its selected sense
   *                     or its icon layout.
   *
   * Takes the caller's client so it can enlist in their transaction — the accept path
   * creates vet rows and two decks atomically, and a half-applied accept would leave
   * two players with a challenge they cannot study for.
   *
   * Referenced by: StudyChallengeService.materialiseWords.
   */
  async ensureLibraryEntry(
    userId: string,
    entryKey: string,
    language: string,
    client: PoolClient
  ): Promise<number | null> {
    if (!userId || !entryKey || !language) return null;

    const existing = await this.vocabEntryDAL.findBucketRowByUserAndKey(userId, entryKey, language, client);
    if (existing) {
      if (existing.starterPackBucket === 'provisional') {
        await this.vocabEntryDAL.promoteRowToLibrary(existing.id, language, client);
      }
      return existing.id;
    }
    // Race-safe insert: a concurrent sort of the same word in another tab resolves to
    // that row's id rather than a unique-violation.
    return this.vocabEntryDAL.insertLibraryRowIfAbsent(userId, entryKey, language, client);
  }

  /**
   * Record a "Skip for now" deferral in discover_skips (signal-free — see §3.3).
   * Idempotent per (userId, language, cardId) via the unique index.
   */
  private async _recordSkip(userId: string, cardId: number, language: string): Promise<void> {
    await this.starterPacksDAL.insertSkips(userId, language, [cardId]);
  }

  /**
   * Undo the last sort. The client passes the bucket it sorted into so we reverse the
   * exact trace (docs §8):
   *   - skip            → DELETE the discover_skips row (by cardId — no word1 lookup).
   *   - library / target / comfortable / already-learned → DELETE the vet row (by word1).
   * Returns { success } — the client already has the card to re-show; it does not
   * need a replacement.
   */
  async undoSort(userId: string, cardId: number, bucket: string, language: string, packId: number | null = null): Promise<any> {
    // Undoing any card action within a pack means that pack is no longer fully
    // finished/skipped, so it must be un-seen (array_remove) — otherwise it would be
    // wrongly suppressed and never re-served. array_remove is a no-op when the id is
    // absent, so this is safe for non-completing undos too.
    if (packId != null) {
      await this.starterPacksDAL.removeSeenPack(userId, packId);
    }

    if (bucket === 'skip') {
      const removed = await this.starterPacksDAL.deleteSkip(userId, language, cardId);
      return removed
        ? { success: true, message: 'Skip undo successful' }
        : { success: false, message: 'Skip not found' };
    }

    // Any card bucket: reverse the vet row the sort created. Card ids collide across the
    // per-language det tables, so the word is resolved in the language's own table.
    const word1 = await this.starterPacksDAL.findWordById(cardId, language);
    if (!word1) {
      return { success: false, message: 'Card not found in sorted list' };
    }

    // Undo has TWO outcomes, because sorting can either CREATE a row or PROMOTE an
    // existing provisional one (migration 140, docs/PROVISIONAL_CARDS.md):
    //   - the row carries marks  → the user earned that progress in a game while the
    //     card was provisional. Deleting would silently destroy it, so it is demoted
    //     back to 'provisional': it leaves the deck, keeps its history, and discover
    //     keeps offering it, so it can be re-sorted later with the progress intact.
    //   - the row has no marks   → nothing to preserve; it is deleted, so a mis-tap
    //     leaves no trace and the word returns to the normal fresh supply.
    // Both happen in ONE statement (`undoSortedRow`), so the check cannot race a mark.
    const undone = await this.vocabEntryDAL.undoSortedRow(userId, word1, language);
    if (!undone) {
      return { success: false, message: 'Card not found in sorted list' };
    }
    if (undone.demoted) {
      console.log(`[StarterPacks] Undo demoted VocabEntry id=${undone.id} to 'provisional' (marks preserved) for entryKey=${word1}`);
    }
    return { success: true, message: 'Card undo successful', demoted: undone.demoted };
  }

  /**
   * Look up a discover card by its (per-table) surrogate id, scoped to the
   * language-appropriate dictionary table. Returns just the fields sortCard needs
   * (word1 + language). Replaces DictionaryDAL.findById, which is _zh-only.
   *
   * ⚠️ GATED ON `discoverable`, and it must stay that way. The supply queries that
   * FEED discover already filter on the flag, so a well-behaved client can only ever
   * send an id this returns — but a hand-rolled `POST /api/starterPacks/sort` can
   * send any det id at all. Without the gate that call adds an arbitrary dictionary
   * row to the caller's library, including rows whose enrichment columns
   * (`partsOfSpeech`, `longDefinition`, `exampleSentences`, and zh's `breakdown` /
   * `classifier` / `wordForms`) are still null, which is precisely the state
   * CLAUDE.md's mark-discoverable rule exists to keep out of learners' decks.
   *
   * Safe for the provisional-promotion path: lent cards are drawn from
   * `discoverable = TRUE` rows too (the same `discoverSupplyGate`), so promoting
   * one still resolves here.
   */
  private async _findDiscoverCardById(cardId: number, language: string): Promise<{ word1: string; language: string } | null> {
    return this.starterPacksDAL.findDiscoverableWordById(cardId, language);
  }

  // ===========================================================================
  // Sort packs (docs/SORT_PACKS_IMPLEMENTATION.md §3). The on-deck unit becomes a
  // SortPack (up to 4 cards, no sentence). Authored packs come from sort_packs; system
  // fallback packs-of-1 are built on the fly from a single fresh word.
  // ===========================================================================

  /** Delete any discover_skips row for (userId, language, cardId). No-op if absent. */
  private async _clearSkip(userId: string, cardId: number, language: string): Promise<void> {
    await this.starterPacksDAL.deleteSkip(userId, language, cardId);
  }

  /**
   * Record an authored pack as seen (finished or skipped) so it is never served again.
   * Appends only if absent, keeping seenPacks free of duplicates.
   */
  async markPackSeen(userId: string, packId: number): Promise<void> {
    await this.starterPacksDAL.addSeenPack(userId, packId);
  }

  /**
   * Hydrate discover cards for an explicit set of WORDS (det `word1` values), in the
   * order given, dropping any word with no discoverable det row.
   *
   * This is the sort flow's "here is a specific set to offer" entry point, used by the
   * provisional-card hand-off: a game finishes, the player taps "Sort these cards", and
   * the sort page is handed exactly the temporary words that round used rather than the
   * open-ended level-based supply (docs/PROVISIONAL_CARDS.md § Sorting what you played).
   *
   * Words are matched on `word1` because that is the identity a vet row carries
   * (`entryKey`); the caller holds vet rows, not det ids.
   */
  async getCardsForWords(words: string[], userId: string, language: string): Promise<DiscoverCard[]> {
    if (!words || words.length === 0) return [];
    const rows = await this.starterPacksDAL.findDiscoverableByWords(words, language);
    return this._enrichDiscoverCards(this._rowsToDiscoverCards(rows), language);
  }

  /**
   * Hydrate a set of det ids into DiscoverCards (in the given id order) tagged with
   * per-user pack state: `sorted` (has a library vet row → locked + "sorted!") and
   * `skipped` (currently in discover_skips → draggable again inside a pack). Used for
   * authored-pack cards.
   */
  private async _hydrateCards(entryIds: number[], userId: string, language: string): Promise<DiscoverCard[]> {
    const rows = await this.starterPacksDAL.findCardsWithPackState(entryIds, userId, language);
    // Preserve authored card order; attach the pack-state flags onto each DTO.
    return this._rowsToDiscoverCards(rows).map((card, i) => ({
      ...card,
      sorted: rows[i].sorted,
      skipped: rows[i].skipped,
    }));
  }

  /** Turn authored sort_packs rows into SortPack DTOs (cards hydrated; no sentence — not shown in this flow). */
  private async _hydrateAuthoredPacks(rows: SortPackRow[], userId: string, language: string): Promise<SortPack[]> {
    return Promise.all(rows.map(async (row) => ({
      packKey: `pack:${row.id}`,
      packId: row.id,
      level: row.level,
      cards: await this._hydrateCards(row.entryIds, userId, language),
    })));
  }

  /**
   * Build system fallback packs-of-1 from fresh (un-sorted, un-skipped) words nearest
   * the level. Reuses the card supply query, then wraps each enriched card as a
   * single-card pack.
   */
  private async _buildFallbackPacks(
    language: string,
    userId: string,
    level: number,
    excludeCardIds: number[],
    limit: number
  ): Promise<SortPack[]> {
    if (limit <= 0) return [];
    // Pin to EXACTLY this level — getNextPacks drives the nearest-level drift, so a
    // level's singles are served before drifting away (level honored first).
    const rows = await this.starterPacksDAL.findSupplyRows(language, userId, level, excludeCardIds, { includeSkips: false, limit, exactLevel: level });
    const cards = await this._enrichDiscoverCards(this._rowsToDiscoverCards(rows), language);
    return cards.map((card) => ({
      packKey: `single:${card.id}`,
      packId: null,
      level: (card.difficulty as number | null) ?? level,
      cards: [{ ...card, sorted: false, skipped: false }],
    }));
  }

  /**
   * Level visit order for the supply drift: the estimated level first, then outward by
   * distance, biased UPWARD on ties (adapt-up — a level-3 pack is preferred over a
   * level-1 pack for a level-2 user). e.g. level 2 → [2, 3, 1, 4, 5, 6].
   */
  private _levelDriftOrder(level: number): number[] {
    const levels: number[] = [];
    for (let l = 1; l <= StarterPacksService.MAX_LEVEL; l++) levels.push(l);
    return levels.sort((a, b) => {
      const da = Math.abs(a - level);
      const db = Math.abs(b - level);
      if (da !== db) return da - db;
      return b - a; // tie → higher level first (adapt upward)
    });
  }

  /**
   * Client-facing supply for the sort-pack flow. Serves AUTHORED packs first
   * (nearest-level-first by packOrder, excluding seen packs and any the client still
   * holds, dropping packs whose cards are ALL already sorted), then fills the rest with
   * fallback packs-of-1. `excludePackKeys` are the packKeys the client currently holds
   * so a replacement is never a duplicate. Skips are NOT auto-recycled (requirements §5.2).
   *
   * `requestedLevel` is the level to center supply on. Two callers, same param:
   *   - AUTO (client's adaptive target): the client sends the level it is currently
   *     tracking (docs §6 — it moves the target itself as SortPacks resolve,
   *     no server round-trip needed to decide the next level). `null` means the client
   *     has no target yet (its very first fetch this session) — the server seeds one
   *     via the cold-start `estimateLevel`.
   *   - MANUAL (the level dropdown, docs §6.5): the client sends its pinned level with
   *     `manual: true`.
   * `manual` controls drift: auto requests (manual=false, whether cold-started or
   * client-tracked) drift to adjacent levels when `requestedLevel`'s supply runs out
   * (§6.3); a manual pin never drifts — it collapses the walk to a single level. Either
   * way the returned `level` just echoes the center actually used, for the client to
   * remember (e.g. to capture the cold-start seed) — never re-derived from vet state
   * after cold start, and never shown as a fluctuating number in the auto UI.
   */
  async getNextPacks(
    language: string,
    userId: string,
    excludePackKeys: string[] = [],
    limit = 2,
    requestedLevel: number | null = null,
    manual = false
  ): Promise<{ packs: SortPack[]; exhausted: boolean; level: number }> {
    const level = requestedLevel != null ? requestedLevel : await this.estimateLevel(userId, language);
    const seen = await this.starterPacksDAL.findSeenPackIds(userId);

    // Split the client-held packKeys into authored ids and single card ids.
    const heldPackIds: number[] = [];
    const heldSingleIds: number[] = [];
    for (const key of excludePackKeys) {
      if (key.startsWith('pack:')) heldPackIds.push(Number(key.slice(5)));
      else if (key.startsWith('single:')) heldSingleIds.push(Number(key.slice(7)));
    }

    // LEVEL is honored before the authored-packs-first rule: walk levels nearest-first
    // and, WITHIN each level, serve authored packs then fallback singles, before ever
    // drifting to the next level. So a level-2 request exhausts ALL level-2 supply
    // (packs AND singles) before seeing any level-1 or level-3 card. A manual pin
    // collapses this walk to a single level — no drift out of the requested level.
    const excludePackIds = [...seen, ...heldPackIds];
    const excludeCardIds = [...heldSingleIds];
    const packs: SortPack[] = [];

    const levelsToVisit = manual ? [level] : this._levelDriftOrder(level);
    for (const lvl of levelsToVisit) {
      if (packs.length >= limit) break;

      // Authored packs at this level (over-fetch: some may drop as all-cards-sorted).
      const remaining1 = limit - packs.length;
      const candidates = await this.sortPacksDAL.fetchPacksAtLevel(language, lvl, excludePackIds, remaining1 * 3 + 5);
      const authored = await this._hydrateAuthoredPacks(candidates, userId, language);
      // Authored packs are served in CURATION ORDER — the `packOrder` sequence that
      // fetchPacksAtLevel already applied. Do NOT re-sort here: `packOrder` is a
      // deliberate human teaching sequence (packs build on each other), and a derived
      // ordering silently overrides it. Frequency ordering still governs the fallback
      // singles (StarterPacksDAL.findSupplyRows' ORDER BY), which have no curation order to respect.
      for (const p of authored) {
        if (packs.length >= limit) break;
        if (p.cards.some((c) => !c.sorted)) { // never serve an all-sorted pack (§4.5)
          packs.push(p);
          if (p.packId != null) excludePackIds.push(p.packId);
          excludeCardIds.push(...p.cards.map((c) => c.id));
        }
      }

      if (packs.length >= limit) break;

      // Then fallback packs-of-1 at this SAME level.
      const remaining2 = limit - packs.length;
      const fallback = await this._buildFallbackPacks(language, userId, lvl, excludeCardIds, remaining2);
      for (const p of fallback) {
        packs.push(p);
        excludeCardIds.push(...p.cards.map((c) => c.id));
      }
    }

    return { packs, exhausted: packs.length === 0, level };
  }

  /**
   * Skip a whole pack: record a discover_skips row for each remaining unsorted card
   * (each independently recoverable from the skipped-cards sheet) and mark the pack seen (for
   * authored packs). Signal-free — no vet rows, no level movement (requirements §5.1).
   */
  async skipPack(userId: string, cardIds: number[], language: string, packId: number | null = null): Promise<void> {
    await this.starterPacksDAL.insertSkips(userId, language, cardIds);
    if (packId != null) {
      await this.markPackSeen(userId, packId);
    }
  }

  /**
   * All words the user has currently skipped in a language, newest-first, as
   * DiscoverCards for acp's skipped-cards sheet. (No example-sentence enrichment — the grid
   * only needs the card face.)
   */
  async listSkipped(userId: string, language: string): Promise<DiscoverCard[]> {
    return this._rowsToDiscoverCards(await this.starterPacksDAL.findSkippedCards(userId, language));
  }

  /**
   * Recycle ONE skipped card back into the normal supply — the hold-to-recycle gesture
   * on a card in acp's hidden skipped-cards sheet (docs/SORT_CARDS_REQUIREMENTS.md
   * §5.1a). A no-op when the card is not (or no longer) skipped. Reuses `_clearSkip`,
   * the same delete a pack-less sort performs.
   */
  async recycleSkip(userId: string, cardId: number, language: string): Promise<void> {
    await this._clearSkip(userId, cardId, language);
  }

  /**
   * Recycle ALL of the user's skips for a language back into the normal supply (the
   * skipped-cards sheet's "Recycle all" action). Returns how many were cleared.
   */
  async recycleAllSkips(userId: string, language: string): Promise<number> {
    return this.starterPacksDAL.deleteAllSkips(userId, language);
  }
}

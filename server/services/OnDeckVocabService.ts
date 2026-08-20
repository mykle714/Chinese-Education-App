import { PoolClient } from 'pg';
import { VocabEntry, TypedMarkHistory, MarkType } from '../types/index.js';
import type { MasteryBarId } from '../contracts/wire.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { DictionaryService } from './DictionaryService.js';
import { StarterPacksService } from './StarterPacksService.js';
import { ValidationError } from '../types/dal.js';
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';
import { vetTableForLanguage, vetReadFrom, CORE_CATEGORY_EXPR, CORE_CATEGORY_SELECT, barCategoryExpr, masteredBarClause, builtinCollectionClause, type BuiltinCollectionId, typeCategoryExpr, vetSortedClause, vetPlayableClause, vetProvisionalClause, vetDeckOrProvisionalClause } from '../dal/shared/vetTable.js';
import { computeTypeCategory } from '../utils/masteryCompute.js';
import { rankCardQueue, isTypeOnCooldown } from './cardQueueRanking.js';
import { DICT_COLS, DICT_JOIN } from '../dal/shared/dictJoin.js';
import type { TTSService } from './TTSService.js';
import type { ProvisionalCardService } from './ProvisionalCardService.js';
import {
  generateWordSearchGrid,
  type GridCell,
  type WordSearchInput,
  type WordSearchGrid,
} from './wordSearchGrid.js';
import { resolveSenseGloss, resolveDisplayDefinition, resolveDisplayPronunciation } from '../utils/definitions.js';

// Difficulty-targeted study modes launched from the decks page (Review/Challenge
// buttons). Each mode shapes BOTH the initial working-loop distribution and the
// replacement-card pool handed back by the mark endpoint, so banned categories
// never leak in via a correct-mark refill.
export type StudyMode = 'review' | 'challenge';

/**
 * Which collection a game/flp round was launched from (docs/DECKS_FEATURE.md).
 * `undefined` anywhere this appears means an ordinary, unrestricted launch.
 *
 * A deck is a STORED set (a `deck_cards` join); every other collection is a COMPUTED
 * one, so the eight built-ins collapse into a single variant carrying the id whose
 * WHERE fragment defines it. That is why launching from "Comfortable" needed no new
 * variant here — only a new id.
 */
export type CollectionFilter =
  | { kind: 'deck'; deckId: number }
  | { kind: 'builtin'; id: BuiltinCollectionId };

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
//
// `allowed` is a HARD filter and is deliberately never widened. Review is exactly
// Comfortable + Mastered, Challenge is exactly Unfamiliar + Target — the same split
// Match Speed uses (src/games/match-speed/constants.ts). When a learner has
// nothing in Review's buckets the loop comes back thin (or empty) and the decks
// page greys the button; that is the intended answer, NOT a bug to fix by
// falling back to other categories. A "review" session padded with cards the
// learner has never seen is not a review session. Provisioned cards start with an
// empty mark history, so lending can fill Challenge but can never fill Review.
// See docs/PROVISIONAL_CARDS.md § 6.
export const MODE_CONFIGS: Record<StudyMode, ModeLoopConfig> = {
  // Review: ease the learner with cards they mostly know.
  review: {
    quotas: [{ category: 'Comfortable', count: 7 }, { category: 'Mastered', count: 3 }],
    fillOrder: ['Comfortable', 'Mastered'],
    allowed: ['Comfortable', 'Mastered'],
  },
  // Challenge: drill the cards the learner struggles with.
  challenge: {
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

/**
 * Fisher–Yates, in place. Used for the working loop's play order.
 *
 * NOT `sort(() => Math.random() - 0.5)`: that comparator is inconsistent, so the
 * result depends on the sort implementation's comparison pattern and is measurably
 * biased toward leaving elements near where they started — visible at n = 10, where
 * the loop's first card would disproportionately be whatever the ranking put first.
 */
function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

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
    private starterPacksService: StarterPacksService,
    // Card audio pre-warm (see the hasAudio field on VocabEntry). Injected rather
    // than imported as a singleton so the composition root owns its lifetime.
    private ttsService: TTSService,
    // Lends cards when the flp working loop cannot be filled from cards that are off
    // cooldown. Injected here rather than driven from the controller because the
    // decision is made mid-algorithm, once the shortfall is known — and the refill
    // path (getNextLibraryCardWithFallback) needs the same call.
    private provisionalCardService: ProvisionalCardService
  ) {}

  // The mark types the flp can actually present (docs/MASTERY_REWORK.md § 1): a
  // foreign-first prompt is a RECOGNITION review, an English-first prompt is a
  // PRODUCTION review. Reading/Writing marks come from other games (Word Search /
  // Practice Writing / Memory Map) and are never shown in the working loop, so flp
  // cooldown eligibility consults only these two tracks — a correct mark earned in
  // another game no longer suppresses a card from the flp.
  private static readonly FLP_MARK_TYPES: readonly MarkType[] = ['recognition', 'production'];

  // The flp's cooldown WINDOW is keyed on the card's OVERALL (core) category: the loop
  // presents two mark types on one card, so a single whole-card window is the coherent
  // choice. Games that exercise ONE track pass that track's per-type category instead.
  //
  // The cooldown table and the queue maths themselves live in services/cardQueueRanking.ts
  // — a pure module shared with Memory Map, which needs the identical discipline on the
  // reading track (docs/MEMORY_MAP_GAME.md § 13.1). They used to be private methods here.
  private flpWindowCategory(card: VocabEntry): string | null | undefined {
    return card.category;
  }

  /**
   * The flp-eligible subset of `cards` (≥1 mark type off cooldown), each stamped with
   * its `readyMarkTypes`, ordered AS A QUEUE: longest-waiting first.
   *
   * This is the flp's one ranking rule, shared by the initial working loop and the
   * mark-endpoint refill so a loop and its replacements are drawn the same way. It
   * ranks WITHIN a utcm category — the quota distribution still decides how many cards
   * come from each mastery bucket, and this decides which cards fill them.
   *
   * TWO TIERS, and the second is the reason this can't be a plain ascending sort:
   *
   *   1. cards with review history, by arrival time ASC — the card that came off
   *      cooldown earliest is served first (see cardQueueRanking.queueArrivalAt);
   *   2. never-marked cards (no correct mark in either flp track) — always LAST,
   *      however long they have technically been "available".
   *
   * A never-marked card scores -Infinity, which an ascending sort would put at the
   * FRONT, so the tier is compared before the timestamp. Brand-new sorts and lent
   * provisional cards are therefore reached only once genuinely rested cards run out.
   *
   * Ties (notably the whole never-marked tail) keep the caller's incoming order, which
   * is `createdAt DESC` — newest first. Array.sort is stable.
   */
  private rankFlpEligible(cards: VocabEntry[], now: number): VocabEntry[] {
    // The ordering rule itself is shared (rankCardQueue); what the flp adds is stamping
    // the ready tracks onto the returned card as `readyMarkTypes`, which the client uses
    // to steer which face it shows.
    return rankCardQueue(cards, now, {
      markTypes: OnDeckVocabService.FLP_MARK_TYPES,
      windowCategoryOf: (card) => this.flpWindowCategory(card),
    }).map(({ card, readyTypes }) => ({ ...card, readyMarkTypes: readyTypes }));
  }

  /**
   * Whether a session may be topped up with LENT cards when its own pool is spent.
   *
   * A provisional card has an empty mark history, so it computes as Unfamiliar and can
   * only ever satisfy a pool that accepts that category. Lending into a session that
   * would then filter the card straight back out is pure waste, and lending into a
   * NAMED set is worse than waste — a Review round padded with words the learner has
   * never seen is not a review, and a deck round made of non-deck words is not that
   * deck. Those sessions honor the cooldown and come back empty instead.
   *
   *   Mix / Challenge, unrestricted → lend
   *   Review, `?collection=mastered`, `?deck=` → never lend
   *
   * Expressed as one rule (Unfamiliar is servable AND the round is unrestricted)
   * rather than a mode/collection switch, so a future mode or collection gets the
   * right answer by construction.
   */
  private canLendProvisional(
    loopCategories: string[],
    collection?: CollectionFilter | null
  ): boolean {
    if (collection) return false;
    return loopCategories.includes('Unfamiliar');
  }

  // A card is playable in a game when the ONE mark type that game emits is off its
  // per-type cooldown (bubble-match = recognition; word-search = reading in
  // No-Pinyin mode, production in Pinyin mode). The window duration comes from that
  // same track's per-type category, so the whole game path — bucketing and resting
  // alike — reads only the history of the track it exercises.
  // See docs/MASTERY_REWORK.md § Per-type cooldown ("Games").
  private isCardGameEligible(card: VocabEntry, markType: MarkType, now: number): boolean {
    const windowCategory = computeTypeCategory(card.typedMarkHistory, markType);
    return !isTypeOnCooldown(card.typedMarkHistory, markType, now, windowCategory);
  }

  /**
   * Fetch per-category library candidates for a game, split into `eligible`
   * (the game's mark type is off cooldown = fresh) vs `cooled` (still cooling).
   * Each partition preserves the SQL RANDOM() order. Games fill their pool from
   * `eligible` first — requested categories, then fallback categories — and only
   * dip into `cooled` as a last resort to reach the required count, so the
   * per-type cooldown is honored without ever blocking entry more than an
   * un-cooled library would.
   *
   * BUCKETING IS PER MARK TYPE (docs/MASTERY_REWORK.md § "Games select by their own
   * mark type"): the category a candidate is filed under comes from the recent mark
   * history of `markType` alone (compute_type_category), NOT from the core-bar
   * compute_core_category the flp and decks page use. A card with a maxed
   * Recognition window but an empty Reading window is a Mastered candidate for
   * Bubble Match and an Unfamiliar one for Word Search No-Pinyin — which is the
   * point: each game drills the track it is actually training.
   *
   * The row's core category is still selected (as `category`) so downstream
   * consumers of VocabEntry keep their usual whole-card field; only the WHERE
   * bucket changed.
   *
   * `maxEntryKeyLen` (Word Search) restricts candidates to short words the grid
   * can place; omit for no length cap.
   *
   * `excludeIds` drops specific vocab-entry ids from every bucket. Used by the
   * partial-refill game pool (Bubble Match's "Play Again" keeps the cards the
   * player failed to match, so those must not come back as replacements).
   */
  private async fetchGameCandidates(
    client: PoolClient,
    userId: string,
    language: string,
    categories: string[],
    markType: MarkType,
    now: number,
    cap: number,
    maxEntryKeyLen?: number,
    excludeIds: number[] = [],
    collection?: CollectionFilter | null
  ): Promise<{ eligible: Record<string, VocabEntry[]>; cooled: Record<string, VocabEntry[]> }> {
    const eligible: Record<string, VocabEntry[]> = {};
    const cooled: Record<string, VocabEntry[]> = {};
    // Optional collection restriction (docs/DECKS_FEATURE.md). $7 is the next free
    // placeholder after the six bound below.
    const deck = this.deckPlayFilter(collection, 7);
    // maxEntryKeyLen is a caller-supplied constant (never user input); coerce to a
    // safe integer before inlining, since it isn't a bind param.
    const lenClause = maxEntryKeyLen != null
      ? `AND LENGTH(ve."entryKey") <= ${Math.max(0, Math.floor(maxEntryKeyLen))}`
      : '';
    for (const category of categories) {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}, ${CORE_CATEGORY_SELECT}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1
        AND ve."language" = $4
        -- PLAYABLE: a game round may draw provisional cards, which is the whole
        -- point of the baseline top-up (docs/PROVISIONAL_CARDS.md).
        AND ${vetPlayableClause()}
        AND ${typeCategoryExpr('$5')} = $2
        AND NOT (ve.id = ANY($6::int[]))
        ${lenClause}
        ${deck.clause}
        ORDER BY RANDOM()
        LIMIT $3
      `, [userId, category, cap, language, markType, excludeIds, ...deck.params]);

      const fresh: VocabEntry[] = [];
      const stale: VocabEntry[] = [];
      for (const row of result.rows) {
        // Stamp the row with the bucket it was actually drawn from. The loop key is
        // the per-mark-type game category (Unfamiliar/Target/Comfortable/Mastered) —
        // distinct from the row's `category`, which CORE_CATEGORY_SELECT fills with
        // the CORE bar's utcm level. Match Speed keys its client-side card
        // buffer off this, and needs it to stay truthful when the fill loops in
        // getGameVocabPool top a short bucket up from the fallback order: the card
        // carries the label of the queue it came out of, not the one that was asked
        // for. See docs/MATCH_SPEED_GAME.md § Backend change.
        // `categories` is a caller-supplied list of FlashcardCategory values typed
        // loosely as string[], hence the assertion.
        row.gameCategory = category as VocabEntry['gameCategory'];
        (this.isCardGameEligible(row, markType, now) ? fresh : stale).push(row);
      }
      eligible[category] = fresh;
      cooled[category] = stale;
    }
    return { eligible, cooled };
  }

  /**
   * Held PROVISIONAL cards near a difficulty, off cooldown — the RE-LEND source
   * (docs/PROVISIONAL_CARDS.md § 3b).
   *
   * Only meaningful for a TIER-TARGETED caller. Every other caller has already had
   * its chance at these rows: they are `vetPlayableClause()`, so an ordinary pool
   * query picks them up in its own bucket at fill tier 1 or 3. What no ordinary query
   * can do is ask for them BY DIFFICULTY, which is exactly what a rolled Hydra color
   * needs — and without this, a long run mints a brand-new row for every color slot
   * the library cannot cover, forever.
   *
   * Ordered nearest-difficulty-first (the same `ABS(difficulty - level)` widening the
   * minting query uses, so re-lend and mint agree about what "tier 3" means), then
   * randomly within a distance so a run does not replay one fixed sequence.
   *
   * Cooldown is filtered in APP CODE, not SQL, because that is where it lives
   * (`cardQueueRanking.isTypeOnCooldown` reads `typedMarkHistory`). A still-resting
   * card is dropped rather than served: the cooldown is never broken to re-lend.
   */
  private async fetchRelendable(
    client: PoolClient,
    userId: string,
    language: string,
    targetLevel: number,
    markType: MarkType,
    now: number,
    limit: number,
    excludeIds: number[],
    collection?: CollectionFilter | null
  ): Promise<VocabEntry[]> {
    if (limit <= 0) return [];
    // $6 is the next free placeholder after the five bound below.
    const deck = this.deckPlayFilter(collection, 6);
    const result = await client.query<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $2
      AND ${vetProvisionalClause()}
      AND NOT (ve.id = ANY($4::int[]))
      ${deck.clause}
      ORDER BY ABS(COALESCE(de."difficulty", 99) - $3) ASC, RANDOM()
      LIMIT $5
    `, [userId, language, targetLevel, excludeIds, limit, ...deck.params]);

    return result.rows.filter((row) => this.isCardGameEligible(row, markType, now));
  }

  /**
   * Lend `need` cards for a GAME pool and hand them back as FRESH candidates.
   *
   * The game equivalent of lendIntoLoop. Two steps, in order
   * (docs/PROVISIONAL_CARDS.md § 3b):
   *
   *   1. RE-LEND — when the caller pinned a `targetLevel`, first draw from
   *      provisional rows the learner already holds near that difficulty and that
   *      are off cooldown. Costs nothing and mints nothing.
   *   2. MINT — cover whatever step 1 could not, exactly as before.
   *
   * Step 1 is skipped without a `levelOffset`, and that is not an oversight: an
   * untargeted caller's held provisional rows are already reachable through its own
   * bucket query, so re-lending them here would return rows the fill loop has either
   * taken already or deliberately passed over.
   *
   * A minted row has no mark history, so it bands Unfamiliar on every track and can
   * never be on cooldown — re-querying the Unfamiliar bucket with the caller's
   * exclusions therefore returns essentially just the new rows.
   *
   * Returns [] when both steps come up empty, so the caller falls through to its
   * borrow/cooled tiers exactly as it did before lending existed here.
   *
   * NOTE the length cap: Word Search passes `maxEntryKeyLen`, but nothing constrains
   * lending itself to short words, so a lend can legitimately yield zero usable rows
   * for that game. That is the same over-lend the controller's PROVISION_RETRY_FACTOR
   * loop already accepts (docs/PROVISIONAL_CARDS.md).
   */
  private async lendGameCandidates(
    client: PoolClient,
    userId: string,
    language: string,
    need: number,
    markType: MarkType,
    now: number,
    cap: number,
    maxEntryKeyLen: number | undefined,
    excludeIds: number[],
    collection?: CollectionFilter | null,
    levelOffset?: number
  ): Promise<VocabEntry[]> {
    if (need <= 0) return [];

    // Resolve the tier ONCE, so the re-lend query and the mint agree about what this
    // color means and the learner's level is estimated a single time.
    const level = levelOffset !== undefined
      ? await this.provisionalCardService.resolveLendLevel(userId, language, levelOffset)
      : undefined;

    // 1. Re-lend what the learner already holds at this tier.
    const relent = level !== undefined
      ? await this.fetchRelendable(
          client, userId, language, level, markType, now, need, excludeIds, collection
        )
      : [];
    if (relent.length >= need) return relent.slice(0, need);

    // 2. Mint the shortfall. The re-lent rows are added to the exclusion list so the
    //    post-mint re-query cannot hand the same card back twice.
    const { granted } = await this.provisionalCardService.lendCards(
      userId, language, need - relent.length, 'default', { level }
    );
    if (granted === 0) return relent;
    const { eligible } = await this.fetchGameCandidates(
      client, userId, language, ['Unfamiliar'], markType, now, cap, maxEntryKeyLen,
      [...excludeIds, ...relent.map((card) => card.id)], collection
    );
    return [...relent, ...(eligible['Unfamiliar'] ?? [])];
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
    const withDefsApproval = await this.dictionaryService.enrichFieldApprovalsBatch(withLongDefMeta, language);
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
        SELECT ve.*, ${DICT_COLS}, ${CORE_CATEGORY_SELECT}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1
        AND ve."language" = $2
        -- SORTED: this is the deck the user built, not what a game may serve.
        AND ${vetSortedClause()}
        ORDER BY ve."createdAt" DESC
      `, [userId, language]);

      return await this.enrichEntriesPipeline(result.rows, language);
    } finally {
      client.release();
    }
  }

  /**
   * Every card in one user-authored deck, enriched exactly like the Learn Now and
   * Mastered collections above, so one client component renders all three
   * (docs/DECKS_FEATURE.md).
   *
   * ── Why this read lives here and not in DeckDAL ───────────────────────────────
   * It is the THIRD collection read, not a deck feature: it needs DICT_JOIN, the
   * utcm category expression and `enrichEntriesPipeline`, all of which already sit
   * on this service beside its two siblings. DeckDAL owns the deck tables and
   * answers membership questions; DeckService owns the ownership check and calls
   * this. See DeckService's class comment.
   *
   * SORTED, not playable: this is a view of the user's own cards, so a card lent
   * by the provisional top-up (which is never written into a deck anyway — see
   * vetDeckOrProvisionalClause) must not appear in the list. `vetDeckClause` is
   * the strict "in the deck" form for the same reason.
   *
   * ORDERED BY MEMBERSHIP, newest addition first — not by the card's `createdAt`
   * like the other two collections. A deck is something the user assembled, so
   * "what I most recently put in here" is the meaningful recency, and it matches
   * the order DeckDAL.listDeckCardIds returns.
   *
   * The caller MUST have already established that `deckId` belongs to `userId`
   * (DeckService.getDeck does). The `ve."userId" = $1` filter means a wrong deck
   * id yields an empty list rather than another user's cards, but it is a backstop,
   * not the check.
   */
  async getDeckCards(userId: string, language: string, deckId: number): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}, ${CORE_CATEGORY_SELECT},
               dc."addedAt" AS "deckAddedAt"
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        -- Joined rather than spliced as vetDeckClause's EXISTS: this read needs
        -- the membership row's "addedAt" for its sort, which a semi-join cannot
        -- expose. At most one deck_cards row matches (composite PK), so the join
        -- cannot duplicate a card.
        JOIN deck_cards dc ON dc."vocabEntryId" = ve.id AND dc."deckId" = $3
        WHERE ve."userId" = $1
        AND ve."language" = $2
        -- SORTED: deck read (a deck never contains a lent card).
        AND ${vetSortedClause()}
        ORDER BY dc."addedAt" DESC
      `, [userId, language, deckId]);

      return await this.enrichEntriesPipeline(result.rows, language);
    } finally {
      client.release();
    }
  }

  /**
   * WHERE fragment restricting a PLAYABLE read to one collection, or the empty
   * string when the launch was unrestricted.
   *
   * Every deck-filtered selection query composes this with its bucket clause; the
   * deck id is bound, never interpolated (only the `$n` placeholder position is,
   * and that is computed from the caller's own parameter list).
   *
   * For a DECK it uses the "deck OR provisional" form, not the strict one: a game
   * launched from a four-card deck still gets topped up to its baseline, and those
   * lent cards must be servable even though they are not deck members. See
   * docs/DECKS_FEATURE.md § Playing a small deck.
   *
   * There is no 'learn-now' variant, and that is not an omission: the Learn Now
   * collection IS every sorted card, which is exactly what these queries already
   * select. Adding a clause for it would restate `vetPlayableClause()`.
   */
  private deckPlayFilter(
    collection: CollectionFilter | null | undefined,
    nextParamIndex: number
  ): { clause: string; params: number[] } {
    if (collection == null) return { clause: '', params: [] };

    if (collection.kind === 'builtin') {
      // Every built-in collection is a COMPUTED set, not a stored one, so it filters
      // on the same expression its collection page lists by — one shared definition
      // in `builtinCollectionClause`, so the round and the page can never disagree
      // about what the set contains.
      //
      // Applied to EVERY candidate query, including the fallback buckets, so a round
      // launched from Comfortable cannot quietly top itself up with Unfamiliar cards.
      // Note this is the card's CORE/BAR band, not the game's per-track band — a card
      // can therefore be core-Mastered and still land in the game's Unfamiliar bucket,
      // which is correct: the set is what the user chose, the bucket is how the game
      // paces it.
      return { clause: `AND ${builtinCollectionClause(collection.id)}`, params: [] };
    }

    return {
      clause: `AND ${vetDeckOrProvisionalClause(`$${nextParamIndex}`)}`,
      params: [collection.deckId],
    };
  }

  /**
   * How many sorted cards are mastered in EACH bar — the figures on the fdp's up-to-
   * three Mastered rows (migration 143).
   *
   * One query with three FILTERed counts rather than three round trips, and rather
   * than a `bar` parameter on getCategoryCounts: the page needs all three numbers at
   * once and the three predicates share a single scan of the same rows.
   *
   * Every bar is counted even when its goal is off. The caller decides which rows to
   * show; making the count itself goal-aware would mean re-fetching on a goal toggle
   * to populate a row whose answer we already had.
   */
  async getMasteredCountsByBar(
    userId: string,
    language: string
  ): Promise<Record<MasteryBarId, number>> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const client = await db.getClient();
    try {
      const result = await client.query<{ core: number; reading: number; writing: number }>(`
        SELECT
          COUNT(*) FILTER (WHERE ${masteredBarClause('core')})::int    AS core,
          COUNT(*) FILTER (WHERE ${masteredBarClause('reading')})::int AS reading,
          COUNT(*) FILTER (WHERE ${masteredBarClause('writing')})::int AS writing
        FROM ${vetTableForLanguage(language)} ve
        WHERE ve."userId" = $1
        AND ve."language" = $2
        -- SORTED: these are deck sizes shown to the user, so a lent card must not
        -- inflate them (same rule as getCategoryCounts).
        AND ${vetSortedClause()}
      `, [userId, language]);

      const row = result.rows[0];
      return {
        core: row?.core ?? 0,
        reading: row?.reading ?? 0,
        writing: row?.writing ?? 0,
      };
    } finally {
      client.release();
    }
  }

  /**
   * The contents of ONE built-in collection — the single read behind every non-deck
   * collection page (`GET /api/onDeck/collectionCards?collection=…`).
   *
   * The five built-ins differ ONLY in a WHERE fragment, so they share one query
   * rather than one method each. `builtinCollectionClause` (vetTable.ts) owns the
   * fragment; adding a sixth collection is a case there and an entry in the client's
   * shared list (src/features/flashcards/builtinCollections.ts).
   *
   * Every one of them is a SORTED read (`vetSortedClause`): lent provisional cards
   * are invisible to every deck surface, so a collection's size always means "cards
   * you chose to keep" (docs/PROVISIONAL_CARDS.md).
   *
   * Notes on the individual sets:
   * - **learn-now** is ONE ID PER BAR, and each reads only its own bar. The
   *   unqualified `learn-now` is the core set — "what is left to know" — and a card
   *   whose recognition/production is unfinished belongs there no matter how its
   *   reading or writing bar is doing. A single set requiring ALL bars would strand a
   *   core-mastered card in the active pile forever because the learner once enabled
   *   the writing goal; three independent sets say the true thing three times, and
   *   each is the exact complement of that bar's Mastered collection.
   * - The three **mastered** collections are not disjoint and are not meant to be: a
   *   card the learner both recognizes and can write appears in two. Each answers
   *   "what have I finished in THIS skill".
   * - Only `mastered` (core) is reachable without a goal; the other two are simply
   *   not offered in the UI. This method does not enforce that — a hand-rolled
   *   `?collection=mastered-reading` returns the correct, possibly non-empty reading
   *   set for someone who has been playing Word Search without the goal on, which is
   *   true rather than harmful.
   */
  async getBuiltinCollectionCards(
    userId: string,
    language: string,
    collection: BuiltinCollectionId
  ): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const client = await db.getClient();
    try {
      const result = await client.query<VocabEntry>(`
        SELECT ve.*, ${DICT_COLS}, ${CORE_CATEGORY_SELECT}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1
        AND ve."language" = $2
        -- SORTED: deck read.
        AND ${vetSortedClause()}
        AND ${builtinCollectionClause(collection)}
        ORDER BY ve."createdAt" DESC
      `, [userId, language]);

      return await this.enrichEntriesPipeline(result.rows, language);
    } finally {
      client.release();
    }
  }

  /**
   * Every flp candidate row of one category (DICT-joined, category-stamped,
   * UN-enriched), newest first. The single candidate source for BOTH flp paths — the
   * initial working loop and the mark-endpoint refill — so the two cannot drift.
   * `excludeIds` keeps already-chosen cards out.
   *
   * Deliberately UNLIMITED. Cooldown eligibility and the longest-waiting-first queue
   * ranking are computed in app code from `typedMarkHistory`, which SQL would have to
   * re-implement over jsonb to order by; a partial scan would rank a random subset and
   * silently return the wrong card. The refill path has always scanned a category in
   * full for the same reason. Enrichment stays deferred to only the chosen cards, so
   * the cost here is one narrow read per category, not per candidate.
   */
  private async fetchFlpCandidates(
    client: PoolClient,
    userId: string,
    category: string,
    language: string,
    excludeIds: number[],
    collection?: CollectionFilter | null
  ): Promise<VocabEntry[]> {
    // Optional collection restriction; $5 is the next free placeholder after the four below.
    const deck = this.deckPlayFilter(collection, 5);
    const result = await client.query<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $4
      -- PLAYABLE: feeds the flp working loop and its refill.
      AND ${vetPlayableClause()}
      AND ${CORE_CATEGORY_EXPR} = $2
      AND ve.id != ALL($3::int[])
      ${deck.clause}
      -- Stable tiebreak only; the real ordering is rankFlpEligible in app code.
      ORDER BY ve."createdAt" DESC
    `, [userId, category, excludeIds, language, ...deck.params]);
    return result.rows;
  }

  /**
   * Get the next library card for a correct-mark refill, honoring PER-TYPE
   * cooldowns (docs/MASTERY_REWORK.md § Per-type cooldown).
   *
   * Priority: the preferred category, then a LENT card, then Target -> Unfamiliar ->
   * Comfortable -> Mastered. At each step we take the head of that category's queue —
   * the card waiting longest since it came off cooldown (rankFlpEligible) — stamping
   * `readyMarkTypes` so the client shows a face for a ready type. `excludeIds` keeps cards already in the loop out.
   *
   * LEND BEFORE BORROWING (2026-08-17), mirroring the initial loop: once the preferred
   * category is spent we lend a fresh card rather than reaching into another category.
   * The lent card is Unfamiliar whatever was asked for, which is the accepted cost.
   * Skipped when the preferred category was not servable at all (a mode session whose
   * `preferredCategory` is outside `allowedCategories`) — there was no requested bucket
   * to come up short, so borrowing is the honest first move there and lending stays a
   * last resort.
   *
   * WHEN EVERY CANDIDATE IS COOLING the cooldown is HONORED rather than broken: an
   * unrestricted Mix/Challenge session lends one provisional card and serves that
   * (canLendProvisional), and every other session returns null so the client winds
   * the loop down. A cooling card is never re-served.
   *
   * `allowedCategories` (Review/Challenge modes) restricts the pool to the given
   * categories only — a banned category is never served, even as a last resort.
   * When the allowed pool is empty, returns null so the caller can wind the loop
   * down ("no more review/challenge cards remaining"). Enriches only the chosen card.
   *
   * `collection` (docs/DECKS_FEATURE.md) restricts the replacement pool to the
   * collection the session was launched from. IT MUST BE PASSED WHENEVER THE
   * SESSION WAS LAUNCHED FROM ONE — the mark endpoint is what refills the loop, so a deck-launched session
   * that omitted it here would start serving off-deck cards the moment the learner
   * answered the first card correctly.
   */
  async getNextLibraryCardWithFallback(
    userId: string,
    preferredCategory: string,
    language: string,
    excludeIds: number[] = [],
    allowedCategories?: string[],
    collection?: CollectionFilter | null
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
    // Everything the preferred category may fall back to, in priority order.
    const borrowOrder = fallbackBase.filter(cat => cat !== preferredCategory);

    const now = Date.now();
    const client = await db.getClient();
    try {
      let winner: VocabEntry | null = null;

      // Take the head of the first category queue that has an eligible card.
      const serveFrom = async (categories: string[]): Promise<VocabEntry | null> => {
        for (const category of categories) {
          const cards = await this.fetchFlpCandidates(client, userId, category, language, excludeIds, collection);
          if (cards.length === 0) continue;
          const ranked = this.rankFlpEligible(cards, now);
          if (ranked.length > 0) return ranked[0];
        }
        return null;
      };

      // Lend one card and serve it. The lent row has no mark history, so it is
      // Unfamiliar and immediately eligible; re-querying Unfamiliar returns it (any
      // Unfamiliar card that WAS eligible has already been considered by the caller's
      // passes). Returns null when dictionary supply is exhausted.
      let lendAttempted = false;
      const serveLent = async (): Promise<VocabEntry | null> => {
        lendAttempted = true;
        const { granted } = await this.provisionalCardService.lendCards(userId, language, 1);
        if (granted === 0) return null;
        const lent = await this.fetchFlpCandidates(client, userId, 'Unfamiliar', language, excludeIds, collection);
        return this.rankFlpEligible(lent, now)[0] ?? null;
      };

      // 1. The category the caller actually asked for.
      winner = await serveFrom(preferredFirst);

      // 2. LEND rather than borrow — but only when there really was a requested
      //    bucket (see the docblock) and the session may show a lent card.
      if (!winner && preferredFirst.length > 0 && this.canLendProvisional(fallbackBase, collection)) {
        winner = await serveLent();
      }

      // 3. Borrow across the remaining allowed categories.
      if (!winner) winner = await serveFrom(borrowOrder);

      // 4. Nothing anywhere is off cooldown. Rather than re-serve a resting card, lend
      //    — the last-resort case, and the only lend a no-preferred-bucket session gets.
      //    `lendAttempted` skips a second round trip when step 2 already found supply
      //    exhausted.
      if (!winner && !lendAttempted && this.canLendProvisional(fallbackBase, collection)) {
        winner = await serveLent();
      }

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
   * The top `limit` flp-eligible cards of one category for the initial working loop —
   * the head of that category's queue, longest-waiting first (rankFlpEligible),
   * stamped with `readyMarkTypes` for client face-steering. `excludeIds` keeps already-picked cards
   * out. Returns fewer than `limit`, including zero, when the category is spent.
   */
  private async fetchEligibleCategoryCards(
    client: PoolClient,
    userId: string,
    language: string,
    category: string,
    limit: number,
    excludeIds: number[],
    now: number,
    collection?: CollectionFilter | null
  ): Promise<VocabEntry[]> {
    if (limit <= 0) return [];
    const candidates = await this.fetchFlpCandidates(client, userId, category, language, excludeIds, collection);
    return this.rankFlpEligible(candidates, now).slice(0, limit);
  }

  /**
   * Top a short working loop up with freshly LENT cards, and return them.
   *
   * Reached when the learner's own cards cannot fill the loop — most often because
   * they are all resting on their cooldown, which `ensureBaseline` cannot detect
   * (the user is well past the 20-card baseline; the cards just aren't ready). We
   * honor the cooldown and lend instead of re-serving a cooling card.
   *
   * The lent rows have no mark history, so they compute as Unfamiliar and are
   * immediately eligible. Re-querying Unfamiliar with the loop's `excludeIds` returns
   * essentially just them: any Unfamiliar card that WAS eligible has already been
   * taken by the quota/top-up passes and is in `excludeIds`.
   *
   * Returns [] when dictionary supply is exhausted — the round then plays short, or
   * empty, rather than breaking the cooldown.
   */
  private async lendIntoLoop(
    client: PoolClient,
    userId: string,
    language: string,
    need: number,
    excludeIds: number[],
    now: number,
    collection?: CollectionFilter | null
  ): Promise<VocabEntry[]> {
    if (need <= 0) return [];
    const { granted } = await this.provisionalCardService.lendCards(userId, language, need);
    if (granted === 0) return [];
    return this.fetchEligibleCategoryCards(
      client, userId, language, 'Unfamiliar', need, excludeIds, now, collection
    );
  }

  /**
   * Get distributed working loop with a category distribution.
   * - Default (Mix): 1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target.
   * - `mode` 'review'/'challenge': the difficulty-targeted distributions in MODE_CONFIGS
   *   (Review = 7 Comfortable + 3 Mastered; Challenge = 7 Unfamiliar + 3 Target), each
   *   topping up only from its allowed categories.
   * - `categoryFilter`: returns up to 10 cards from that single category (legacy
   *   deck-tap path), ignoring distribution.
   *
   * PER-TYPE COOLDOWN (docs/MASTERY_REWORK.md § Per-type cooldown): every fetch is
   * eligibility-filtered — a card is only offered if ≥1 flp mark type
   * (recognition/production) is off cooldown, and it's stamped with
   * `readyMarkTypes` so the client steers the shown face. Within each quota the
   * eligible cards are ranked AS A QUEUE, longest-waiting first (rankFlpEligible), so
   * a quota is filled by the cards most overdue for review; cards with no correct mark
   * yet sort last. Enriches cards with related words that share
   * characters.
   *
   * WHEN A QUOTA IS SHORT the loop LENDS BEFORE IT BORROWS: the shortfall is covered
   * with freshly lent provisional cards first, and only what lending cannot cover is
   * taken from other categories via the mode's fill order. Lent cards are always
   * Unfamiliar, so this deliberately skews a short loop Unfamiliar rather than
   * deepening whichever bucket had surplus.
   *
   * The cooldown is never broken either way. A restricted session (Review, a builtin
   * collection, a deck) cannot lend, so it returns short (possibly empty) and the
   * client shows its "nothing ready" state. See canLendProvisional and
   * docs/PROVISIONAL_CARDS.md.
   *
   * `deckId` (docs/DECKS_FEATURE.md) restricts the whole loop — quotas, top-up and
   * the cooled last-resort fill alike — to one user-authored deck. It composes with
   * `mode`: a deck launched in Challenge mode draws Unfamiliar/Target cards FROM THAT
   * DECK. Note that the client must pass the same deck id to the mark endpoint,
   * which is what refills the loop as cards are answered.
   */
  async getDistributedWorkingLoop(
    userId: string,
    language: string,
    categoryFilter?: string | null,
    mode?: StudyMode,
    collection?: CollectionFilter | null
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
      // Cross-category borrow order, applied only AFTER lending (see the LEND-FIRST
      // pass below). Empty for the legacy single-category path, which never borrows.
      let fillOrder: string[] = [];

      if (categoryFilter) {
        // Legacy deck-tap path: up to WORKING_LOOP_SIZE eligible cards from the
        // single tapped category.
        loopCategories = [categoryFilter];
        workingLoop = await this.fetchEligibleCategoryCards(
          client, userId, language, categoryFilter, WORKING_LOOP_SIZE, [], now, collection
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
            client, userId, language, category, count, workingLoop.map(c => c.id), now, collection
          );
          workingLoop.push(...rows);
        }

        // The cross-category top-up is deliberately NOT run here; it happens after
        // the lend pass below.
        fillOrder = config.fillOrder;
      }

      // LEND FIRST, BORROW SECOND (2026-08-17).
      //
      // A quota that its own category could not fill is topped up with FRESHLY LENT
      // cards BEFORE we borrow from any other category. A lent row has no mark
      // history, so it always arrives as Unfamiliar — the loop's mix therefore skews
      // Unfamiliar rather than skewing toward whichever category happened to have
      // surplus, and that is the intended trade: a brand-new word is closer to what
      // the missing quota was asking for than someone else's leftovers.
      //
      // Note this ordering only bites when a quota underfills, and a quota underfills
      // exactly when that category's eligible pool is spent — so the borrow pass below
      // can never have served the *same* category anyway. What we are choosing between
      // is "lend" and "deepen a different bucket".
      //
      // Restricted sessions (Review, a builtin collection, a deck) still never lend:
      // a Review round padded with never-seen words is not a review, and a deck round
      // made of non-deck words is not that deck. They come back short on purpose.
      // See canLendProvisional and docs/PROVISIONAL_CARDS.md.
      if (workingLoop.length < WORKING_LOOP_SIZE && this.canLendProvisional(loopCategories, collection)) {
        const lent = await this.lendIntoLoop(
          client, userId, language, WORKING_LOOP_SIZE - workingLoop.length,
          workingLoop.map(c => c.id), now, collection
        );
        workingLoop.push(...lent);
      }

      // Only once lending is spent (or banned) do we borrow across categories, in the
      // mode's fill-order priority.
      for (const category of fillOrder) {
        if (workingLoop.length >= WORKING_LOOP_SIZE) break;
        const rows = await this.fetchEligibleCategoryCards(
          client, userId, language, category,
          WORKING_LOOP_SIZE - workingLoop.length, workingLoop.map(c => c.id), now, collection
        );
        workingLoop.push(...rows);
      }

      // Randomize play order. The ranking above chose WHICH cards are in the loop;
      // the order they're played in is deliberately not the ranking, so a session
      // doesn't march predictably from most- to least-recently-rested. The legacy
      // single-category path keeps its original unshuffled order.
      if (!categoryFilter) shuffleInPlace(workingLoop);

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
   * decks page (per-bucket counts), the Account page's deck buckets and the scp
   * tally.
   *
   * CORE BAR ONLY (migration 143). "How many Comfortable cards do I have" is a
   * question about the deck as a whole, and the answer must not change because the
   * learner switched on the writing goal — under the old goal-blended category it
   * did, and every one of these surfaces moved at once. Reading and writing progress
   * is counted where it is shown: on the card's own bars and in that bar's Mastered
   * collection.
   *
   * NOTE — known divergence, unchanged by the split: these counts band by the core
   * bar, while the game pools bucket by the per-type category of the mark type they
   * emit (see fetchGameCandidates). So the `available` map a game reports can
   * disagree with the pool it actually assembled — e.g. cards that are core
   * Comfortable but have an empty reading track count as Comfortable here while Word
   * Search No-Pinyin draws them as Unfamiliar. This is deliberate (one shared count
   * source across decks + games); if the game hints ever need to match the pool, give
   * the game callers a per-type count variant rather than switching this one.
   * docs/MASTERY_REWORK.md § "Games select by their own mark type".
   */
  async getCategoryCounts(
    userId: string,
    language: string,
    categories: string[] = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'],
    bar: MasteryBarId = 'core'
  ): Promise<Record<string, number>> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    // Which bar the four bands are read off. `core` for every historical caller —
    // deck sizes, the level estimate, the account page. The Reading/Writing Centers
    // pass their own bar, so their tile figures count the skill the page is about
    // (docs/DECKS_FEATURE.md § "Mastery Centers"). `bar` is a validated union value,
    // so `barCategoryExpr` can only produce one of three fixed SQL fragments.
    const categoryExpr = barCategoryExpr(bar);
    const client = await db.getClient();
    try {
      // category is computed per row from typedMarkHistory (migration 143), so we
      // group by the derived expression. `ve` alias is required by
      // barCategoryExpr's default. No users join: no bar depends on the goal flags.
      const result = await client.query<{ category: string; n: number }>(`
        SELECT ${categoryExpr} AS category, COUNT(*)::int AS n
        FROM ${vetTableForLanguage(language)} ve
        WHERE ve."userId" = $1
        AND ve."language" = $3
        -- SORTED: these counts are the deck sizes shown on the decks page. They must
        -- NOT count provisional cards, or the page would claim cards the user has not
        -- sorted. Games no longer use these counts to gate entry.
        AND ${vetSortedClause()}
        AND ${categoryExpr} = ANY($2::text[])
        GROUP BY ${categoryExpr}
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
   * PER-TYPE SELECTION (docs/MASTERY_REWORK.md § "Games select by their own mark
   * type" + § Per-type cooldown, "Games"): `gameMarkType` is the mark type this
   * game emits (bubble-match = 'recognition'). It drives BOTH which category
   * bucket each candidate falls in (banded off that track's own 8-mark window) and
   * the per-type cooldown. The pool is filled FRESH-FIRST — cards whose game mark
   * type is off cooldown, drawn from the requested categories then the fallback
   * categories — and only tops up with COOLED cards (same category order) as a
   * last resort, so a recently-played library still yields a full board.
   *
   * PARTIAL REFILL (`opts.need` + `opts.excludeIds`): Bubble Match's "Play Again"
   * keeps the pairs the player failed to match and only swaps out the ones they
   * cleared, so it asks for `need` (< total) cards while excluding the kept ids.
   * The requested per-bucket quotas are scaled down by `need / total` so a partial
   * refill keeps roughly the same difficulty mix as a full board instead of being
   * front-loaded with whichever bucket happens to be listed first.
   *
   * TWO TIERS OF "don't give me this card":
   *   - `excludeIds` is HARD — filtered out in SQL, can never come back. Used for
   *     cards still on the board (returning one would duplicate a live bubble).
   *   - `avoidIds` is SOFT — the card is demoted to the same last-resort tier as
   *     a cooled card, so it only reappears if the library can't fill the board
   *     without it. Used for cards the player just cleared: they should feel
   *     retired for a while, but a 21-card library must still assemble a board.
   *     This also covers the race where the client's fire-and-forget mark POST
   *     hasn't landed yet, so the real per-type cooldown isn't visible to this
   *     query.
   */
  async getGameVocabPool(
    userId: string,
    language: string,
    distribution: Record<string, number>,
    gameMarkType: MarkType,
    // `collection` (docs/DECKS_FEATURE.md) restricts the whole pool to one
    // collection — for a deck, its cards plus any card lent to reach the baseline.
    opts: {
      need?: number;
      excludeIds?: number[];
      avoidIds?: number[];
      collection?: CollectionFilter | null;
      /** Let this call lend even though it is a partial refill. Set only for a
          ROLLING-SUPPLY surface (`ROLLING_SUPPLY_SURFACES`, contracts/wire.ts),
          whose every spawn is a refill and which would otherwise never lend. */
      lendOnRefill?: boolean;
      /** Lend this many levels away from the learner's estimated level, instead of
          at it — Hydra rolls a color and maps it to a tier offset
          (docs/HYDRA_BUBBLES.md § 6.2). Resolved to an absolute level by
          `ProvisionalCardService.resolveLendLevel`, and ignored unless lending
          actually fires. */
      lendLevelOffset?: number;
    } = {}
  ): Promise<{
    cards: VocabEntry[];
    requested: Record<string, number>;
    available: Record<string, number>;
    total: number;
    /** Cards this call had to return (= `total` for a full board, fewer for a refill). */
    needed: number;
    sufficient: boolean;
  }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const now = Date.now();
    const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);
    const excludeIds = opts.excludeIds ?? [];
    // How many cards this call must actually return. A full board asks for
    // `total`; a partial refill asks for fewer (the rest are cards the caller is
    // keeping and has listed in excludeIds).
    const target = Math.max(0, Math.min(opts.need ?? total, total));
    // Scale the per-bucket quotas to the target so a partial refill preserves the
    // requested difficulty mix (e.g. need=10 of a 2/10/6/2 board → 1/5/3/1)
    // instead of being filled entirely from whichever bucket is enumerated first.
    const scaled: Record<string, number> = {};
    for (const [category, count] of Object.entries(distribution)) {
      scaled[category] = target === total ? count : Math.round((count * target) / total);
    }
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
        client, userId, language, countCategories, gameMarkType, now,
        OnDeckVocabService.GAME_CANDIDATE_CAP, undefined, excludeIds, opts.collection
      );

      // Soft-avoid: pull just-cleared cards out of BOTH tiers into a third,
      // strictly-last tier. It has to be its own tier rather than the back of the
      // matching category's `cooled` queue: the fill loops iterate category-by-
      // category, so a demoted card sitting in (say) the Unfamiliar cooled queue
      // would still be drawn ahead of every Mastered cooled card — which is
      // exactly how a refill ended up handing back the cards just cleared.
      const avoidIds = new Set(opts.avoidIds ?? []);
      const avoided: Record<string, VocabEntry[]> = {};
      if (avoidIds.size > 0) {
        for (const category of countCategories) {
          const fresh = eligible[category] ?? [];
          const rested = cooled[category] ?? [];
          eligible[category] = fresh.filter((c) => !avoidIds.has(c.id));
          cooled[category] = rested.filter((c) => !avoidIds.has(c.id));
          avoided[category] = [
            ...fresh.filter((c) => avoidIds.has(c.id)),
            ...rested.filter((c) => avoidIds.has(c.id)),
          ];
        }
      }

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

      // 1. Fill each requested bucket up to its (target-scaled) quota from FRESH
      //    cards, never overshooting the target.
      for (const [category, count] of Object.entries(scaled)) {
        if (cards.length >= target) break;
        drain(eligible[category] ?? [], Math.min(count, target - cards.length));
      }
      // SINGLE-BUCKET REQUESTS NEVER SUBSTITUTE A BUCKET (2026-08-18).
      //
      // A caller that asks for ONE category is not describing a difficulty MIX it
      // would like — it is asking a question whose answer is the category itself.
      // Hydra Bubbles rolls a color, requests that color, and pays the player
      // according to it (docs/HYDRA_BUBBLES.md § 2, § 5); topping its request up from
      // another bucket hands back a card whose real category the caller then
      // misreports to the player, and misprices. So for a single-bucket request the
      // fallback ORDER collapses to the requested bucket alone: it would rather come
      // back short — the caller can wait or skip the slot — than come back wrong.
      //
      // A multi-bucket caller (every other game) is unaffected: it asked for a
      // distribution, and topping one quota up from another is exactly the
      // best-effort fill it wants.
      const requested = Object.keys(distribution);
      const substituting = requested.length > 1;
      const fallbackOrder = substituting ? OnDeckVocabService.GAME_FALLBACK_ORDER : requested;
      const lastResortOrder = substituting
        ? [...requested, ...OnDeckVocabService.GAME_FALLBACK_ORDER]
        : requested;

      // 2. LEND ONLY WHAT BORROWING CANNOT COVER (2026-08-19, narrowing the
      //    2026-08-17 "lend before borrowing" rule — docs/PROVISIONAL_CARDS.md § 4b).
      //
      //    A requested bucket that came up short is still covered by lending BEFORE we
      //    substitute another bucket's cards — but only for the part of the shortfall
      //    the learner's own FRESH (off-cooldown) cards cannot cover. Everything tier 3
      //    is about to borrow is subtracted from the lend request first.
      //
      //    WHY THIS NARROWING EXISTS. The original rule assumed a quota underfills only
      //    when supply is spent. That is false for a game whose mark track is sparsely
      //    populated: Speed Reading buckets by READING, where a typical learner is
      //    ~100% Unfamiliar, so its Target/Comfortable/Mastered quotas (18 of 20) are
      //    unfillable no matter how large the library is. Worse, a minted row is always
      //    Unfamiliar, so lending can NEVER close those quotas — every load lent
      //    another ~18 cards, forever (a dev account with 151 fresh reading-Unfamiliar
      //    library cards had accumulated 170 provisional rows). Borrowing is free and
      //    the borrowed card is a card the learner actually chose, so a fresh card in
      //    hand always beats minting one.
      //
      //    Single-bucket callers (Hydra Bubbles) are unaffected: their `fallbackOrder`
      //    is the requested bucket alone, which tier 1 has already drained, so
      //    `freshRemaining` is 0 and this is the old unconditional lend.
      //
      //    Two sessions never reach here at all:
      //      * a COLLECTION-restricted pool (a deck / builtin) — a deck round made of
      //        non-deck words is not that deck (same rule as canLendProvisional);
      //      * a PARTIAL REFILL (`opts.need`) — Bubble Match's Play Again is mid-session
      //        with a board in hand, and lending there would grow the player's deck on
      //        every tap. That exemption predates this change (see
      //        OnDeckVocabController.getGamePool) and is deliberately preserved —
      //        EXCEPT for a rolling-supply surface (`opts.lendOnRefill`), whose every
      //        spawn is a refill and which would otherwise never lend at all. See
      //        ROLLING_SUPPLY_SURFACES in contracts/wire.ts.
      //
      //    The collection exemption has NO opt-out: a restricted round plays the set
      //    the learner chose, rolling supply or not (docs/HYDRA_BUBBLES.md § 6.3).
      const mayLend = opts.need === undefined || opts.lendOnRefill === true;
      // Fresh cards tier 3 still has in hand. The buckets are disjoint (a card has
      // exactly one category for this markType) and the soft-avoid tier has already
      // been lifted out of `eligible`, so a plain sum counts no card twice. Capped by
      // GAME_CANDIDATE_CAP per category, which can only make us lend MORE than
      // strictly necessary, never less.
      const freshRemaining = fallbackOrder.reduce(
        (sum, category) => sum + (eligible[category]?.length ?? 0),
        0
      );
      const lendNeed = target - cards.length - freshRemaining;
      if (lendNeed > 0 && !opts.collection && mayLend) {
        const lent = await this.lendGameCandidates(
          client, userId, language, lendNeed, gameMarkType, now,
          OnDeckVocabService.GAME_CANDIDATE_CAP, undefined,
          [...excludeIds, ...selectedIds], opts.collection, opts.lendLevelOffset
        );
        // The re-query is unaware of the soft-avoid tier, so filter those back out.
        drain(lent.filter((card) => !avoidIds.has(card.id)), target - cards.length);
      }
      // 3. Still short → top up to `target` with FRESH cards from the fallback
      //    buckets (Target → Comfortable → Unfamiliar → Mastered).
      for (const category of fallbackOrder) {
        if (cards.length >= target) break;
        drain(eligible[category] ?? [], target - cards.length);
      }
      // 4. Last resort → COOLING cards (requested buckets first, then fallback), so a
      //    just-played library still assembles a full board.
      //
      //    For a single-bucket caller this is the tier that MATTERS, and it is
      //    deliberately allowed to break the per-type cooldown: a genuinely Mastered
      //    card that is merely resting is a truthful blue bubble, whereas a minted
      //    HSK-1 word colored blue by its lend tier is not. Note the consequence —
      //    a mark on a still-cooling card is dropped by the guard at
      //    POST /api/flashcards/mark (docs/HYDRA_BUBBLES.md § 8), so these cards are
      //    playable but do not advance mastery. That is the accepted trade: the
      //    cooldown exists precisely so re-answering a Mastered card inside its
      //    window earns nothing.
      for (const category of lastResortOrder) {
        if (cards.length >= target) break;
        drain(cooled[category] ?? [], target - cards.length);
      }
      // 5. Absolute last resort → AVOIDED cards (just cleared by the caller). Only
      //    reached when the library is too small to fill the board without reusing
      //    them; a roomy library never gets here.
      for (const category of lastResortOrder) {
        if (cards.length >= target) break;
        drain(avoided[category] ?? [], target - cards.length);
      }

      const sufficient = cards.length >= target;

      // Enrich (long defs / parts of speech etc.) then pre-warm audio. We skip
      // the related-words / used-in passes the EIC needs — the game only renders
      // the word, its pinyin, and the flashcard definition.
      const enriched = await this.enrichEntriesPipeline(cards, language);
      const withAudio = await this.prewarmAudio(enriched);

      // `total` stays the full board size (what the client's "you need N Learn
      // Now cards" message quotes); `needed` is what THIS call had to return.
      return { cards: withAudio, requested: { ...scaled }, available, total, needed: target, sufficient };
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
   * PER-TYPE SELECTION (docs/MASTERY_REWORK.md § "Games select by their own mark
   * type" + § Per-type cooldown, "Games"): `gameMarkType` is the mode's mark type —
   * 'reading' for No-Pinyin, 'production' for Pinyin — and it decides both the
   * category bucket each candidate lands in and its cooldown. Because the two modes
   * bucket off different tracks, the SAME library yields different word sets per
   * mode, which is the intent. Both the initial selection and the substring-dedup
   * replacements prefer FRESH cards (that type off cooldown) across the requested
   * then fallback categories, dipping into COOLED cards only as a last resort so
   * the game never blocks a just-played library.
   */
  async getWordSearchGrid(
    userId: string,
    language: string,
    distribution: Record<string, number>,
    gameMarkType: MarkType,
    // `collection` (docs/DECKS_FEATURE.md) restricts the grid's words to one collection.
    // The de-dup / replacement loop below is unaffected: it only ever draws from
    // the candidate queues this filter has already narrowed.
    collection?: CollectionFilter | null
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
    /** Grid words that were LENT to reach the baseline (docs/PROVISIONAL_CARDS.md). */
    provisionalWords?: string[];
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
        client, userId, language, countCategories, gameMarkType, now,
        OnDeckVocabService.WORD_SEARCH_CANDIDATE_CAP, 4, [], collection
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
      //    2. LEND to cover any shortfall, then 3. top up to `total` with FRESH
      //    fallback cards, then 4. backfill the remainder with COOLED cards
      //    (requested buckets → fallback).
      for (const [category, count] of Object.entries(distribution)) drain(eligible[category] ?? [], count);

      // LEND ONLY WHAT BORROWING CANNOT COVER (2026-08-19), same rule as the game
      // pool above: the shortfall is reduced by every FRESH card the fallback pass
      // still holds, so a learner with playable cards is never minted new ones. This
      // matters here for exactly the same reason — No-Pinyin mode buckets by READING,
      // a track on which most learners are ~100% Unfamiliar, so the Target/Comfortable/
      // Mastered quotas underfill on a library that is not short at all.
      //
      // The lent rows are pushed onto the Unfamiliar FRESH queue rather than drained
      // straight into `selected`, so the substring-dedup replacement loop below can
      // draw on them too — otherwise a lent word dropped as a substring could not be
      // replaced by another lent word. A collection-restricted grid never lends.
      //
      // NOTE the grid's extra constraint: `total` distinct-charactered words. Under-
      // lending here is safe because the controller's PROVISION_RETRY_FACTOR loop
      // re-enters with an escalated baseline when the de-dup pass still comes up short.
      const wsFreshRemaining = OnDeckVocabService.GAME_FALLBACK_ORDER.reduce(
        (sum, category) => sum + (eligible[category]?.length ?? 0),
        0
      );
      const wsLendNeed = total - selected.length - wsFreshRemaining;
      if (wsLendNeed > 0 && !collection) {
        const lent = await this.lendGameCandidates(
          client, userId, language, wsLendNeed, gameMarkType, now,
          OnDeckVocabService.WORD_SEARCH_CANDIDATE_CAP, 4, [...selectedIds], collection
        );
        // Unshift: freshly lent words go to the FRONT of the Unfamiliar queue, ahead
        // of any Unfamiliar card the quota pass left behind.
        (eligible['Unfamiliar'] ??= []).unshift(...lent);
        drain(eligible['Unfamiliar'], total - selected.length);
      }

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
      // The same pass also collects each character's `components` (migration 125) — the
      // sub-character visual parts the No Pinyin hint ladder reveals one at a time. It
      // rides this existing query rather than adding a round trip, since both are
      // per-target-character facts keyed by the same word1 list.
      const targetChars = [...new Set(withAudio.flatMap((w) => [...w.entryKey]))];
      const charClusters = new Map<string, Array<{ sense?: string | null; glosses?: string[] | null }>>();
      const charComponentsMap = new Map<string, string[]>();
      if (targetChars.length > 0) {
        const clustersResult = await client.query<{
          word1: string;
          definitionClusters: unknown;
          components: unknown;
        }>(`
          SELECT word1, "definitionClusters", components
          FROM dictionaryentries_zh
          WHERE language = 'zh' AND word1 = ANY($1)
        `, [targetChars]);
        for (const row of clustersResult.rows) {
          if (!charClusters.has(row.word1) && Array.isArray(row.definitionClusters)) {
            charClusters.set(row.word1, row.definitionClusters as Array<{ sense?: string | null; glosses?: string[] | null }>);
          }
          // NULL (never backfilled) and [] (verified atomic) both mean "no parts to
          // reveal" to the client, so both collapse to an empty array here.
          if (!charComponentsMap.has(row.word1) && Array.isArray(row.components)) {
            charComponentsMap.set(
              row.word1,
              (row.components as unknown[]).filter((c): c is string => typeof c === 'string')
            );
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
          // Sense-resolved alongside the definition below — the grid's pinyin must be the
          // chosen sense's reading, not whichever one the det column happens to hold.
          pinyin: resolveDisplayPronunciation(w) ?? '',
          // The word list is a dd surface for a SAVED card, so it must honor the learner's
          // per-card sense pick (vet.selectedSense) exactly as the flashcard face does. The
          // clusters don't travel in the grid payload, so the resolution happens here.
          // See docs/DEFINITION_CLUSTERS.md.
          definition: resolveDisplayDefinition(w),
          charSenses,
          charComponents: [...w.entryKey].map((char) => charComponentsMap.get(char) ?? []),
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
        // Which of the grid's words were LENT to reach the baseline rather than sorted
        // by the player (docs/PROVISIONAL_CARDS.md). Reported as a flat word list
        // rather than a flag on each PlacedWord so it doesn't have to be threaded
        // through the grid generator, which has no business knowing about buckets.
        provisionalWords: withAudio
          .filter((card) => card.starterPackBucket === 'provisional')
          .map((card) => card.entryKey),
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
        const result = await this.ttsService.synthesize(entry.entryKey, ttsLang, entry.pronunciation);
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

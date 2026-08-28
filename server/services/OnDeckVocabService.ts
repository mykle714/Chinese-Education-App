import { PoolClient } from 'pg';
import { VocabEntry, TypedMarkHistory, MarkType } from '../types/index.js';
import type { MasteryBarId, FlpForeignTrack } from '../contracts/wire.js';
import { flpMarkTypes } from '../contracts/wire.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { DictionaryService } from './DictionaryService.js';
import { StarterPacksService } from './StarterPacksService.js';
import { ValidationError } from '../types/dal.js';
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';
import { vetTableForLanguage, vetReadFrom, CORE_CATEGORY_EXPR, CORE_CATEGORY_SELECT, barCategoryExpr, masteredBarClause, builtinCollectionClause, type BuiltinCollectionId, typeCategoryExpr, vetSortedClause, vetDeckOrProvisionalClause } from '../dal/shared/vetTable.js';
import { computeTypeCategory } from '../utils/masteryCompute.js';
import { rankCardQueue, rankCardQueueCooled, isTypeOnCooldown } from './cardQueueRanking.js';
import { DICT_COLS, DICT_JOIN } from '../dal/shared/dictJoin.js';
import type { TTSService } from './TTSService.js';
import type { ProvisionalCardService } from './ProvisionalCardService.js';
import {
  generateWordSearchGrid,
  type GridCell,
  type WordSearchInput,
  type WordSearchGrid,
} from './wordSearchGrid.js';
import { resolveSenseGloss, resolveDisplayDefinition, resolveDisplayPronunciation, ddCollisionKey } from '../utils/definitions.js';
// Tap-to-drill rung construction, shared with the example-sentence / long-definition
// enrichment paths so both chains obey one rule. See docs/SEGMENT_DRILL_DOWN.md.
import { getAllSubstrings, buildDictMap, buildExcludeSet, buildDrillRungs, type SegmentDrillRung } from '../dal/shared/segmentString.js';
import type { DictionaryEntry } from '../types/index.js';

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

  // The mark types the flp can actually present (docs/MASTERY_REWORK.md § 1): an
  // English-first prompt is a PRODUCTION review, and a foreign-first prompt is either
  // a RECOGNITION review (pinyin shown) or a READING one (zh, "Show pinyin" off) —
  // `foreignTrack`, sent by the client per session and threaded through every
  // selection path below. Writing marks come from other surfaces (Practice Writing)
  // and are never shown in the working loop, so flp cooldown eligibility consults only
  // the session's two tracks — a correct mark earned in another game no longer
  // suppresses a card from the flp.
  //
  // The pair itself is built by `flpMarkTypes` (server/contracts/wire.ts), the one
  // definition the client's face-steering also maps through, so the face a learner is
  // shown can never disagree with the mark the client then writes.
  private static readonly DEFAULT_FOREIGN_TRACK: FlpForeignTrack = 'recognition';

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
  private rankFlpEligible(
    cards: VocabEntry[],
    now: number,
    foreignTrack: FlpForeignTrack = OnDeckVocabService.DEFAULT_FOREIGN_TRACK
  ): VocabEntry[] {
    // The ordering rule itself is shared (rankCardQueue); what the flp adds is stamping
    // the ready tracks onto the returned card as `readyMarkTypes`, which the client uses
    // to steer which face it shows.
    return rankCardQueue(cards, now, {
      markTypes: flpMarkTypes(foreignTrack),
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
    collection?: CollectionFilter | null,
    /** Vet ids of cards LENT to this round (docs/PROVISIONAL_CARDS.md § 4b). The only
        way a provisional row enters a pool — the bucket clause below is otherwise
        sorted-only. Empty (`= ANY('{}')` ⇒ false) for a learner with cards of their
        own, which is the overwhelmingly common case. */
    lentIds: number[] = []
  ): Promise<{ eligible: Record<string, VocabEntry[]>; cooled: Record<string, VocabEntry[]> }> {
    const eligible: Record<string, VocabEntry[]> = {};
    const cooled: Record<string, VocabEntry[]> = {};
    // Optional collection restriction (docs/DECKS_FEATURE.md). $8 is the next free
    // placeholder after the seven bound below.
    const deck = this.deckPlayFilter(collection, 8);
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
        -- SORTED ONLY: a lent card is not an ordinary candidate. It is never on
        -- cooldown and always bands Unfamiliar, so leaving it in this query let the
        -- lent rows out-compete the learner's own deck in every round. Lending is now
        -- the LAST fill tier and hands its rows back by id (docs/PROVISIONAL_CARDS.md
        -- § 4b, fetchRowsByIds).
        AND (${vetSortedClause()} OR ve.id = ANY($7::int[]))
        AND ${typeCategoryExpr('$5')} = $2
        AND NOT (ve.id = ANY($6::int[]))
        ${lenClause}
        ${deck.clause}
        -- THE LEARNER'S OWN CARDS FIRST, then lent ones, then random within each.
        -- Without this the two are shuffled together, so a round that had to borrow
        -- could leave the learner's own cards on the bench in favour of words they
        -- never chose — the exact outcome the sorted-only selection rule exists to
        -- prevent (docs/PROVISIONAL_CARDS.md § 4b). Only matters when lentIds is
        -- non-empty; otherwise every row is sorted and the first key is constant.
        ORDER BY (ve."starterPackBucket" = 'provisional') ASC, RANDOM()
        LIMIT $3
      `, [userId, category, cap, language, markType, excludeIds, lentIds, ...deck.params]);

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
   * The rows behind a set of NAMED vet ids, ready to drop into a game pool.
   *
   * (Was `fetchLentRows`, and lending is still its main caller — but a Study
   * Challenge board also addresses specific ids, and both want the same
   * dict-joined, category-stamped, caller-ordered rows.)
   *
   * The counterpart of the sorted-only candidate queries: lending hands back IDS
   * (`ProvisionalCardService.acquireLentCards`), and this is what turns them into
   * DICT-joined, category-stamped `VocabEntry` rows. Nothing else in the service may
   * surface a provisional row.
   *
   * Preserves the CALLER'S order, which is the lend order — re-lent rows nearest the
   * target difficulty first, then freshly minted ones — rather than the arbitrary
   * order the `id = ANY(...)` scan returns them in.
   *
   * Filters on the game's own cooldown, exactly like `fetchGameCandidates`: a freshly
   * minted row has no history and always passes, while a RE-LENT row may well be
   * resting, and re-lending is not a reason to break a cooldown.
   *
   * `maxEntryKeyLen` (Word Search) drops words too long for the grid. Applied in app
   * code rather than SQL because this query is addressing specific ids, not searching.
   */
  private async fetchRowsByIds(
    client: PoolClient,
    userId: string,
    language: string,
    ids: number[],
    markType: MarkType,
    now: number,
    maxEntryKeyLen?: number,
    /**
     * Skip the per-type cooldown filter — for a caller whose ids are NOT a
     * preference but an obligation. The only such caller today is a Study Challenge
     * board: all nine contested words must appear in every round
     * (docs/STUDY_CHALLENGE.md § 5.2), and the filler ladder is deliberately the
     * player's most MASTERED cards, which are exactly the ones most likely to be
     * resting. Dropping either for a cooldown would silently shrink the board that
     * the round's score is measured against.
     *
     * The accepted consequence is the app-wide one: a mark on a still-cooling card
     * is dropped at POST /api/flashcards/mark (docs/HYDRA_BUBBLES.md § 8), so those
     * cards play and score but do not advance mastery.
     */
    ignoreCooldown = false
  ): Promise<VocabEntry[]> {
    if (ids.length === 0) return [];

    const result = await client.query<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $2
      AND ve.id = ANY($3::int[])
    `, [userId, language, ids]);

    const byId = new Map(result.rows.map((row) => [row.id, row]));
    const ordered: VocabEntry[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      if (maxEntryKeyLen != null && row.entryKey.length > maxEntryKeyLen) continue;
      if (!ignoreCooldown && !this.isCardGameEligible(row, markType, now)) continue;
      // Same stamp fetchGameCandidates applies: the bucket the card is being served
      // AS, on the track this game exercises.
      row.gameCategory = computeTypeCategory(
        row.typedMarkHistory, markType
      ) as VocabEntry['gameCategory'];
      ordered.push(row);
    }
    return ordered;
  }

  /**
   * The dd COLLISION KEYS of a set of vet ids (`ddCollisionKey`, utils/definitions.ts).
   *
   * Exists for the partial-refill case. A refilling caller sends `exclude` = every card
   * currently on the board or in its buffer, and the pool must not hand back a card that
   * READS the same as one of them — the on-screen set is what the player is comparing,
   * and the server is the only party that can resolve a dd, so it has to look up what
   * those excluded cards say before choosing replacements.
   *
   * Cheap by construction: `ids` is bounded by a game board (tens of cards), and the
   * common case — a full board with nothing excluded — short-circuits to an empty set.
   *
   * Skips empty keys: a card with no usable dd has nothing to collide WITH (see
   * `ddCollisionKey`).
   */
  private async fetchDdKeys(
    client: PoolClient,
    userId: string,
    language: string,
    ids: number[]
  ): Promise<Set<string>> {
    const keys = new Set<string>();
    if (ids.length === 0) return keys;

    const result = await client.query<VocabEntry>(`
      SELECT ve.id, ve."selectedSense", ${DICT_COLS}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $2
      AND ve.id = ANY($3::int[])
    `, [userId, language, ids]);

    for (const row of result.rows) {
      const key = ddCollisionKey(row);
      if (key) keys.add(key);
    }
    return keys;
  }

  /**
   * Batch-resolve dd collision keys (`ddCollisionKey`) to their phase-2 near-miss
   * `meaningGroupId` (`gloss_meaning_groups`, migration 154 — docs/GLOSS_CONFUSABILITY.md
   * § 6). A key absent from the returned map has not been clustered (or was clustered
   * as a singleton with no near-miss partner) — callers MUST treat a missing key as
   * "does not collide," never as a group of its own. This is the "no group id ⇒ no
   * constraint" invariant the design doc requires: the guard degrades to phase-1
   * (exact-dd only) behavior for any word the offline pipeline hasn't reached yet.
   */
  private async fetchGroupIds(
    client: PoolClient,
    glossKeys: string[]
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const unique = Array.from(new Set(glossKeys.filter((key): key is string => Boolean(key))));
    if (unique.length === 0) return map;

    const result = await client.query<{ glossKey: string; meaningGroupId: number }>(`
      SELECT "glossKey", "meaningGroupId"
      FROM gloss_meaning_groups
      WHERE "glossKey" = ANY($1::text[])
    `, [unique]);

    for (const row of result.rows) {
      map.set(row.glossKey, row.meaningGroupId);
    }
    return map;
  }

  /**
   * Lend `need` cards for a GAME pool and hand them back as playable candidates.
   *
   * The game half of the last fill tier. All policy lives in
   * `ProvisionalCardService.acquireLentCards` — re-lend rows the learner already
   * holds, then mint only the remainder — so this method is just the translation
   * between "how many cards does the board still need" and "rows to drain".
   *
   * `levelOffset` pins the DIFFICULTY to lend around: Hydra maps a rolled colour to a
   * tier relative to the learner (docs/HYDRA_BUBBLES.md § 6.2), and only the server
   * knows their level. Absent, lending centres on the learner's own estimated level.
   *
   * Returns [] when supply is exhausted, so the caller simply comes back short — a
   * short board is always the correct answer, never a refusal.
   */
  private async lendGameCandidates(
    client: PoolClient,
    userId: string,
    language: string,
    need: number,
    markType: MarkType,
    now: number,
    maxEntryKeyLen: number | undefined,
    excludeIds: number[],
    levelOffset?: number
  ): Promise<VocabEntry[]> {
    if (need <= 0) return [];

    // Resolve the tier ONCE, so re-lend and mint agree about what this colour means
    // and the learner's level is estimated a single time.
    const level = levelOffset !== undefined
      ? await this.provisionalCardService.resolveLendLevel(userId, language, levelOffset)
      : undefined;

    const { lentIds } = await this.provisionalCardService.acquireLentCards(
      userId, language, need, 'default', { level, excludeIds }
    );
    return this.fetchRowsByIds(client, userId, language, lentIds, markType, now, maxEntryKeyLen);
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
    collection?: CollectionFilter | null,
    /** Vet ids lent to this loop — see fetchGameCandidates. */
    lentIds: number[] = []
  ): Promise<VocabEntry[]> {
    // Optional collection restriction; $6 is the next free placeholder after the five below.
    const deck = this.deckPlayFilter(collection, 6);
    const result = await client.query<VocabEntry>(`
      SELECT ve.*, ${DICT_COLS}, ${CORE_CATEGORY_SELECT}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $4
      -- SORTED ONLY: same rule as the game pools — a lent card enters a round only
      -- through the last-resort lend tier, by id (docs/PROVISIONAL_CARDS.md § 4b).
      AND (${vetSortedClause()} OR ve.id = ANY($5::int[]))
      AND ${CORE_CATEGORY_EXPR} = $2
      AND ve.id != ALL($3::int[])
      ${deck.clause}
      -- Stable tiebreak only; the real ordering is rankFlpEligible in app code — but
      -- the tie is REAL for never-marked cards, which all score equally and keep this
      -- order. Own cards first, or a lent row (always created today, so newest by
      -- createdAt) would beat the learner's own unmarked cards into the loop.
      ORDER BY (ve."starterPackBucket" = 'provisional') ASC, ve."createdAt" DESC
    `, [userId, category, excludeIds, language, lentIds, ...deck.params]);
    return result.rows;
  }

  /**
   * Get the next library card for a correct-mark refill, honoring PER-TYPE
   * cooldowns (docs/MASTERY_REWORK.md § Per-type cooldown).
   *
   * Priority: the preferred category, then Target -> Unfamiliar -> Comfortable ->
   * Mastered, then a COOLING card, and only then a LENT one. At each step we take the
   * head of that category's queue —
   * the card waiting longest since it came off cooldown (rankFlpEligible) — stamping
   * `readyMarkTypes` so the client shows a face for a ready type. `excludeIds` keeps cards already in the loop out.
   *
   * BORROW, THEN COOL, THEN LEND (2026-08-20, replacing the 2026-08-17 lend-first
   * rule). Lending is the bottom of the ladder because it exists for a learner who has
   * not sorted enough cards, not for one whose answered card happened to empty its own
   * category — which is every learner, on every correct mark, once a category runs dry.
   *
   * WHEN EVERY CANDIDATE IS COOLING a resting card is re-served rather than a new word
   * minted. It is deliberately shown knowing its mark will be dropped at
   * POST /api/flashcards/mark: the cooldown exists precisely so re-answering a card
   * inside its window earns nothing, and the learner keeps studying their own deck.
   * Only when there is no resting card either does an unrestricted session lend
   * (canLendProvisional); a restricted one returns null and the client winds the loop
   * down.
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
    collection?: CollectionFilter | null,
    /** The session's foreign-first track — see DEFAULT_FOREIGN_TRACK. The client must
        echo the same value it launched the loop with, because THIS call is what refills
        the loop: a refill steered by the wrong track would hand back a card whose face
        is ready on a track the client is not going to mark. */
    foreignTrack: FlpForeignTrack = OnDeckVocabService.DEFAULT_FOREIGN_TRACK
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
          const ranked = this.rankFlpEligible(cards, now, foreignTrack);
          if (ranked.length > 0) return ranked[0];
        }
        return null;
      };

      // Take the nearest-to-ready COOLING card from the first category that has one.
      // These are the learner's own cards, re-shown early; the mark they earn is
      // dropped at POST /api/flashcards/mark, which is what the cooldown means.
      const serveCooled = async (categories: string[]): Promise<VocabEntry | null> => {
        for (const category of categories) {
          const cards = await this.fetchFlpCandidates(client, userId, category, language, excludeIds, collection);
          const resting = rankCardQueueCooled(cards, now, {
            markTypes: flpMarkTypes(foreignTrack),
            windowCategoryOf: (card) => this.flpWindowCategory(card),
          });
          if (resting.length > 0) return resting[0];
        }
        return null;
      };

      // Lend one card and serve it. Policy (re-lend before minting) lives in
      // ProvisionalCardService; the row comes back by id, so it is re-queried with
      // `lentIds` — the ordinary candidate path is sorted-only. Returns null when
      // dictionary supply is exhausted.
      const serveLent = async (): Promise<VocabEntry | null> => {
        const { lentIds } = await this.provisionalCardService.acquireLentCards(
          userId, language, 1, 'default', { excludeIds }
        );
        if (lentIds.length === 0) return null;
        for (const category of fallbackBase) {
          const lent = await this.fetchFlpCandidates(
            client, userId, category, language, excludeIds, collection, lentIds
          );
          const ranked = this.rankFlpEligible(lent.filter((card) => lentIds.includes(card.id)), now, foreignTrack);
          if (ranked.length > 0) return ranked[0];
        }
        return null;
      };

      // 1. The category the caller actually asked for.
      winner = await serveFrom(preferredFirst);

      // 2. Borrow a FRESH card from the remaining allowed categories.
      if (!winner) winner = await serveFrom(borrowOrder);

      // 3. Nothing is off cooldown anywhere — re-serve the card closest to ready,
      //    preferred category first (2026-08-20). This tier used to be a LEND, sitting
      //    both here and above the borrow pass, which minted a card on every correct
      //    mark once the answered card's own category ran dry: 14 lends in a single
      //    dev session, and a bucket that grew without bound.
      if (!winner) winner = await serveCooled([...preferredFirst, ...borrowOrder]);

      // 4. Genuinely nothing to serve — the learner has too few cards. Lend one, if
      //    this session is allowed to show a lent card at all.
      if (!winner && this.canLendProvisional(fallbackBase, collection)) {
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
    collection?: CollectionFilter | null,
    lentIds: number[] = [],
    foreignTrack: FlpForeignTrack = OnDeckVocabService.DEFAULT_FOREIGN_TRACK
  ): Promise<VocabEntry[]> {
    if (limit <= 0) return [];
    const candidates = await this.fetchFlpCandidates(client, userId, category, language, excludeIds, collection, lentIds);
    return this.rankFlpEligible(candidates, now, foreignTrack).slice(0, limit);
  }

  /**
   * The COOLING cards of one category, nearest-to-ready first — the flp's
   * next-to-last fill tier (2026-08-20).
   *
   * The flp had no cooled tier at all: a loop that could not be filled from rested
   * cards either lent new ones or came back short. Both were worse than re-showing a
   * card the learner chose, so the ladder now reads fresh → borrowed → COOLED → lent
   * (docs/PROVISIONAL_CARDS.md § 4b).
   *
   * These cards are shown but earn nothing: a mark fired at a still-cooling track is
   * dropped at `POST /api/flashcards/mark`. That is the point of the cooldown — a card
   * answered correctly minutes ago has nothing left to teach today — and it is a
   * better answer than growing the learner's deck with words they never chose.
   */
  private async fetchCooledCategoryCards(
    client: PoolClient,
    userId: string,
    language: string,
    category: string,
    limit: number,
    excludeIds: number[],
    now: number,
    collection?: CollectionFilter | null,
    lentIds: number[] = [],
    foreignTrack: FlpForeignTrack = OnDeckVocabService.DEFAULT_FOREIGN_TRACK
  ): Promise<VocabEntry[]> {
    if (limit <= 0) return [];
    const candidates = await this.fetchFlpCandidates(client, userId, category, language, excludeIds, collection, lentIds);
    return rankCardQueueCooled(candidates, now, {
      markTypes: flpMarkTypes(foreignTrack),
      windowCategoryOf: (card) => this.flpWindowCategory(card),
    }).slice(0, limit);
  }

  /**
   * Top a short working loop up with LENT cards, and return them.
   *
   * THE LAST TIER, reached only once the loop's own categories AND their cooling
   * cards are spent — i.e. the learner genuinely has too few cards, not merely too
   * few rested ones (docs/PROVISIONAL_CARDS.md § 4b). Until 2026-08-20 this ran
   * BEFORE borrowing and before cooling, which minted a fresh batch on every load for
   * any learner whose quota categories were thin.
   *
   * Policy lives in `ProvisionalCardService.acquireLentCards`: rows the learner
   * already holds are re-lent before anything new is minted. The ids come back here
   * and are re-queried through the ordinary flp candidate path — passing them as
   * `lentIds`, since selection is otherwise sorted-only.
   *
   * A lent row has no mark history, so it bands Unfamiliar and is immediately
   * eligible. Returns [] when dictionary supply is exhausted — the loop then plays
   * short, or empty, rather than breaking the cooldown.
   */
  private async lendIntoLoop(
    client: PoolClient,
    userId: string,
    language: string,
    need: number,
    excludeIds: number[],
    now: number,
    collection?: CollectionFilter | null,
    foreignTrack: FlpForeignTrack = OnDeckVocabService.DEFAULT_FOREIGN_TRACK
  ): Promise<VocabEntry[]> {
    if (need <= 0) return [];
    const { lentIds } = await this.provisionalCardService.acquireLentCards(
      userId, language, need, 'default', { excludeIds }
    );
    if (lentIds.length === 0) return [];
    // Re-lent rows keep their marks, so they can land in ANY band — query every
    // category rather than assuming Unfamiliar.
    //
    // FILTERED TO `lentIds` (not just excluded): passing `lentIds` widens the
    // candidate query to "sorted OR lent", so without this filter the pass could hand
    // back an ordinary sorted card — and for a MODE session (Challenge allows only
    // Unfamiliar/Target) that card could be from a category the mode forbids.
    // Goes through `fetchFlpCandidates` rather than `fetchEligibleCategoryCards`
    // because the latter applies its LIMIT before we could filter: a category holding
    // plenty of ordinary sorted cards would fill the slice with those and drop the
    // lent rows this call exists to return. The candidate query is deliberately
    // unlimited (see its docblock), so filtering first costs nothing.
    const lent = new Set(lentIds);
    const rows: VocabEntry[] = [];
    for (const category of ['Unfamiliar', 'Target', 'Comfortable', 'Mastered']) {
      if (rows.length >= need) break;
      const candidates = await this.fetchFlpCandidates(
        client, userId, category, language, excludeIds, collection, lentIds
      );
      const ranked = this.rankFlpEligible(candidates.filter((card) => lent.has(card.id)), now, foreignTrack);
      rows.push(...ranked.slice(0, need - rows.length));
    }
    return rows;
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
   * eligibility-filtered — a card is only offered if ≥1 of the session's two flp mark
   * types (`flpMarkTypes(foreignTrack)`) is off cooldown, and it's stamped with
   * `readyMarkTypes` so the client steers the shown face. Within each quota the
   * eligible cards are ranked AS A QUEUE, longest-waiting first (rankFlpEligible), so
   * a quota is filled by the cards most overdue for review; cards with no correct mark
   * yet sort last. Enriches cards with related words that share
   * characters.
   *
   * WHEN A QUOTA IS SHORT the loop BORROWS, then COOLS, then LENDS (2026-08-20): the
   * shortfall is covered from the mode's other categories first, then by re-showing
   * the learner's own cooling cards, and only then with lent cards. Lending exists to
   * get a learner started who has not sorted enough cards — not to paper over a quota
   * that a healthy deck simply cannot fill (the Mix loop asks for 1 Mastered + 2
   * Comfortable that a young deck does not have).
   *
   * The cooled tier deliberately re-serves resting cards: they are shown but earn
   * nothing, because a mark on a cooling track is dropped at POST /api/flashcards/mark.
   * A restricted session (Review, a builtin collection, a deck) still cannot lend, but
   * it does reach the cooled tier, so a deck whose cards are all resting replays them
   * instead of showing the "nothing ready" state. See canLendProvisional and
   * docs/PROVISIONAL_CARDS.md § 4b.
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
    collection?: CollectionFilter | null,
    /** Vet ids the caller's baseline top-up lent this session. Selection is
        sorted-only, so without these the lent cards are invisible and the loop would
        lend a second time to find them (docs/PROVISIONAL_CARDS.md § 4b). */
    lentIds: number[] = [],
    /** The session's foreign-first track — see DEFAULT_FOREIGN_TRACK. Decides which two
        tracks eligibility, queue order and the `readyMarkTypes` stamp are computed on. */
    foreignTrack: FlpForeignTrack = OnDeckVocabService.DEFAULT_FOREIGN_TRACK
  ): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const now = Date.now();
    const client = await db.getClient();
    try {
      let workingLoop: VocabEntry[];

      // The categories this loop may draw from, in fallback priority — also the
      // pool for the cooled fill below.
      let loopCategories: string[];
      // Cross-category borrow order, applied once the quotas are in. Empty for the
      // legacy single-category path, which never borrows.
      let fillOrder: string[] = [];

      if (categoryFilter) {
        // Legacy deck-tap path: up to WORKING_LOOP_SIZE eligible cards from the
        // single tapped category.
        loopCategories = [categoryFilter];
        workingLoop = await this.fetchEligibleCategoryCards(
          client, userId, language, categoryFilter, WORKING_LOOP_SIZE, [], now, collection, lentIds, foreignTrack
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
            client, userId, language, category, count, workingLoop.map(c => c.id), now, collection, lentIds, foreignTrack
          );
          workingLoop.push(...rows);
        }

        // The cross-category top-up runs below, as tier 1 of the shared fill ladder.
        fillOrder = config.fillOrder;
      }

      // FILL ORDER: BORROW → COOL → LEND (2026-08-20, replacing "lend first, borrow
      // second" of 2026-08-17).
      //
      // A quota its own category could not fill is covered, in this order:
      //   1. FRESH cards borrowed from the mode's other categories;
      //   2. COOLING cards — the learner's own words, shown again early. They earn
      //      nothing (the mark is dropped at POST /api/flashcards/mark), which is
      //      exactly what a cooldown means;
      //   3. LENT cards, and only here.
      //
      // The old ordering minted a card whenever a quota underfilled, and a quota
      // underfills constantly for an ordinary learner — the Mix loop asks for 1
      // Mastered + 2 Comfortable that a young deck simply does not have. Lending is
      // for a learner who has not sorted enough cards, not for one whose cards are
      // merely resting or unevenly distributed.
      //
      // Restricted sessions (Review, a builtin collection, a deck) still never lend:
      // a Review round padded with never-seen words is not a review, and a deck round
      // made of non-deck words is not that deck. They come back short on purpose —
      // but they DO now reach tier 2, so a deck whose cards are all resting replays
      // them instead of showing an empty loop.
      // See canLendProvisional and docs/PROVISIONAL_CARDS.md.
      for (const category of fillOrder) {
        if (workingLoop.length >= WORKING_LOOP_SIZE) break;
        const rows = await this.fetchEligibleCategoryCards(
          client, userId, language, category,
          WORKING_LOOP_SIZE - workingLoop.length, workingLoop.map(c => c.id), now, collection, lentIds, foreignTrack
        );
        workingLoop.push(...rows);
      }

      // 2. COOLING cards, nearest-to-ready first, across every category this loop may
      //    draw from (the legacy single-category path stays inside its own category).
      for (const category of loopCategories) {
        if (workingLoop.length >= WORKING_LOOP_SIZE) break;
        const rows = await this.fetchCooledCategoryCards(
          client, userId, language, category,
          WORKING_LOOP_SIZE - workingLoop.length, workingLoop.map(c => c.id), now, collection, lentIds, foreignTrack
        );
        workingLoop.push(...rows);
      }

      // 3. LEND — the learner really is short of cards.
      if (workingLoop.length < WORKING_LOOP_SIZE && this.canLendProvisional(loopCategories, collection)) {
        const lent = await this.lendIntoLoop(
          client, userId, language, WORKING_LOOP_SIZE - workingLoop.length,
          workingLoop.map(c => c.id), now, collection, foreignTrack
        );
        workingLoop.push(...lent);
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
   * Build ONE STUDY CHALLENGE ROUND'S BOARD (docs/STUDY_CHALLENGE.md § 5.2).
   *
   * A challenge board answers a different question from every other game pool, so
   * it is a different assembly rather than a `mode` on the one above. The normal
   * pool asks "give me a difficulty MIX"; this one asks "give me THESE nine
   * words, plus whatever is easiest to pad the board out with". Two hard rules
   * follow, and neither can be expressed as a bucket distribution:
   *
   *  1. **All nine contested words appear in every round.** Filler pads the board
   *     out to the game's natural size; it never displaces a contested word. So the
   *     contested rows are addressed BY ID and hydrated with the cooldown ignored —
   *     a contested word that happens to be resting is still contested.
   *  2. **Filler is the player's easiest available material**, via the
   *     `mastered-first` ladder (`ProvisionalCardService.getFillerPool`): Mastered →
   *     Comfortable → Target → Unfamiliar → lent. Filler must not be a source of
   *     difficulty — a challenge measures the nine, and padding with words the
   *     player has never seen would add noise and reward whoever got luckier filler.
   *     That is also why filler scores 20 rather than 100 (§ 5.4).
   *
   * ⚠️ THE RESULT IS SHUFFLED, and that is a correctness requirement, not a
   * nicety (Q74). The board must not reveal which words are contested; handing the
   * nine back first would let any client — and any player watching the deal
   * order — read the split straight off the payload. The games classify by WORD
   * against the set they already hold, never by position.
   *
   * `includeContested: false` is the rolling top-up form — Match Speed's buffer and
   * Hydra's colour buffers refill mid-run, and those refills are pure filler
   * because the contested set was dealt once, up front, and is never recycled
   * (§ 5.3).
   *
   * The band `available` counts are still returned, so the response is shape-
   * compatible with the ordinary pool and the games need only one parser.
   */
  async getChallengeGamePool(
    userId: string,
    language: string,
    gameMarkType: MarkType,
    opts: {
      /** Vet ids of the contested words, from `StudyChallengeService.getRoundContext`. */
      contestedIds: number[];
      /** The contested WORDS — what keeps a contested word out of the filler pool. */
      contestedWords: string[];
      /** Board size: how many cards this call must return in total. */
      need: number;
      /** False for a mid-run top-up, which is filler only. */
      includeContested: boolean;
      /** Cards already on the board / in a buffer — never hand one back twice. */
      excludeIds?: number[];
      /** Word Search drops words too long for its grid. */
      maxEntryKeyLen?: number;
    }
  ): Promise<{
    cards: VocabEntry[];
    requested: Record<string, number>;
    available: Record<string, number>;
    total: number;
    needed: number;
    sufficient: boolean;
  }> {
    if (!userId) throw new ValidationError('User ID is required');

    const now = Date.now();
    const need = Math.max(0, Math.floor(opts.need));
    const excluded = new Set(opts.excludeIds ?? []);
    const available = await this.getCategoryCounts(
      userId, language, OnDeckVocabService.GAME_FALLBACK_ORDER
    );

    const client = await db.getClient();
    try {
      const contestedIds = opts.includeContested
        ? opts.contestedIds.filter((id) => !excluded.has(id))
        : [];
      const contested = await this.fetchRowsByIds(
        client, userId, language, contestedIds, gameMarkType, now, opts.maxEntryKeyLen,
        true // obligation, not preference — see fetchRowsByIds
      );

      // Filler tops the board up to `need`. The contested WORDS are excluded by word
      // rather than by id so a second vet row for the same word (a language switch,
      // a re-materialised card) cannot slip in as its own filler.
      // ⚠️ THE EXCLUSION GOES INTO THE LADDER, NOT AFTER IT. The ladder is
      // deterministic (band descent, then commonality), so filtering its RESULT would
      // hand a mid-run top-up exactly the rows the opening deal already took — the
      // refill would come back empty and a rolling-buffer game would run dry
      // mid-round. Measured, and fixed, on 2026-08-22.
      const fillerIds = await this.provisionalCardService.getFillerPool(
        userId, language, Math.max(0, need - contested.length), opts.contestedWords,
        [...excluded, ...opts.contestedIds]
      );
      const filler = await this.fetchRowsByIds(
        client, userId, language,
        fillerIds.filter((id) => !excluded.has(id) && !contestedIds.includes(id)),
        gameMarkType, now, opts.maxEntryKeyLen,
        // The ladder's top rungs are the player's MASTERED cards, which are the most
        // likely of all to be resting. Filtering them would empty the filler pool for
        // exactly the learners the ladder was written for.
        true
      );

      const cards = this.shuffleCards([...contested, ...filler]).slice(0, need);
      const enriched = await this.enrichEntriesPipeline(cards, language);
      const withAudio = await this.prewarmAudio(enriched);

      return {
        cards: withAudio,
        // A challenge board asks for no bands at all: the set IS the request.
        requested: {},
        available,
        total: need,
        needed: need,
        // Short only when the player's whole library AND the dictionary are
        // exhausted. A short board still plays — it is never a refusal (§ 5.2).
        sufficient: withAudio.length >= need,
      };
    } finally {
      client.release();
    }
  }

  /** Fisher-Yates over a copy — see the Q74 note on `getChallengeGamePool`. */
  private shuffleCards(cards: VocabEntry[]): VocabEntry[] {
    const out = [...cards];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

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
      /** Never fill from outside the requested buckets. Set by callers for whom the
          bucket IS the answer rather than a preference — Hydra pays the player by the
          band a card came from (docs/HYDRA_BUBBLES.md § 6.2d). Such a request comes
          back short rather than wrong. */
      strictBuckets?: boolean;
      /** Vet ids the caller's baseline top-up lent this round
          (`ProvisionalCardService.ensureBaseline`). Selection is sorted-only, so
          without these the lent cards are invisible to the pool. */
      lentIds?: number[];
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
        OnDeckVocabService.GAME_CANDIDATE_CAP, undefined, excludeIds, opts.collection,
        opts.lentIds ?? []
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
      // NO TWO CARDS IN ONE ROUND MAY READ THE SAME (2026-08-22).
      //
      // Distinct entries routinely resolve to the SAME dd — 高兴 / 开心 both "happy",
      // any two measure words both "measure word". Every game shows its cards at once,
      // so two same-dd cards on one board give a prompt two correct-looking answers of
      // which only one scores. The pool is the single place all four gamePool games
      // (Bubble Match, Match Speed, Speed Reading, Hydra) get their cards, so the guard
      // lives here rather than four times over on the client.
      // See docs/GAMES_FEATURE.md § "No two cards may share a dd in one round".
      //
      // SEEDED with the dds of the cards the caller is KEEPING (`excludeIds` = on the
      // board or in the buffer, for a partial refill), so a replacement can't collide
      // with a bubble already on screen — the exact same reason `excludeIds` itself
      // exists, one level up from identity.
      const takenDds = await this.fetchDdKeys(client, userId, language, excludeIds);

      // PHASE 2 NEAR-MISS GUARD (docs/GLOSS_CONFUSABILITY.md § 6). Resolve every
      // candidate's dd key to its precomputed `meaningGroupId` in one batch — the
      // same offline clustering `ddCollisionKey` glossKeys are looked up against —
      // then walk `takenGroups` alongside `takenDds` in `drain()` below. A key with
      // no row in `gloss_meaning_groups` is simply absent from the map (see
      // `fetchGroupIds`), so words the pipeline hasn't clustered yet never block.
      const candidateDdKeys = [
        ...takenDds,
        ...Object.values(eligible).flat().map(ddCollisionKey),
        ...Object.values(cooled).flat().map(ddCollisionKey),
        ...Object.values(avoided).flat().map(ddCollisionKey),
      ];
      const glossKeyToGroup = await this.fetchGroupIds(client, candidateDdKeys);
      const takenGroups = new Set<number>();
      for (const key of takenDds) {
        const groupId = glossKeyToGroup.get(key);
        if (groupId !== undefined) takenGroups.add(groupId);
      }

      // HARD everywhere except the two cases lending itself can't run — must mirror
      // `mayLend` exactly (declared again, unchanged, at tier 5 below) so the two can
      // never drift apart: a collection-restricted round, and a partial refill that
      // isn't a rolling-supply surface, both have no fallback to grow into if the
      // near-miss guard shortens the board, so those two admit a same-meaning-group
      // card rather than come back short. Exact-dd collisions (`takenDds` above) stay
      // hard in both cases — identical strings collide regardless.
      const mayLend = opts.need === undefined || opts.lendOnRefill === true;
      const groupGuardHard = !opts.collection && mayLend;

      // Pop up to `limit` not-yet-selected cards off one category queue.
      const drain = (queue: VocabEntry[], limit: number): void => {
        while (limit > 0 && queue.length > 0) {
          const card = queue.shift()!;
          if (selectedIds.has(card.id)) continue;
          // A colliding card is DISCARDED, not deferred: the key it clashes with is
          // held for the whole round, so this card could never become admissible later.
          // An empty key means "no dd to confuse anyone with" and never collides.
          const ddKey = ddCollisionKey(card);
          if (ddKey && takenDds.has(ddKey)) continue;
          const groupId = ddKey ? glossKeyToGroup.get(ddKey) : undefined;
          if (groupGuardHard && groupId !== undefined && takenGroups.has(groupId)) continue;
          if (ddKey) takenDds.add(ddKey);
          if (groupId !== undefined) takenGroups.add(groupId);
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
      // STRICT-BUCKET REQUESTS NEVER SUBSTITUTE A BUCKET (2026-08-18; made explicit
      // 2026-08-21).
      //
      // A caller can ask for a set of categories in one of two spirits. Usually it is
      // describing a difficulty MIX it would like, and topping one quota up from a
      // neighbouring bucket is exactly the best-effort fill it wants. But Hydra
      // Bubbles rolls a COLOR, requests the bands that color is made of, and pays the
      // player according to that color (docs/HYDRA_BUBBLES.md § 2, § 5) — for it the
      // request is a question whose answer is the bucket itself, and a card from
      // outside the set is one the caller then misreports to the player and misprices.
      // `strictBuckets` collapses the fallback ORDER to the requested buckets alone:
      // such a caller would rather come back SHORT — it can wait or skip the slot —
      // than come back WRONG.
      //
      // ⚠️ IT IS A FLAG NOW, NOT AN INFERENCE, and that is the point. This used to be
      // inferred as `requested.length === 1`, which worked only while Hydra asked for
      // exactly one band per color. Hydra's two-color rework asks for TWO bands per
      // color (BUCKETS_BY_COLOR, src/games/hydra-bubbles/constants.ts), which the old
      // inference would have read as "a mix, please substitute freely" — silently
      // reintroducing the mispricing it was written to stop. An intent this load-
      // bearing has to be stated by the caller, not guessed from the shape of what it
      // asked for.
      //
      // The length-1 inference is kept underneath as a backstop for any future caller
      // that asks for a single bucket without knowing about the flag; a single-bucket
      // request is unambiguous in a way a subset request is not.
      const requested = Object.keys(distribution);
      const substituting = !opts.strictBuckets && requested.length > 1;
      const fallbackOrder = substituting ? OnDeckVocabService.GAME_FALLBACK_ORDER : requested;
      const lastResortOrder = substituting
        ? [...requested, ...OnDeckVocabService.GAME_FALLBACK_ORDER]
        : requested;

      // 2. Still short → top up to `target` with FRESH cards from the fallback
      //    buckets (Target → Comfortable → Unfamiliar → Mastered).
      for (const category of fallbackOrder) {
        if (cards.length >= target) break;
        drain(eligible[category] ?? [], target - cards.length);
      }
      // 3. Still short → COOLING cards (requested buckets first, then fallback), so a
      //    just-played library still assembles a full board.
      //
      //    For a single-bucket caller this is the tier that MATTERS, and it is
      //    deliberately allowed to break the per-type cooldown: a genuinely Mastered
      //    card that is merely resting is a truthful `bloom` bubble (Hydra's +1 tier),
      //    whereas a minted HSK-1 word placed in that tier by its lend level is not.
      //    Note the consequence —
      //    a mark on a still-cooling card is dropped by the guard at
      //    POST /api/flashcards/mark (docs/HYDRA_BUBBLES.md § 8), so these cards are
      //    playable but do not advance mastery. That is the accepted trade: the
      //    cooldown exists precisely so re-answering a Mastered card inside its
      //    window earns nothing.
      for (const category of lastResortOrder) {
        if (cards.length >= target) break;
        drain(cooled[category] ?? [], target - cards.length);
      }
      // 4. Then → AVOIDED cards (just cleared by the caller). Only reached when the
      //    library is too small to fill the board without reusing them; a roomy
      //    library never gets here.
      for (const category of lastResortOrder) {
        if (cards.length >= target) break;
        drain(avoided[category] ?? [], target - cards.length);
      }

      // 5. ABSOLUTE last resort → LEND (2026-08-20, replacing the 2026-08-17
      //    "lend before borrowing" rule and its 2026-08-19 narrowing).
      //
      //    LENDING IS NOW THE BOTTOM OF THE LADDER, BELOW COOLING CARDS. The rule it
      //    implements: lending exists to get a learner started who has not sorted
      //    enough cards, and for nothing else (docs/PROVISIONAL_CARDS.md § 4b). A
      //    learner with a real library whose cards are merely RESTING is not short of
      //    cards, so tier 3 re-serves those instead. The cost is that a mark on a
      //    still-cooling card is dropped at POST /api/flashcards/mark, so those cards
      //    play but do not advance mastery — the accepted trade, and a far better one
      //    than growing the learner's deck with words they never chose.
      //
      //    Why the old ordering was wrong, concretely: Speed Reading buckets by
      //    READING, where a typical learner is ~100% Unfamiliar, so its
      //    Target/Comfortable/Mastered quotas (18 of 20) are unfillable no matter how
      //    large the library is — and a minted row is itself Unfamiliar, so lending
      //    could never close them. Every load lent another ~18 cards, forever.
      //
      //    In practice this tier is reached by exactly two callers: a genuinely
      //    under-supplied learner whose baseline top-up could not cover the board
      //    (dictionary exhausted), and Hydra Bubbles, whose every spawn is a refill and
      //    whose colour ladder is built on lending (docs/HYDRA_BUBBLES.md § 6.2).
      //    Hydra now pulls cooling cards before it lends, like everything else.
      //
      //    Two sessions never reach it at all:
      //      * a COLLECTION-restricted pool (a deck / builtin) — a deck round made of
      //        non-deck words is not that deck (same rule as canLendProvisional);
      //      * a PARTIAL REFILL (`opts.need`) — Bubble Match's Play Again is mid-session
      //        with a board in hand, and lending there would grow the player's deck on
      //        every tap. EXCEPT for a rolling-supply surface (`opts.lendOnRefill`),
      //        whose every spawn is a refill and which would otherwise never lend at
      //        all. See ROLLING_SUPPLY_SURFACES in contracts/wire.ts.
      //
      //    The collection exemption has NO opt-out: a restricted round plays the set
      //    the learner chose, rolling supply or not (docs/HYDRA_BUBBLES.md § 6.3).
      //    (`mayLend` declared once, above — see the near-miss guard comment there.)
      if (cards.length < target && !opts.collection && mayLend) {
        const lent = await this.lendGameCandidates(
          client, userId, language, target - cards.length, gameMarkType, now,
          undefined, [...excludeIds, ...selectedIds], opts.lendLevelOffset
        );
        // The re-query is unaware of the soft-avoid tier, so filter those back out.
        drain(lent.filter((card) => !avoidIds.has(card.id)), target - cards.length);
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

  // Grid dimensions: 6 columns wide × 7 rows tall (portrait play area).
  // See docs/WORD_SEARCH_GAME.md §2.
  //
  // ONE BOARD SIZE FOR EVERY MODE. A Study Challenge round used to get its own
  // roomier 8×8 grid; that split was removed on 2026-08-28 (with the 12 → 9 word
  // drop) because two sizes meant two densities, two tunings, and — since
  // `templateModeApplicable` gates on these exact dimensions — a challenge board
  // that could never reach template mode. Challenge and ordinary boards now read
  // the SAME constants and therefore share the placement fallback.
  static readonly WORD_SEARCH_ROWS = 7;
  static readonly WORD_SEARCH_COLS = 6;
  // Cap on how many library candidates we pull per category up front. Word Search
  // needs a working set to run the substring de-dup / replacement loop against;
  // this bounds memory for users with very large libraries.
  private static readonly WORD_SEARCH_CANDIDATE_CAP = 500;

  /**
   * Build the Word Search game payload: a clean 9-word set (no word's Chinese
   * text is a substring of another's) hidden as snaking paths in a 7×6 grid of
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
    collection?: CollectionFilter | null,
    /** Vet ids the caller's baseline top-up lent this grid. Selection is sorted-only,
        so without these the lent cards are invisible (docs/PROVISIONAL_CARDS.md § 4b).
        The controller's PROVISION_RETRY_FACTOR loop accumulates them across retries. */
    lentIds: number[] = [],
    /**
     * STUDY CHALLENGE ROUND (docs/STUDY_CHALLENGE.md § 5.2). When present the board
     * is not a band mix at all: the contested words ARE the target list and filler
     * comes from the `mastered-first` ladder. The grid is the SAME size as an
     * ordinary board (see WORD_SEARCH_ROWS) — both hold 9 words.
     */
    challenge?: {
      contestedIds: number[];
      contestedWords: string[];
      /** Filler queue size as a multiple of `total` (default 2). The controller
          escalates this and retries when the de-dup pass comes up short — the
          challenge equivalent of the non-challenge path's PROVISION_RETRY_FACTOR
          loop, since there is no baseline to lend against here: the contested nine
          are fixed, so a bigger spare filler queue is the only lever. */
      fillerMultiplier?: number;
    } | null
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

    // ONE GRID SIZE, challenge or not (see WORD_SEARCH_ROWS). Both boards hold 9
    // words — TOTAL_WORDS and CHALLENGE_WORD_COUNT are separately-declared 9s, not
    // one derived from the other — in 7x6 (42 cells), so 36-of-42 cells (86%) are
    // word cells either way, and both boards are eligible for TEMPLATE MODE
    // (`templateModeApplicable` gates on exactly these dimensions).
    const rows = OnDeckVocabService.WORD_SEARCH_ROWS;
    const cols = OnDeckVocabService.WORD_SEARCH_COLS;
    // The challenge's own set is the target list — never the requested
    // distribution. Even though both sum to 9, the challenge set is the
    // SPECIFIC contested word ids (§ 5.2), unrelated to a band distribution.
    const total = challenge
      ? challenge.contestedIds.length
      : Object.values(distribution).reduce((sum, n) => sum + n, 0);

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
        OnDeckVocabService.WORD_SEARCH_CANDIDATE_CAP, 4, [], collection, lentIds
      );

      const selectedIds = new Set<number>();
      const selected: VocabEntry[] = [];
      // NO TWO WORDS ON ONE GRID MAY READ THE SAME — the same rule the game pool
      // enforces (see `takenDds` in getGameVocabPool), and the word list makes it even
      // more visible here: ten glosses printed in a column, two of them identical, with
      // no way for the player to know which grid word they are being asked to find.
      // See docs/GAMES_FEATURE.md § "No two cards may share a dd in one round".
      //
      // Unseeded (a grid is always built from scratch — there is no refill path) and
      // released on eviction, unlike the pool's: the substring de-dup loop below drops
      // words back out of `selected`, and a dropped word's dd must become available
      // again or the replacement pass would be excluding a gloss nothing is showing.
      const takenDds = new Set<string>();

      // PHASE 2 NEAR-MISS GUARD (docs/GLOSS_CONFUSABILITY.md § 6), mirroring
      // `getGameVocabPool`'s `takenGroups`/`glossKeyToGroup`. Word Search has no
      // `need`/`lendOnRefill` split — a collection-restricted grid is the only round
      // that never lends — so the guard is hard unless `collection` is set. Unlike
      // `takenDds`, `glossKeyToGroup` grows over the method's lifetime: challenge
      // filler and lent rows are fetched AFTER this initial batch (below), so
      // `loadGroupsFor` re-queries for any new key not already resolved.
      const glossKeyToGroup = new Map<string, number>();
      const loadGroupsFor = async (rows: VocabEntry[]): Promise<void> => {
        const keys = rows.map(ddCollisionKey).filter((key): key is string => Boolean(key));
        const missing = keys.filter((key) => !glossKeyToGroup.has(key));
        if (missing.length === 0) return;
        const found = await this.fetchGroupIds(client, missing);
        for (const [key, groupId] of found) glossKeyToGroup.set(key, groupId);
      };
      await loadGroupsFor([...Object.values(eligible).flat(), ...Object.values(cooled).flat()]);
      const takenGroups = new Set<number>();
      const groupGuardHard = !collection;

      // Pop up to `limit` unused cards from one queue into `selected`.
      const drain = (queue: VocabEntry[], limit: number): void => {
        while (limit > 0 && queue.length > 0) {
          const card = queue.shift()!;
          if (selectedIds.has(card.id)) continue;
          const ddKey = ddCollisionKey(card);
          if (ddKey && takenDds.has(ddKey)) continue;
          const groupId = ddKey ? glossKeyToGroup.get(ddKey) : undefined;
          if (groupGuardHard && groupId !== undefined && takenGroups.has(groupId)) continue;
          if (ddKey) takenDds.add(ddKey);
          if (groupId !== undefined) takenGroups.add(groupId);
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

      // ── CHALLENGE SELECTION (§ 5.2) ──
      // The contested words go in first, whole, cooldown ignored — they are an
      // obligation, not a preference. The `mastered-first` filler is then pushed
      // onto a FRESH queue rather than into `selected`, so the substring-de-dup loop
      // below can draw replacements from it: an arbitrary set of nine words will
      // not reliably have mutually distinct characters, and when one has to be
      // dropped a filler word takes its place. That substitution is exactly why Word
      // Search scores contested and filler differently (§ 5.4) rather than a flat 100.
      if (challenge) {
        const contestedRows = await this.fetchRowsByIds(
          client, userId, language, challenge.contestedIds, gameMarkType, now, 4, true
        );
        drain(contestedRows, contestedRows.length);
        // At least twice the board, because this queue serves TWO jobs: topping the
        // target list up to `total`, and feeding the de-dup loop's replacements. A
        // queue sized exactly to the board leaves nothing to substitute WITH, and the
        // grid then fails as `insufficient-distinct` — which for a challenge round is
        // a round the player cannot play at all. Doubling only reduces the odds of
        // that rather than eliminating them, so the controller escalates
        // `fillerMultiplier` and retries when it still isn't enough.
        const fillerIds = await this.provisionalCardService.getFillerPool(
          userId, language, total * (challenge.fillerMultiplier ?? 2),
          challenge.contestedWords, challenge.contestedIds
        );
        const fillerRows = await this.fetchRowsByIds(
          client, userId, language, fillerIds, gameMarkType, now, 4, true
        );
        (eligible['Target'] ??= []).push(...fillerRows.filter((row) => !selectedIds.has(row.id)));
        await loadGroupsFor(fillerRows);
        // Top up to `total` from that same filler queue when contested words were
        // dropped for length (> 4 characters cannot be placed) or have no vet row.
        drain(eligible['Target'], Math.max(0, total - selected.length));
      }

      // 1. Fill each requested bucket up to its quota from FRESH cards, then
      //    2. top up to `total` with FRESH fallback cards, then 3. backfill with
      //    COOLED cards (requested buckets → fallback), and only then 4. LEND.
      if (!challenge) {
        for (const [category, count] of Object.entries(distribution)) drain(eligible[category] ?? [], count);
      }

      for (const category of OnDeckVocabService.GAME_FALLBACK_ORDER) {
        if (selected.length >= total) break;
        drain(eligible[category] ?? [], total - selected.length);
      }
      for (const category of [...Object.keys(distribution), ...OnDeckVocabService.GAME_FALLBACK_ORDER]) {
        if (selected.length >= total) break;
        drain(cooled[category] ?? [], total - selected.length);
      }

      // 4. LAST → LEND (2026-08-20). Same ladder as the game pool: fresh cards of the
      //    requested buckets, then fresh borrowed ones, then COOLING cards, and only
      //    then words the learner has never chosen. A learner whose grid words are
      //    merely resting is not short of cards (docs/PROVISIONAL_CARDS.md § 4b).
      //
      // The lent rows are pushed onto the Unfamiliar FRESH queue rather than drained
      // straight into `selected`, so the substring-dedup replacement loop below can
      // draw on them too — otherwise a lent word dropped as a substring could not be
      // replaced by another lent word. A collection-restricted grid never lends.
      //
      // NOTE the grid's extra constraint: `total` distinct-charactered words. Under-
      // lending here is safe because the controller's PROVISION_RETRY_FACTOR loop
      // re-enters with an escalated baseline when the de-dup pass still comes up short.
      if (selected.length < total && !collection && !challenge) {
        const lent = await this.lendGameCandidates(
          client, userId, language, total - selected.length, gameMarkType, now,
          4, [...selectedIds], undefined
        );
        // Unshift: freshly lent words go to the FRONT of the Unfamiliar queue, ahead
        // of any Unfamiliar card the quota pass left behind.
        (eligible['Unfamiliar'] ??= []).unshift(...lent);
        await loadGroupsFor(lent);
        drain(eligible['Unfamiliar'], total - selected.length);
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
        // Release the evicted word's dd so a replacement may legitimately reuse it.
        const victimDd = ddCollisionKey(victim);
        if (victimDd) takenDds.delete(victimDd);
        // Same release for its near-miss group (§ 6) — correct under the hard guard,
        // where at most one selected card can ever hold a given group id at once, so
        // there is nothing else still relying on the group being held.
        const victimGroupId = victimDd ? glossKeyToGroup.get(victimDd) : undefined;
        if (victimGroupId !== undefined) takenGroups.delete(victimGroupId);

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
      //
      // The same query is ALSO widened from the single characters to every <=4-char
      // SUBSTRING of every target word, so it can build each word's tap-to-drill chain
      // (docs/SEGMENT_DRILL_DOWN.md): tapping a found 中国人 narrows to 中国 before it
      // narrows to a character. Widening this existing round trip is what keeps the
      // feature free here — est and long definitions already load the same substring set
      // for their segmenter, but a word-search grid never had a reason to.
      const targetChars = [...new Set(withAudio.flatMap((w) => [...w.entryKey]))];
      const drillCandidates = [...new Set(withAudio.flatMap((w) => getAllSubstrings(w.entryKey)))];
      const charClusters = new Map<string, Array<{ sense?: string | null; glosses?: string[] | null }>>();
      const charComponentsMap = new Map<string, string[]>();
      const drillByWord = new Map<string, SegmentDrillRung[]>();
      if (targetChars.length > 0) {
        const clustersResult = await client.query<{
          word1: string;
          definitionClusters: unknown;
          components: unknown;
        }>(`
          SELECT word1, pronunciation, definitions, "definitionClusters", components,
                 "matchException", "frequencyScore", "exampleSentenceDefinitionPronunciationOverride",
                 -- The target word's own breakdown, so a single-character drill rung is
                 -- glossed with the sense that character carries IN THIS WORD (the same
                 -- answer the bt gives). The client prefers the grid cell's definition for
                 -- that rung, which resolves identically; this keeps the shipped rung list
                 -- self-consistent for the cell-less fallback path.
                 breakdown
          FROM dictionaryentries_zh
          WHERE language = 'zh' AND word1 = ANY($1)
        `, [drillCandidates]);

        // Rungs are resolved with the shared builder so the word-search chain and the
        // example-sentence chain can never drift apart. No English context exists here
        // (a grid is a word list, not prose), so rung glosses are the entry's lead sense.
        const drillEntries = clustersResult.rows as unknown as DictionaryEntry[];
        const drillDictMap = buildDictMap(drillEntries);
        const drillExcludeTokens = buildExcludeSet(drillEntries);
        for (const w of withAudio) {
          if (drillByWord.has(w.entryKey)) continue;
          const rungs = buildDrillRungs(w.entryKey, drillDictMap, { excludeTokens: drillExcludeTokens });
          if (rungs.length > 0) drillByWord.set(w.entryKey, rungs);
        }

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
          drill: drillByWord.get(w.entryKey),
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

import { VocabEntry, MarkType, UsedInItem } from '../types/index.js';
import { WORD_SEARCH_BOARDS, type MasteryWorldId, type WordSearchBoardId } from '../contracts/wire.js';
import { isFlpOnlyMark, FLP_ONLY_CORE_PBH, barProgressBarHeight, barCategory, worldForMarkType } from '../contracts/mastery.js';
import { STUDY_MIX_QUOTAS, STUDY_MIX_FILL_ORDER } from '../contracts/studyMix.js';
import type { FlpWorld } from '../contracts/studyMode.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import type { IOnDeckVocabDAL, CollectionFilter } from '../dal/interfaces/IOnDeckVocabDAL.js';
import { DictionaryService } from './DictionaryService.js';
import { StarterPacksService } from './StarterPacksService.js';
import { ValidationError } from '../types/dal.js';
import type { BuiltinCollectionId } from '../dal/shared/vetTable.js';
import { computeTypeCategory } from '../utils/masteryCompute.js';
import { flpReadyCountsByBand, flpUpcomingReady, type FlpUpcomingRelease } from '../contracts/flpReadiness.js';
import { rankCardQueue, isMarkOnCooldown } from './cardQueueRanking.js';
import type { CardAudioService } from './CardAudioService.js';
import type { ProvisionalCardService } from './ProvisionalCardService.js';
import {
  generateWordSearchGrid,
  type GridCell,
  type WordSearchInput,
  type WordSearchGrid,
} from './wordSearchGrid.js';
import { resolveSenseGloss, resolveDisplayDefinition, resolveDisplayPronunciation, resolveDefaultPronunciation, ddCollisionKey } from '../utils/definitions.js';
// Tap-to-drill rung construction, shared with the example-sentence / long-definition
// enrichment paths so both chains obey one rule. See docs/SEGMENT_DRILL_DOWN.md.
import { getAllSubstrings, buildDictMap, buildExcludeSet, buildDrillRungs, type SegmentDrillRung } from '../dal/shared/segmentString.js';
import type { DictionaryEntry } from '../types/index.js';

// The flp's world axis (server/contracts/studyMode.ts): which bar a session's bands,
// queue and cooldown are read off. Every session is Study Mix.
export { parseFlpWorld, type FlpWorld } from '../contracts/studyMode.js';

// The round-scope type lives on the DAL interface (the DAL turns it into SQL, and a DAL
// must not import from a service); re-exported so importers keep using this module.
export type { CollectionFilter } from '../dal/interfaces/IOnDeckVocabDAL.js';

/**
 * The working-loop deal's candidates, read once and banded in memory
 * (`OnDeckVocabService.loadFlpDealPool`). Each call returns up to `limit` cards of
 * `band` at the head of its queue, skipping any already in `picked`.
 */
interface FlpDealPool {
  /** Off-cooldown cards, in rankFlpEligible order (the quota and top-up tiers). The flp
      never deals a cooling card, so there is no cooled tier (2026-11-11). */
  eligible(band: string, limit: number, picked: VocabEntry[]): VocabEntry[];
}

/** The shape of a working loop: ordered quotas plus the top-up priority. */
interface LoopConfig {
  // Ordered initial fetch quotas (summing to the loop total).
  quotas: { category: string; count: number }[];
  // Priority order used to top the loop up to its total when a quota underfills.
  fillOrder: string[];
}

// The Study Mix working-loop shape — the historical 1-2-2-5 distribution with a
// Target-first top-up. The quotas themselves are a shared contract
// (`STUDY_MIX_QUOTAS`, server/contracts/studyMix.ts). Until 2026-11-04 the Review and
// Challenge study modes had their own band-restricted configs beside this one
// (`MODE_CONFIGS`, docs/DEFERRED_WORK.md § 31); Mix is now the only loop shape.
const DEFAULT_LOOP_CONFIG: LoopConfig = {
  quotas: STUDY_MIX_QUOTAS.map((q) => ({ ...q })),
  fillOrder: [...STUDY_MIX_FILL_ORDER],
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
    // Every card read this service makes (candidates, decks, counts, Word Search det
    // reads). The service holds the selection policy; the DAL holds the SQL.
    private onDeckVocabDAL: IOnDeckVocabDAL,
    private dictionaryService: DictionaryService,
    // Used only by Word Search, to bound the filler pool to the user's estimated
    // difficulty level (and below) — see getWordSearchGrid.
    private starterPacksService: StarterPacksService,
    // Card audio pre-warm (see the hasAudio field on VocabEntry). Injected rather
    // than imported as a singleton so the composition root owns its lifetime.
    private cardAudioService: CardAudioService,
    // Lends cards when the flp working loop cannot be filled from cards that are off
    // cooldown. Injected here rather than driven from the controller because the
    // decision is made mid-algorithm, once the shortfall is known — and the refill
    // path (getNextLibraryCardWithFallback) needs the same call.
    private provisionalCardService: ProvisionalCardService
  ) {}

  // The flp presents exactly the two KNOW tracks — English-first writes production,
  // foreign-first writes recognition (with or without pinyin, since 2026-09-25) — and
  // both rest on ONE clock, the core bar's (docs/MASTERY_REWORK.md § 6). So every flp
  // selection path gates on this one bar; which of the two faces the card then shows
  // is the client's call (src/utils/flpFaceSteering.ts), made from the card's own
  // history, so no per-card stamp is needed.
  //
  // The cooldown table and the queue maths live in services/cardQueueRanking.ts — a
  // pure module shared with Memory Map, which ranks the reading clock the same way
  // (docs/MEMORY_MAP_GAME.md § 13.1).
  //
  // The ONE exception is the reading flp (`world: 'reading'`), which marks the
  // reading track and therefore gates on the reading bar instead — every flp selection
  // helper below takes the bar as a parameter, defaulting to this one.
  private static readonly FLP_WORLD: MasteryWorldId = 'core';

  /**
   * The flp-eligible subset of `cards` (the know clock has run out), ordered AS A
   * QUEUE.
   *
   * This is the flp's one ranking rule, shared by the initial working loop and the
   * mark-endpoint refill so a loop and its replacements are drawn the same way. It
   * ranks WITHIN a utcm category — the quota distribution still decides how many cards
   * come from each mastery bucket, and this decides which cards fill them.
   *
   * TWO TIERS (cardQueueRanking.rankCardQueue):
   *
   *   1. RECENT — a mark on the bar, right or wrong, in the last 30 days: by arrival
   *      time ASC, so the card that came off cooldown earliest is served first (see
   *      cardQueueRanking.queueArrivalAt);
   *   2. STALE — no mark in 30 days, or never marked: the learner's own cards before
   *      lent ones, then EASIEST FIRST — det `difficulty` on core/reading, the hardest
   *      character's stroke count (`maxCharStrokeCount`) on writing.
   *
   * Ties keep the caller's incoming order, which is `createdAt DESC` — newest first.
   * Array.sort is stable.
   */
  private rankFlpEligible(cards: VocabEntry[], now: number, world: MasteryWorldId = OnDeckVocabService.FLP_WORLD): VocabEntry[] {
    return rankCardQueue(cards, now, { world }).map(({ card }) => card);
  }

  /**
   * Whether an flp session may be topped up with LENT cards when its own pool is spent.
   *
   * Two conditions, both required:
   *
   *   1. `lend` — the session's LEND SWITCH (2026-11-11). An flp session serves only the
   *      learner's own off-cooldown cards until they run out; then the flp shows an
   *      interim card ("out of ready cards — new words next") and re-deals with the
   *      switch on (`?lend=1` on the deal / break refill, `lend: true` on the mark).
   *      The switch is client state and resets when the Deck Tower visit ends
   *      (docs/DECK_TOWER.md § "Running out of ready cards").
   *   2. An unrestricted scope. Lending into a NAMED set is worse than waste — a focused
   *      round padded with words outside the day's set is not that day's set. Such a
   *      session comes back short and the flp shows "done for the day" instead.
   *
   *   switch on, unrestricted          → lend
   *   switch off, or focused (FOCUS_MODE.md § 4) → never lend
   *
   * Until 2026-11-04 this also took the loop's category list and refused when
   * Unfamiliar was not among them (a lent card bands Unfamiliar): that guarded the
   * Review study mode and the legacy single-category `?category=` loop, both removed.
   * Every flp session now draws from all four bands, so only the scope matters. The
   * restricted cases also used to include `?collection=` and `?deck=` launches.
   */
  private canLendProvisional(lend: boolean, collection?: CollectionFilter | null): boolean {
    return lend && !collection;
  }

  // A card is FRESH for a game when a mark of the type that game emits would actually
  // be recorded — the same two tests `FlashcardMarkService.applyMark` applies, so the
  // pool never calls a card fresh that the mark gate would then drop:
  //
  //   1. the clock of the bar that mark lands in has run out. For a recognition or
  //      production game that is the shared KNOW clock, so a card just answered in
  //      the flp is resting for Bubble Match too (docs/MASTERY_REWORK.md § 6);
  //   2. the mark is not flp-only — once a card's core pbh reaches 6 its know marks
  //      count only from the flp (`isFlpOnlyMark`), so for a recognition/production
  //      game the card is filed as COOLED, playable only as backfill.
  //
  // BUCKETING stays per mark type (fetchGameCandidates) — only freshness is per bar.
  private isCardGameEligible(card: VocabEntry, markType: MarkType, now: number): boolean {
    return (
      !isMarkOnCooldown(card.typedMarkHistory, markType, now, card.writingMastery) &&
      !isFlpOnlyMark(card.typedMarkHistory, markType)
    );
  }

  /**
   * An flp game break's seed rule (docs/FLP_GAME_BREAKS.md § 4): a working-loop card goes
   * on the break's board only if the game's mark on it COUNTS and will take it out of the
   * loop. That is `isCardGameEligible` (off cooldown, not flp-only) PLUS a bar line on
   * every bar, not just core: the card must sit below `BREAK_SEED_PBH_LIMIT` on the bar
   * the game's mark lands in. A loop card at or above the line stays in the loop for the
   * flp to finish. On core the extra test is the flp-only line itself; on reading/writing
   * it is a product rule (2026-11-03), since game marks there would still be recorded.
   */
  private isBreakSeedPlayable(card: VocabEntry, markType: MarkType, now: number): boolean {
    return (
      this.isCardGameEligible(card, markType, now) &&
      barProgressBarHeight(card.typedMarkHistory, worldForMarkType(markType), card.writingMastery)
        < OnDeckVocabService.BREAK_SEED_PBH_LIMIT
    );
  }

  /** The bar height a break seed must stay under — the Comfortable cut, = FLP_ONLY_CORE_PBH. */
  private static readonly BREAK_SEED_PBH_LIMIT = FLP_ONLY_CORE_PBH;

  /**
   * Split a break's seed rows into the tier dealt FIRST (`markable`) and a last-resort
   * `fallback`. Shared by `getGameVocabPool` and `getWordSearchGrid`.
   *
   *   - Unfocused break (the seed is the working loop): `markable` = `isBreakSeedPlayable`;
   *     `fallback` is EMPTY. A loop card the game cannot clear is never on the board
   *     (2026-11-03 — it used to fill a short board, recording nothing). Seeds are kept
   *     out of the candidate query too, so a dropped seed cannot ride in another way.
   *   - Focused break (the seed is today's remaining set, docs/FOCUS_MODE.md § 4a):
   *     unchanged — `isCardGameEligible` splits it, and the unmarkable remainder is tier 2b.
   */
  private partitionBreakSeeds(
    rows: VocabEntry[],
    markType: MarkType,
    now: number,
    focused: boolean
  ): { markable: VocabEntry[]; fallback: VocabEntry[] } {
    const markable: VocabEntry[] = [];
    const fallback: VocabEntry[] = [];
    for (const row of rows) {
      if (focused) (this.isCardGameEligible(row, markType, now) ? markable : fallback).push(row);
      else if (this.isBreakSeedPlayable(row, markType, now)) markable.push(row);
    }
    return { markable, fallback };
  }

  /**
   * The subset of `seedIds` an unfocused break may deal (`isBreakSeedPlayable`), in the
   * given order. For the writing games, whose own services deal characters rather than
   * cards and so filter the loop's WORDS here first (WritingGridController →
   * `parseWritingDealOptions`).
   */
  async filterBreakSeedIds(
    userId: string,
    language: string,
    seedIds: number[],
    markType: MarkType
  ): Promise<number[]> {
    if (seedIds.length === 0) return [];
    const now = Date.now();
    const rows = await this.fetchRowsByIds(userId, language, seedIds, markType, now, undefined, true);
    return rows.filter((row) => this.isBreakSeedPlayable(row, markType, now)).map((row) => row.id);
  }

  /**
   * Fetch per-category library candidates for a game, split into `eligible`
   * (the game's mark type is off cooldown = fresh) vs `cooled` (still cooling).
   * Each partition preserves the SQL RANDOM() order. Games fill their pool from
   * `eligible` first — requested categories, then fallback categories — and only
   * dip into `cooled` as a last resort to reach the required count, so the
   * cooldown (and the flp-only line) is honored without ever blocking entry more than an
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
    for (const category of categories) {
      const rows = await this.onDeckVocabDAL.findGameCandidatesInCategory(
        userId, language, category, markType, cap,
        { maxEntryKeyLen, excludeIds, lentIds, scope: collection }
      );

      const fresh: VocabEntry[] = [];
      const stale: VocabEntry[] = [];
      for (const row of rows) {
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
    userId: string,
    language: string,
    ids: number[],
    markType: MarkType,
    now: number,
    maxEntryKeyLen?: number,
    /**
     * Skip the freshness filter (cooldown + flp-only) — for a caller whose ids are NOT a
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

    const rows = await this.onDeckVocabDAL.findRowsByIds(userId, language, ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
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
    userId: string,
    language: string,
    ids: number[]
  ): Promise<Set<string>> {
    const keys = new Set<string>();
    if (ids.length === 0) return keys;

    const rows = await this.onDeckVocabDAL.findDdRowsByIds(userId, language, ids);
    for (const row of rows) {
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
    glossKeys: string[]
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const unique = Array.from(new Set(glossKeys.filter((key): key is string => Boolean(key))));
    if (unique.length === 0) return map;

    for (const row of await this.onDeckVocabDAL.findMeaningGroupIds(unique)) {
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
    return this.fetchRowsByIds(userId, language, lentIds, markType, now, maxEntryKeyLen);
  }

  /**
   * Attach `relatedWords` — up to 4 of the user's own sorted words sharing a character —
   * to every zh entry. Non-zh entries pass through untouched.
   *
   * ONE query for the whole batch (`findRelatedBySharedCharactersForWords`), so a deal
   * holds one pool client here rather than one per card (docs/DEFERRED_WORK.md, scaling
   * table item 2). Best-effort like the per-card form it replaced: if the read fails the
   * cards ship without related words rather than failing the deal.
   */
  private async enrichMultipleWithRelatedWords(userId: string, entries: VocabEntry[]): Promise<VocabEntry[]> {
    const zhWords = entries.filter(e => e.language === 'zh').map(e => e.entryKey);
    if (zhWords.length === 0) return entries;

    let byWord: Map<string, Array<{ id: number; entryKey: string; pronunciation: string | null; definition: string | null }>>;
    try {
      byWord = await this.vocabEntryDAL.findRelatedBySharedCharactersForWords(userId, zhWords, 'zh', 4);
    } catch (error) {
      console.error(`Failed to find related words for ${zhWords.length} cards:`, error);
      return entries;
    }
    return entries.map(entry => {
      if (entry.language !== 'zh') return entry;
      const relatedWords = byWord.get(entry.entryKey.trim());
      return relatedWords ? { ...entry, relatedWords } : entry;
    });
  }

  /**
   * For every single-character zh entry, attach up to 4 multi-char words containing the
   * character (user's vet first, then det fallback) as `usedIn`. On the WRITING bar also
   * attach `writingUsedIn` — up to 2: saved words (ungated) then frequency-4–5 dictionary
   * words — for the writing card's hint bubbles (docs/WRITING_PRACTICE_REWORK.md § 3).
   * Multi-char and non-zh entries pass through: they use the precomputed `breakdown` map
   * for the bt tab.
   *
   * One query per list for the whole batch (`findUsedInForCharacters` /
   * `findWritingUsedInForCharacters`), so a deal holds at most two pool clients here
   * rather than up to two per card (docs/DEFERRED_WORK.md, scaling table item 2).
   * Best-effort: a failed read ships the cards without the list.
   */
  private async enrichMultipleWithUsedIn(userId: string, entries: VocabEntry[], world: MasteryWorldId = 'core'): Promise<VocabEntry[]> {
    const isSingleZhChar = (e: VocabEntry) => e.language === 'zh' && [...e.entryKey].length === 1;
    const chars = entries.filter(isSingleZhChar).map(e => e.entryKey);
    if (chars.length === 0) return entries;

    let usedInByChar: Map<string, UsedInItem[]>;
    let writingByChar: Map<string, UsedInItem[]> | undefined;
    try {
      [usedInByChar, writingByChar] = await Promise.all([
        this.vocabEntryDAL.findUsedInForCharacters(userId, chars, 'zh', 4),
        world === 'writing'
          ? this.vocabEntryDAL.findWritingUsedInForCharacters(userId, chars, 'zh', 2)
          : Promise.resolve(undefined),
      ]);
    } catch (error) {
      console.error(`Failed to find usedIn for ${chars.length} cards:`, error);
      return entries;
    }
    return entries.map(entry => {
      if (!isSingleZhChar(entry)) return entry;
      const usedIn = usedInByChar.get(entry.entryKey) ?? [];
      const writingUsedIn = writingByChar?.get(entry.entryKey);
      return writingUsedIn ? { ...entry, usedIn, writingUsedIn } : { ...entry, usedIn };
    });
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

    const rows = await this.onDeckVocabDAL.findSortedCards(userId, language);
    return await this.enrichEntriesPipeline(rows, language);
  }

  /**
   * How many sorted cards are mastered in EACH bar (migration 143) — the Deck Tower's
   * Mastered deck per world and its cards page's Mastered key.
   *
   * One query with three FILTERed counts rather than three round trips, and rather
   * than a `world` parameter on getCategoryCounts: the page needs all three numbers at
   * once and the three predicates share a single scan of the same rows.
   *
   * Every bar is counted even when its goal is off. The caller decides which rows to
   * show; making the count itself goal-aware would mean re-fetching on a goal toggle
   * to populate a row whose answer we already had.
   */
  async getMasteredCountsByWorld(
    userId: string,
    language: string
  ): Promise<Record<MasteryWorldId, number>> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    return await this.onDeckVocabDAL.countMasteredByWorld(userId, language);
  }

  /**
   * How many sorted cards an flp session could actually serve RIGHT NOW, per utcm band
   * of the session's bar — the Deck Tower's Learning-deck figures (docs/DECK_TOWER.md).
   * (Until 2026-11-04 it also returned `reviewNextReadyMs`, the Review study mode's
   * countdown; that mode was removed — docs/DEFERRED_WORK.md § 31.)
   *
   * Deliberately the narrowest possible read — `id` + `typedMarkHistory` only, no
   * dictionary join, no enrichment pipeline (see `getBuiltinCollectionCards`, which
   * needs both for DISPLAY and is why the old decks page's card count used to be slow). Every
   * figure here is computed from `typedMarkHistory` alone, so nothing else is fetched.
   *
   * The counting/cooldown arithmetic itself is the SHARED contract
   * (`server/contracts/flpReadiness.ts`) — the exact functions the client used to run
   * against the full `allCards` fetch, and the same ones `rankFlpEligible` above
   * restates for actual queue ordering. One definition, so the tower figure can never
   * promise a card the flp would not deal.
   *
   * Referenced by docs/DECK_TOWER.md.
   */
  async getFlpReadyCounts(
    userId: string,
    language: string,
    /** Which bar's bands and clock the figures are read off. */
    world: FlpWorld = 'core',
    /**
     * Count only these vet ids — a focused world's remaining daily set
     * (docs/FOCUS_MODE.md § 4). Omitted = every sorted card.
     */
    onlyIds?: number[]
  ): Promise<{ counts: Record<string, number>; upcoming: FlpUpcomingRelease[] }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const readiness = await this.onDeckVocabDAL.findReadinessRows(userId, language, world, onlyIds);
    const rows = readiness.map((row) => ({
      typedMarkHistory: row.typedMarkHistory ?? undefined,
      writingMastery: row.writingMastery,
    }));
    const now = Date.now();
    // `upcoming`: the cooling cards' release schedule, from the same rows, so the Deck
    // Tower can grow card by card as each comes off cooldown (docs/DECK_TOWER.md §
    // "Cooldown releases") without polling this endpoint.
    return { counts: flpReadyCountsByBand(rows, now, world), upcoming: flpUpcomingReady(rows, now, world) };
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

    const rows = await this.onDeckVocabDAL.findBuiltinCollectionCards(userId, language, collection);
    return await this.enrichEntriesPipeline(rows, language);
  }

  /**
   * Every flp candidate row of one category — or of every band, for the working-loop
   * deal's pool (`loadFlpDealPool`) — DICT-joined, category-stamped, UN-enriched,
   * newest first. The single candidate source for BOTH flp paths — the initial working
   * loop and the mark-endpoint refill — so the two cannot drift.
   * `excludeIds` keeps already-chosen cards out.
   *
   * Deliberately UNLIMITED. Cooldown eligibility and the two-tier queue ranking
   * (rankFlpEligible) are computed in app code from `typedMarkHistory`, which SQL would have to
   * re-implement over jsonb to order by; a partial scan would rank a random subset and
   * silently return the wrong card. The refill path has always scanned a category in
   * full for the same reason. Enrichment stays deferred to only the chosen cards, so
   * the cost here is one read per call, not per candidate — and the deal makes one call
   * for its whole pool rather than one per band and tier.
   */
  private async fetchFlpCandidates(
    userId: string,
    /**
     * The band to read, on `world`'s bar. `null` reads EVERY band in one pass — the
     * working-loop deal's pool (`getDistributedWorkingLoop`), which bands the rows in app
     * code (`barCategory`) instead of re-running this query, and the per-row
     * `barCategoryExpr`, once per band.
     */
    category: string | null,
    language: string,
    excludeIds: number[],
    collection?: CollectionFilter | null,
    /** Vet ids lent to this loop — see fetchGameCandidates. */
    lentIds: number[] = [],
    /** The bar whose band `category` is read off — core except for the reading flp. */
    world: MasteryWorldId = OnDeckVocabService.FLP_WORLD
  ): Promise<VocabEntry[]> {
    return this.onDeckVocabDAL.findFlpCandidates(userId, language, {
      category, world, excludeIds, lentIds, scope: collection,
    });
  }

  /**
   * Get the next library card for a correct-mark refill, honoring the know
   * cooldown (docs/MASTERY_REWORK.md § 6).
   *
   * Priority: the preferred category, then the rest in STUDY_MIX_FILL_ORDER
   * (Target -> Comfortable -> Unfamiliar -> Mastered — the same order the initial
   * loop borrows in), and only then a LENT card. At each step we take the head of that
   * category's queue (rankFlpEligible: marked in the last 30 days, longest-waiting
   * first; then the rest, own before lent, easiest first). `excludeIds` keeps cards
   * already in the loop out.
   *
   * NEVER A COOLING CARD (2026-11-11). The flp used to re-serve the nearest-to-ready
   * cooling card when nothing was off cooldown (the 2026-08-20 "borrow, cool, lend"
   * ladder). Those cards played but earned nothing (their marks are dropped at
   * POST /api/flashcards/mark), and they made the Deck Tower count down cards it never
   * counted. Now nothing fresh ⇒ null, unless the session's lend switch is on
   * (canLendProvisional), when a lent card is served. A null winds the client's loop
   * down; an empty loop is what raises the flp's "out of ready cards" card.
   * Enriches only the chosen card.
   *
   * `collection` is the session's focus-mode scope (docs/FOCUS_MODE.md § 4), resolved
   * server-side by the caller — the mark endpoint is what refills the loop, so a
   * focused session that omitted it here would start serving cards outside the day's
   * set the moment the learner answered the first card correctly.
   *
   * (The `allowedCategories` band cap the Review / Challenge study modes passed was
   * removed with those modes on 2026-11-04 — docs/DEFERRED_WORK.md § 31.)
   */
  async getNextLibraryCardWithFallback(
    userId: string,
    preferredCategory: string,
    language: string,
    excludeIds: number[] = [],
    collection?: CollectionFilter | null,
    /** The session's flp bar (studyMode.ts) — core unless this is a reading/writing session. */
    world: MasteryWorldId = OnDeckVocabService.FLP_WORLD,
    /** The session's lend switch (canLendProvisional): may this refill be a lent card? */
    lend = false
  ): Promise<VocabEntry | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!preferredCategory) {
      throw new ValidationError('Preferred category is required');
    }

    // ONE BORROW ORDER (2026-10-28): the fallback walks STUDY_MIX_FILL_ORDER (TCUM) —
    // the same order getDistributedWorkingLoop tops a short loop up in, so a loop and
    // its refills borrow alike.
    const fallbackBase = [...STUDY_MIX_FILL_ORDER] as string[];
    const preferredFirst = [preferredCategory];
    // Everything the preferred category may fall back to, in priority order.
    const borrowOrder = fallbackBase.filter(cat => cat !== preferredCategory);

    const now = Date.now();
    let winner: VocabEntry | null = null;

    // Take the head of the first category queue that has an eligible card.
    const serveFrom = async (categories: string[]): Promise<VocabEntry | null> => {
      for (const category of categories) {
        const cards = await this.fetchFlpCandidates(userId, category, language, excludeIds, collection, [], world);
        if (cards.length === 0) continue;
        const ranked = this.rankFlpEligible(cards, now, world);
        if (ranked.length > 0) return ranked[0];
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
          userId, category, language, excludeIds, collection, lentIds, world
        );
        const ranked = this.rankFlpEligible(lent.filter((card) => lentIds.includes(card.id)), now, world);
        if (ranked.length > 0) return ranked[0];
      }
      return null;
    };

    // 1. The category the caller actually asked for.
    winner = await serveFrom(preferredFirst);

    // 2. Borrow a FRESH card from the remaining categories.
    if (!winner) winner = await serveFrom(borrowOrder);

    // 3. Nothing is off cooldown anywhere. Lend one, if this session's lend switch is
    //    on and its scope allows a lent card at all; otherwise there is no refill and
    //    the client's loop winds down. (A cooling card is never re-served — see the
    //    docblock.)
    if (!winner && this.canLendProvisional(lend, collection)) {
      winner = await serveLent();
    }

    if (!winner) return null;

    // Enrich only the chosen card (candidates were fetched un-enriched).
    const enriched = await this.enrichEntriesPipeline([winner], language);
    const withRelated = await this.enrichMultipleWithRelatedWords(userId, enriched);
    const withUsedIn = await this.enrichMultipleWithUsedIn(userId, withRelated, world);
    return withUsedIn[0];
  }

  /**
   * Replacements for the working-loop cards an flp game break cleared
   * (docs/FLP_GAME_BREAKS.md § 4a). The batch twin of the mark endpoint's per-swipe
   * refill: one `getNextLibraryCardWithFallback` per cleared card, so a break's clears
   * refill under the same focus / world / lending rules a correct swipe does.
   *
   * Differences from the swipe refill, both forced by when it runs (after the game):
   *   - The preferred band is each cleared card's band on `world` AS IT STANDS — the
   *     game's mark has already landed, so the pre-mark band (`categoryBeforeMark`) is
   *     not known here. A card the game promoted asks one band up.
   *   - `excludeIds` grows as winners are picked, so two clears never draw the same card.
   *
   * Returns at most one card per id in `replacedIds` (fewer when the pool is spent — the
   * client winds those slots down, as for a swipe refill that came back empty).
   */
  async refillWorkingLoop(
    userId: string,
    language: string,
    replacedIds: number[],
    excludeIds: number[],
    collection: CollectionFilter | null,
    world: MasteryWorldId,
    /** The session's lend switch, forwarded to each pick (canLendProvisional). */
    lend = false
  ): Promise<VocabEntry[]> {
    if (replacedIds.length === 0) return [];
    // `markType` is only used for freshness, which `ignoreCooldown` skips, and for the
    // `gameCategory` stamp, which is not read here.
    const replaced = await this.fetchRowsByIds(userId, language, replacedIds, 'recognition', Date.now(), undefined, true);

    const exclude = new Set([...excludeIds, ...replacedIds]);
    const winners: VocabEntry[] = [];
    // Sequential on purpose: each pick must see the previous picks in `exclude`.
    for (const card of replaced) {
      const preferred = barCategory(card.typedMarkHistory, world, card.writingMastery);
      const next = await this.getNextLibraryCardWithFallback(
        userId, preferred, language, [...exclude], collection, world, lend
      );
      if (!next) break; // the pool is spent; later picks would come back empty too
      exclude.add(next.id);
      winners.push(next);
    }
    return winners;
  }

  /**
   * The working-loop deal's candidate pool: every flp candidate row, read ONCE
   * (`fetchFlpCandidates` with no band), banded in app code on `world`'s bar and ranked
   * once per band. The deal's quota and top-up tiers then take cards from it in memory.
   *
   * Until 2026-11-08 each tier re-ran the candidate query for one band — five or more
   * full reads per deal, each evaluating `barCategoryExpr` on every one of the user's
   * rows. On a 400-card deck that was most of a ~0.8 s deal (dev), and the Deck Tower's
   * first dive waits on the deal (docs/DECK_TOWER.md § "Studying the tower").
   *
   * Equivalent to the per-band reads: the bands come from `barCategory`, the TS mirror of
   * `barCategoryExpr` (the same banding the tower's ready counts use,
   * `getFlpReadyCounts`); both rankers score each card on its own, so ranking a band once
   * and skipping the cards already picked yields the same order as re-querying with
   * `excludeIds`; and grouping keeps the query's ORDER BY as the rankers' stable tiebreak.
   *
   * Referenced by docs/MASTERY_REWORK.md (§ "Ordering", the candidate query) and
   * docs/DEFERRED_WORK.md (the scaling table's refill row).
   */
  private async loadFlpDealPool(
    userId: string,
    language: string,
    now: number,
    collection: CollectionFilter | null | undefined,
    lentIds: number[],
    world: MasteryWorldId
  ): Promise<FlpDealPool> {
    const rows = await this.fetchFlpCandidates(userId, null, language, [], collection, lentIds, world);
    const byBand = new Map<string, VocabEntry[]>();
    for (const card of rows) {
      const band = barCategory(card.typedMarkHistory, world, card.writingMastery);
      const list = byBand.get(band);
      if (list) list.push(card);
      else byBand.set(band, [card]);
    }
    // Ranked lazily, once per band: a deal often never reaches the top-up bands.
    const eligible = new Map<string, VocabEntry[]>();
    const take = (ranked: VocabEntry[], limit: number, picked: VocabEntry[]): VocabEntry[] => {
      if (limit <= 0) return [];
      const pickedIds = new Set(picked.map((c) => c.id));
      const out: VocabEntry[] = [];
      for (const card of ranked) {
        if (out.length >= limit) break;
        if (!pickedIds.has(card.id)) out.push(card);
      }
      return out;
    };
    return {
      eligible: (band, limit, picked) => {
        let ranked = eligible.get(band);
        if (!ranked) {
          ranked = this.rankFlpEligible(byBand.get(band) ?? [], now, world);
          eligible.set(band, ranked);
        }
        return take(ranked, limit, picked);
      },
    };
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
    userId: string,
    language: string,
    need: number,
    excludeIds: number[],
    now: number,
    collection?: CollectionFilter | null,
    world: MasteryWorldId = OnDeckVocabService.FLP_WORLD
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
    // back an ordinary sorted card instead of the lent row this call exists to place.
    // Goes through `fetchFlpCandidates` rather than the deal's pool (loadFlpDealPool):
    // the rows lent here may have just been minted, after the pool was read, and taking
    // a band's head before filtering would let a category holding plenty of ordinary
    // sorted cards fill the slice with those and drop the lent rows this call exists to
    // return. The candidate query is deliberately
    // unlimited (see its docblock), so filtering first costs nothing.
    const lent = new Set(lentIds);
    const rows: VocabEntry[] = [];
    for (const category of ['Unfamiliar', 'Target', 'Comfortable', 'Mastered']) {
      if (rows.length >= need) break;
      const candidates = await this.fetchFlpCandidates(
        userId, category, language, excludeIds, collection, lentIds, world
      );
      const ranked = this.rankFlpEligible(candidates.filter((card) => lent.has(card.id)), now, world);
      rows.push(...ranked.slice(0, need - rows.length));
    }
    return rows;
  }

  /**
   * Get distributed working loop with a category distribution.
   * Study Mix is the only loop shape: 1 Mastered, 2 Comfortable, 2 Unfamiliar,
   * 5 Target. (Removed 2026-11-04: the Review / Challenge study modes, and the legacy
   * single-category `?category=` path whose only sender was the deleted standalone
   * /flashcards/learn route.)
   *
   * KNOW COOLDOWN (docs/MASTERY_REWORK.md § 6): every fetch is eligibility-filtered —
   * a card is only offered once its know clock (shared by recognition and production)
   * has run out. Which face it then shows is decided client-side from the card's own
   * history (src/utils/flpFaceSteering.ts). Within each quota the
   * eligible cards are ranked AS A QUEUE (rankFlpEligible): cards marked in the last
   * 30 days come first, longest-waiting first, so a quota is filled by the cards most
   * overdue for review; the rest (no mark in 30 days, or never marked) follow, own
   * before lent, easiest first. Enriches cards with related words that share
   * characters.
   *
   * WHEN A QUOTA IS SHORT the loop BORROWS from the other categories' off-cooldown
   * cards, and then, only with the session's LEND SWITCH on (`lend`), LENDS. Without
   * the switch a short loop simply comes back short — or empty, which is what raises
   * the flp's "out of ready cards" card and its re-deal with `lend` on
   * (canLendProvisional; docs/DECK_TOWER.md § "Running out of ready cards").
   *
   * NO COOLED TIER (2026-11-11). Until then a short loop was padded with the learner's
   * own COOLING cards before lending (the 2026-08-20 "borrow, cool, lend" ladder). They
   * played but earned nothing, and the Deck Tower — which counts only off-cooldown
   * cards — counted them down anyway, then reconciled back up on the climb-out. The flp
   * now deals only off-cooldown cards, and lent ones once the learner agrees.
   *
   * `collection` is the server-resolved focus scope; it restricts the whole loop —
   * quotas and top-up alike, and a focused loop never lends. The mark endpoint
   * re-resolves the same scope for its refills.
   */
  async getDistributedWorkingLoop(
    userId: string,
    language: string,
    collection?: CollectionFilter | null,
    /** Vet ids the caller's baseline top-up lent this session. Selection is
        sorted-only, so without these the lent cards are invisible and the loop would
        lend a second time to find them (docs/PROVISIONAL_CARDS.md § 4b). */
    lentIds: number[] = [],
    /** The session's flp bar — `reading` / `writing` for those flps, else core. */
    world: FlpWorld = 'core',
    /** The session's lend switch (canLendProvisional): may the loop be topped up with lent cards? */
    lend = false
  ): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    // The reading flp is Chinese-only: a Latin-script card has nothing to read that its
    // meaning does not already give away, and no es card can accrue reading marks.
    if (world === 'reading' && language !== 'zh') {
      throw new ValidationError('Reading flashcards are only available for Chinese');
    }
    // So is the writing flp: the recognizer is zh_CN and the card draws hanzi.
    if (world === 'writing' && language !== 'zh') {
      throw new ValidationError('Writing flashcards are only available for Chinese');
    }

    const now = Date.now();
    // Study Mix: fetch each quota in order, then top up to WORKING_LOOP_SIZE in the
    // fill order. Mix may draw from all four bands.
    const config = DEFAULT_LOOP_CONFIG;
    const workingLoop: VocabEntry[] = [];

    // One read of every candidate, banded and ranked in memory (loadFlpDealPool).
    const pool = await this.loadFlpDealPool(userId, language, now, collection, lentIds, world);

    // Initial quotas (eligibility-filtered).
    for (const { category, count } of config.quotas) {
      workingLoop.push(...pool.eligible(category, count, workingLoop));
    }

    // The cross-category top-up runs below, as tier 1 of the shared fill ladder.
    const fillOrder = config.fillOrder;

    // FILL ORDER: BORROW → LEND (2026-11-11; the COOL tier between them is gone).
    //
    // A quota its own category could not fill is covered, in this order:
    //   1. FRESH cards borrowed from the other categories;
    //   2. LENT cards — only with the session's lend switch on, and never in a
    //      focused world (canLendProvisional).
    //
    // Without the switch a short loop stays short, and an empty one tells the client
    // the learner is out of ready cards (docs/DECK_TOWER.md § "Running out of ready
    // cards"). Lending sits strictly after every off-cooldown card of the learner's
    // own, so a card coming off cooldown mid-session is still dealt before a lent one.
    for (const category of fillOrder) {
      if (workingLoop.length >= WORKING_LOOP_SIZE) break;
      workingLoop.push(...pool.eligible(category, WORKING_LOOP_SIZE - workingLoop.length, workingLoop));
    }

    // 2. LEND — the learner is out of ready cards and has agreed to new words.
    if (workingLoop.length < WORKING_LOOP_SIZE && this.canLendProvisional(lend, collection)) {
      const lent = await this.lendIntoLoop(
        userId, language, WORKING_LOOP_SIZE - workingLoop.length,
        workingLoop.map(c => c.id), now, collection, world
      );
      workingLoop.push(...lent);
    }

    // Randomize play order. The ranking above chose WHICH cards are in the loop;
    // the order they're played in is deliberately not the ranking, so a session
    // doesn't march predictably from most- to least-recently-rested.
    shuffleInPlace(workingLoop);

    // Run the three-stage enrichment pipeline, then add related words + single-char usedIn
    const enriched = await this.enrichEntriesPipeline(workingLoop, language);
    const withRelated = await this.enrichMultipleWithRelatedWords(userId, enriched);
    const withUsedIn = await this.enrichMultipleWithUsedIn(userId, withRelated, world);

    // Pre-warm the TTS disk cache for every card before responding. The client
    // still fetches MP3s via /api/tts/synthesize after this returns, but those
    // calls are now guaranteed cache hits (~1ms each) so the speaker button
    // and auto-play feel instant. Per-entry failures degrade gracefully:
    // hasAudio=false signals the client to fall back to Web Speech for that
    // card. We don't fail the whole loop if Google has a hiccup on one entry.
    return await this.cardAudioService.prewarm(withUsedIn);
  }

  /**
   * Count library cards per category for the requested categories. Used by the
   * decks page (per-bucket counts), the Account page's deck buckets and the acp
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
    world: MasteryWorldId = 'core'
  ): Promise<Record<string, number>> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    // Which bar the four bands are read off. `core` for every historical caller —
    // deck sizes, the level estimate, the account page. The card library
    // (src/features/flashcards/useCardLibrary.ts) passes its lens's bar, so its band
    // figures count the skill being viewed.
    const rows = await this.onDeckVocabDAL.countByBand(userId, language, categories, world);
    const counts: Record<string, number> = {};
    for (const cat of categories) counts[cat] = 0;
    for (const row of rows) counts[row.category] = row.n;
    return counts;
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

    const contestedIds = opts.includeContested
      ? opts.contestedIds.filter((id) => !excluded.has(id))
      : [];
    const contested = await this.fetchRowsByIds(
      userId, language, contestedIds, gameMarkType, now, opts.maxEntryKeyLen,
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
      userId, language,
      fillerIds.filter((id) => !excluded.has(id) && !contestedIds.includes(id)),
      gameMarkType, now, opts.maxEntryKeyLen,
      // The ladder's top rungs are the player's MASTERED cards, which are the most
      // likely of all to be resting. Filtering them would empty the filler pool for
      // exactly the learners the ladder was written for.
      true
    );

    const cards = this.shuffleCards([...contested, ...filler]).slice(0, need);
    const enriched = await this.enrichEntriesPipeline(cards, language);
    const withAudio = await this.cardAudioService.prewarm(enriched);

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
   * type" + § 6 "Games honor the same clock"): `gameMarkType` is the mark type this
   * game emits (bubble-match = 'recognition'). It drives BOTH which category
   * bucket each candidate falls in (banded off that track's own 8-mark window) and
   * freshness (the clock of the bar it lands in, plus the flp-only line). The pool is filled FRESH-FIRST — cards whose game mark
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
   *     hasn't landed yet, so the real cooldown isn't visible to this
   *     query.
   */
  async getGameVocabPool(
    userId: string,
    language: string,
    distribution: Record<string, number>,
    gameMarkType: MarkType,
    // `collection` is the server-resolved focus scope (docs/FOCUS_MODE.md § 4 / § 4a):
    // today's set, or (an flp break) everything outside it.
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
      /** Vet ids the caller wants on the board FIRST — an flp game break's working
          loop (docs/FLP_GAME_BREAKS.md § 4). Only the seeds that pass
          `isBreakSeedPlayable` (the mark counts, and the card is under 6 on the game's
          bar) are dealt, before any bucket quota; the rest are never on the board
          (`partitionBreakSeeds`). Ignored on an `outside-focus` collection, which
          supplies its own (docs/FOCUS_MODE.md § 4a). */
      seedIds?: number[];
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

    // SEED (docs/FLP_GAME_BREAKS.md § 4). Loaded with `ignoreCooldown` so every seed
    // comes back, then split by `partitionBreakSeeds` — an unfocused break keeps only
    // the seeds whose mark counts and that sit under pbh 6 on the game's bar. Seeds that
    // are already excluded (on the caller's board) are dropped — exclude always wins.
    //
    // A FOCUSED BREAK SWAPS THE SEED (docs/FOCUS_MODE.md § 4a). The caller's seed is the
    // working loop, which is exactly the set the break is meant to get away from, so it
    // is replaced by the day's remaining cards and dealt AFTER the outside cards.
    const focusBreak = opts.collection?.kind === 'outside-focus' ? opts.collection : null;
    const excludeSet = new Set(excludeIds);
    const seedIds = (focusBreak ? focusBreak.remainingIds : opts.seedIds ?? [])
      .filter((id) => !excludeSet.has(id));
    const seedRows = await this.fetchRowsByIds(
      userId, language, seedIds, gameMarkType, now, undefined, true
    );
    const { markable: seedMarkable, fallback: seedFallback } =
      this.partitionBreakSeeds(seedRows, gameMarkType, now, focusBreak !== null);

    // Per-category candidates split fresh (game type off cooldown) vs cooled. The
    // seed ids are kept OUT of this query so a seed can only enter through its own
    // tier below — otherwise an ineligible seed would ride in on the cooled tier
    // ahead of its fallback position, or a markable one be counted twice.
    const { eligible, cooled } = await this.fetchGameCandidates(
      userId, language, countCategories, gameMarkType, now,
      OnDeckVocabService.GAME_CANDIDATE_CAP, undefined, [...excludeIds, ...seedIds], opts.collection,
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
    const takenDds = await this.fetchDdKeys(userId, language, excludeIds);

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
      ...seedRows.map(ddCollisionKey),
    ];
    const glossKeyToGroup = await this.fetchGroupIds(candidateDdKeys);
    const takenGroups = new Set<number>();
    for (const key of takenDds) {
      const groupId = glossKeyToGroup.get(key);
      if (groupId !== undefined) takenGroups.add(groupId);
    }

    // HARD everywhere except the two cases lending itself can't run — must mirror
    // `mayLend` exactly (declared again, unchanged, at tier 5 below) so the two can
    // never drift apart: a focus-scoped round, and a partial refill that
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

    // 0. SEED → markable seeds first (docs/FLP_GAME_BREAKS.md § 4), still through
    //    `drain` so the dd / meaning-group guard applies to them like any card. Each
    //    seed placed is charged to its bucket's quota, so the requested difficulty
    //    mix still shapes what the top-up adds rather than being overfilled on top.
    const quotaLeft: Record<string, number> = { ...scaled };
    const beforeSeed = cards.length;
    // A focused break holds its markable seeds back to tier 2a.
    if (!focusBreak) drain(seedMarkable, target);
    for (const card of cards.slice(beforeSeed)) {
      const bucket = card.gameCategory;
      if (bucket && quotaLeft[bucket] !== undefined) quotaLeft[bucket] = Math.max(0, quotaLeft[bucket] - 1);
    }

    // 1. Fill each requested bucket up to its (target-scaled, seed-charged) quota
    //    from FRESH cards, never overshooting the target.
    for (const [category, count] of Object.entries(quotaLeft)) {
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
    // THE FLAG IS THE ONLY WAY IN (2026-09-13). A length-1 inference used to sit
    // underneath as a "backstop" for single-bucket callers, and it turned out to have
    // a real, unintended caller: Match Speed's buffer top-up omits every bucket that
    // is already full (`topUpQuery`), so a learner with one Unfamiliar card routinely
    // sent `?Unfamiliar=5` alone. The backstop read that as strict, skipped tier 2 and
    // the fallback half of tiers 3–4, came back short, and fell straight through to
    // tier 5 — LENDING to an account with ~700 sorted cards it could have borrowed
    // from. The rule is: a non-strict request borrows across buckets before it lends,
    // however many buckets it happened to name.
    const requested = Object.keys(distribution);
    const substituting = !opts.strictBuckets;
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
    // 2a. FOCUSED BREAK ONLY: the outside cards ran out → the day's remaining focus
    //     cards. Ahead of the cooling tier on purpose: a focus card takes the game's
    //     marks, and a mark on a cooling outside card would be dropped.
    if (focusBreak && cards.length < target) drain(seedMarkable, target - cards.length);
    // 2b. FOCUSED BREAK ONLY (empty otherwise — `partitionBreakSeeds`): the remaining
    //     focus cards that cannot take the game's marks. Every fresh card has been
    //     tried, so nothing markable is being displaced. Not bucket-restricted: the
    //     seed is the caller's own set, not a band request.
    if (cards.length < target) drain(seedFallback, target - cards.length);
    // 3. Still short → COOLING cards (requested buckets first, then fallback), so a
    //    just-played library still assembles a full board.
    //
    //    For a single-bucket caller this is the tier that MATTERS, and it is
    //    deliberately allowed to break the cooldown: a genuinely Mastered
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
    //      * a FOCUS-scoped pool (docs/FOCUS_MODE.md § 4) — a focused round padded
    //        with words outside the day's set is not that set (same rule as
    //        canLendProvisional);
    //      * a PARTIAL REFILL (`opts.need`) — Bubble Match's Play Again is mid-session
    //        with a board in hand, and lending there would grow the player's deck on
    //        every tap. EXCEPT for a rolling-supply surface (`opts.lendOnRefill`),
    //        whose every spawn is a refill and which would otherwise never lend at
    //        all. See ROLLING_SUPPLY_SURFACES in contracts/wire.ts.
    //
    //    The focus exemption has NO opt-out: a scoped round plays its set, rolling
    //    supply or not (docs/HYDRA_BUBBLES.md § 6.3).
    //    (`mayLend` declared once, above — see the near-miss guard comment there.)
    if (cards.length < target && !opts.collection && mayLend) {
      const lent = await this.lendGameCandidates(
        userId, language, target - cards.length, gameMarkType, now,
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
    const withAudio = await this.cardAudioService.prewarm(enriched);
    // Tell the Stage which cards are not on the focused tower, so clearing one drops
    // nothing (docs/FLP_GAME_BREAKS.md § 6). Every card that is not a seed is outside.
    const seedSet = new Set(seedIds);
    const dealt = focusBreak
      ? withAudio.map((card) => (seedSet.has(card.id) ? card : { ...card, outsideFocus: true }))
      : withAudio;

    // `total` stays the full board size (what the client's "you need N Learn
    // Now cards" message quotes); `needed` is what THIS call had to return.
    return { cards: dealt, requested: { ...scaled }, available, total, needed: target, sufficient };
  }

  // ---- Word Search game ----------------------------------------------------

  // Cap on how many library candidates we pull per category up front. Word Search
  // needs a working set to run the substring de-dup / replacement loop against;
  // this bounds memory for users with very large libraries.
  private static readonly WORD_SEARCH_CANDIDATE_CAP = 500;

  /**
   * Build the Word Search game payload: a clean word set (no word's Chinese text is a
   * substring of another's) hidden as snaking paths in a grid of filler characters.
   * `board` picks the grid (WORD_SEARCH_BOARDS): 9 words on 7×6, or 7 on 6×5 for a Deck
   * Tower break.
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
   * type" + § 6 "Games honor the same clock"): `gameMarkType` is the mode's mark type —
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
    // `collection` is the server-resolved focus scope (docs/FOCUS_MODE.md § 4 / § 4a).
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
     * comes from the `mastered-first` ladder. It always plays the standard board,
     * the same one as an ordinary game: a challenge round's nine words need it.
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
    } | null,
    /** An flp game break's working loop, wanted on the grid first; same tiers as
        `getGameVocabPool`'s `seedIds` (docs/FLP_GAME_BREAKS.md § 4). Ignored on an
        `outside-focus` collection, which supplies its own (docs/FOCUS_MODE.md § 4a). */
    seedIds: number[] = [],
    /** The grid to deal on. The controller only ever pairs `compact` with a non-challenge
        round. */
    board: WordSearchBoardId = 'standard'
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
    /** A focused break's words that are not on the Deck Tower (docs/FLP_GAME_BREAKS.md § 6). */
    outsideFocusWords?: string[];
    templateIndex?: number | null;
  }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    // A challenge board and an ordinary one share the standard grid, so both are
    // eligible for TEMPLATE MODE. CHALLENGE_WORD_COUNT and the standard board's `words`
    // are separately-declared 9s, not one derived from the other.
    const { rows, cols, words: boardWords } = WORD_SEARCH_BOARDS[board];
    // The challenge's own set is the target list — never the requested
    // distribution. Even though both sum to 9, the challenge set is the
    // SPECIFIC contested word ids (§ 5.2), unrelated to a band distribution.
    const total = challenge
      ? challenge.contestedIds.length
      : Object.values(distribution).reduce((sum, n) => sum + n, 0);
    // More words than the board has slots cannot be promised a fit, and would burn every
    // placement attempt before failing as a 500.
    if (total > boardWords) {
      throw new ValidationError(`The ${board} board holds ${boardWords} words, not ${total}`);
    }

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

    const now = Date.now();
    // SEED (docs/FLP_GAME_BREAKS.md § 4), split by `partitionBreakSeeds` as in
    // `getGameVocabPool`. A focused break swaps the seed for the day's remaining
    // cards, dealt after the outside cards (docs/FOCUS_MODE.md § 4a). Words over 4
    // characters are dropped: the grid cannot place them.
    const focusBreak = collection?.kind === 'outside-focus' ? collection : null;
    const seedPool = challenge ? [] : focusBreak ? focusBreak.remainingIds : seedIds;
    const seedRows = await this.fetchRowsByIds(
      userId, language, seedPool, gameMarkType, now, 4, true
    );
    const { markable: seedMarkable, fallback: seedFallback } =
      this.partitionBreakSeeds(seedRows, gameMarkType, now, focusBreak !== null);

    // Per-category candidates split fresh (mode's mark type off cooldown) vs
    // cooled, capped to short (<= 4 char) words the grid can place. We pop from
    // these both for the initial selection and for substring replacements, so a
    // card is never reused across passes. Seeds stay out of this query so they can
    // only enter through their own tiers below.
    const { eligible, cooled } = await this.fetchGameCandidates(
      userId, language, countCategories, gameMarkType, now,
      OnDeckVocabService.WORD_SEARCH_CANDIDATE_CAP, 4, seedPool, collection, lentIds
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
    // `need`/`lendOnRefill` split — a focus-scoped grid is the only round
    // that never lends — so the guard is hard unless `collection` is set. Unlike
    // `takenDds`, `glossKeyToGroup` grows over the method's lifetime: challenge
    // filler and lent rows are fetched AFTER this initial batch (below), so
    // `loadGroupsFor` re-queries for any new key not already resolved.
    const glossKeyToGroup = new Map<string, number>();
    const loadGroupsFor = async (rows: VocabEntry[]): Promise<void> => {
      const keys = rows.map(ddCollisionKey).filter((key): key is string => Boolean(key));
      const missing = keys.filter((key) => !glossKeyToGroup.has(key));
      if (missing.length === 0) return;
      const found = await this.fetchGroupIds(missing);
      for (const [key, groupId] of found) glossKeyToGroup.set(key, groupId);
    };
    await loadGroupsFor([...Object.values(eligible).flat(), ...Object.values(cooled).flat(), ...seedRows]);
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

    // One card off one queue into `selected`, or null if the queue gave none.
    const takeOne = (queue: VocabEntry[]): VocabEntry | null => {
      const before = selected.length;
      drain(queue, 1);
      return selected.length > before ? selected[selected.length - 1] : null;
    };

    // Pull ONE replacement for a dropped word, in the order the board itself fills:
    // markable seeds (a focused break holds them until the fresh cards are spent),
    // FRESH cards (preferred category → fallback order), a focused break's unmarkable
    // seeds (none on an unfocused break — `partitionBreakSeeds`), then
    // COOLED cards (same order) only if nothing else is left. Returns the added
    // card, or null if the whole library is exhausted.
    const pullReplacement = (preferredCategory: string): VocabEntry | null => {
      const order = [preferredCategory, ...OnDeckVocabService.GAME_FALLBACK_ORDER];
      const fromBuckets = (source: Record<string, VocabEntry[]>): VocabEntry | null => {
        for (const category of order) {
          const card = takeOne(source[category] ?? []);
          if (card) return card;
        }
        return null;
      };
      return (focusBreak ? null : takeOne(seedMarkable))
        ?? fromBuckets(eligible)
        ?? (focusBreak ? takeOne(seedMarkable) : null)
        ?? takeOne(seedFallback)
        ?? fromBuckets(cooled);
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
        userId, language, challenge.contestedIds, gameMarkType, now, 4, true
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
        userId, language, fillerIds, gameMarkType, now, 4, true
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
    //    Markable seeds go first, each charged to its bucket's quota, so the mix still
    //    shapes what the top-up adds.
    if (!challenge) {
      if (!focusBreak) drain(seedMarkable, total);
      const quotaLeft: Record<string, number> = { ...distribution };
      for (const card of selected) {
        const bucket = card.gameCategory;
        if (bucket && quotaLeft[bucket] !== undefined) quotaLeft[bucket] = Math.max(0, quotaLeft[bucket] - 1);
      }
      for (const [category, count] of Object.entries(quotaLeft)) {
        drain(eligible[category] ?? [], Math.min(count, total - selected.length));
      }
    }

    for (const category of OnDeckVocabService.GAME_FALLBACK_ORDER) {
      if (selected.length >= total) break;
      drain(eligible[category] ?? [], total - selected.length);
    }
    // Seed tiers 2a + 2b of `getGameVocabPool` — both focused-break only: the remaining
    // set, then its unmarkable cards, ahead of any cooling card.
    if (focusBreak && selected.length < total) drain(seedMarkable, total - selected.length);
    if (selected.length < total) drain(seedFallback, total - selected.length);
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
    // replaced by another lent word. A focus-scoped grid never lends.
    //
    // NOTE the grid's extra constraint: `total` distinct-charactered words. Under-
    // lending here is safe because the controller's PROVISION_RETRY_FACTOR loop
    // re-enters with an escalated baseline when the de-dup pass still comes up short.
    if (selected.length < total && !collection && !challenge) {
      const lent = await this.lendGameCandidates(
        userId, language, total - selected.length, gameMarkType, now,
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

      // The bucket the victim was drawn from, on this game's track, so the replacement
      // keeps the board's mix. `category` is the core bar's band, a different question.
      const replacement = pullReplacement(victim.gameCategory ?? victim.category);
      if (!replacement) break; // library exhausted — can't reach a clean `total`
    }

    const clean = findSubstringVictim() === -1;
    if (!clean || selected.length < total) {
      return { ...emptyResult, sufficient: false, reason: 'insufficient-distinct' };
    }

    // Enrich + prewarm audio for the final set (found-word narration is instant).
    const enriched = await this.enrichEntriesPipeline(selected.slice(0, total), language);
    const withAudio = await this.cardAudioService.prewarm(enriched);

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
    const harvestFillerChars = (words: string[]): string[] => {
      const bag: string[] = [];
      for (const word of words) {
        bag.push(...[...word]);
      }
      return bag;
    };

    // Pull generously so the bag has variety even after the char split; each
    // word yields >= 1 character, so this comfortably covers `fillerNeeded`.
    let fillerChars = harvestFillerChars(
      await this.onDeckVocabDAL.findFillerWords(level, Math.max(fillerNeeded, 100))
    );

    // Fallback: if no level-tagged words exist (e.g. difficulty un-backfilled),
    // fall back to any single-character rows so the grid can still be built.
    if (fillerChars.length === 0) {
      fillerChars = harvestFillerChars(
        await this.onDeckVocabDAL.findSingleCharWords(Math.max(fillerNeeded, 50))
      );
    }
    if (fillerChars.length === 0) {
      // Nothing to draw from at all — can't build a grid.
      return { ...emptyResult, sufficient: false, reason: 'no-filler' };
    }

    // Resolve each unique harvested character's own canonical pinyin by
    // looking it up as a standalone headword (word1 = char), rather than
    // reusing the pronunciation it happened to carry inside its source word.
    const uniqueChars = [...new Set(fillerChars)];
    const charPinyinRows = await this.onDeckVocabDAL.findHeadwordPronunciations(uniqueChars);
    const charPinyinMap = new Map<string, string>();
    for (const row of charPinyinRows) {
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
      const drillRows = await this.onDeckVocabDAL.findDrillEntries(drillCandidates);

      // Rungs are resolved with the shared builder so the word-search chain and the
      // example-sentence chain can never drift apart. No English context exists here
      // (a grid is a word list, not prose), so rung glosses are the entry's lead sense.
      const drillEntries = drillRows as unknown as DictionaryEntry[];
      const drillDictMap = buildDictMap(drillEntries);
      const drillExcludeTokens = buildExcludeSet(drillEntries);
      for (const w of withAudio) {
        if (drillByWord.has(w.entryKey)) continue;
        const rungs = buildDrillRungs(w.entryKey, drillDictMap, { excludeTokens: drillExcludeTokens });
        if (rungs.length > 0) drillByWord.set(w.entryKey, rungs);
      }

      for (const row of drillRows) {
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
    // `definitionClusters` rides along so the pinyin can be the default sense's reading
    // (resolveDefaultPronunciation — the row shows the flat definitions->>0, not one
    // sense's gloss) rather than the raw, unreviewed column. The LIMIT is a safety net,
    // not a product requirement: it bounds the payload if the grid's character set
    // happens to match an unusually large number of headwords (e.g. it's dominated by
    // very common characters).
    const bonusRows = await this.onDeckVocabDAL.findWordsSpelledFrom(gridChars, 1000);
    const bonusWords = bonusRows
      .filter((r) => !!r.definition)
      .map((r) => ({ entryKey: r.word1, pinyin: resolveDefaultPronunciation(r) ?? '', definition: r.definition! }));

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
      // Same flat form, same reason. Every word that is not a seed is outside the set.
      ...(focusBreak && {
        outsideFocusWords: withAudio
          .filter((card) => !seedPool.includes(card.id))
          .map((card) => card.entryKey),
      }),
    };
  }
}

import type { VocabEntry, TypedMarkHistory, MarkType, DefinitionCluster } from '../../types/index.js';
import type { MasteryWorldId } from '../../contracts/wire.js';
import type { BuiltinCollectionId } from '../shared/vetTable.js';

/**
 * The scope a round must stay inside — the "collection" slot of `OnDeckVocabService`.
 *
 * Declared HERE (the DAL interface) rather than in the service because the DAL turns it
 * into a WHERE fragment (`OnDeckVocabDAL.focusScopeClause`), and a DAL must not import
 * from a service. `OnDeckVocabService` re-exports it, so existing importers are unchanged.
 *
 * Until 2026-11-04 this also carried a user-authored deck (`?deck=`) and a built-in
 * collection (`?collection=`); both launch paths were removed with the Decks feature and
 * the collection pages. The slot keeps its `collection` name throughout the service
 * because "a named set the round must stay inside" is still exactly what it means — and
 * every lend tier still checks it (`canLendProvisional`, the game pool's
 * `!opts.collection` gate).
 */
export type CollectionFilter =
  /**
   * FOCUS MODE (docs/FOCUS_MODE.md § 4): the cards still playable today in a focused
   * world — the daily snapshot minus those already marked correct. Never sent by the
   * client: OnDeckVocabController / flashcardRoutes substitute it for an UNRESTRICTED
   * launch when the round's world is focused. Riding this slot is what makes
   * a focused round behave like a named set everywhere at once: every candidate query
   * narrows to `ids`, and every lend tier is skipped (`canLendProvisional`, the game
   * pool's `!opts.collection` gate), so nothing outside the day's set can appear.
   */
  | { kind: 'focus'; ids: number[] }
  /**
   * FOCUS MODE, flp game break (docs/FOCUS_MODE.md § 4a): a break is a change of scene
   * from the day's set, so it draws from every card OUTSIDE today's snapshot and falls
   * back to the remaining set only when those run out. Also server-substituted, never
   * sent by the client.
   *
   *   setIds       — the whole snapshot, cards already marked correct today included:
   *                  those are gone from the set, not "outside" it.
   *   remainingIds — the fallback. `getGameVocabPool` deals them through its seed tiers,
   *                  after the fresh outside cards.
   *
   * Rides this slot for the same reason as `focus`: no lend tier can fire.
   */
  | { kind: 'outside-focus'; setIds: number[]; remainingIds: number[] };

/** The narrow row behind the Deck Tower's ready counts — see `findReadinessRows`. */
export interface FlpReadinessRow {
  id: number;
  typedMarkHistory: TypedMarkHistory | null;
  writingMastery: number | null;
}

/** A det headword's columns the Word Search grid needs for its tap-to-drill chain. */
export interface WordSearchDrillRow {
  word1: string;
  pronunciation: string | null;
  definitions: unknown;
  definitionClusters: unknown;
  components: unknown;
  matchException: unknown;
  frequencyScore: number | null;
  exampleSentenceDefinitionPronunciationOverride: unknown;
  breakdown: unknown;
}

/** A det headword spelled only from a grid's characters — Word Search bonus words. */
export interface WordSearchBonusRow {
  word1: string;
  pronunciation: string | null;
  definition: string | null;
  definitionClusters: DefinitionCluster[] | null;
}

/**
 * Data access for the study surfaces' card reads: the flp working loop and its refills,
 * the game pools, the Word Search grid, and the deck counts.
 *
 * LAYER: DAL. Every method is one query and returns rows as stored (plus the joined
 * dictionary columns). It holds NO selection policy: cooldown eligibility, queue
 * ranking, banding into tiers, lending and the dd-collision guards all stay in
 * `OnDeckVocabService`, which calls these. Each method takes its own pool client
 * (`DatabaseManager.executeQuery`) and releases it before returning, so no caller holds
 * a connection across enrichment or TTS pre-warm (docs/DEFERRED_WORK.md, scaling table
 * item 2).
 *
 * The "sorted only" rule (docs/PROVISIONAL_CARDS.md § 4b) is applied HERE, per query: a
 * lent card is reachable only through an explicit `lentIds` / id list, never as an
 * ordinary candidate.
 *
 * Referenced by: docs/BACKEND_LAYERING.md (the per-file table's OnDeckVocabService row),
 * docs/MASTERY_REWORK.md (§ "Ordering", the candidate query).
 */
export interface IOnDeckVocabDAL {
  // ── Vet reads: candidates ─────────────────────────────────────────────

  /**
   * Up to `cap` sorted (or lent) cards whose PER-MARK-TYPE category on `markType` is
   * `category`, own cards before lent, random within each. DICT-joined, with the core
   * category in `category`.
   */
  findGameCandidatesInCategory(
    userId: string,
    language: string,
    category: string,
    markType: MarkType,
    cap: number,
    opts: {
      maxEntryKeyLen?: number;
      excludeIds: number[];
      lentIds: number[];
      scope?: CollectionFilter | null;
    }
  ): Promise<VocabEntry[]>;

  /**
   * Every flp candidate in `category` on `world`'s bar (`null` = every band), sorted or
   * lent, newest first with own cards ahead of lent. Deliberately UNLIMITED — see
   * `OnDeckVocabService.fetchFlpCandidates`.
   */
  findFlpCandidates(
    userId: string,
    language: string,
    opts: {
      category: string | null;
      world: MasteryWorldId;
      excludeIds: number[];
      lentIds: number[];
      scope?: CollectionFilter | null;
    }
  ): Promise<VocabEntry[]>;

  /** The rows behind named vet ids, any bucket, in arbitrary order. DICT-joined. */
  findRowsByIds(userId: string, language: string, ids: number[]): Promise<VocabEntry[]>;

  /** The narrow rows (`id`, `selectedSense`, dictionary columns) a dd key is resolved from. */
  findDdRowsByIds(userId: string, language: string, ids: number[]): Promise<VocabEntry[]>;

  // ── Vet reads: decks and counts (all SORTED only) ─────────────────────

  /** The user's whole sorted deck, newest first. DICT-joined. */
  findSortedCards(userId: string, language: string): Promise<VocabEntry[]>;

  /** One built-in collection's sorted cards, newest first. DICT-joined. */
  findBuiltinCollectionCards(
    userId: string, language: string, collection: BuiltinCollectionId
  ): Promise<VocabEntry[]>;

  /** Mastered card counts on each of the three bars, in one scan. */
  countMasteredByWorld(userId: string, language: string): Promise<Record<MasteryWorldId, number>>;

  /** Sorted card counts per band of `world`'s bar, for the requested bands only. */
  countByBand(
    userId: string, language: string, categories: string[], world: MasteryWorldId
  ): Promise<Array<{ category: string; n: number }>>;

  /** `id` + mark history only, for the ready counts (writing flp: words it can deal). */
  findReadinessRows(
    userId: string, language: string, world: MasteryWorldId, onlyIds?: number[]
  ): Promise<FlpReadinessRow[]>;

  // ── Gloss meaning groups (docs/GLOSS_CONFUSABILITY.md § 6) ────────────

  /** `meaningGroupId` per clustered gloss key; unclustered keys are simply absent. */
  findMeaningGroupIds(glossKeys: string[]): Promise<Array<{ glossKey: string; meaningGroupId: number }>>;

  // ── Word Search det reads (zh only) ───────────────────────────────────

  /** Random headwords at difficulty 1..`maxDifficulty` — the grid's filler source. */
  findFillerWords(maxDifficulty: number, limit: number): Promise<string[]>;

  /** Random single-character headwords — the filler fallback when difficulty is unset. */
  findSingleCharWords(limit: number): Promise<string[]>;

  /** The `pronunciation` column of each standalone headword in `words`. */
  findHeadwordPronunciations(words: string[]): Promise<Array<{ word1: string; pronunciation: string | null }>>;

  /** The drill-chain columns of each headword in `words` (see WordSearchDrillRow). */
  findDrillEntries(words: string[]): Promise<WordSearchDrillRow[]>;

  /** Up to `limit` headwords spelled ENTIRELY from `chars`. */
  findWordsSpelledFrom(chars: string[], limit: number): Promise<WordSearchBonusRow[]>;
}

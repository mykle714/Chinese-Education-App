import { Request, Response } from 'express';
import { OnDeckVocabService, type StudyMode, type CollectionFilter } from '../services/OnDeckVocabService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';
import { MarkType, MARK_TYPES } from '../types/index.js';
import { ProvisionalCardService } from '../services/ProvisionalCardService.js';
import {
  CardBaselineSurface,
  CARD_BASELINES,
  PROVISION_RETRY_FACTOR,
  masteredCollectionBar,
} from '../contracts/wire.js';
import { parseBuiltinCollectionId } from '../dal/shared/vetTable.js';
import { DeckService } from '../services/DeckService.js';

/**
 * OnDeck Vocabulary Controller
 * Handles HTTP requests for active on-deck card operations.
 */
export class OnDeckVocabController {
  constructor(
    private onDeckVocabService: OnDeckVocabService,
    // Tops the user up to the surface's baseline before any set is assembled, so no
    // endpoint here can ever answer "not enough cards" (docs/PROVISIONAL_CARDS.md).
    private provisionalCardService: ProvisionalCardService,
    // Resolves + authorizes the optional `deck` query param that restricts a
    // game/flp round to one user-authored deck (docs/DECKS_FEATURE.md).
    private deckService: DeckService
  ) {}

  /**
   * Resolve the optional collection-launch query params (docs/DECKS_FEATURE.md).
   *
   *   ?deck=<id>                    → that user-authored deck
   *   ?collection=<built-in id>     → that built-in collection (all / unfamiliar /
   *                                   target / comfortable / learn-now / the three
   *                                   mastered bars)
   *   (none)                        → null, the ordinary whole-library launch
   *
   * THROWS NotFoundError when a deck id is not one this caller owns — so a stale
   * link to a deleted deck fails loudly instead of quietly playing the user's whole
   * library under a deck's name.
   *
   * The deck ownership check is not a security boundary: every downstream query is
   * already filtered by `ve."userId"`, so another user's deck id would simply select
   * nothing. It is a CORRECTNESS check — "selects nothing" then triggers the
   * provisional top-up, and the learner would be handed a round made entirely of
   * lent cards with no explanation.
   */
  private async resolveCollection(req: Request, userId: string): Promise<CollectionFilter | null> {
    const rawDeck = req.query.deck;
    if (rawDeck != null && String(rawDeck).trim() !== '') {
      // getDeck validates the id shape and throws NotFoundError when it isn't the
      // caller's; handleControllerError maps that to a 404.
      const deck = await this.deckService.getDeck(userId, rawDeck);
      return { kind: 'deck', deckId: deck.id };
    }
    // Anything other than a recognized value means an unrestricted launch — an
    // unknown collection name must never silently narrow the round.
    const builtin = parseBuiltinCollectionId(String(req.query.collection ?? ''));
    return builtin ? { kind: 'builtin', id: builtin } : null;
  }

  /**
   * Parse the `surface` query param naming which baseline applies to this request.
   *
   * Every game/flp caller sends it. An unrecognized or missing value means an older
   * client (or a hand-rolled request), and we must still not block: fall back to the
   * requested distribution's own total, which is what that caller was going to try to
   * fill anyway.
   */
  private static parseSurface(raw: unknown): CardBaselineSurface | null {
    const value = String(raw ?? '');
    return value in CARD_BASELINES ? (value as CardBaselineSurface) : null;
  }

  /**
   * Get all library cards (vocab entries from *-library OnDeck sets)
   * GET /api/onDeck/libraryCards
   */
  getLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const libraryCards = await this.onDeckVocabService.getLibraryCards(userId, language);
      res.json(libraryCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getLibraryCards');
    }
  };

  /**
   * The contents of ONE built-in collection — every non-deck collection page.
   * GET /api/onDeck/collectionCards?collection=all|unfamiliar|target|comfortable
   *                                            |learn-now|mastered|mastered-reading|mastered-writing
   *
   * This replaces the old `masteredLibraryCards?bar=` and `nonMasteredLibraryCards`
   * pair. Those two were the same query with two different WHERE fragments, and the
   * fdp's band tiles would have made it four; one parameterized endpoint keeps every
   * built-in collection reaching the client through one shape.
   *
   * An unrecognized collection falls back to **learn-now** rather than to "everything":
   * a typo'd or stale link must never quietly widen the set a learner is looking at.
   */
  getCollectionCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const collection = parseBuiltinCollectionId(String(req.query.collection ?? '')) ?? 'learn-now';
      const cards = await this.onDeckVocabService.getBuiltinCollectionCards(userId, language, collection);
      res.json(cards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getCollectionCards');
    }
  };

  /**
   * Get distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target by default).
   * GET /api/onDeck/distributedWorkingLoop?category=<optional>&mode=<review|challenge|optional>&deck=<optional>
   * The optional `mode` swaps in a difficulty-targeted distribution (see MODE_CONFIGS).
   * The optional `deck` / `collection` params restrict the loop to one collection
   * (docs/DECKS_FEATURE.md); the client must send the same restriction to the mark
   * endpoint, which refills the loop.
   */
  getDistributedWorkingLoop = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const categoryFilter = req.query.category as string | undefined;
      const rawMode = req.query.mode as string | undefined;
      const mode: StudyMode | undefined =
        rawMode === 'review' || rawMode === 'challenge' ? rawMode : undefined;
      const language = await getUserLanguage(userId);
      const collection = await this.resolveCollection(req, userId);

      // flp never blocks on deck size any more: top the user up to the flp baseline
      // first, so a learner with an empty deck still gets a full working loop. The
      // response shape is unchanged — the client spots the temporary cards by their
      // `starterPackBucket` and shows the generic notice (flp is not itemized,
      // because the loop refills as you go and the played set isn't known up front).
      await this.provisionalCardService.ensureBaselineForSurface(userId, language, 'flp');

      const workingLoop = await this.onDeckVocabService.getDistributedWorkingLoop(userId, language, categoryFilter, mode, collection);
      res.json(workingLoop);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getDistributedWorkingLoop');
    }
  };

  /**
   * Per-category library card counts of the CORE bar
   * (Unfamiliar / Target / Comfortable / Mastered).
   * GET /api/onDeck/categoryCounts
   */
  getCategoryCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const counts = await this.onDeckVocabService.getCategoryCounts(userId, language);
      res.json(counts);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getCategoryCounts');
    }
  };

  /**
   * How many cards are mastered in each of the three bars (migration 143).
   * GET /api/onDeck/masteredCounts → { core, reading, writing }
   *
   * Separate from categoryCounts rather than folded into it: that map is keyed by
   * BAND for one bar, this one is keyed by BAR for one band, and merging the two
   * shapes would give the fdp a response it has to disambiguate by key spelling.
   */
  getMasteredCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const counts = await this.onDeckVocabService.getMasteredCountsByBar(userId, language);
      res.json(counts);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getMasteredCounts');
    }
  };

  // Categories the game pool may request counts for (mirrors the SR buckets).
  private static readonly GAME_POOL_CATEGORIES = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'];

  /**
   * Build a game's card pool.
   * GET /api/onDeck/gamePool?markType=recognition&Unfamiliar=2&Target=10&Comfortable=6&Mastered=2
   *
   * `markType` selects which mastery track buckets and cools the candidates —
   * `recognition` (Bubble Match), `reading` (Speed Reading), `production`, or `writing`.
   * Every caller passes it explicitly; see the parameterization note below.
   * Defaults to 2 Unfamiliar + 10 Target + 6 Comfortable + 2 Mastered (20 total)
   * when no recognised category params are supplied. The service tops the pool
   * up to its total from fallback buckets when a quota can't be met, so this is
   * a best-effort fill. Returns { cards, requested, available, total, needed,
   * sufficient }.
   *
   * PARTIAL REFILL: `&need=N&exclude=12,34&avoid=56,78` returns only N cards,
   * never returns an `exclude`d id, and treats `avoid`ed ids as cooled (drawn
   * only if the library can't fill the board without them). Bubble Match's single
   * "Play Again" button uses this to swap out only the pairs the player matched:
   * the pairs still on the board are `exclude`d and every pair cleared this
   * session is `avoid`ed.
   */
  getGamePool = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const distribution: Record<string, number> = {};
      for (const cat of OnDeckVocabController.GAME_POOL_CATEGORIES) {
        const raw = req.query[cat];
        if (raw != null) {
          const n = parseInt(String(raw), 10);
          if (Number.isFinite(n) && n > 0) distribution[cat] = n;
        }
      }
      if (Object.keys(distribution).length === 0) {
        distribution.Unfamiliar = 2;
        distribution.Target = 10;
        distribution.Comfortable = 6;
        distribution.Mastered = 2;
      }

      // Partial-refill params, all optional and defensively parsed — anything
      // unparseable falls back to full-board behavior.
      //   exclude — csv of vocab-entry ids that can NEVER come back (still on the
      //             board), filtered in SQL
      //   avoid   — csv of ids to treat as cooled (just cleared this session), only
      //             drawn if the library can't fill the board otherwise
      //   need    — how many cards to return
      const parseIdCsv = (raw: unknown): number[] =>
        String(raw ?? '')
          .split(',')
          .map((part) => parseInt(part, 10))
          .filter((n) => Number.isInteger(n) && n > 0);
      const excludeIds = parseIdCsv(req.query.exclude);
      const avoidIds = parseIdCsv(req.query.avoid);
      const rawNeed = parseInt(String(req.query.need ?? ''), 10);
      const need = Number.isFinite(rawNeed) && rawNeed >= 0 ? rawNeed : undefined;

      // Which mastery track this caller's game exercises. A game's pool must be
      // bucketed by the mark type it actually EMITS (not the goal-blended overall
      // category) and must honor that type's cooldown — otherwise a card just
      // answered correctly comes straight back, while a card weak in the relevant
      // track is treated as strong because some other track is healthy.
      // See docs/MASTERY_REWORK.md § "Games select by their own mark type".
      //
      // This used to be hardcoded to 'recognition' back when Bubble Match was the
      // only caller. Speed Reading emits READING marks, so the endpoint is parameterized
      // and every caller passes `markType` explicitly — the default below is a
      // safety net for a malformed request, not a supported calling convention.
      const rawMarkType = String(req.query.markType ?? '');
      const markType: MarkType = MARK_TYPES.includes(rawMarkType as MarkType)
        ? (rawMarkType as MarkType)
        : 'recognition';

      const language = await getUserLanguage(userId);
      // Optional collection restriction. Resolved BEFORE the top-up so a bad deck
      // id 404s without first lending the user cards for a round that won't happen.
      const collection = await this.resolveCollection(req, userId);

      // Top up to the surface's baseline BEFORE assembling the pool, so the selection
      // below has enough rows to draw from and `sufficient` comes back true. A partial
      // refill (`need` set — Bubble Match's Play Again) skips this: the player is
      // mid-session with a board already in hand, and lending more cards there would
      // quietly grow their deck every time they tapped the button.
      if (need === undefined) {
        const surface = OnDeckVocabController.parseSurface(req.query.surface);
        const baseline = surface
          ? CARD_BASELINES[surface]
          : Object.values(distribution).reduce((sum, n) => sum + n, 0);
        await this.provisionalCardService.ensureBaseline(userId, language, baseline);
      }

      const pool = await this.onDeckVocabService.getGameVocabPool(
        userId, language, distribution, markType, { need, excludeIds, avoidIds, collection }
      );
      res.json(pool);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getGamePool');
    }
  };

  /**
   * Build the Word Search game grid.
   * GET /api/onDeck/wordSearchGrid?Unfamiliar=2&Target=10&Comfortable=6&Mastered=2
   * Same requested distribution + fallback semantics as the bubble-match pool,
   * plus a substring de-dup pass and snaking grid generation. Returns
   * { grid, words, rows, cols, total, available, sufficient, reason? }.
   */
  getWordSearchGrid = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const distribution: Record<string, number> = {};
      for (const cat of OnDeckVocabController.GAME_POOL_CATEGORIES) {
        const raw = req.query[cat];
        if (raw != null) {
          const n = parseInt(String(raw), 10);
          if (Number.isFinite(n) && n > 0) distribution[cat] = n;
        }
      }
      if (Object.keys(distribution).length === 0) {
        distribution.Unfamiliar = 2;
        distribution.Target = 10;
        distribution.Comfortable = 6;
        distribution.Mastered = 2;
      }

      const language = await getUserLanguage(userId);
      // Board mode decides the mark type this game emits (docs/MASTERY_REWORK.md
      // § "Games select by their own mark type"): No-Pinyin is a reading review,
      // Pinyin is a production review. That type buckets the pool by its own mark
      // history and gates its per-type cooldown. Default to production (Pinyin) if
      // the mode param is absent/unrecognized.
      const mode = String(req.query.mode ?? '');
      const gameMarkType: MarkType = mode === 'no-pinyin' ? 'reading' : 'production';
      const collection = await this.resolveCollection(req, userId);

      // Word Search is the one surface where meeting the baseline does NOT guarantee a
      // playable round: its ten words must have mutually DISTINCT characters, which a
      // row count cannot express, so a topped-up deck can still fail the de-dup pass.
      // Escalate the baseline and retry until the grid builds or we hit the cap.
      // `shortfall > 0` means the dictionary itself ran dry, so retrying is pointless.
      let result = await this.onDeckVocabService.getWordSearchGrid(
        userId, language, distribution, gameMarkType, collection
      );
      for (let multiplier = 1; multiplier <= PROVISION_RETRY_FACTOR && !result.sufficient; multiplier++) {
        // 'language' means the game is zh-only and this user isn't studying zh —
        // no amount of lending fixes that.
        if (result.reason === 'language') break;
        const top = await this.provisionalCardService.ensureBaselineForSurface(
          userId, language, 'word-search', multiplier
        );
        if (top.granted === 0) break; // nothing left to lend
        result = await this.onDeckVocabService.getWordSearchGrid(
          userId, language, distribution, gameMarkType, collection
        );
      }
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getWordSearchGrid');
    }
  };
}

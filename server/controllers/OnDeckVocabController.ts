import { Request, Response } from 'express';
import { OnDeckVocabService, type StudyMode } from '../services/OnDeckVocabService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';
import { MarkType, MARK_TYPES } from '../types/index.js';

/**
 * OnDeck Vocabulary Controller
 * Handles HTTP requests for active on-deck card operations.
 */
export class OnDeckVocabController {
  constructor(private onDeckVocabService: OnDeckVocabService) {}

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
   * Get mastered library cards (library cards with category = 'Mastered')
   * GET /api/onDeck/masteredLibraryCards
   */
  getMasteredLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const masteredCards = await this.onDeckVocabService.getMasteredLibraryCards(userId, language);
      res.json(masteredCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getMasteredLibraryCards');
    }
  };

  /**
   * Get non-mastered library cards (library cards without category = 'Mastered')
   * GET /api/onDeck/nonMasteredLibraryCards
   */
  getNonMasteredLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const nonMasteredCards = await this.onDeckVocabService.getNonMasteredLibraryCards(userId, language);
      res.json(nonMasteredCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getNonMasteredLibraryCards');
    }
  };

  /**
   * Get distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target by default).
   * GET /api/onDeck/distributedWorkingLoop?category=<optional>&mode=<easy|hard|optional>
   * The optional `mode` swaps in a difficulty-targeted distribution (see MODE_CONFIGS).
   */
  getDistributedWorkingLoop = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const categoryFilter = req.query.category as string | undefined;
      const rawMode = req.query.mode as string | undefined;
      const mode: StudyMode | undefined =
        rawMode === 'easy' || rawMode === 'hard' ? rawMode : undefined;
      const language = await getUserLanguage(userId);
      const workingLoop = await this.onDeckVocabService.getDistributedWorkingLoop(userId, language, categoryFilter, mode);
      res.json(workingLoop);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getDistributedWorkingLoop');
    }
  };

  /**
   * Get per-category library card counts (Unfamiliar / Target / Comfortable / Mastered).
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
      const pool = await this.onDeckVocabService.getGameVocabPool(
        userId, language, distribution, markType, { need, excludeIds, avoidIds }
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
      const result = await this.onDeckVocabService.getWordSearchGrid(
        userId, language, distribution, gameMarkType
      );
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getWordSearchGrid');
    }
  };
}

import { Request, Response } from 'express';
import { StarterPacksService } from '../services/StarterPacksService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

// Supported language codes — used for validation in multiple endpoints
const VALID_LANGUAGES = ['zh', 'es'] as const;

// Difficulty scale ceiling (StarterPacksService._levelConfig — one generalized 1..6
// scale for every language, migration 79). Used to validate the manual level-dropdown
// override on the sort-pack fetch endpoints.
const MAX_DIFFICULTY_LEVEL = 6;

/** Parse+validate a manual level override (1..MAX_DIFFICULTY_LEVEL); anything else → null ("auto"). */
function parseRequestedLevel(raw: unknown): number | null {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_DIFFICULTY_LEVEL ? n : null;
}

/**
 * Starter Packs Controller
 * Handles HTTP requests for starter pack operations
 */
export class StarterPacksController {
  constructor(private starterPacksService: StarterPacksService) {}

  /**
   * Get the initial sort-pack queue for a language (the client holds a short FIFO queue
   * of PACKS — the service default fills 2: on-deck + one buffer).
   * GET /api/starter-packs/:language?level=<1-6>
   * `level` is the manual HSK/difficulty dropdown override (omit, or any non-1..6
   * value, for "auto" — the adaptive estimate).
   * Response: { packs: SortPack[], exhausted: boolean, level: number }
   */
  getStarterPackCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const requestedLevel = parseRequestedLevel(req.query.level);
      const result = await this.starterPacksService.getNextPacks(language, userId, [], 2, requestedLevel);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.getStarterPackCards');
    }
  };

  /**
   * Refill one pack after the client's on-deck pack completes (the FIFO tail).
   * POST /api/starter-packs/next-pack
   * Body: { language: string, excludePackKeys?: string[], level?: number }
   * `level` is the manual HSK/difficulty dropdown override (omit for "auto").
   * Response: { nextPack: SortPack | null, exhausted: boolean, level: number }
   */
  nextPack = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language, excludePackKeys, level } = req.body;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }
      const held: string[] = Array.isArray(excludePackKeys)
        ? excludePackKeys.filter((k: any) => typeof k === 'string')
        : [];
      const requestedLevel = parseRequestedLevel(level);

      const { packs, exhausted, level: estimatedLevel } = await this.starterPacksService.getNextPacks(language, userId, held, 1, requestedLevel);
      res.json({ nextPack: packs[0] ?? null, exhausted, level: estimatedLevel });
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.nextPack');
    }
  };

  /**
   * Skip a whole pack: defers all remaining unsorted cards at once (each recorded
   * individually) and marks an authored pack seen.
   * POST /api/starter-packs/skip-pack
   * Body: { cardIds: number[], language: string, packId?: number | null }
   * Response: { success: true }
   */
  skipPack = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { cardIds, language, packId } = req.body;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }
      const validatedCardIds: number[] = Array.isArray(cardIds)
        ? cardIds.filter((id: any) => typeof id === 'number' && Number.isInteger(id))
        : [];

      await this.starterPacksService.skipPack(
        userId, validatedCardIds, language,
        typeof packId === 'number' ? packId : null
      );
      res.json({ success: true });
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.skipPack');
    }
  };

  /**
   * List the user's currently-skipped words for a language (Skipped page grid).
   * GET /api/starter-packs/:language/skipped
   * Response: DiscoverCard[]
   */
  getSkipped = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const cards = await this.starterPacksService.listSkipped(userId, language);
      res.json(cards);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.getSkipped');
    }
  };

  /**
   * Recycle ALL of the user's skips for a language back into the sort supply.
   * POST /api/starter-packs/:language/recycle-skips
   * Response: { recycled: number }
   */
  recycleSkips = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const recycled = await this.starterPacksService.recycleAllSkips(userId, language);
      res.json({ recycled });
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.recycleSkips');
    }
  };

  /**
   * Get user's progress on a starter pack
   * GET /api/starter-packs/:language/progress
   */
  getProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const progress = await this.starterPacksService.getProgress(language, userId);
      res.json(progress);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.getProgress');
    }
  };

  /**
   * Sort a card into a bucket. The response carries the single replacement card for
   * the client's FIFO tail (a sort always shrinks the queue by one), so there is no
   * separate "load more" call.
   * POST /api/starter-packs/sort
   * Body: { cardId: number, bucket: string, language: string, excludeIds?: number[] }
   * Response: { success, message, bucket, nextCard: DiscoverCard | null, exhausted }
   */
  sortCard = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { cardId, bucket, language, excludeIds, packId, lastInPack } = req.body;

      if (!cardId || !bucket || !language) {
        res.status(400).json({ error: 'Missing required fields: cardId, bucket, language' });
        return;
      }

      const validBuckets = ['already-learned', 'library', 'skip'];
      if (!validBuckets.includes(bucket)) {
        res.status(400).json({ error: 'Invalid bucket type' });
        return;
      }

      // excludeIds = the ids the client still holds in its queue, so the returned
      // replacement card is never a duplicate (legacy single-card flow). Validate to a
      // clean int array.
      const validatedExcludeIds: number[] = Array.isArray(excludeIds)
        ? excludeIds.filter((id: any) => typeof id === 'number' && Number.isInteger(id))
        : [];

      // Pack mode: the client sends `packId` (a number for authored packs, null for
      // fallback singles) — its PRESENCE switches the service off the legacy
      // replacement-card path. `lastInPack` marks the pack seen on its final sort.
      const opts = 'packId' in req.body
        ? { packId: typeof packId === 'number' ? packId : null, lastInPack: lastInPack === true }
        : {};

      const result = await this.starterPacksService.sortCard(userId, cardId, bucket, language, validatedExcludeIds, opts);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.sortCard');
    }
  };

  /**
   * Undo last card sort. The client passes the bucket it sorted into so the service
   * reverses the exact trace (skip → discover_skips row; otherwise → vet row).
   * POST /api/starter-packs/undo
   * Body: { cardId: number, bucket: string, language: string }
   */
  undoSort = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { cardId, bucket, language, packId } = req.body;

      if (!cardId || !bucket || !language) {
        res.status(400).json({ error: 'Missing required fields: cardId, bucket, language' });
        return;
      }

      // packId (authored pack) → the service un-sees the pack so it can be re-served.
      const result = await this.starterPacksService.undoSort(
        userId, cardId, bucket, language,
        typeof packId === 'number' ? packId : null
      );
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.undoSort');
    }
  };
}

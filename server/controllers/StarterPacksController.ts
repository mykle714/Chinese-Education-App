import { Request, Response } from 'express';
import { StarterPacksService } from '../services/StarterPacksService.js';
import { ProvisionalCardService } from '../services/ProvisionalCardService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

// Supported language codes — used for validation in multiple endpoints
const VALID_LANGUAGES = ['zh', 'es'] as const;

// Difficulty scale ceiling (StarterPacksService._levelConfig — one generalized 1..6
// scale for every language, migration 79). Used to validate the manual level-dropdown
// override on the sort-pack fetch endpoints.
const MAX_DIFFICULTY_LEVEL = 6;

/** Parse+validate a level (1..MAX_DIFFICULTY_LEVEL) — the auto target OR the manual pin; anything else → null. */
function parseRequestedLevel(raw: unknown): number | null {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_DIFFICULTY_LEVEL ? n : null;
}

/** `mode === 'manual'` → the level dropdown pin (no drift); anything else → auto (drifts). */
function parseManual(raw: unknown): boolean {
  return raw === 'manual';
}

/**
 * Starter Packs Controller
 * Handles HTTP requests for starter pack operations
 */
export class StarterPacksController {
  constructor(
    private starterPacksService: StarterPacksService,
    // Supplies the "sort the temporary cards you just played" set
    // (docs/PROVISIONAL_CARDS.md § Sorting what you played).
    private provisionalCardService: ProvisionalCardService
  ) {}

  /**
   * The sort flow, handed an EXPLICIT set of cards instead of the open-ended
   * level-based supply: the temporary (provisional) cards the user still holds.
   * GET /api/starterPacks/:language/provisionalSet?words=a,b,c
   *
   * `words` narrows the set to the cards one round actually used; omit it for every
   * outstanding temporary card. The service intersects whatever is asked for with
   * what the user genuinely holds, so the param cannot widen the set.
   *
   * Response: { cards: DiscoverCard[] } — an empty array means there is nothing left
   * to sort (every temporary card was already promoted), and the client closes the flow.
   */
  getProvisionalSet = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      // Optional csv of words. Trimmed and emptied-out, so `?words=` behaves as "all".
      const rawWords = String(req.query.words ?? '');
      const words = rawWords
        .split(',')
        .map((word) => word.trim())
        .filter((word) => word.length > 0);

      const cards = await this.provisionalCardService.getSortSet(
        userId, language, words.length > 0 ? words : undefined
      );
      res.json({ cards });
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.getProvisionalSet');
    }
  };

  /**
   * Get the initial sort-pack queue for a language (the client holds a short FIFO queue
   * of PACKS — the service default fills 2: on-deck + one buffer).
   * GET /api/starterPacks/:language?level=<1-6>&mode=auto|manual
   * `level` is the level to center supply on: the client's own adaptive target (auto,
   * docs §6 rewritten) or its dropdown pin (manual). Omit `level` on a brand-new
   * session's first call so the server seeds a cold-start estimate. `mode=manual`
   * pins to exactly `level` (no drift); anything else drifts to adjacent levels when
   * `level`'s supply runs out.
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
      const manual = parseManual(req.query.mode);
      const result = await this.starterPacksService.getNextPacks(language, userId, [], 2, requestedLevel, manual);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.getStarterPackCards');
    }
  };

  /**
   * Refill one pack after the client's on-deck pack completes (the FIFO tail).
   * POST /api/starterPacks/nextPack
   * Body: { language: string, excludePackKeys?: string[], level?: number, mode?: 'auto' | 'manual' }
   * `level`/`mode` mean the same as on GET /api/starterPacks/:language — the client
   * always has a level to send by the time it calls this (either its adaptive target,
   * already updated from the completing pack's signal, or its dropdown pin).
   * Response: { nextPack: SortPack | null, exhausted: boolean, level: number }
   */
  nextPack = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language, excludePackKeys, level, mode } = req.body;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }
      const held: string[] = Array.isArray(excludePackKeys)
        ? excludePackKeys.filter((k: any) => typeof k === 'string')
        : [];
      const requestedLevel = parseRequestedLevel(level);
      const manual = parseManual(mode);

      const { packs, exhausted, level: centerLevel } = await this.starterPacksService.getNextPacks(language, userId, held, 1, requestedLevel, manual);
      res.json({ nextPack: packs[0] ?? null, exhausted, level: centerLevel });
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.nextPack');
    }
  };

  /**
   * Skip a whole pack: defers all remaining unsorted cards at once (each recorded
   * individually) and marks an authored pack seen.
   * POST /api/starterPacks/skipPack
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
   * GET /api/starterPacks/:language/skipped
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
   * POST /api/starterPacks/:language/recycleSkips
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
   * Quick Mark bulk-triage supply (docs/QUICK_MARK.md §5): one keyset-paginated page of
   * not-yet-sorted discoverable words at an exact level, ordered by vernacular score.
   * GET /api/starterPacks/:language/quickMark?level=<1-6>&cursorScore=<n|empty>&cursorId=<n>
   * `level` omitted → the service seeds from the user's adaptive frontier estimate.
   * `cursorId` present → resume after that card (cursorScore empty = the NULL-score tail).
   * Response: { cards: DiscoverCard[], level: number, hasMore: boolean }
   */
  getQuickMarkCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      // Absent/invalid level → null, so the service seeds the user's current level.
      const level = parseRequestedLevel(req.query.level);

      // Keyset cursor: cursorId anchors the page; cursorScore may be a number OR empty
      // (the trailing NULL-frequencyScore block). No cursorId → first page (null cursor).
      const cursorIdRaw = typeof req.query.cursorId === 'string' ? parseInt(req.query.cursorId, 10) : NaN;
      let cursor: { score: number | null; id: number } | null = null;
      if (Number.isInteger(cursorIdRaw)) {
        const scoreRaw = typeof req.query.cursorScore === 'string' ? parseInt(req.query.cursorScore, 10) : NaN;
        cursor = { score: Number.isInteger(scoreRaw) ? scoreRaw : null, id: cursorIdRaw };
      }

      const result = await this.starterPacksService.listQuickMarkCards(language, userId, level, cursor);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.getQuickMarkCards');
    }
  };

  /**
   * Quick Mark batch save (docs/QUICK_MARK.md §6): reconcile every marked card's vet
   * state to its on-screen mark in one request.
   * POST /api/starterPacks/quickMarkBatch
   * Body: { language: string, marks: { cardId: number, state: 'empty'|'library'|'already-learned' }[] }
   * Response: { success: true, applied: number }
   */
  quickMarkBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language, marks } = req.body;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const VALID_STATES = ['empty', 'library', 'already-learned'];
      const validatedMarks = Array.isArray(marks)
        ? marks.filter((m: any) =>
            m && typeof m.cardId === 'number' && Number.isInteger(m.cardId) && VALID_STATES.includes(m.state))
        : [];

      const result = await this.starterPacksService.quickMarkBatch(userId, language, validatedMarks);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.quickMarkBatch');
    }
  };

  /**
   * Get user's progress on a starter pack
   * GET /api/starterPacks/:language/progress
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
   * POST /api/starterPacks/sort
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
   * POST /api/starterPacks/undo
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

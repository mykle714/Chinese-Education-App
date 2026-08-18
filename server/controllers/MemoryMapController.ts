import { Request, Response } from 'express';
import { MemoryMapService } from '../services/MemoryMapService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';

/**
 * Memory Map HTTP layer — /api/memoryMap/*
 *
 * LAYER: controller. Parses and validates request SHAPE, delegates every decision to
 * MemoryMapService, and does no SQL. See docs/MEMORY_MAP_GAME.md § 9.
 *
 * WHY NOT GamesController: that controller is deliberately game-AGNOSTIC (one
 * controller, every game, scoped by `:gameId`) and serves only the framework-level
 * assets/progress endpoints. Memory Map owns tables of its own, so folding it in would
 * break that invariant — the same reasoning that gave Speed Reading its own controller.
 *
 * The language is resolved from the ACCOUNT, never from the request. A map is per
 * (user, language) and each language has its own independent map; letting the client
 * name the language would let it read and mutate the other one.
 */
export class MemoryMapController {
  constructor(private memoryMapService: MemoryMapService) {}

  /**
   * The learner's map, topped up to capacity.
   * GET /api/memoryMap
   *   → { words: [...], newlyPlaced: [ids], capacity: 100 }
   *
   * Called once on game entry. Spawning happens here rather than on a separate
   * "please spawn" call because the two are one thought — the map you are shown IS the
   * map after top-up, and a client that could load without spawning would render a
   * stale map and never notice.
   */
  getMap = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      res.json(await this.memoryMapService.loadMap(userId, language));
    } catch (error: any) {
      handleControllerError(error, res, 'MemoryMapController.getMap');
    }
  };

  /**
   * Retire a word that just became reading-mastered, and refill its slot.
   * POST /api/memoryMap/graduate  { vocabEntryId }
   *   → { graduated: boolean, replacement: word | null }
   *
   * `graduated: false` is the COMMON answer, not an error: the client calls this after
   * every correct answer because it cannot know which mark crosses the threshold. The
   * service re-reads mastery from the database rather than trusting the claim.
   */
  graduate = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const vocabEntryId = Number(req.body?.vocabEntryId);
      if (!Number.isInteger(vocabEntryId)) {
        res.status(400).json({ error: 'vocabEntryId must be an integer' });
        return;
      }

      const language = await getUserLanguage(userId);
      res.json(await this.memoryMapService.graduate(userId, language, vocabEntryId));
    } catch (error: any) {
      handleControllerError(error, res, 'MemoryMapController.graduate');
    }
  };
}

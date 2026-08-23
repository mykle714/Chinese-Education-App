import { Request, Response } from 'express';
import { ArenaService } from '../services/ArenaService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * Arena HTTP layer (docs/ARENA_FEATURE.md § 10).
 *
 *   GET    /api/arena              → ArenaBoardResponse
 *   POST   /api/arena/optIn        → { weekKey }
 *   DELETE /api/arena/optIn        → 204
 *   POST   /api/arena/admin/tick   → { formed, resolved, stranded }  (dev/admin only)
 *
 * LAYER: controller. Extracts the caller and their language/timezone, hands off
 * to ArenaService, maps thrown errors via handleControllerError. No policy here
 * — "you may only join during the break" and every cutoff live in the service.
 */
export class ArenaController {
  constructor(private arenaService: ArenaService) {}

  /**
   * The caller's language and timezone.
   *
   * Both come from the request rather than storage: the client drove the
   * language switch and owns the clock, exactly as the minute-points endpoints
   * do. `tz` is only used to decide whether times are labelled with the arena's
   * zone — it can never move a member between arenas.
   */
  private contextOf(req: Request): { language: string; tz: string } {
    return {
      language: (req.query.language as string) || 'zh',
      tz: (req.query.tz as string) || 'UTC',
    };
  }

  /** GET /api/arena */
  async getBoard(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { language, tz } = this.contextOf(req);
      res.json(await this.arenaService.getBoard(userId, language, tz));
    } catch (error) {
      handleControllerError(error, res, 'ArenaController.getBoard');
    }
  }

  /** POST /api/arena/optIn */
  async optIn(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const language = req.body?.language || (req.query.language as string) || 'zh';
      const tz = req.body?.tz || (req.query.tz as string) || 'UTC';
      const weekKey = await this.arenaService.optIn(userId, language, tz);
      res.json({ weekKey });
    } catch (error) {
      handleControllerError(error, res, 'ArenaController.optIn');
    }
  }

  /** DELETE /api/arena/optIn */
  async withdraw(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      // No tz: withdrawal is gated on holding a live seat, not on the clock.
      const { language } = this.contextOf(req);
      await this.arenaService.withdraw(userId, language);
      res.status(204).send();
    } catch (error) {
      handleControllerError(error, res, 'ArenaController.withdraw');
    }
  }

  /**
   * POST /api/arena/location — store or clear the caller's coarse location.
   *
   * The body carries a 5-character geohash cell the CLIENT computed; the raw
   * coordinates never reach this server. `{ geoCell: null }` clears it, which is
   * the in-app off switch a remembered permission has to have.
   */
  async setLocation(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await this.arenaService.setLocation(userId, req.body?.geoCell ?? null);
      res.status(204).send();
    } catch (error) {
      handleControllerError(error, res, 'ArenaController.setLocation');
    }
  }

  /**
   * POST /api/arena/message — set or clear the caller's arena message.
   *
   * `{ message: null }` clears it, which is the in-app off switch any piece of
   * user-authored text has to have. The stored value is echoed back so the client
   * renders exactly what the server kept rather than what the user typed — the
   * service trims, collapses whitespace and strips control characters, so the two
   * are not always the same string.
   */
  async setMessage(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const stored = await this.arenaService.setMessage(userId, req.body?.message ?? null);
      res.json({ message: stored });
    } catch (error) {
      handleControllerError(error, res, 'ArenaController.setMessage');
    }
  }

  /**
   * POST /api/arena/admin/tick — run formation and resolution by hand.
   *
   * The real driver is an hourly cron that exists only on prod (§ 10), so
   * without this endpoint the entire feature is untestable locally: arenas would
   * never form on a dev machine and the board would be permanently empty.
   *
   * Gated to validators, who are the closest thing to an admin role this app
   * has. It is idempotent — formation checks arenaExistsForBucket and resolution
   * guards on `resolvedAt IS NULL` — so a double tap is harmless.
   *
   * A non-zero `stranded` in the response means opted-in members whose week has
   * already opened are in no arena — always a bug (ArenaService.countStranded).
   * It is reported rather than thrown: the tick itself succeeded, and the count
   * is a diagnostic about the state it found.
   */
  async adminTick(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      if (!(req as any).user?.isValidator) {
        res.status(403).json({ error: 'Not permitted' });
        return;
      }
      // tick() resolves before forming; the order is load-bearing (see the
      // service). Do not inline the two calls here in the other order.
      res.json(await this.arenaService.tick());
    } catch (error) {
      handleControllerError(error, res, 'ArenaController.adminTick');
    }
  }
}

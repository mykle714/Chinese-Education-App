import { Request, Response } from 'express';
import { SentenceTilesService } from '../services/SentenceTilesService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { resolveTimezone, streakDateOf } from '../utils/streakDate.js';
import type {
  SentenceTilesCreateBody,
  SentenceTilesExchangeBody,
  SentenceTilesListResponse,
  SentenceTilesPlayBody,
} from '../contracts/sentenceTiles.js';

/**
 * Sentence Tiles HTTP layer (docs/SENTENCE_TILES_GAME.md § "Endpoints").
 *
 *   GET  /api/sentenceTiles/games                       → SentenceTilesListResponse
 *   POST /api/sentenceTiles/games {opponentId}          → SentenceTilesGameView (a draft; you move first)
 *   GET  /api/sentenceTiles/games/:id[?since=N]         → SentenceTilesGameView, or 204 when still at version N
 *   POST /api/sentenceTiles/games/:id/play              → SentenceTilesMoveResponse
 *   POST /api/sentenceTiles/games/:id/exchange          → SentenceTilesMoveResponse
 *   POST /api/sentenceTiles/games/:id/pass              → SentenceTilesMoveResponse
 *   POST /api/sentenceTiles/games/:id/resign            → SentenceTilesMoveResponse
 *   POST /api/sentenceTiles/games/:id/decline           → SentenceTilesMoveResponse (opponent, unaccepted)
 *   POST /api/sentenceTiles/games/:id/cancel            → SentenceTilesMoveResponse (challenger, unaccepted)
 *
 * Every request may carry `tz` (query on GET, body on POST): the caller's IANA zone, which
 * decides the local day the judge budget counts against — the dictionary AI cap's convention.
 *
 * LAYER: controller. Extracts the caller + inputs, hands off to SentenceTilesService, maps DAL
 * errors via handleControllerError. No policy here.
 */
export class SentenceTilesController {
  constructor(private service: SentenceTilesService) {}

  /** The local streak-day for the caller's timezone (falls back to the server default). */
  private usageDate(tz: unknown): string {
    return streakDateOf(new Date(), resolveTimezone(typeof tz === 'string' ? tz : undefined));
  }

  async listGames(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const body: SentenceTilesListResponse = { games: await this.service.listGames(userId) };
      res.json(body);
    } catch (error) {
      handleControllerError(error, res, 'SentenceTilesController.listGames');
    }
  }

  async createGame(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const body = (req.body ?? {}) as SentenceTilesCreateBody & { tz?: string };
      res.status(201).json(await this.service.createGame(userId, body.opponentId, this.usageDate(body.tz)));
    } catch (error) {
      handleControllerError(error, res, 'SentenceTilesController.createGame');
    }
  }

  /** The heartbeat poll and the initial load share this: `?since=` turns it into a 204 check. */
  async getGame(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const sinceRaw = req.query.since;
      const since = typeof sinceRaw === 'string' && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : undefined;
      const view = await this.service.getGame(userId, req.params.id, this.usageDate(req.query.tz), since);
      if (!view) {
        res.status(204).end();
        return;
      }
      res.json(view);
    } catch (error) {
      handleControllerError(error, res, 'SentenceTilesController.getGame');
    }
  }

  async play(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const body = (req.body ?? {}) as SentenceTilesPlayBody;
      res.json(
        await this.service.playTiles(userId, req.params.id, body.placements, body.direction, this.usageDate(body.tz))
      );
    } catch (error) {
      handleControllerError(error, res, 'SentenceTilesController.play');
    }
  }

  async exchange(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const body = (req.body ?? {}) as SentenceTilesExchangeBody & { tz?: string };
      res.json(await this.service.exchange(userId, req.params.id, body.tileIds, this.usageDate(body.tz)));
    } catch (error) {
      handleControllerError(error, res, 'SentenceTilesController.exchange');
    }
  }

  async pass(req: Request, res: Response): Promise<void> {
    await this.simpleMove(req, res, 'pass');
  }

  async resign(req: Request, res: Response): Promise<void> {
    await this.simpleMove(req, res, 'resign');
  }

  async decline(req: Request, res: Response): Promise<void> {
    await this.simpleMove(req, res, 'decline');
  }

  async cancel(req: Request, res: Response): Promise<void> {
    await this.simpleMove(req, res, 'cancel');
  }

  /** The four body-less moves share one shape. */
  private async simpleMove(req: Request, res: Response, move: 'pass' | 'resign' | 'decline' | 'cancel'): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const usageDate = this.usageDate(req.body?.tz);
      res.json(await this.service[move](userId, req.params.id, usageDate));
    } catch (error) {
      handleControllerError(error, res, `SentenceTilesController.${move}`);
    }
  }
}

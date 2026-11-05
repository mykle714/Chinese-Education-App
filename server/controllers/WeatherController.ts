import { Request, Response } from 'express';
import { WeatherService } from '../services/WeatherService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * Weather HTTP layer (docs/DECK_TOWER.md § "Weather").
 *
 *   GET /api/weather → WeatherResponse (server/contracts/wire.ts)
 *
 * LAYER: controller. Extracts the caller and hands off to WeatherService; the
 * service decides everything else (which cell, caching, the WMO fold).
 */
export class WeatherController {
  constructor(private weatherService: WeatherService) {}

  /** GET /api/weather */
  async getWeather(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json(await this.weatherService.weatherFor(userId));
    } catch (error) {
      handleControllerError(error, res, 'WeatherController.getWeather');
    }
  }
}

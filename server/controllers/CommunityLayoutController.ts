import { Request, Response } from 'express';
import { CommunityLayoutService } from '../services/CommunityLayoutService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';
import { Language } from '../types/index.js';

// A page never returns more than this many designs (guards against a client asking for a huge
// page). The UI requests 10 (the "set of 10" in the spec).
const MAX_PAGE = 30;
const DEFAULT_PAGE = 10;

/**
 * HTTP layer for the Community page (docs/COMMUNITY_PAGE.md).
 *
 * POST /api/community/learning-feed { language?, excludeOwners[], excludeKeys[], limit? }
 * POST /api/community/top-feed      { language?, excludeOwners[], excludeKeys[], limit? }
 * GET  /api/community/my-votes
 * POST /api/community/vote          { ownerUserId, entryKey, language? }
 * POST /api/community/apply-design  { ownerUserId, entryKey, language?, override? }
 *
 * Feeds are POST (not GET) so the growing exclude lists aren't bound by URL length.
 * `excludeOwners`/`excludeKeys` are parallel arrays naming already-shown (ownerUserId, entryKey)
 * pairs, so infinite scroll never repeats a design.
 */
export class CommunityLayoutController {
  constructor(private service: CommunityLayoutService) {}

  // Resolve the request language: trust an explicit 'zh'|'es' from the body, else fall back to
  // the user's saved study language.
  private async resolveLanguage(req: Request, userId: string): Promise<Language> {
    const raw = req.body?.language;
    if (raw === 'zh' || raw === 'es') return raw;
    return getUserLanguage(userId);
  }

  // Parse + sanitize the exclude pair-arrays and page size from a feed request body.
  private parsePaging(req: Request): { excludeOwners: string[]; excludeKeys: string[]; limit: number } {
    const owners = Array.isArray(req.body?.excludeOwners) ? req.body.excludeOwners.filter((s: unknown) => typeof s === 'string') : [];
    const keys = Array.isArray(req.body?.excludeKeys) ? req.body.excludeKeys.filter((s: unknown) => typeof s === 'string') : [];
    // unnest() pairs them positionally, so they MUST be the same length — truncate to the shorter.
    const n = Math.min(owners.length, keys.length);
    const rawLimit = Number(req.body?.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_PAGE) : DEFAULT_PAGE;
    return { excludeOwners: owners.slice(0, n), excludeKeys: keys.slice(0, n), limit };
  }

  /** POST /api/community/learning-feed */
  async learningFeed(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const language = await this.resolveLanguage(req, userId);
      const { excludeOwners, excludeKeys, limit } = this.parsePaging(req);
      const designs = await this.service.getLearningFeed(userId, language, excludeOwners, excludeKeys, limit);
      res.json({ designs });
    } catch (error) {
      handleControllerError(error, res, 'CommunityLayoutController.learningFeed');
    }
  }

  /** POST /api/community/top-feed */
  async topFeed(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const language = await this.resolveLanguage(req, userId);
      const { excludeOwners, excludeKeys, limit } = this.parsePaging(req);
      const designs = await this.service.getTopFeed(userId, language, excludeOwners, excludeKeys, limit);
      res.json({ designs });
    } catch (error) {
      handleControllerError(error, res, 'CommunityLayoutController.topFeed');
    }
  }

  /** GET /api/community/my-votes — design keys the viewer voted on this week. */
  async myVotes(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const votes = await this.service.getMyVotesThisWeek(userId);
      res.json({ votes });
    } catch (error) {
      handleControllerError(error, res, 'CommunityLayoutController.myVotes');
    }
  }

  /** POST /api/community/vote */
  async vote(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { ownerUserId, entryKey } = req.body ?? {};
      if (typeof ownerUserId !== 'string' || typeof entryKey !== 'string' || !entryKey.trim()) {
        res.status(400).json({ error: 'ownerUserId and entryKey are required', code: 'ERR_INVALID_INPUT' });
        return;
      }
      const language = await this.resolveLanguage(req, userId);
      const result = await this.service.vote(userId, ownerUserId, entryKey.trim(), language);
      res.json({ result });
    } catch (error) {
      handleControllerError(error, res, 'CommunityLayoutController.vote');
    }
  }

  /** POST /api/community/unvote — toggle a vote off (remove this week's vote for the design). */
  async unvote(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { ownerUserId, entryKey } = req.body ?? {};
      if (typeof ownerUserId !== 'string' || typeof entryKey !== 'string' || !entryKey.trim()) {
        res.status(400).json({ error: 'ownerUserId and entryKey are required', code: 'ERR_INVALID_INPUT' });
        return;
      }
      const language = await this.resolveLanguage(req, userId);
      const removed = await this.service.unvote(userId, ownerUserId, entryKey.trim(), language);
      res.json({ removed });
    } catch (error) {
      handleControllerError(error, res, 'CommunityLayoutController.unvote');
    }
  }

  /** POST /api/community/apply-design */
  async applyDesign(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { ownerUserId, entryKey, override } = req.body ?? {};
      if (typeof ownerUserId !== 'string' || typeof entryKey !== 'string' || !entryKey.trim()) {
        res.status(400).json({ error: 'ownerUserId and entryKey are required', code: 'ERR_INVALID_INPUT' });
        return;
      }
      const language = await this.resolveLanguage(req, userId);
      const result = await this.service.applyDesign(userId, ownerUserId, entryKey.trim(), language, override === true);
      res.json({ result });
    } catch (error) {
      handleControllerError(error, res, 'CommunityLayoutController.applyDesign');
    }
  }
}

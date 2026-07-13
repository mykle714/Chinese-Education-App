import { Request, Response } from 'express';
import { DALError } from '../types/dal.js';
import { NightMarketTemplateService } from '../services/NightMarketTemplateService.js';

/**
 * Night Market Template Controller — HTTP layer for validator-authored templates
 * (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). Thin: extracts the authenticated user,
 * delegates to NightMarketTemplateService, and maps DALErrors to their statusCode
 * (403 non-validator, 400 validation, 404 not found).
 */
export class NightMarketTemplateController {
  constructor(private readonly service: NightMarketTemplateService) {}

  /**
   * GET /api/nightmarket-templates/name-available?name=...
   * → { available: boolean } — backs the editor Properties-popup name check.
   */
  async checkNameAvailable(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const name = (req.query?.name as string) ?? '';
      const available = await this.service.isNameAvailable(userId, name);
      res.json({ available });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to check template name', 'ERR_TEMPLATE_NAME_CHECK_FAILED');
    }
  }

  /**
   * GET /api/nightmarket-templates → { templates: TemplateSummary[] }
   * Name-ordered summaries for the editor's Load dropdown.
   */
  async listTemplates(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const templates = await this.service.listTemplates(userId);
      res.json({ templates });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to list templates', 'ERR_TEMPLATE_LIST_FAILED');
    }
  }

  /**
   * GET /api/nightmarket-templates/load?name=...&version=... → { template } | 404
   * Full definition (+ availableVersions) for loading one version into the editor.
   */
  async getTemplate(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const name = (req.query?.name as string) ?? '';
      // Default to version 0 when omitted (the base loaded by the Load dropdown).
      const version = req.query?.version != null ? Number(req.query.version) : 0;
      const template = await this.service.getTemplate(userId, name, version);
      res.json({ template });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to load template', 'ERR_TEMPLATE_LOAD_FAILED');
    }
  }

  /**
   * POST /api/nightmarket-templates  { name, version, width, height, definition }
   * → 200 { template, overwritten } — upsert by (name, version).
   */
  async saveTemplate(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const { name, version, width, height, description, definition } = req.body ?? {};
      const { template, overwritten } = await this.service.saveTemplate(userId, { name, version, width, height, description, definition });
      res.status(200).json({ template, overwritten });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to save template', 'ERR_TEMPLATE_SAVE_FAILED');
    }
  }

  /**
   * DELETE /api/nightmarket-templates?name=... → { deleted: true } | 404
   * Hard-deletes the WHOLE template (every version of the name).
   */
  async deleteTemplate(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const name = (req.query?.name as string) ?? '';
      await this.service.deleteTemplate(userId, name);
      res.status(200).json({ deleted: true });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to delete template', 'ERR_TEMPLATE_DELETE_FAILED');
    }
  }

  /** Map a DALError to its own statusCode/code; otherwise a 500 fallback. */
  private handleError(res: Response, error: any, fallbackMsg: string, fallbackCode: string): void {
    console.error(`[NM-TEMPLATE-CONTROLLER] ❌ ${fallbackMsg}:`, error);
    if (error instanceof DALError) {
      res.status(error.statusCode || 500).json({ error: error.message, code: error.code });
    } else {
      res.status(500).json({ error: fallbackMsg, code: fallbackCode });
    }
  }
}

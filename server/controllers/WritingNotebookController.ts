import { Request, Response } from 'express';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { resolveWriteLanguage } from '../utils/languageParam.js';
import type { WritingNotebookService } from '../services/WritingNotebookService.js';
import type { Language } from '../types/index.js';

/**
 * Writing Notebook — /api/writingNotebook/* (docs/WRITING_NOTEBOOK.md § "API").
 *
 *   GET  /summary?language=zh                               → NotebookSummary
 *   POST /sheets/open        { language, word }              → NotebookSheetState
 *   GET  /cells?language&word&from&to                        → { cells: NotebookCell[] }
 *   GET  /nextEmpty?language&word&after                      → { cellIndex }
 *   PUT  /cells/:cellIndex   { language, word, ink }         → NotebookSheetState
 *
 * Thin: every rule (word shape, index bounds, ink decoding, recognition, counters) is
 * WritingNotebookService's. This resolves the user and language and maps errors.
 */
export class WritingNotebookController {
  constructor(private notebookService: WritingNotebookService) {}

  /** The caller + a supported language, or null after a 401/400 has been sent. */
  private resolve(req: Request, res: Response, rawLanguage: unknown): { userId: string; language: Language } | null {
    const userId = requireUserId(req, res);
    if (!userId) return null;
    const language = resolveWriteLanguage(rawLanguage);
    if (!language) {
      res.status(400).json({ error: 'language is required', code: 'ERR_INVALID_INPUT' });
      return null;
    }
    return { userId, language };
  }

  async summary(req: Request, res: Response): Promise<void> {
    try {
      const ctx = this.resolve(req, res, req.query.language);
      if (!ctx) return;
      res.json(await this.notebookService.getSummary(ctx.userId, ctx.language));
    } catch (error) {
      handleControllerError(error, res, 'WritingNotebookController.summary');
    }
  }

  async openSheet(req: Request, res: Response): Promise<void> {
    try {
      const ctx = this.resolve(req, res, req.body?.language);
      if (!ctx) return;
      res.json(await this.notebookService.openSheet(ctx.userId, ctx.language, req.body?.word));
    } catch (error) {
      handleControllerError(error, res, 'WritingNotebookController.openSheet');
    }
  }

  async listCells(req: Request, res: Response): Promise<void> {
    try {
      const ctx = this.resolve(req, res, req.query.language);
      if (!ctx) return;
      const { word, from, to } = req.query;
      const cells = await this.notebookService.listCells(ctx.userId, ctx.language, word, from, to);
      res.json({ cells });
    } catch (error) {
      handleControllerError(error, res, 'WritingNotebookController.listCells');
    }
  }

  async nextEmpty(req: Request, res: Response): Promise<void> {
    try {
      const ctx = this.resolve(req, res, req.query.language);
      if (!ctx) return;
      const cellIndex = await this.notebookService.findNextEmpty(ctx.userId, ctx.language, req.query.word, req.query.after);
      res.json({ cellIndex });
    } catch (error) {
      handleControllerError(error, res, 'WritingNotebookController.nextEmpty');
    }
  }

  async saveCell(req: Request, res: Response): Promise<void> {
    try {
      const ctx = this.resolve(req, res, req.body?.language);
      if (!ctx) return;
      const { word, ink } = req.body ?? {};
      res.json(await this.notebookService.saveCell(ctx.userId, ctx.language, word, req.params.cellIndex, ink));
    } catch (error) {
      handleControllerError(error, res, 'WritingNotebookController.saveCell');
    }
  }
}

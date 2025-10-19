import { Request, Response } from 'express';
import { TextService } from '../services/TextService.js';
import { TextCreateData, TextUpdateData } from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';

/**
 * Text Controller - Handles HTTP requests for text/document operations
 * Follows the DAL architecture pattern
 */
export class TextController {
  constructor(private textService: TextService) {}

  /**
   * Create a new text document
   * POST /api/texts
   */
  async createText(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const { title, description, content, language } = req.body;

      if (!title) {
        res.status(400).json({
          error: 'Title is required',
          code: 'ERR_MISSING_FIELDS'
        });
        return;
      }

      // Content can be empty string for new documents, but must be present
      if (content === undefined || content === null) {
        res.status(400).json({
          error: 'Content field is required (can be empty)',
          code: 'ERR_MISSING_FIELDS'
        });
        return;
      }

      const textData: Omit<TextCreateData, 'userId'> = {
        title,
        description: description || '',
        content,
        language
      };

      const newText = await this.textService.createText(userId, textData);

      console.log(`[TEXT-CONTROLLER] ✅ Created text successfully:`, {
        userId: `${userId.substring(0, 8)}...`,
        textId: newText.id,
        title: newText.title
      });

      res.status(201).json(newText);
    } catch (error: any) {
      console.error('[TEXT-CONTROLLER] ❌ Error creating text:', error);
      
      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.message,
          code: 'ERR_VALIDATION_FAILED'
        });
      } else if (error instanceof NotFoundError) {
        res.status(404).json({
          error: error.message,
          code: 'ERR_NOT_FOUND'
        });
      } else {
        res.status(500).json({
          error: 'Failed to create text',
          code: 'ERR_CREATE_TEXT_FAILED'
        });
      }
    }
  }

  /**
   * Update an existing text document
   * PUT /api/texts/:id
   */
  async updateText(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const { id } = req.params;
      const { title, description, content, language } = req.body;

      const updateData: TextUpdateData = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (content !== undefined) updateData.content = content;
      if (language !== undefined) updateData.language = language;

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          error: 'No update data provided',
          code: 'ERR_NO_UPDATE_DATA'
        });
        return;
      }

      const updatedText = await this.textService.updateText(userId, id, updateData);

      console.log(`[TEXT-CONTROLLER] ✅ Updated text successfully:`, {
        userId: `${userId.substring(0, 8)}...`,
        textId: id,
        updatedFields: Object.keys(updateData)
      });

      res.json(updatedText);
    } catch (error: any) {
      console.error('[TEXT-CONTROLLER] ❌ Error updating text:', error);
      
      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.message,
          code: 'ERR_VALIDATION_FAILED'
        });
      } else if (error instanceof NotFoundError) {
        res.status(404).json({
          error: error.message,
          code: 'ERR_NOT_FOUND'
        });
      } else {
        res.status(500).json({
          error: 'Failed to update text',
          code: 'ERR_UPDATE_TEXT_FAILED'
        });
      }
    }
  }

  /**
   * Delete a text document
   * DELETE /api/texts/:id
   */
  async deleteText(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const { id } = req.params;

      const deleted = await this.textService.deleteText(userId, id);

      if (!deleted) {
        res.status(404).json({
          error: 'Text not found',
          code: 'ERR_NOT_FOUND'
        });
        return;
      }

      console.log(`[TEXT-CONTROLLER] ✅ Deleted text successfully:`, {
        userId: `${userId.substring(0, 8)}...`,
        textId: id
      });

      res.json({ success: true, message: 'Text deleted successfully' });
    } catch (error: any) {
      console.error('[TEXT-CONTROLLER] ❌ Error deleting text:', error);
      
      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.message,
          code: 'ERR_VALIDATION_FAILED'
        });
      } else if (error instanceof NotFoundError) {
        res.status(404).json({
          error: error.message,
          code: 'ERR_NOT_FOUND'
        });
      } else {
        res.status(500).json({
          error: 'Failed to delete text',
          code: 'ERR_DELETE_TEXT_FAILED'
        });
      }
    }
  }

  /**
   * Get all texts for authenticated user
   * GET /api/texts
   */
  async getAllTexts(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const texts = await this.textService.getUserTexts(userId);

      console.log(`[TEXT-CONTROLLER] ✅ Retrieved texts successfully:`, {
        userId: `${userId.substring(0, 8)}...`,
        count: texts.length
      });

      res.json(texts);
    } catch (error: any) {
      console.error('[TEXT-CONTROLLER] ❌ Error fetching texts:', error);
      
      if (error instanceof NotFoundError) {
        res.status(404).json({
          error: error.message,
          code: 'ERR_NOT_FOUND'
        });
      } else {
        res.status(500).json({
          error: 'Failed to retrieve texts',
          code: 'ERR_FETCH_TEXTS_FAILED'
        });
      }
    }
  }

  /**
   * Get a specific text by ID
   * GET /api/texts/:id
   */
  async getTextById(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const { id } = req.params;

      const text = await this.textService.getTextById(id);

      if (!text) {
        res.status(404).json({
          error: 'Text not found',
          code: 'ERR_NOT_FOUND'
        });
        return;
      }

      // Authorization check: user can only view their own texts or system texts
      if (text.userId && text.userId !== userId) {
        res.status(403).json({
          error: 'You do not have permission to view this text',
          code: 'ERR_FORBIDDEN'
        });
        return;
      }

      console.log(`[TEXT-CONTROLLER] ✅ Retrieved text successfully:`, {
        userId: `${userId.substring(0, 8)}...`,
        textId: id
      });

      res.json(text);
    } catch (error: any) {
      console.error('[TEXT-CONTROLLER] ❌ Error fetching text:', error);
      
      res.status(500).json({
        error: 'Failed to retrieve text',
        code: 'ERR_FETCH_TEXT_FAILED'
      });
    }
  }

  /**
   * Get user text statistics
   * GET /api/texts/stats
   */
  async getUserTextStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const stats = await this.textService.getUserTextStats(userId);

      console.log(`[TEXT-CONTROLLER] ✅ Retrieved text stats successfully:`, {
        userId: `${userId.substring(0, 8)}...`,
        stats
      });

      res.json(stats);
    } catch (error: any) {
      console.error('[TEXT-CONTROLLER] ❌ Error fetching text stats:', error);
      
      res.status(500).json({
        error: 'Failed to retrieve text statistics',
        code: 'ERR_FETCH_STATS_FAILED'
      });
    }
  }
}

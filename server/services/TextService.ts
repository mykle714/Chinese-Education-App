import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { Text, TextCreateData, TextUpdateData } from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import { dbManager } from '../dal/base/DatabaseManager.js';

/**
 * Text Service - Contains all business logic for text/document operations
 * Handles validation, authorization, and text management for the Reader feature
 */
export class TextService {
  constructor(
    private userDAL: IUserDAL
  ) {}

  /**
   * Create a new user document with validation
   */
  async createText(userId: string, textData: Omit<TextCreateData, 'userId'>): Promise<Text> {
    // Business validation
    this.validateTextData(textData);

    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Generate unique ID
    const id = `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Get character count
    const characterCount = textData.content.length;
    
    // Use user's selected language or default to Chinese
    const language = textData.language || user.selectedLanguage || 'zh';
    
    // Create text in database
    const result = await dbManager.executeQuery<Text>(async (client) => {
      return await client.query(
        `INSERT INTO texts (id, "userId", title, description, content, language, "characterCount", "isUserCreated", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
         RETURNING *`,
        [id, userId, textData.title.trim(), textData.description?.trim() || '', textData.content, language, characterCount]
      );
    });
    
    if (result.recordset.length === 0) {
      throw new Error('Failed to create text');
    }
    
    console.log(`[TEXT-SERVICE] ✅ Created new user document:`, {
      userId: `${userId.substring(0, 8)}...`,
      textId: id,
      title: textData.title,
      language,
      characterCount
    });
    
    return result.recordset[0];
  }

  /**
   * Update an existing text document
   */
  async updateText(userId: string, textId: string, updateData: TextUpdateData): Promise<Text> {
    // Business validation
    this.validateUpdateData(updateData);
    
    // Verify text exists and user owns it
    const existingText = await this.getTextById(textId);
    if (!existingText) {
      throw new NotFoundError('Text not found');
    }
    
    // Authorization check - only owner can edit
    if (existingText.userId !== userId) {
      throw new ValidationError('You can only edit your own documents');
    }
    
    // System texts cannot be edited
    if (!existingText.isUserCreated) {
      throw new ValidationError('System texts cannot be edited');
    }
    
    // Calculate new character count if content is being updated
    const characterCount = updateData.content 
      ? updateData.content.length 
      : existingText.characterCount;
    
    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (updateData.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(updateData.title.trim());
    }
    
    if (updateData.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(updateData.description.trim());
    }
    
    if (updateData.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(updateData.content);
      updates.push(`"characterCount" = $${paramIndex++}`);
      values.push(characterCount);
    }
    
    // Language is immutable after creation - cannot be updated
    
    values.push(textId);
    
    // Update text in database
    const result = await dbManager.executeQuery<Text>(async (client) => {
      return await client.query(
        `UPDATE texts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );
    });
    
    if (result.recordset.length === 0) {
      throw new NotFoundError('Text not found after update');
    }
    
    console.log(`[TEXT-SERVICE] ✅ Updated user document:`, {
      userId: `${userId.substring(0, 8)}...`,
      textId,
      updatedFields: Object.keys(updateData)
    });
    
    return result.recordset[0];
  }

  /**
   * Delete a text document
   */
  async deleteText(userId: string, textId: string): Promise<boolean> {
    // Verify text exists and user owns it
    const existingText = await this.getTextById(textId);
    if (!existingText) {
      throw new NotFoundError('Text not found');
    }
    
    // Authorization check - only owner can delete
    if (existingText.userId !== userId) {
      throw new ValidationError('You can only delete your own documents');
    }
    
    // System texts cannot be deleted
    if (!existingText.isUserCreated) {
      throw new ValidationError('System texts cannot be deleted');
    }
    
    // Delete text from database
    const result = await dbManager.executeQuery(async (client) => {
      return await client.query(
        'DELETE FROM texts WHERE id = $1',
        [textId]
      );
    });
    
    console.log(`[TEXT-SERVICE] ✅ Deleted user document:`, {
      userId: `${userId.substring(0, 8)}...`,
      textId,
      title: existingText.title
    });
    
    return result.rowsAffected > 0;
  }

  /**
   * Get text by ID
   */
  async getTextById(textId: string): Promise<Text | null> {
    const result = await dbManager.executeQuery<Text>(async (client) => {
      return await client.query(
        'SELECT * FROM texts WHERE id = $1',
        [textId]
      );
    });
    
    return result.recordset.length > 0 ? result.recordset[0] : null;
  }

  /**
   * Get all texts for a user
   * Filtered by user's preferred language
   */
  async getUserTexts(userId: string): Promise<Text[]> {
    // Verify user exists and get their preferred language
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Use user's selected language or default to Chinese
    const language = user.selectedLanguage || 'zh';
    
    // Get user's texts for the language
    const result = await dbManager.executeQuery<Text>(async (client) => {
      return await client.query(
        `SELECT * FROM texts 
         WHERE language = $1 AND "userId" = $2
         ORDER BY "createdAt" DESC`,
        [language, userId]
      );
    });
    
    console.log(`[TEXT-SERVICE] 📚 Retrieved texts for user:`, {
      userId: `${userId.substring(0, 8)}...`,
      language,
      totalTexts: result.recordset.length
    });
    
    return result.recordset;
  }

  /**
   * Get only user-created texts
   */
  async getUserCreatedTexts(userId: string): Promise<Text[]> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    const result = await dbManager.executeQuery<Text>(async (client) => {
      return await client.query(
        `SELECT * FROM texts 
         WHERE "userId" = $1 AND "isUserCreated" = true
         ORDER BY "createdAt" DESC`,
        [userId]
      );
    });
    
    return result.recordset;
  }

  /**
   * Get text statistics for a user
   */
  async getUserTextStats(userId: string): Promise<{
    total: number;
    userCreated: number;
    systemTexts: number;
    totalCharacters: number;
  }> {
    const texts = await this.getUserTexts(userId);
    
    return {
      total: texts.length,
      userCreated: texts.filter(t => t.isUserCreated).length,
      systemTexts: texts.filter(t => !t.isUserCreated).length,
      totalCharacters: texts.reduce((sum, t) => sum + t.characterCount, 0)
    };
  }

  // Private helper methods

  /**
   * Validate text data for creation
   */
  private validateTextData(data: Omit<TextCreateData, 'userId'>): void {
    if (!data.title || data.title.trim().length === 0) {
      throw new ValidationError('Title is required');
    }
    
    if (data.title.trim().length > 200) {
      throw new ValidationError('Title is too long (maximum 200 characters)');
    }
    
    if (data.description && data.description.length > 500) {
      throw new ValidationError('Description is too long (maximum 500 characters)');
    }
    
    if (data.content !== undefined && data.content.length > 50000) {
      throw new ValidationError('Content is too long (maximum 50,000 characters)');
    }
    
    // Validate language code
    const validLanguages = ['zh', 'ja', 'ko', 'vi'];
    if (data.language && !validLanguages.includes(data.language)) {
      throw new ValidationError(`Invalid language. Must be one of: ${validLanguages.join(', ')}`);
    }
  }

  /**
   * Validate text data for updates
   */
  private validateUpdateData(data: TextUpdateData): void {
    if (data.title !== undefined) {
      if (!data.title || data.title.trim().length === 0) {
        throw new ValidationError('Title cannot be empty');
      }
      
      if (data.title.trim().length > 200) {
        throw new ValidationError('Title is too long (maximum 200 characters)');
      }
    }
    
    if (data.description !== undefined && data.description.length > 500) {
      throw new ValidationError('Description is too long (maximum 500 characters)');
    }
    
    if (data.content !== undefined && data.content.length > 50000) {
      throw new ValidationError('Content is too long (maximum 50,000 characters)');
    }
    
    // Language is immutable after creation - do not allow updates
    if (data.language !== undefined) {
      throw new ValidationError('Language cannot be changed after document creation');
    }
  }
}

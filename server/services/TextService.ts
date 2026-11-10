import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { Text, TextCreateData, TextUpdateData } from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import type { ITextDAL } from '../dal/interfaces/ITextDAL.js';
import { sanitizeDocumentContent } from '../utils/sanitizeContent.js';
import { deriveDocumentTitle, documentTitleSource } from '../utils/documentTitle.js';
import {
  buildDictMap,
  buildExcludeSet,
  getAllSubstrings,
  segmentWithDict,
  splitHanRuns,
  SEGMENTATION_MAX_TOKEN_CHARS,
} from '../dal/shared/segmentString.js';

/**
 * Ceiling on user-authored documents per account. A bound on volume, not a product
 * limit — see `createText`. System documents are excluded from the count.
 */
const MAX_DOCUMENTS_PER_USER = 500;

/**
 * Text Service - Contains all business logic for text/document operations
 * Handles validation, authorization, and text management for the Reader feature
 *
 * LAYER: service — no SQL. `texts` reads and writes go through `ITextDAL`.
 */
export class TextService {
  constructor(
    private userDAL: IUserDAL,
    private dictionaryDAL: IDictionaryDAL,
    private textDAL: ITextDAL
  ) {}

  /**
   * Create a new user document. There is no title input: the Reader creates a
   * document on the first Save of a blank draft, and the title is derived from the
   * content (deriveTitle). Renaming afterwards goes through updateText.
   */
  async createText(userId: string, textData: Omit<TextCreateData, 'userId'>): Promise<Text> {
    // Business validation
    this.validateTextData(textData);

    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // A CEILING ON DOCUMENTS PER ACCOUNT. Each field was already bounded (title 200,
    // content 50 000) but the NUMBER of documents was not, so the
    // only limit on how much a single account could store was how fast it could POST.
    // Set far above any plausible reading library — this exists to stop a loop, not
    // to ration documents, and the message says which one it is so a real user who
    // somehow reaches it knows what to do.
    const existingCount = await this.countUserCreatedTexts(userId);
    if (existingCount >= MAX_DOCUMENTS_PER_USER) {
      throw new ValidationError(
        `You already have ${MAX_DOCUMENTS_PER_USER} documents. Delete one to make room.`
      );
    }

    // Get character count
    const characterCount = textData.content.length;

    // Use user's selected language or default to Chinese
    const language = textData.language || user.selectedLanguage || 'zh';

    // Defense-in-depth: neutralize control chars / HTML in the stored body.
    const safeContent = sanitizeDocumentContent(textData.content);
    // Derived from the sanitized body, so the title can't carry what the body can't.
    const title = await this.deriveTitle(safeContent, language);

    // id and createdAt are filled by Postgres defaults (uuid_generate_v4, now()).
    const created = await this.textDAL.insertUserText({
      userId, title, content: safeContent, language, characterCount,
    });

    console.log(`[TEXT-SERVICE] ✅ Created new user document:`, {
      userId: `${userId.substring(0, 8)}...`,
      textId: created.id,
      title,
      language,
      characterCount
    });
    
    return created;
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
    
    // Nothing to change (neither field): return the document as it is. TextController
    // already rejects an empty body with 400; this guards any other caller, because
    // `TextDAL.updateFields` refuses an update that names no column.
    if (updateData.title === undefined && updateData.content === undefined) {
      return existingText;
    }

    // Language is immutable after creation - cannot be updated (validateUpdateData).
    const updated = await this.textDAL.updateFields(textId, {
      title: updateData.title?.trim(),
      // Defense-in-depth: neutralize control chars / HTML before storing.
      content: updateData.content !== undefined ? sanitizeDocumentContent(updateData.content) : undefined,
      // Counted on the RAW content, as createText does. `!== undefined` (not truthiness),
      // so clearing a document to "" records 0 rather than keeping the old count.
      characterCount: updateData.content !== undefined ? updateData.content.length : undefined,
    });

    if (!updated) {
      throw new NotFoundError('Text not found after update');
    }
    
    console.log(`[TEXT-SERVICE] ✅ Updated user document:`, {
      userId: `${userId.substring(0, 8)}...`,
      textId,
      updatedFields: Object.keys(updateData)
    });
    
    return updated;
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
    
    const deleted = await this.textDAL.deleteById(textId);
    
    console.log(`[TEXT-SERVICE] ✅ Deleted user document:`, {
      userId: `${userId.substring(0, 8)}...`,
      textId,
      title: existingText.title
    });
    
    return deleted;
  }

  /**
   * Get text by ID
   */
  async getTextById(textId: string): Promise<Text | null> {
    return this.textDAL.findById(textId);
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
    
    const texts = await this.textDAL.findByUserAndLanguage(userId, language);
    
    console.log(`[TEXT-SERVICE] 📚 Retrieved texts for user:`, {
      userId: `${userId.substring(0, 8)}...`,
      language,
      totalTexts: texts.length
    });
    
    return texts;
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
    
    return this.textDAL.findUserCreated(userId);
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

  /**
   * How many documents this user has authored. Counts only `isUserCreated` rows, so
   * system documents never eat into the allowance.
   */
  private async countUserCreatedTexts(userId: string): Promise<number> {
    return this.textDAL.countUserCreated(userId);
  }

  // Private helper methods

  /**
   * The title for a new document: as many whole words of its first line as fit in
   * 20 characters (server/utils/documentTitle.ts). Chinese runs are split with the
   * gsa against det, so the lookup is one findMultipleByWord1 over the substrings of
   * just the title window — not the whole document. Other languages split on
   * whitespace and need no lookup.
   */
  private async deriveTitle(content: string, language: string): Promise<string> {
    const source = documentTitleSource(content);
    const hanRuns = splitHanRuns(source).filter((run) => run.type === 'han').map((run) => run.value);
    if (hanRuns.length === 0) return deriveDocumentTitle(content, (run) => [run]);

    const candidates = [...new Set(hanRuns.flatMap((run) => getAllSubstrings(run)))];
    // Same over-length filter as DictionaryDAL's run segmenter: the gsa never matches
    // tokens longer than 4, but buildExcludeSet would still absorb their exceptions.
    const entries = (await this.dictionaryDAL.findMultipleByWord1(candidates, language))
      .filter((entry) => [...entry.word1].length <= SEGMENTATION_MAX_TOKEN_CHARS);
    const dictMap = buildDictMap(entries);
    const excludeSet = buildExcludeSet(entries);
    return deriveDocumentTitle(content, (run) => segmentWithDict(run, dictMap, excludeSet));
  }

  /**
   * Validate text data for creation
   */
  private validateTextData(data: Omit<TextCreateData, 'userId'>): void {
    if (data.content !== undefined && data.content.length > 50000) {
      throw new ValidationError('Content is too long (maximum 50,000 characters)');
    }
    
    // Validate language code
    const validLanguages = ['zh', 'es'];
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
    
    if (data.content !== undefined && data.content.length > 50000) {
      throw new ValidationError('Content is too long (maximum 50,000 characters)');
    }
    
    // Language is immutable after creation - do not allow updates
    if (data.language !== undefined) {
      throw new ValidationError('Language cannot be changed after document creation');
    }
  }
}

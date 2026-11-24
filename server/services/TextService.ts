import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { Text, TextCreateData, TextUpdateData } from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import type { ITextDAL } from '../dal/interfaces/ITextDAL.js';
import { DOCUMENT_TITLE_MAX_LENGTH, TEXT_KINDS } from '../contracts/wire.js';
import { sanitizeDocumentContent } from '../utils/sanitizeContent.js';
import { normalizePronunciationOverrides } from '../utils/pronunciationOverrides.js';
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
   * Create a new user document. The Reader creates a document on the first Save of a
   * blank draft. Its title is the one typed into the draft's header field when there is
   * one (`textData.title`, normalizeTitle), otherwise derived from the content
   * (deriveTitle). Renaming afterwards goes through updateText.
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
    // A typed title is normalized like a rename; a blank or absent one is derived from
    // the sanitized body, so the title can't carry what the body can't.
    const typedTitle = typeof textData.title === 'string' && textData.title.trim().length > 0
      ? this.normalizeTitle(textData.title)
      : undefined;
    const title = typedTitle ?? await this.deriveTitle(safeContent, language);

    // id and createdAt are filled by Postgres defaults (uuid_generate_v4, now()).
    const created = await this.textDAL.insertUserText({
      userId, title, content: safeContent, language, characterCount,
      // A draft can carry an icon from its first Save (docs/USER_DOCUMENT_FEATURE_SUMMARY.md
      // § "Document icon"); omitted → no icon.
      iconId: textData.iconId ?? null,
      // The Reader collection (texts.kind, migration 194). The Reader sends 'journal'
      // when New document was tapped with the Journal tile selected; omitted → 'document'.
      kind: textData.kind ?? 'document',
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
    
    // Nothing to change (no field): return the document as it is. TextController
    // already rejects an empty body with 400; this guards any other caller, because
    // `TextDAL.updateFields` refuses an update that names no column.
    if (
      updateData.title === undefined && updateData.content === undefined
      && updateData.iconId === undefined && updateData.pronunciationOverrides === undefined
    ) {
      return existingText;
    }

    // READING CHOICES (migration 207; utils/pronunciationOverrides.ts). Checked against
    // the content as it will be STORED (sanitized), since the offsets index into it. A
    // content change without a list re-checks the stored list, so no choice ever points
    // at a word that is no longer there.
    const contentToStore = updateData.content !== undefined ? sanitizeDocumentContent(updateData.content) : undefined;
    let pronunciationOverrides;
    if (updateData.pronunciationOverrides !== undefined || contentToStore !== undefined) {
      const normalized = normalizePronunciationOverrides(
        updateData.pronunciationOverrides ?? existingText.pronunciationOverrides ?? [],
        contentToStore ?? existingText.content,
      );
      if (normalized.shapeError) throw new ValidationError(normalized.shapeError);
      if (normalized.dropped > 0) {
        console.log(`[TEXT-SERVICE] Dropped ${normalized.dropped} stale reading choice(s) on text ${textId}`);
      }
      pronunciationOverrides = normalized.overrides;
    }
    // Picking a reading is not editing: a choices-only update leaves the "Recently
    // edited" sort alone.
    const onlyReadingChoices = updateData.title === undefined && updateData.content === undefined
      && updateData.iconId === undefined;

    // Language is immutable after creation - cannot be updated (validateUpdateData).
    const updated = await this.textDAL.updateFields(textId, {
      // Normalized (control chars stripped, whitespace collapsed) like a typed create title.
      title: updateData.title !== undefined ? this.normalizeTitle(updateData.title) : undefined,
      // Defense-in-depth: neutralize control chars / HTML before storing.
      content: contentToStore,
      // Counted on the RAW content, as createText does. `!== undefined` (not truthiness),
      // so clearing a document to "" records 0 rather than keeping the old count.
      characterCount: updateData.content !== undefined ? updateData.content.length : undefined,
      // `null` clears the icon, `undefined` leaves it (TextDAL.updateFields skips undefined).
      iconId: updateData.iconId,
      pronunciationOverrides,
      touchUpdatedAt: !onlyReadingChoices,
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

    this.validateIconId(data.iconId);

    if (data.kind !== undefined && !(TEXT_KINDS as readonly string[]).includes(data.kind)) {
      throw new ValidationError(`Invalid kind. Must be one of: ${TEXT_KINDS.join(', ')}`);
    }
  }

  /**
   * An icon id is an icons8 id string or null (clear). Shape-checked only: whether the
   * icon exists is the FK's job (texts."iconId" → icons8, migration 193), and the
   * client always caches the icon (`ensureIcon8`) before sending its id.
   */
  private validateIconId(iconId: unknown): void {
    if (iconId === undefined || iconId === null) return;
    if (typeof iconId !== 'string' || iconId.trim().length === 0 || iconId.length > 64) {
      throw new ValidationError('Invalid icon id');
    }
  }

  /**
   * A learner-typed document title, made safe to store: control characters stripped
   * (sanitizeDocumentContent) and every run of whitespace, newlines included, collapsed
   * to one space — a title is a single line in the header and on the list cards.
   * Throws ValidationError when the input is not a string, is blank, or exceeds
   * DOCUMENT_TITLE_MAX_LENGTH. Used by createText (a typed draft title) and updateText
   * (a rename from the Reader's editable header title, features/reader/ReaderDocumentPage.tsx).
   * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Editing.
   */
  private normalizeTitle(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new ValidationError('Title must be text');
    }
    const title = sanitizeDocumentContent(raw).replace(/\s+/g, ' ').trim();
    if (title.length === 0) {
      throw new ValidationError('Title cannot be empty');
    }
    if (title.length > DOCUMENT_TITLE_MAX_LENGTH) {
      throw new ValidationError(`Title is too long (maximum ${DOCUMENT_TITLE_MAX_LENGTH} characters)`);
    }
    return title;
  }

  /**
   * Validate text data for updates
   */
  private validateUpdateData(data: TextUpdateData): void {
    // Throws on a non-string, blank or over-long title; the result is discarded here
    // and recomputed when the update is stored.
    if (data.title !== undefined) this.normalizeTitle(data.title);
    
    if (data.content !== undefined && data.content.length > 50000) {
      throw new ValidationError('Content is too long (maximum 50,000 characters)');
    }
    
    // Language is immutable after creation - do not allow updates
    if (data.language !== undefined) {
      throw new ValidationError('Language cannot be changed after document creation');
    }

    this.validateIconId(data.iconId);
  }
}

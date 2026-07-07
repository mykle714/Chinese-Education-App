import { Readable } from 'stream';
import csv from 'csv-parser';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { DictionaryService } from './DictionaryService.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, DifficultyLevel, Language, IconLayoutItem, ICON_LAYOUT_MAX_ITEMS, SnapConfig, TextColors, TextColorMode, TextLayout, TextLayoutItem, TextBlock, CARD_COLOR_VALUES } from '../types/index.js';
import { ValidationError, NotFoundError, BulkResult } from '../types/dal.js';
import db from '../db.js';
import { vetTableForLanguage } from '../dal/shared/vetTable.js';

// ── Icon-layout geometry (mirrors src/pages/FlashcardsLearnPage/cardIconLayout.ts) ──
// These must stay in lockstep with the client constants so save-time validation clamps
// an icon center to the SAME bound the edit canvas allows on release (clampIconCenter).
// Diverging here is what made far-off-card icons get yanked deeper inward on save.
const BASE_ICON_FRAC = 0.28;        // icon box width as a fraction of card width (before scale)
const CARD_ASPECT = 295 / 426;      // fixed flashcard width / height (FlashCardSection frame)
const MIN_ON_CARD_FRAC = 0.15;      // min slice of an icon that must stay on-card after a drag

// CSV row interface for import processing
interface CSVRow {
  front: string;
  back: string;
  hint?: string;
  publishedAt?: string;
}

// Import result interface
interface ImportResult {
  success: boolean;
  results: BulkResult;
  message: string;
}

/**
 * VocabEntry Service - Contains all business logic for vocabulary operations
 * Handles validation, CSV processing, search, and vocabulary management
 */
export class VocabEntryService {
  constructor(
    private vocabEntryDAL: IVocabEntryDAL,
    private userDAL: IUserDAL,
    private dictionaryService: DictionaryService
  ) {}

  /**
   * Create a new vocabulary entry with validation
   */
  async createEntry(userId: string, entryData: Omit<VocabEntryCreateData, 'userId'>): Promise<VocabEntry> {
    // Business validation
    this.validateEntryData(entryData);

    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Use user's selected language or default to Chinese
    const language: Language = user.selectedLanguage || 'zh';
    const trimmedKey = entryData.entryKey.trim();

    // Check for duplicates within the same language (business rule). The same
    // spelling can legitimately exist in another study language, so the check
    // is scoped to the user's active language.
    const existingEntry = await this.vocabEntryDAL.findByUserAndKey(userId, entryData.entryKey, language);
    if (existingEntry) {
      throw new ValidationError(`Entry with key "${entryData.entryKey}" already exists`);
    }

    // Reject orphans: vet rows now derive their definition from det via
    // entryKey/language. Without a matching det row the entry would render
    // with no definition, so block creation up front.
    const dictMatch = await this.dictionaryService.lookupTerm(trimmedKey, language);
    if (!dictMatch) {
      throw new ValidationError(
        `No dictionary entry exists for "${trimmedKey}" in ${language}. ` +
        `Add it to the dictionary first before saving it to your vocabulary.`
      );
    }

    const newEntry: VocabEntry = await this.vocabEntryDAL.create({
      userId,
      entryKey: trimmedKey,
      language,
    });

    return newEntry;
  }

  /**
   * Add a dictionary entry to the user's library from a context that may or
   * may not already have a vocabentries row.
   *
   * Branches:
   *  - no row → INSERT with starterPackBucket='library' (category is GENERATED → 'Unfamiliar')
   *  - row already in library → no-op
   *  - row with NULL bucket → bucket → 'library' (status='added'). ('skip' rows no
   *    longer occur in vet — skips live in discover_skips since migration 80 — but
   *    the non-library branch below still safely upgrades any stray NULL row.)
   *
   * Returns the resulting vocabentry id and a status string the client can
   * translate into a flash message.
   */
  async addToLibrary(
    userId: string,
    entryKey: string,
    language: Language,
  ): Promise<{ status: 'added' | 'already-in-library'; vocabEntryId: number }> {
    const trimmedKey = entryKey?.trim();
    if (!trimmedKey) {
      throw new ValidationError('entryKey is required');
    }

    // Reject orphans — vet rows derive their definition from det via entryKey/language.
    const dictMatch = await this.dictionaryService.lookupTerm(trimmedKey, language);
    if (!dictMatch) {
      throw new NotFoundError(
        `No dictionary entry exists for "${trimmedKey}" in ${language}.`,
      );
    }

    // Per-language vet table (migration 66). This "add to library" path doesn't
    // choose a specific POS, so es rows are inserted with pos NULL (a word-level
    // save); the discover sort flow is what captures a specific POS.
    const vetTable = vetTableForLanguage(language);
    const client = await db.getClient();
    try {
      const existing = await client.query<{ id: number; starterPackBucket: string | null }>(
        `SELECT id, "starterPackBucket" FROM ${vetTable}
         WHERE "userId" = $1 AND "entryKey" = $2 AND language = $3`,
        [userId, trimmedKey, language],
      );

      if (existing.rows.length === 0) {
        const insertResult = await client.query<{ id: number }>(
          // category is GENERATED from markHistory (migration 67); a fresh row's
          // empty history resolves to 'Unfamiliar', so it is not written here.
          `INSERT INTO ${vetTable} ("userId", "entryKey", language, "starterPackBucket")
           VALUES ($1, $2, $3, 'library')
           RETURNING id`,
          [userId, trimmedKey, language],
        );
        return { status: 'added', vocabEntryId: insertResult.rows[0].id };
      }

      const row = existing.rows[0];
      if (row.starterPackBucket === 'library') {
        return { status: 'already-in-library', vocabEntryId: row.id };
      }

      // Any non-library row (a stray NULL bucket) becomes a library add.
      await client.query(
        `UPDATE ${vetTable} SET "starterPackBucket" = 'library' WHERE id = $1`,
        [row.id],
      );
      return { status: 'added', vocabEntryId: row.id };
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing vocabulary entry
   */
  async updateEntry(userId: string, entryId: number, language: string, updateData: VocabEntryUpdateData): Promise<VocabEntry> {
    // Business validation
    this.validateUpdateData(updateData);

    // Verify user owns the entry (business rule). vet is split per language, so the
    // lookup is language-scoped (caller passes the user's active language).
    const existingEntry = await this.vocabEntryDAL.findByIdAndLanguage(entryId, language);
    if (!existingEntry) {
      throw new NotFoundError('Vocabulary entry not found');
    }
    
    if (existingEntry.userId !== userId) {
      throw new ValidationError('You can only update your own vocabulary entries');
    }
    
    // Check for duplicate key if key is being changed (business rule).
    // Scoped to the existing entry's language since identity is (user, key, language).
    if (updateData.entryKey !== existingEntry.entryKey) {
      const duplicateEntry = await this.vocabEntryDAL.findByUserAndKey(userId, updateData.entryKey, existingEntry.language);
      if (duplicateEntry && duplicateEntry.id !== entryId) {
        throw new ValidationError(`Entry with key "${updateData.entryKey}" already exists`);
      }
    }
    
    const updateFields: any = {
      entryKey: updateData.entryKey!.trim(),
    };

    // Update entry
    const updatedEntry = await this.vocabEntryDAL.update(entryId, updateFields);

    return updatedEntry;
  }

  /**
   * Persist (or clear) a custom flashcard icon arrangement for one of the user's vet
   * rows. `layout` of null clears it back to the default centered icon. Two per-card
   * editor settings ride along on the same write — each follows the SAME tri-state rule:
   * `undefined` leaves the column untouched (community copy path), `null` clears it, an
   * object/value sets it. `snapConfig` = the snap toggles (migration 88); `textColors` = the
   * Contrast text-color overrides (migration 89); `cardColor` = the card background fill
   * (migration 94). Validates each shape here (business rule), then writes via the
   * ownership-scoped DAL method. See docs/CARD_ICON_LAYOUT.md.
   */
  async updateIconLayout(
    userId: string,
    entryId: number,
    language: string,
    layout: IconLayoutItem[] | null,
    snapConfig?: SnapConfig | null,
    textColors?: TextColors | null,
    textLayout?: TextLayout | null,
    cardColor?: string | null
  ): Promise<VocabEntry> {
    const clean = layout === null ? null : this.validateIconLayout(layout);
    const cleanSnap = snapConfig === undefined ? undefined : this.validateSnapConfig(snapConfig);
    const cleanColors = textColors === undefined ? undefined : this.validateTextColors(textColors);
    const cleanText = textLayout === undefined ? undefined : this.validateTextLayout(textLayout);
    const cleanCardColor = cardColor === undefined ? undefined : this.validateCardColor(cardColor);
    const updated = await this.vocabEntryDAL.updateIconLayout(userId, entryId, language, clean, cleanSnap, cleanColors, cleanText, cleanCardColor);
    if (!updated) {
      // No row matched the id for this user — either it doesn't exist or isn't theirs.
      throw new NotFoundError('Vocabulary entry not found');
    }
    return updated;
  }

  /**
   * Persist (or clear) the learner's chosen definition-cluster sense for one vet row
   * (migration 99). `selectedSense` is the cluster's `sense` label — a stable identity that
   * survives re-sorting/re-scoring, unlike a positional index. `null` clears the choice back
   * to the default/starred sense. Trimmed to a bounded length as a defensive guard against
   * an oversized body; the client only ever sends a real cluster label. See
   * docs/DEFINITION_CLUSTERS.md.
   */
  async updateSelectedSense(
    userId: string,
    entryId: number,
    language: string,
    selectedSense: string | null
  ): Promise<VocabEntry> {
    const clean = selectedSense === null ? null : String(selectedSense).slice(0, 500);
    const updated = await this.vocabEntryDAL.updateSelectedSense(userId, entryId, language, clean);
    if (!updated) {
      // No row matched the id for this user — either it doesn't exist or isn't theirs.
      throw new NotFoundError('Vocabulary entry not found');
    }
    return updated;
  }

  /**
   * Validate the per-card text-color overrides: null (both 'theme') or an object with a
   * `foreign` + `english` side, each one of 'theme' | 'dark' | 'light'. Any missing /
   * unrecognized side falls back to 'theme', so a partial/loosely-typed body is normalized.
   * See docs/CARD_ICON_LAYOUT.md.
   */
  private validateTextColors(colors: unknown): TextColors | null {
    if (colors === null) return null;
    if (typeof colors !== 'object' || Array.isArray(colors)) {
      throw new ValidationError('textColors must be an object or null');
    }
    const c = colors as Record<string, unknown>;
    const coerce = (v: unknown): TextColorMode => (v === 'dark' || v === 'light' ? v : 'theme');
    return { foreign: coerce(c.foreign), english: coerce(c.english) };
  }

  /**
   * Validate the per-card background fill (migration 94): null (follow theme) or one of the
   * six offered hex swatches (CARD_COLOR_VALUES). Any other value — including a well-formed
   * but off-palette hex — normalizes to null, so only vetted fills reach the DB. See
   * docs/CARD_ICON_LAYOUT.md.
   */
  private validateCardColor(color: unknown): string | null {
    if (typeof color === 'string' && CARD_COLOR_VALUES.includes(color)) return color;
    return null;
  }

  /**
   * Validate the per-card movable-text placement (migration 91): null (both blocks default)
   * or an object with optional `foreign` / `english` blocks, each carrying finite numeric
   * x/y/scale/rotation (+ optional `locked`). Each block's scale is clamped to the readable
   * text range and its center to [0,1]; an invalid/absent block is dropped. If neither block
   * survives, the whole thing normalizes to null (keeps clean rows). See docs/CARD_ICON_LAYOUT.md.
   */
  private validateTextLayout(layout: unknown): TextLayout | null {
    if (layout === null) return null;
    if (typeof layout !== 'object' || Array.isArray(layout)) {
      throw new ValidationError('textLayout must be an object or null');
    }
    const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
    const src = layout as Record<string, unknown>;
    const out: TextLayout = {};
    for (const block of ['foreign', 'english'] as TextBlock[]) {
      const raw = src[block] as Record<string, unknown> | undefined;
      if (raw == null) continue; // absent block → render at default
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ValidationError(`textLayout.${block} must be an object`);
      }
      for (const k of ['x', 'y', 'scale', 'rotation']) {
        if (typeof raw[k] !== 'number' || !Number.isFinite(raw[k] as number)) {
          throw new ValidationError(`textLayout.${block}.${k} must be a finite number`);
        }
      }
      const item: TextLayoutItem = {
        // Text must stay on-card; the client already clamps the whole box on, so a plain
        // [0,1] center clamp here is a safe outer bound that never fights that.
        x: clamp(raw.x as number, 0, 1),
        y: clamp(raw.y as number, 0, 1),
        scale: clamp(raw.scale as number, 0.5, 3), // readable-text range (mirrors TEXT_SCALE_MIN/MAX)
        rotation: raw.rotation as number,
        // Optional lock flag; coerced + omitted when false so unlocked blocks stay clean.
        ...(raw.locked === true ? { locked: true } : {}),
      };
      out[block] = item;
    }
    // Normalize "no surviving blocks" back to null so a default layout is stored as NULL.
    return out.foreign || out.english ? out : null;
  }

  /**
   * Validate the per-card snap toggles: null (all off) or an object with three boolean
   * flags. Coerces each to a real boolean so a partial/loosely-typed body is normalized.
   * See docs/CARD_ICON_LAYOUT.md.
   */
  private validateSnapConfig(snap: unknown): SnapConfig | null {
    if (snap === null) return null;
    if (typeof snap !== 'object' || Array.isArray(snap)) {
      throw new ValidationError('snapConfig must be an object or null');
    }
    const s = snap as Record<string, unknown>;
    return {
      move: s.move === true,
      rotate: s.rotate === true,
      resize: s.resize === true,
    };
  }

  /**
   * Validate + normalize a custom icon arrangement: max ICON_LAYOUT_MAX_ITEMS items,
   * each with a non-empty iconId and finite numeric x/y/scale/rotation/z. Coordinates
   * are clamped to sane ranges; `z` is renumbered 0..n-1 (by ascending z) so paint
   * order is canonical regardless of how the client tracked it.
   */
  private validateIconLayout(layout: unknown): IconLayoutItem[] {
    if (!Array.isArray(layout)) {
      throw new ValidationError('iconLayout must be an array or null');
    }
    if (layout.length > ICON_LAYOUT_MAX_ITEMS) {
      throw new ValidationError(`iconLayout may contain at most ${ICON_LAYOUT_MAX_ITEMS} icons`);
    }

    const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

    const items: IconLayoutItem[] = layout.map((raw: any, i: number) => {
      const iconId = typeof raw?.iconId === 'string' ? raw.iconId.trim() : '';
      if (!iconId) throw new ValidationError(`iconLayout[${i}].iconId is required`);
      const nums = ['x', 'y', 'scale', 'rotation', 'z'];
      for (const k of nums) {
        if (typeof raw?.[k] !== 'number' || !Number.isFinite(raw[k])) {
          throw new ValidationError(`iconLayout[${i}].${k} must be a finite number`);
        }
      }
      const scale = clamp(raw.scale, 0.25, 5);
      // Clamp the icon CENTER the same way the edit canvas does on release
      // (clampIconCenter): keep at least MIN_ON_CARD_FRAC of the icon's OWN size on-card
      // rather than forcing the center into [0,1]. The center is therefore allowed to sit
      // slightly past the card edge (overhang is negative), so an icon parked mostly
      // off-card during editing is NOT pulled deeper inward on save. Icons are square in
      // px, so the half-size is BASE_ICON_FRAC·scale/2 in width fractions; the y axis uses
      // the same physical half-size expressed in height fractions via CARD_ASPECT.
      const halfW = (BASE_ICON_FRAC * scale) / 2;
      const halfH = halfW * CARD_ASPECT;
      const overhang = 2 * MIN_ON_CARD_FRAC - 1; // how far the center may pass an edge
      return {
        iconId,
        x: clamp(raw.x, overhang * halfW, 1 - overhang * halfW),
        y: clamp(raw.y, overhang * halfH, 1 - overhang * halfH),
        scale,
        rotation: raw.rotation,
        z: raw.z,
        // Optional horizontal-mirror flag; coerced to a real boolean (omitted when false
        // so unmirrored items stay clean in the jsonb).
        ...(raw.flipX === true ? { flipX: true } : {}),
        // Optional lock flag (icon ignores canvas translate/resize/rotate gestures);
        // coerced + omitted when false so unlocked items stay clean in the jsonb.
        ...(raw.locked === true ? { locked: true } : {}),
      };
    });

    // Renumber z to a canonical 0..n-1 by ascending original z (stable for ties).
    items
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => a.item.z - b.item.z || a.idx - b.idx)
      .forEach((entry, rank) => { entry.item.z = rank; });

    return items;
  }

  /**
   * Delete a vocabulary entry
   */
  async deleteEntry(userId: string, entryId: number, language: string): Promise<boolean> {
    const existingEntry = await this.vocabEntryDAL.findByIdAndLanguage(entryId, language);
    if (!existingEntry) {
      throw new NotFoundError('Vocabulary entry not found');
    }

    if (existingEntry.userId !== userId) {
      throw new ValidationError('You can only delete your own vocabulary entries');
    }

    // Clean up orphaned StarterPackSorts row if one exists
    try {
      const client = await db.getClient();
      try {
        await client.query(`
          DELETE FROM StarterPackSorts sps
          USING dictionaryentries_zh de
          WHERE sps."dictionaryEntryId" = de.id
            AND de.word1 = $1
            AND sps."userId" = $2
        `, [existingEntry.entryKey, userId]);
      } finally {
        client.release();
      }
    } catch (e) {
      console.warn('Failed to clean up StarterPackSorts for entry', entryId, e);
    }

    return await this.vocabEntryDAL.delete(entryId);
  }

  /**
   * Get vocabulary entry by ID with ownership check
   */
  async getEntry(userId: string, entryId: number, language: string): Promise<VocabEntry> {
    const entry = await this.vocabEntryDAL.findByIdAndLanguage(entryId, language);
    if (!entry) {
      throw new NotFoundError('Vocabulary entry not found');
    }

    if (entry.userId !== userId) {
      console.log(entry.userId,userId)
      throw new ValidationError('You can only access your own vocabulary entries');
    }

    // Enrich with computed example sentences and synonym metadata.
    // The entry carries its own language, so use it for every dictionary lookup.
    const [withExampleMeta] = await this.dictionaryService.enrichExampleSentencesMetadataBatch([entry], entry.language);
    const [withLongDefMeta] = await this.dictionaryService.enrichLongDefinitionMetadataBatch([withExampleMeta], entry.language);
    const [enriched] = await this.dictionaryService.enrichEntriesWithSynonymMetadata([withLongDefMeta], entry.language);

    // Enrich with related words (library words sharing characters, zh only)
    const relatedWords = await this.vocabEntryDAL.findRelatedBySharedCharacters(
      userId,
      enriched.entryKey,
      enriched.language,
      4
    );
    return { ...enriched, relatedWords };
  }

  /**
   * Get all vocabulary entries for a user with pagination
   * Filters by user's preferred language
   */
  async getUserEntries(userId: string, limit: number = 100, offset: number = 0): Promise<{
    entries: VocabEntry[];
    total: number;
    hasMore: boolean;
  }> {
    // Verify user exists and get their preferred language
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Use user's selected language or default to Chinese
    const language = user.selectedLanguage || 'zh';
    
    const [entries, total] = await Promise.all([
      this.vocabEntryDAL.findByUserIdAndLanguage(userId, language, limit, offset),
      this.vocabEntryDAL.countByUserIdAndLanguage(userId, language)
    ]);

    // Enrich with computed example sentences and synonym metadata
    const withExampleMeta = await this.dictionaryService.enrichExampleSentencesMetadataBatch(entries, language);
    const withLongDefMeta = await this.dictionaryService.enrichLongDefinitionMetadataBatch(withExampleMeta, language);
    const enrichedEntries = await this.dictionaryService.enrichEntriesWithSynonymMetadata(withLongDefMeta, language);

    return {
      entries: enrichedEntries,
      total,
      hasMore: offset + entries.length < total
    };
  }

  /**
   * Search vocabulary entries
   */
  async searchEntries(userId: string, searchTerm: string, language: Language, limit: number = 50): Promise<VocabEntry[]> {
    if (!searchTerm || searchTerm.trim().length === 0) {
      throw new ValidationError('Search term is required');
    }

    // Business rule: minimum search term length
    if (searchTerm.trim().length < 2) {
      throw new ValidationError('Search term must be at least 2 characters long');
    }

    const results = await this.vocabEntryDAL.searchEntries(userId, searchTerm.trim(), language, limit);
    const withExampleMeta = await this.dictionaryService.enrichExampleSentencesMetadataBatch(results, language);
    const withLongDefMeta = await this.dictionaryService.enrichLongDefinitionMetadataBatch(withExampleMeta, language);
    return await this.dictionaryService.enrichEntriesWithSynonymMetadata(withLongDefMeta, language);
  }

  /**
   * Get entries by HSK level. HSK is a Chinese-only concept, so this path is
   * hard-pinned to zh end to end.
   */
  async getEntriesByDifficultyLevel(userId: string, difficulty: DifficultyLevel): Promise<VocabEntry[]> {
    const entries = await this.vocabEntryDAL.findByDifficultyLevel(userId, difficulty);
    const withExampleMeta = await this.dictionaryService.enrichExampleSentencesMetadataBatch(entries, 'zh');
    const withLongDefMeta = await this.dictionaryService.enrichLongDefinitionMetadataBatch(withExampleMeta, 'zh');
    return await this.dictionaryService.enrichEntriesWithSynonymMetadata(withLongDefMeta, 'zh');
  }


  /**
   * Import vocabulary entries from CSV buffer
   */
  async importFromCSV(userId: string, csvBuffer: Buffer): Promise<ImportResult> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Parse CSV data
    const csvData = csvBuffer.toString('utf-8');
    const entries = await this.parseCSVData(csvData);
    
    if (entries.length === 0) {
      return {
        success: false,
        results: {
          total: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: []
        },
        message: 'No valid entries found in CSV file'
      };
    }
    
    // Convert CSV entries to VocabEntryCreateData
    // Use user's selected language or default to Chinese
    const language = user.selectedLanguage || 'zh';
    
    // NOTE: CSV `back` field (the user's own translation) is intentionally
    // discarded — definitions now come from det at read time.
    const vocabEntries: VocabEntryCreateData[] = entries.map(entry => ({
      userId,
      entryKey: entry.front.trim(),
      language,
      difficulty: null // Business rule: CSV imports don't have HSK levels by default
    }));
    
    // Perform bulk upsert with progress tracking
    const results = await this.vocabEntryDAL.bulkUpsertWithProgress(
      vocabEntries,
      (processed, total) => {
        console.log(`CSV Import Progress: ${processed}/${total} (${Math.round(processed/total*100)}%)`);
      }
    );
    
    const message = `Import completed. ${results.inserted} entries imported, ${results.updated} entries updated, ${results.errors.length} errors.`;
    
    return {
      success: results.errors.length < results.total / 2, // Success if less than 50% errors
      results,
      message
    };
  }

  /**
   * Import vocabulary entries from CSV stream (for large files)
   */
  async importFromCSVStream(userId: string, csvStream: Readable): Promise<ImportResult> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    return new Promise((resolve, reject) => {
      const entries: CSVRow[] = [];
      let rowCount = 0;
      
      csvStream
        .pipe(csv({
          mapHeaders: ({ header }) => header.trim().toLowerCase(),
          skipEmptyLines: true,
          skipLinesWithError: true
        }))
        .on('data', (row: any) => {
          rowCount++;
          
          try {
            const csvRow = this.validateCSVRow(row, rowCount);
            entries.push(csvRow);
          } catch (error: any) {
            console.warn(`Skipping row ${rowCount}: ${error.message}`);
          }
        })
        .on('end', async () => {
          try {
            if (entries.length === 0) {
              resolve({
                success: false,
                results: {
                  total: 0,
                  inserted: 0,
                  updated: 0,
                  skipped: 0,
                  errors: []
                },
                message: 'No valid entries found in CSV file'
              });
              return;
            }
            
            // Convert to VocabEntryCreateData
            // Use user's selected language or default to Chinese
            const language = user.selectedLanguage || 'zh';
            
            const vocabEntries: VocabEntryCreateData[] = entries.map(entry => ({
              userId,
              entryKey: entry.front.trim(),
              language,
              difficulty: null
            }));
            
            // Perform bulk upsert
            const results = await this.vocabEntryDAL.bulkUpsertWithProgress(vocabEntries);
            
            const message = `Stream import completed. ${results.inserted} entries imported, ${results.updated} entries updated, ${results.errors.length} errors.`;
            
            resolve({
              success: results.errors.length < results.total / 2,
              results,
              message
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(new ValidationError(`CSV parsing error: ${error.message}`));
        });
    });
  }

  /**
   * Get recent entries for a user
   */
  async getRecentEntries(userId: string, language: Language, days: number = 7): Promise<VocabEntry[]> {
    const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const entries = await this.vocabEntryDAL.findEntriesCreatedAfter(userId, date, language);
    const withLongDefMeta = await this.dictionaryService.enrichLongDefinitionMetadataBatch(entries, language);
    return await this.dictionaryService.enrichEntriesWithSynonymMetadata(withLongDefMeta, language);
  }

  /**
   * Get vocabulary entries by tokens for reader feature
   */
  async getEntriesByTokens(userId: string, tokens: string[], language: Language): Promise<VocabEntry[]> {
    const serviceStart = performance.now();
    
    console.log(`[VOCAB-SERVICE] 🔄 Processing token lookup request:`, {
      userId: `${userId.substring(0, 8)}...`,
      tokensReceived: tokens?.length || 0,
      timestamp: new Date().toISOString()
    });

    // Verify user exists
    const userValidationStart = performance.now();
    const user = await this.userDAL.findById(userId);
    const userValidationTime = performance.now() - userValidationStart;
    
    if (!user) {
      console.error(`[VOCAB-SERVICE] ❌ User validation failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        error: 'User not found',
        validationTime: `${userValidationTime.toFixed(2)}ms`
      });
      throw new NotFoundError('User not found');
    }

    console.log(`[VOCAB-SERVICE] ✅ User validation passed:`, {
      userId: `${userId.substring(0, 8)}...`,
      userName: user.name,
      validationTime: `${userValidationTime.toFixed(2)}ms`
    });

    // Business validation
    if (!tokens || tokens.length === 0) {
      console.log(`[VOCAB-SERVICE] 📝 Empty token array received:`, {
        userId: `${userId.substring(0, 8)}...`,
        response: 'returning empty array',
        serviceTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
      });
      return [];
    }

    console.log(`[VOCAB-SERVICE] 🔍 Starting token validation and cleanup:`, {
      userId: `${userId.substring(0, 8)}...`,
      rawTokenCount: tokens.length,
      sampleRawTokens: tokens.slice(0, 10)
    });

    // Remove duplicates and filter out empty tokens
    const uniqueTokens = [...new Set(tokens.filter(token => token && token.trim().length > 0))];
    
    const duplicatesRemoved = tokens.length - uniqueTokens.length;
    const emptyTokensFiltered = tokens.filter(token => !token || token.trim().length === 0).length;

    console.log(`[VOCAB-SERVICE] 🧹 Token cleanup completed:`, {
      userId: `${userId.substring(0, 8)}...`,
      originalCount: tokens.length,
      uniqueCount: uniqueTokens.length,
      duplicatesRemoved: duplicatesRemoved,
      emptyTokensFiltered: emptyTokensFiltered,
      cleanupEfficiency: `${((uniqueTokens.length / tokens.length) * 100).toFixed(1)}%`,
      cleanedTokens: uniqueTokens.slice(0, 15) // Show first 15 cleaned tokens
    });
    
    if (uniqueTokens.length === 0) {
      console.log(`[VOCAB-SERVICE] 📝 No valid tokens after cleanup:`, {
        userId: `${userId.substring(0, 8)}...`,
        reason: 'All tokens were empty or invalid',
        serviceTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
      });
      return [];
    }

    // Business rule: limit token count to prevent abuse
    if (uniqueTokens.length > 1000) {
      console.error(`[VOCAB-SERVICE] ❌ Token limit validation failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        tokenCount: uniqueTokens.length,
        maxAllowed: 1000,
        serviceTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
      });
      throw new ValidationError('Too many tokens requested (maximum 1000)');
    }

    // Business rule: validate token length
    const invalidTokens = uniqueTokens.filter(token => token.length > 100);
    if (invalidTokens.length > 0) {
      console.error(`[VOCAB-SERVICE] ❌ Token length validation failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        invalidTokenCount: invalidTokens.length,
        maxLength: 100,
        invalidTokens: invalidTokens.slice(0, 5), // Show first 5 invalid tokens
        serviceTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
      });
      throw new ValidationError('Some tokens are too long (maximum 100 characters per token)');
    }

    console.log(`[VOCAB-SERVICE] ✅ All validations passed, forwarding to DAL:`, {
      userId: `${userId.substring(0, 8)}...`,
      validatedTokens: uniqueTokens.length,
      tokenLengthStats: {
        minLength: Math.min(...uniqueTokens.map(t => t.length)),
        maxLength: Math.max(...uniqueTokens.map(t => t.length)),
        avgLength: (uniqueTokens.reduce((sum, t) => sum + t.length, 0) / uniqueTokens.length).toFixed(1)
      },
      validationTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
    });

    // Get entries by tokens from DAL
    const dalStart = performance.now();
    const entries = await this.vocabEntryDAL.findByTokens(userId, uniqueTokens, language);
    const dalTime = performance.now() - dalStart;

    // Enrich with computed long-definition metadata + synonym metadata
    const withLongDefMeta = await this.dictionaryService.enrichLongDefinitionMetadataBatch(entries, language);
    const enrichedEntries = await this.dictionaryService.enrichEntriesWithSynonymMetadata(withLongDefMeta, language);
    const totalServiceTime = performance.now() - serviceStart;

    console.log(`[VOCAB-SERVICE] 📊 Service processing completed:`, {
      userId: `${userId.substring(0, 8)}...`,
      tokensProcessed: uniqueTokens.length,
      entriesFound: entries.length,
      matchRate: `${(entries.length / uniqueTokens.length * 100).toFixed(1)}%`,
      dalTime: `${dalTime.toFixed(2)}ms`,
      totalServiceTime: `${totalServiceTime.toFixed(2)}ms`,
      performance: {
        tokensPerSecond: Math.round(uniqueTokens.length / (totalServiceTime / 1000)),
        entriesPerSecond: Math.round(entries.length / (dalTime / 1000))
      },
      foundEntries: entries.map(e => ({ id: e.id, key: e.entryKey })).slice(0, 10),
      synonymEnrichment: {
        entriesWithSynonyms: enrichedEntries.filter(e => e.synonyms?.length).length,
        totalSynonymsResolved: enrichedEntries.reduce((sum, e) => sum + Object.keys(e.synonymsMetadata || {}).length, 0),
        synonymMetadataPreview: enrichedEntries
          .filter(e => e.synonymsMetadata)
          .slice(0, 5)
          .map(e => ({
            entry: e.entryKey,
            synonyms: e.synonymsMetadata
          }))
      }
    });

    return enrichedEntries;
  }

  // Private helper methods

  /**
   * Parse CSV data from string
   */
  private async parseCSVData(csvData: string): Promise<CSVRow[]> {
    return new Promise((resolve, reject) => {
      const entries: CSVRow[] = [];
      const stream = Readable.from([csvData]);
      let rowCount = 0;
      
      stream
        .pipe(csv({
          mapHeaders: ({ header }) => header.trim().toLowerCase(),
          skipEmptyLines: true,
          skipLinesWithError: true
        }))
        .on('data', (row: any) => {
          rowCount++;
          
          try {
            const csvRow = this.validateCSVRow(row, rowCount);
            entries.push(csvRow);
          } catch (error: any) {
            console.warn(`Skipping row ${rowCount}: ${error.message}`);
          }
        })
        .on('end', () => {
          resolve(entries);
        })
        .on('error', (error) => {
          reject(new ValidationError(`CSV parsing error: ${error.message}`));
        });
    });
  }

  /**
   * Validate and normalize CSV row data
   */
  private validateCSVRow(row: any, rowNumber: number): CSVRow {
    const front = row.front?.toString().trim();
    const back = row.back?.toString().trim();
    
    if (!front) {
      throw new ValidationError(`Row ${rowNumber}: 'front' field is required`);
    }
    
    if (!back) {
      throw new ValidationError(`Row ${rowNumber}: 'back' field is required`);
    }
    
    // Business rule: validate entry length
    if (front.length > 500) {
      throw new ValidationError(`Row ${rowNumber}: 'front' field is too long (max 500 characters)`);
    }
    
    if (back.length > 1000) {
      throw new ValidationError(`Row ${rowNumber}: 'back' field is too long (max 1000 characters)`);
    }
    
    return {
      front,
      back,
      hint: row.hint?.toString().trim() || '',
      publishedAt: row.publishedat?.toString().trim() || row.published_at?.toString().trim() || ''
    };
  }

  /**
   * Validate entry data for creation
   */
  private validateEntryData(data: Omit<VocabEntryCreateData, 'userId'>): void {
    if (!data.entryKey || data.entryKey.trim().length === 0) {
      throw new ValidationError('Entry key is required');
    }

    if (data.entryKey.trim().length > 500) {
      throw new ValidationError('Entry key is too long (maximum 500 characters)');
    }
  }

  /**
   * Validate entry data for updates
   */
  private validateUpdateData(data: VocabEntryUpdateData): void {
    if (!data.entryKey || data.entryKey.trim().length === 0) {
      throw new ValidationError('Entry key is required');
    }

    if (data.entryKey.trim().length > 500) {
      throw new ValidationError('Entry key is too long (maximum 500 characters)');
    }
  }
}

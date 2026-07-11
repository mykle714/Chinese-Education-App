import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import {
  Language,
  Text,
  ValidationField,
  ValidationRecord,
} from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import { dbManager } from '../dal/base/DatabaseManager.js';
import { TextService } from './TextService.js';
import { composeDefinitionsBody, composeExampleSentenceBody } from '../utils/validationBodyFormat.js';

/**
 * Validation Service — business logic for the human-in-the-loop data-validation
 * feature (docs/DATA_VALIDATION_SYSTEM.md).
 *
 * LAYER: service layer. A "validator" user (users.isValidator) reviews ONE field of
 * ONE discoverable entry and Approves or Flags it, via either of two paths:
 *   - the Reader document queue (composeValidationDoc + submitValidation) — download
 *     a doc, read its pretty-printed body, act on it later; or
 *   - the inline path (submitEntryValidation) — Approve/Flag buttons rendered right
 *     next to the entry's example sentence / long definition wherever a validator is
 *     already looking at it, no document involved.
 * There is no editing in either path: Approve always composes/copies the CURRENT
 * data server-side (never trusts client content), and Flag records only the flag
 * with no content. Records are written to the dedicated `validations` table — NOT to
 * the det tables — because dictionaryentries_{zh,es} are TRUNCATE+restored on every
 * prod data deploy, which would wipe a review column. `validations` is keyed by the
 * det row id (stable across data deploys) + language, so it survives deploys and
 * drives the backfill guard. Each (user, entry, field) may be recorded at most once
 * (enforced by the `validations_unique_per_user` constraint) — shared by both paths.
 *
 * Depends on: TextService.createText (persists the text's validation* linkage),
 * validationBodyFormat (shared pretty-text composer, also used by DictionaryDAL's
 * approval-freshness check), migration 104/106.
 */

// The two det tables carry the same relevant columns; the table name is derived
// from the (validated) language, never from raw input, so it is safe to inline.
const TABLE_BY_LANGUAGE: Record<Language, string> = {
  zh: 'dictionaryentries_zh',
  es: 'dictionaryentries_es',
};

// Human-readable subtitle for each validation field, used as the document description.
const FIELD_LABEL: Record<ValidationField, string> = {
  definitions: 'Definitions & Parts of Speech',
  exampleSentence0: 'Example Sentence 1',
  exampleSentence1: 'Example Sentence 2',
  exampleSentence2: 'Example Sentence 3',
};

// Minimal shape of a det row we read while composing a validation document.
interface DetFieldRow {
  id: number;
  word1: string;
  pronunciation: string | null;
  partsOfSpeech: string[] | null;
  definitions: string[] | null;
  longDefinition: string | null;
  exampleSentences: Array<{ foreignText?: unknown; english?: unknown }> | null;
}

export class ValidationService {
  constructor(
    private userDAL: IUserDAL,
    private textService: TextService
  ) {}

  /**
   * Compose and persist a validation document for the given validator.
   *
   * Picks one eligible (entry, field) in the validator's language — discoverable,
   * with the field populated, and NOT already in `validations` for this user+field —
   * composes a pretty-printed body, and stores it as a validation Text (with the
   * validation* linkage columns set). Returns the created Text.
   *
   * @throws ValidationError if the user is not a validator.
   * @throws NotFoundError   if no eligible entry/field remains for this user.
   */
  async composeValidationDoc(userId: string, language: Language): Promise<Text> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isValidator) {
      throw new ValidationError('Only validators can download entries to validate');
    }

    const table = this.tableFor(language);

    // Pick an eligible (entry, field). Each discoverable entry expands into up to
    // four candidate fields; keep only populated ones this user has not yet
    // validated (checked against the `validations` table, joined by entry id +
    // language), preferring the least-validated field (random tiebreak).
    const pick = await dbManager.executeQuery<{ id: number; field: ValidationField }>(
      async (client) =>
        client.query(
          `WITH candidates AS (
             SELECT d.id, f.field,
                    (SELECT count(*) FROM validations val
                       WHERE val."entryId" = d.id AND val.language = $2 AND val.field = f.field) AS n_val
             FROM ${table} d
             CROSS JOIN LATERAL (VALUES
               ('definitions',      d."partsOfSpeech" IS NOT NULL AND jsonb_array_length(d.definitions) > 0 AND d."longDefinition" IS NOT NULL),
               ('exampleSentence0', jsonb_array_length(d."exampleSentences") > 0),
               ('exampleSentence1', jsonb_array_length(d."exampleSentences") > 1),
               ('exampleSentence2', jsonb_array_length(d."exampleSentences") > 2)
             ) AS f(field, populated)
             WHERE d.discoverable = TRUE
               AND f.populated
               AND NOT EXISTS (
                 SELECT 1 FROM validations val
                  WHERE val."entryId" = d.id AND val.language = $2
                    AND val.field = f.field AND val."validatorUserId" = $1
               )
           )
           SELECT id, field FROM candidates
           ORDER BY n_val ASC, random()
           LIMIT 1`,
          [userId, language]
        )
    );

    if (pick.recordset.length === 0) {
      throw new NotFoundError('No entries left for you to validate right now');
    }
    const { id: entryId, field } = pick.recordset[0];

    // Load the entry columns needed to compose the body.
    const entry = await this.getDetFieldRow(table, entryId);
    if (!entry) throw new NotFoundError('Entry disappeared while composing document');

    // Compose the pretty-printed, read-only body + document metadata.
    const content = this.composeBody(entry, field);
    // Title carries the word and, when present, its pronunciation (pinyin for zh):
    // "Validate - 方言 - fāng yán". pronunciation may be NULL (e.g. some es rows).
    const pinyin = entry.pronunciation?.trim();
    const title = pinyin ? `Validate - ${entry.word1} - ${pinyin}` : `Validate - ${entry.word1}`;
    const description = FIELD_LABEL[field];

    // Persist as a validation document (TextService sets the validation* columns).
    return this.textService.createText(userId, {
      title,
      description,
      content,
      language,
      validationEntryId: entryId,
      validationLanguage: language,
      validationField: field,
    });
  }

  /**
   * Record an approval or flag for a validation document.
   *
   * Verifies ownership + validator status, then inserts one row into `validations`.
   * Approve copies the document's content verbatim — it's exactly what the
   * validator was shown, so there is nothing to re-parse or re-validate. Flag
   * records no content, just the flag. The unique constraint enforces the
   * one-record-per (user, entry, field) rule: a duplicate submit is rejected.
   *
   * @throws ValidationError if not a validator, not a validation doc, or already recorded.
   */
  async submitValidation(
    userId: string,
    textId: string,
    action: 'approve' | 'flag'
  ): Promise<ValidationRecord> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isValidator) {
      throw new ValidationError('Only validators can submit validations');
    }

    const text = await this.textService.getTextById(textId);
    if (!text) throw new NotFoundError('Document not found');
    if (text.userId !== userId) {
      throw new ValidationError('You can only validate your own documents');
    }
    if (!text.validationEntryId || !text.validationLanguage || !text.validationField) {
      throw new ValidationError('This document is not a validation document');
    }

    // Approve copies exactly what was shown to the reader; flag stores nothing.
    const content = action === 'approve' ? text.content : null;

    // Insert; the unique constraint (entryId, language, field, validatorUserId)
    // makes a duplicate submit a no-op via ON CONFLICT — we detect that and 400.
    const result = await dbManager.executeQuery<ValidationRecord>(async (client) =>
      client.query(
        `INSERT INTO validations
           ("entryId", language, field, "validatorUserId", "validatorName", action, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT validations_unique_per_user DO NOTHING
         RETURNING id, "entryId", language, field, "validatorUserId", "validatorName", action, content, "createdAt"`,
        [text.validationEntryId, text.validationLanguage, text.validationField, userId, user.name, action, content]
      )
    );

    if (result.recordset.length === 0) {
      throw new ValidationError('You have already validated this field for this entry');
    }

    // Once a submission is accepted the review is complete and the (entry, field)
    // can never be handed to this user again (unique constraint), so the throwaway
    // validation document has no further purpose — auto-delete it from the
    // validator's account for BOTH actions.
    await this.textService.deleteText(userId, textId);

    console.log(`[VALIDATION-SERVICE] ✅ Recorded ${action} (doc auto-deleted):`, {
      userId: `${userId.substring(0, 8)}...`,
      entryId: text.validationEntryId,
      language: text.validationLanguage,
      field: text.validationField,
    });

    return result.recordset[0];
  }

  /**
   * Record an approval or flag directly against a dictionary entry's field, with no
   * downloaded Reader document involved — the inline Approve/Flag buttons rendered
   * next to an example sentence / long definition wherever a validator is already
   * looking at the entry (est, definition display). Looks up the det row fresh by
   * (word1, language) so the client never needs to know the det surrogate id, then
   * approves with a freshly-composed body (never the client's) or flags with none.
   *
   * @throws ValidationError if not a validator, the field isn't populated, or already recorded.
   * @throws NotFoundError   if no discoverable entry matches (word1, language).
   */
  async submitEntryValidation(
    userId: string,
    word1: string,
    language: Language,
    field: ValidationField,
    action: 'approve' | 'flag'
  ): Promise<ValidationRecord> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isValidator) {
      throw new ValidationError('Only validators can submit validations');
    }

    const table = this.tableFor(language);
    const result = await dbManager.executeQuery<DetFieldRow>(async (client) =>
      client.query(
        `SELECT id, word1, pronunciation, "partsOfSpeech", definitions, "longDefinition", "exampleSentences"
           FROM ${table} WHERE word1 = $1 AND language = $2 AND discoverable = TRUE`,
        [word1, language]
      )
    );
    const entry = result.recordset[0];
    if (!entry) throw new NotFoundError('Entry not found');
    if (!this.isFieldPopulated(entry, field)) {
      throw new ValidationError('This field has no data to validate');
    }

    // Approve composes fresh from the CURRENT det row (never trusts client content);
    // flag stores nothing.
    const content = action === 'approve' ? this.composeBody(entry, field) : null;

    const insertResult = await dbManager.executeQuery<ValidationRecord>(async (client) =>
      client.query(
        `INSERT INTO validations
           ("entryId", language, field, "validatorUserId", "validatorName", action, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT validations_unique_per_user DO NOTHING
         RETURNING id, "entryId", language, field, "validatorUserId", "validatorName", action, content, "createdAt"`,
        [entry.id, language, field, userId, user.name, action, content]
      )
    );

    if (insertResult.recordset.length === 0) {
      throw new ValidationError('You have already validated this field for this entry');
    }

    console.log(`[VALIDATION-SERVICE] ✅ Recorded inline ${action}:`, {
      userId: `${userId.substring(0, 8)}...`,
      entryId: entry.id,
      language,
      field,
    });

    return insertResult.recordset[0];
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private tableFor(language: Language): string {
    const table = TABLE_BY_LANGUAGE[language];
    if (!table) throw new ValidationError(`Unsupported validation language: ${language}`);
    return table;
  }

  private async getDetFieldRow(table: string, entryId: number): Promise<DetFieldRow | null> {
    const result = await dbManager.executeQuery<DetFieldRow>(async (client) =>
      client.query(
        `SELECT id, word1, pronunciation, "partsOfSpeech", definitions, "longDefinition", "exampleSentences"
           FROM ${table} WHERE id = $1`,
        [entryId]
      )
    );
    return result.recordset[0] || null;
  }

  /**
   * Pretty-print the target field's current data for display — the exact text a
   * validator reads, and (unchanged) exactly what Approve copies into
   * `validations.content`. Delegates to the shared formatters in
   * validationBodyFormat so DictionaryDAL's approval-freshness check can rebuild
   * this same string from the current det row and compare byte-for-byte.
   */
  private composeBody(entry: DetFieldRow, field: ValidationField): string {
    if (field === 'definitions') {
      return composeDefinitionsBody({
        partsOfSpeech: entry.partsOfSpeech,
        definitions: entry.definitions,
        longDefinition: entry.longDefinition,
      });
    }

    const index = Number(field.slice('exampleSentence'.length));
    const sentence = (entry.exampleSentences || [])[index] ?? null;
    return composeExampleSentenceBody(
      sentence ? { foreignText: sentence.foreignText, english: sentence.english } : null
    );
  }

  /** Mirrors composeValidationDoc's SQL eligibility check, applied to an already-loaded row. */
  private isFieldPopulated(entry: DetFieldRow, field: ValidationField): boolean {
    if (field === 'definitions') {
      return !!entry.partsOfSpeech?.length && !!entry.definitions?.length && !!entry.longDefinition;
    }
    const index = Number(field.slice('exampleSentence'.length));
    return (entry.exampleSentences?.length ?? 0) > index;
  }
}

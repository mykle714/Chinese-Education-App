import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import {
  Language,
  Text,
  ValidationField,
  ValidationRecord,
} from '../types/index.js';
import { ValidationError, NotFoundError, ValidationFormatError } from '../types/dal.js';
import { dbManager } from '../dal/base/DatabaseManager.js';
import { sanitizeDocumentContent } from '../utils/sanitizeContent.js';
import { TextService } from './TextService.js';

/**
 * Validation Service — business logic for the human-in-the-loop data-validation
 * feature (docs/DATA_VALIDATION_SYSTEM.md).
 *
 * LAYER: service layer. A "validator" user (users.isValidator) downloads an
 * auto-composed Reader document for ONE field of ONE discoverable entry, then
 * Approves it or Flags it with an edited suggestion. Records are written to the
 * dedicated `validations` table — NOT to the det tables — because
 * dictionaryentries_{zh,es} are TRUNCATE+restored on every prod data deploy, which
 * would wipe a review column. `validations` is keyed by the det row id (stable
 * across data deploys) + language, so it survives deploys and drives the backfill
 * guard. Each (user, entry, field) may be recorded at most once (enforced by the
 * `validations_unique_per_user` constraint).
 *
 * `content` is stored for BOTH actions: for 'approve' it is the exact data version
 * approved; for 'flag' it is the validator's suggested edit.
 *
 * Depends on: TextService.createText (persists the text's validation* linkage),
 * sanitizeDocumentContent, migration 104.
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

// User-facing message when a submission broke the fixed document format. The Reader
// surfaces this verbatim (severity=error) and tells the validator to Revert.
const FORMAT_CHANGED_MESSAGE =
  'The document format was changed. Only the JSON values may be edited (field/key names must stay the same) — please Revert and start over.';

// Minimal shape of a det row we read while composing a validation document.
// The field values are dumped verbatim as raw JSON into the document body, so they
// are typed as `unknown` — we never inspect their internal shape here.
interface DetFieldRow {
  id: number;
  word1: string;
  pronunciation: string | null;
  partsOfSpeech: unknown;
  definitions: unknown;
  longDefinition: unknown;
  exampleSentences: unknown[] | null;
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
   * composes an editable body, and stores it as a validation Text (with the
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

    // Compose the editable body + document metadata.
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
      validationOriginalContent: content,
    });
  }

  /**
   * Record an approval or flag for a validation document.
   *
   * Verifies ownership + validator status, then inserts one row into `validations`.
   * `content` (the reviewed body — the approved version, or the suggested edit) is
   * stored for BOTH actions and sanitized. The unique constraint enforces the
   * one-record-per (user, entry, field) rule: a duplicate submit is rejected.
   *
   * @throws ValidationError if not a validator, not a validation doc, or already recorded.
   */
  async submitValidation(
    userId: string,
    textId: string,
    action: 'approve' | 'flag',
    content: string
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

    const language = text.validationLanguage;
    const entryId = text.validationEntryId;
    const field = text.validationField;
    const safeContent = sanitizeDocumentContent(content);

    // Format + shape guard: the submitted body must still parse into exactly the
    // composed `<fieldName>:\n<JSON>` blocks (valid JSON per block) AND preserve each
    // block's JSON key shape vs the composed original — i.e. the validator changed
    // only JSON VALUES, not the surrounding format and not any key name (a renamed
    // key stays valid JSON but would no longer be recognized here). Any violation is
    // rejected with a distinct code so the Reader can tell them to Revert. Run for
    // both actions: an approval's unedited body always passes.
    this.assertOnlyJsonValuesEdited(safeContent, text.validationOriginalContent ?? '', field);

    // Insert; the unique constraint (entryId, language, field, validatorUserId)
    // makes a duplicate submit a no-op via ON CONFLICT — we detect that and 400.
    const result = await dbManager.executeQuery<ValidationRecord>(async (client) =>
      client.query(
        `INSERT INTO validations
           ("entryId", language, field, "validatorUserId", "validatorName", action, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT validations_unique_per_user DO NOTHING
         RETURNING id, "entryId", language, field, "validatorUserId", "validatorName", action, content, "createdAt"`,
        [entryId, language, field, userId, user.name, action, safeContent]
      )
    );

    if (result.recordset.length === 0) {
      throw new ValidationError('You have already validated this field for this entry');
    }

    // Once a submission is accepted the review is complete and the (entry, field)
    // can never be handed to this user again (unique constraint), so the throwaway
    // validation document has no further purpose — auto-delete it from the
    // validator's account for BOTH actions. The suggestion/approved content is
    // already captured verbatim in the `validations` row (not FK-linked to texts),
    // so deleting the doc loses nothing.
    await this.textService.deleteText(userId, textId);

    console.log(`[VALIDATION-SERVICE] ✅ Recorded ${action} (doc auto-deleted):`, {
      userId: `${userId.substring(0, 8)}...`,
      entryId,
      language,
      field,
    });

    return result.recordset[0];
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
   * Serialize the target field's RAW stored value(s) into the document body — no
   * prose/formatting. Each underlying det field is written as
   *   `<fieldName>:\n<raw JSON value>`
   * with a blank line between fields. This is the exact string stored as
   * `validationOriginalContent`, so the client's Approve-vs-Flag diff and Revert
   * compare against it byte-for-byte. On submit, this text (approval) or the edited
   * version (flag) is stored verbatim in validations.content; it is never reparsed.
   */
  private composeBody(entry: DetFieldRow, field: ValidationField): string {
    if (field === 'definitions') {
      // The definitions bundle spans three det columns — dump each raw.
      return [
        this.rawField('partsOfSpeech', entry.partsOfSpeech),
        this.rawField('definitions', entry.definitions),
        this.rawField('longDefinition', entry.longDefinition),
      ].join('\n\n');
    }

    // exampleSentenceN — only the two human-reviewable fields of the sentence at
    // index N (foreignText + english), NOT the full stored object (which also holds
    // tense/numberDict/segmentGloss/… machine metadata a validator should not edit).
    const index = Number(field.slice('exampleSentence'.length));
    const sentence = (entry.exampleSentences || [])[index] as
      | { foreignText?: unknown; english?: unknown }
      | null
      | undefined;
    const reviewable = sentence
      ? { foreignText: sentence.foreignText ?? null, english: sentence.english ?? null }
      : null;
    return this.rawField(field, reviewable);
  }

  /** `<fieldName>:\n<raw JSON value>` — pretty-printed so nested objects stay editable. */
  private rawField(fieldName: string, value: unknown): string {
    return `${fieldName}:\n${JSON.stringify(value ?? null, null, 2)}`;
  }

  /**
   * The ordered block field-names that `composeBody` emits for a given validation
   * field — the single source of truth shared by the composer and the submit-time
   * format guard. `definitions` is a three-column bundle; an example sentence is a
   * single block named after the field.
   */
  private expectedBlockFields(field: ValidationField): string[] {
    return field === 'definitions'
      ? ['partsOfSpeech', 'definitions', 'longDefinition']
      : [field];
  }

  /**
   * Split a validation body into a `{ fieldName -> parsed JSON }` map, or `null` if
   * the block structure is wrong (missing/renamed/reordered/duplicated header, stray
   * text) or any block isn't valid JSON.
   *
   * Split strategy: a header line, trimmed, is exactly `<fieldName>:`. Pretty-printed
   * JSON lines are always quoted strings or bracket/brace tokens, so a data line can
   * never trim to a bare `<fieldName>:` — the split is unambiguous.
   */
  private parseValidationBlocks(content: string, field: ValidationField): Record<string, unknown> | null {
    const expected = this.expectedBlockFields(field);
    const headers = new Set(expected.map((name) => `${name}:`));

    const lines = content.replace(/\r\n?/g, '\n').split('\n');
    const blocks: { name: string; body: string[] }[] = [];
    let current: { name: string; body: string[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (headers.has(trimmed)) {
        current = { name: trimmed.slice(0, -1), body: [] };
        blocks.push(current);
      } else if (current) {
        current.body.push(line);
      } else if (trimmed !== '') {
        // Non-whitespace content before the first header ⇒ format changed.
        return null;
      }
    }

    // Exactly the expected headers, in the expected order.
    if (
      blocks.length !== expected.length ||
      blocks.some((block, i) => block.name !== expected[i])
    ) {
      return null;
    }

    const parsed: Record<string, unknown> = {};
    for (const block of blocks) {
      try {
        parsed[block.name] = JSON.parse(block.body.join('\n').trim());
      } catch {
        return null;
      }
    }
    return parsed;
  }

  /**
   * Structural shape comparison of two parsed JSON values. Object KEY names/sets must
   * be identical at every level and container types must match; only primitive leaf
   * VALUES may differ, and array LENGTHS may differ (element editing). This is what
   * catches a renamed key that stays valid JSON but the server would not recognize.
   */
  private sameJsonShape(a: unknown, b: unknown): boolean {
    const kind = (v: unknown): 'array' | 'object' | 'primitive' =>
      Array.isArray(v) ? 'array' : v !== null && typeof v === 'object' ? 'object' : 'primitive';

    const ka = kind(a);
    if (ka !== kind(b)) return false;

    if (ka === 'object') {
      const ao = a as Record<string, unknown>;
      const bo = b as Record<string, unknown>;
      const keysA = Object.keys(ao).sort();
      const keysB = Object.keys(bo).sort();
      if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
      return keysA.every((k) => this.sameJsonShape(ao[k], bo[k]));
    }

    if (ka === 'array') {
      // Lengths may differ; enforce a single homogeneous element shape (our arrays are
      // string[]), so a retyped/renamed element inside an array is still caught.
      const all = [...(a as unknown[]), ...(b as unknown[])];
      if (all.length <= 1) return true;
      return all.every((el) => this.sameJsonShape(all[0], el));
    }

    return true; // primitives: leaf value may differ
  }

  /**
   * Enforce that a submitted body only edited JSON VALUES — not the document format
   * and not any JSON KEY. Rejects with ValidationFormatError (the client tells the
   * validator to Revert and start over) when:
   *   (a) the body no longer splits into the composed `<fieldName>:\n<JSON>` blocks or
   *       a block isn't valid JSON, OR
   *   (b) a block's JSON key shape diverges from the server-composed `original`
   *       (a renamed/added/removed object key) — checked against `validationOriginalContent`.
   */
  private assertOnlyJsonValuesEdited(content: string, original: string, field: ValidationField): void {
    const submitted = this.parseValidationBlocks(content, field);
    if (!submitted) {
      throw new ValidationFormatError(FORMAT_CHANGED_MESSAGE);
    }

    // Compare JSON key shape against the composed original. The original always parses
    // (we composed it); if it somehow doesn't, we only enforce the structural check above.
    const base = this.parseValidationBlocks(original, field);
    if (base) {
      for (const name of this.expectedBlockFields(field)) {
        if (!this.sameJsonShape(base[name], submitted[name])) {
          throw new ValidationFormatError(FORMAT_CHANGED_MESSAGE);
        }
      }
    }
  }
}

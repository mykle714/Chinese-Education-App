import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import {
  DefinitionCluster,
  Language,
  ValidationField,
  ValidationRecord,
  isPerSenseValidationField,
} from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import { dbManager } from '../dal/base/DatabaseManager.js';
import {
  composeDefinitionsBody,
  composeDifficultyBody,
  composeExampleSentenceBody,
  composeFrequencyScoreBody,
  composePartsOfSpeechBody,
  composeSenseFrequencyScoreBody,
} from '../utils/validationBodyFormat.js';
import { longDefToDisplayString, resolveDefaultPronunciation, type LongDefinitionValue } from '../utils/definitions.js';

/**
 * Validation Service — business logic for the human-in-the-loop data-validation
 * feature (docs/DATA_VALIDATION_SYSTEM.md).
 *
 * LAYER: service layer. A "validator" user (users.isValidator) reviews ONE field of
 * ONE discoverable entry and Approves or Flags it via the inline Approve/Flag buttons
 * rendered next to the entry's example sentence / long definition / meta chips
 * wherever a validator is already looking at it (submitEntryValidation). The former
 * Reader document queue (downloaded "Validate - <word1>" docs) was removed
 * 2026-11-05; `validations` rows it wrote are kept and read like any other.
 * There is no editing: Approve always composes the CURRENT data server-side (never
 * trusts client content), and Flag records only the flag with no content. Records are written to the dedicated `validations` table — NOT to
 * the det tables — because dictionaryentries_{zh,es} are TRUNCATE+restored on every
 * PPE data deploy, which would wipe a review column. `validations` is keyed by the
 * det row id (stable across data deploys) + language, so it survives deploys and
 * drives the backfill guard. Each (user, entry, field, senseLabel) has at most one
 * record (the `validations_unique_per_user` constraint); a repeat vote overwrites it. `senseLabel` (migration 139) is '' for every entry-level field and a
 * `definitionClusters[].sense` for the per-sense ones, so a validator can review each
 * sense of a polyseme independently.
 *
 * Depends on: validationBodyFormat (shared pretty-text composer, also used by DictionaryDAL's
 * approval-freshness check), migration 104/106.
 */

// The two det tables carry the same relevant columns; the table name is derived
// from the (validated) language, never from raw input, so it is safe to inline.
const TABLE_BY_LANGUAGE: Record<Language, string> = {
  zh: 'dictionaryentries_zh',
  es: 'dictionaryentries_es',
};

// Minimal shape of a det row read when composing / checking a field's review body.
interface DetFieldRow {
  id: number;
  word1: string;
  pronunciation: string | null;
  partsOfSpeech: string[] | null;
  definitions: string[] | null;
  // Raw JSONB column, NOT a string: a per-sense array for zh, a per-POS object for
  // es/legacy rows (migration 70). composeBody normalizes it via longDefToDisplayString.
  longDefinition: LongDefinitionValue | null;
  exampleSentences: Array<{ foreignText?: unknown; english?: unknown }> | null;
  difficulty: number | null;
  frequencyScore: number | null;
  // Sense clusters (migration 90 zh / 123 es). Read for the per-sense fields, whose
  // reviewable value is a cluster's OWN frequencyScore, not the entry's column.
  definitionClusters: DefinitionCluster[] | null;
}

// The columns every det-row read for validation needs (getDetFieldRowByWord1).
const DET_FIELD_COLUMNS =
  `id, word1, pronunciation, "partsOfSpeech", definitions, "longDefinition", ` +
  `"exampleSentences", difficulty, "frequencyScore", "definitionClusters"`;

export class ValidationService {
  constructor(
    private userDAL: IUserDAL
  ) {}

  /**
   * Record an approval or flag directly against a dictionary entry's field — the
   * inline Approve/Flag buttons rendered
   * next to an example sentence / long definition wherever a validator is already
   * looking at the entry (est, definition display). Looks up the det row fresh by
   * (word1, language) so the client never needs to know the det surrogate id, then
   * approves with a freshly-composed body (never the client's) or flags with none.
   *
   * This is a live control: a validator may change their mind, so a second call for the same (entry, field)
   * from the SAME validator overwrites their prior action/content in place rather
   * than being rejected (`ON CONFLICT ... DO UPDATE`). There is intentionally no
   * history of the earlier vote — see `clearEntryValidation` for un-voting entirely.
   *
   * `senseLabel` addresses ONE definitionCluster for the per-sense fields
   * (`senseFrequencyScore`, migration 139) and is ignored — stored as '' — for
   * entry-level fields, which have no sense.
   *
   * @throws ValidationError if not a validator, or the field isn't populated.
   * @throws NotFoundError   if no discoverable entry matches (word1, language).
   */
  async submitEntryValidation(
    userId: string,
    word1: string,
    language: Language,
    field: ValidationField,
    action: 'approve' | 'flag',
    senseLabel?: string | null
  ): Promise<ValidationRecord> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isValidator) {
      throw new ValidationError('Only validators can submit validations');
    }

    const entry = await this.getDetFieldRowByWord1(language, word1);
    if (!entry) throw new NotFoundError('Entry not found');
    const sense = this.normalizeSenseLabel(field, senseLabel);
    if (!this.isFieldPopulated(entry, field, sense)) {
      throw new ValidationError('This field has no data to validate');
    }

    // Approve composes fresh from the CURRENT det row (never trusts client content);
    // flag stores nothing.
    const content = action === 'approve' ? this.composeBody(entry, field, sense) : null;

    const upsertResult = await dbManager.executeQuery<ValidationRecord>(async (client) =>
      client.query(
        `INSERT INTO validations
           ("entryId", language, field, "senseLabel", "validatorUserId", "validatorName", action, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ON CONSTRAINT validations_unique_per_user
           DO UPDATE SET action = EXCLUDED.action, content = EXCLUDED.content,
                         "validatorName" = EXCLUDED."validatorName"
         RETURNING id, "entryId", language, field, "senseLabel", "validatorUserId", "validatorName", action, content, "createdAt"`,
        [entry.id, language, field, sense, userId, user.name, action, content]
      )
    );

    console.log(`[VALIDATION-SERVICE] ✅ Recorded inline ${action}:`, {
      userId: `${userId.substring(0, 8)}...`,
      entryId: entry.id,
      language,
      field,
      senseLabel: sense || undefined,
    });

    return upsertResult.recordset[0];
  }

  /**
   * Undo a validator's own inline vote on a field, leaving no signal in the DB —
   * the "press the filled icon again" affordance. Deletes only the calling
   * validator's row for (entry, field); other validators' votes are untouched.
   * A no-op (not an error) if this validator never voted.
   *
   * @throws ValidationError if not a validator.
   * @throws NotFoundError   if no discoverable entry matches (word1, language).
   */
  async clearEntryValidation(
    userId: string,
    word1: string,
    language: Language,
    field: ValidationField,
    senseLabel?: string | null
  ): Promise<void> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isValidator) {
      throw new ValidationError('Only validators can submit validations');
    }

    const entry = await this.getDetFieldRowByWord1(language, word1);
    if (!entry) throw new NotFoundError('Entry not found');

    const sense = this.normalizeSenseLabel(field, senseLabel);
    await dbManager.executeQuery(async (client) =>
      client.query(
        `DELETE FROM validations
           WHERE "entryId" = $1 AND language = $2 AND field = $3
             AND "senseLabel" = $4 AND "validatorUserId" = $5`,
        [entry.id, language, field, sense, userId]
      )
    );

    console.log(`[VALIDATION-SERVICE] ✅ Cleared inline vote:`, {
      userId: `${userId.substring(0, 8)}...`,
      entryId: entry.id,
      language,
      field,
      senseLabel: sense || undefined,
    });
  }

  /**
   * The current validator's own vote ('approve' | 'flag' | null) on a field —
   * drives which of the two inline icons (if either) renders filled on mount,
   * so the choice survives a reload instead of only living in local component
   * state. Looks up by (word1, language) same as the submit/clear paths.
   *
   * @throws ValidationError if not a validator.
   * @throws NotFoundError   if no discoverable entry matches (word1, language).
   */
  async getEntryValidationStatus(
    userId: string,
    word1: string,
    language: Language,
    field: ValidationField,
    senseLabel?: string | null
  ): Promise<'approve' | 'flag' | null> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isValidator) {
      throw new ValidationError('Only validators can view validation status');
    }

    const entry = await this.getDetFieldRowByWord1(language, word1);
    if (!entry) throw new NotFoundError('Entry not found');

    const result = await dbManager.executeQuery<{ action: 'approve' | 'flag' }>(async (client) =>
      client.query(
        `SELECT action FROM validations
           WHERE "entryId" = $1 AND language = $2 AND field = $3
             AND "senseLabel" = $4 AND "validatorUserId" = $5`,
        [entry.id, language, field, this.normalizeSenseLabel(field, senseLabel), userId]
      )
    );

    return result.recordset[0]?.action ?? null;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private tableFor(language: Language): string {
    const table = TABLE_BY_LANGUAGE[language];
    if (!table) throw new ValidationError(`Unsupported validation language: ${language}`);
    return table;
  }

  /** Shared by the inline (word1, language) paths: submit/clear/status. */
  private async getDetFieldRowByWord1(language: Language, word1: string): Promise<DetFieldRow | null> {
    const table = this.tableFor(language);
    const result = await dbManager.executeQuery<DetFieldRow>(async (client) =>
      client.query(
        `SELECT ${DET_FIELD_COLUMNS}
           FROM ${table} WHERE word1 = $1 AND language = $2 AND discoverable = TRUE`,
        [word1, language]
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
  private composeBody(entry: DetFieldRow, field: ValidationField, senseLabel = ''): string {
    if (field === 'senseFrequencyScore') {
      return composeSenseFrequencyScoreBody(
        senseLabel,
        this.findCluster(entry, senseLabel)?.frequencyScore ?? null
      );
    }
    if (field === 'definitions') {
      return composeDefinitionsBody({
        definitions: entry.definitions,
        longDefinition: entry.longDefinition,
      });
    }
    if (field === 'partsOfSpeech') return composePartsOfSpeechBody(entry.partsOfSpeech);
    if (field === 'difficulty') return composeDifficultyBody(entry.difficulty);
    if (field === 'frequencyScore') return composeFrequencyScoreBody(entry.frequencyScore);

    const index = Number(field.slice('exampleSentence'.length));
    const sentence = (entry.exampleSentences || [])[index] ?? null;
    return composeExampleSentenceBody(
      sentence ? { foreignText: sentence.foreignText, english: sentence.english } : null
    );
  }

  /**
   * Is there anything to review? The only populated-check for every field — an
   * approval of an empty field would record a review of nothing.
   */
  private isFieldPopulated(entry: DetFieldRow, field: ValidationField, senseLabel = ''): boolean {
    // A sense is reviewable only if the label still resolves to a cluster that carries
    // a score — a stale label (the entry was re-clustered since the client rendered)
    // must not be recorded as an approval of a sense that no longer exists.
    if (field === 'senseFrequencyScore') {
      return this.findCluster(entry, senseLabel)?.frequencyScore != null;
    }
    if (field === 'definitions') {
      // longDefinition is raw JSONB — an empty array/object is "present" to a truthiness
      // check but renders as nothing, so test the composed text instead.
      return !!entry.definitions?.length && !!longDefToDisplayString(entry.longDefinition);
    }
    if (field === 'partsOfSpeech') return !!entry.partsOfSpeech?.length;
    // 0 is not a valid level/score on either scale (1–6 / 1–5), so a plain null-check
    // is enough — but be explicit rather than relying on truthiness.
    if (field === 'difficulty') return entry.difficulty != null;
    if (field === 'frequencyScore') return entry.frequencyScore != null;
    const index = Number(field.slice('exampleSentence'.length));
    return (entry.exampleSentences?.length ?? 0) > index;
  }

  /**
   * The cluster a `senseLabel` addresses, or null. Labels are unique within an entry
   * by construction (docs/DEFINITION_CLUSTERS.md), so a plain find is exact — and a
   * label that matches nothing means the entry was re-clustered since the client
   * rendered it, which every caller treats as "not reviewable".
   */
  private findCluster(entry: DetFieldRow, senseLabel: string): DefinitionCluster | null {
    if (!senseLabel) return null;
    return entry.definitionClusters?.find((c) => c?.sense === senseLabel) ?? null;
  }

  /**
   * The value stored in `validations."senseLabel"` for a request: the trimmed label for
   * a per-sense field, and the empty string for every entry-level one — so a client that
   * sends a stray label on, say, `difficulty` can never fork that field's record into two
   * rows past the unique constraint. Per-sense fields REQUIRE a label; the controller
   * rejects a missing one before this, and this is the second line of defence.
   */
  private normalizeSenseLabel(field: ValidationField, senseLabel?: string | null): string {
    if (!isPerSenseValidationField(field)) return '';
    const label = (senseLabel ?? '').trim();
    if (!label) throw new ValidationError('senseLabel is required for a per-sense validation field');
    return label;
  }
}

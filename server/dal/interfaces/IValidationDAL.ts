import type { DefinitionCluster, Language, ValidationField, ValidationRecord } from '../../types/index.js';
import type { LongDefinitionValue } from '../../utils/definitions.js';

/** The det columns a validation body is composed / checked from (ValidationService.composeBody). */
export interface DetFieldRow {
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

/** Identifies one validator's vote: (entry, field, sense) by one user. */
export interface ValidationVoteKey {
  entryId: number;
  language: Language;
  field: ValidationField;
  /** '' for entry-level fields; a `definitionClusters[].sense` for per-sense ones. */
  senseLabel: string;
  validatorUserId: string;
}

/**
 * Data access for the human-in-the-loop data validation feature: the `validations` table
 * and the det row a vote is about.
 *
 * LAYER: DAL. Who may vote, whether a field is populated, and the composed approval body
 * all stay in `ValidationService`. The backfill-side readers of `validations`
 * (`validatedClause`, DictionaryDAL's approval-freshness check) are separate.
 *
 * Referenced by: docs/DATA_VALIDATION_SYSTEM.md, docs/BACKEND_LAYERING.md § 4.
 */
export interface IValidationDAL {
  /** The DISCOVERABLE det row for (word1, language), or null. */
  findDiscoverableFieldRow(language: Language, word1: string): Promise<DetFieldRow | null>;

  /**
   * Insert this validator's vote, or overwrite their earlier one in place
   * (`validations_unique_per_user`). `content` is null for a flag.
   */
  upsertVote(
    key: ValidationVoteKey,
    vote: { validatorName: string; action: 'approve' | 'flag'; content: string | null }
  ): Promise<ValidationRecord>;

  /** Delete this validator's vote; a no-op when there is none. */
  deleteVote(key: ValidationVoteKey): Promise<void>;

  /** This validator's current action on the field, or null when they have not voted. */
  findVoteAction(key: ValidationVoteKey): Promise<'approve' | 'flag' | null>;
}

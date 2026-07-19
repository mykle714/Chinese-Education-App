/**
 * Pretty-text formatters for the data-validation feature (docs/DATA_VALIDATION_SYSTEM.md).
 *
 * LAYER: server util, shared by two consumers that must always agree byte-for-byte:
 *   - ValidationService.composeBody — builds the Reader document a validator reads.
 *   - DictionaryDAL's approval-freshness check — rebuilds this same text from the
 *     CURRENT det row to decide whether a stored approval still matches the data
 *     (a since-regenerated/edited field must not keep its old approval).
 *
 * Deliberately plain, human-readable prose (not JSON) — the validator never edits
 * this text, so there is no format to guard against on submit.
 */

import { longDefObjectToDisplayString, type LongDefinitionObject } from './definitions.js';

export interface DefinitionsRawFields {
  partsOfSpeech: string[] | null;
  definitions: string[] | null;
  // Raw det column: for zh this is a JSONB object keyed by POS (migration 70), NOT a
  // plain string. Callers pass the raw column value straight through (both
  // ValidationService.composeBody and DictionaryDAL's approval-freshness check read the
  // fresh column), so the string-or-object union must be normalized here — see below.
  longDefinition: LongDefinitionObject | string | null;
}

export interface ExampleSentenceReviewableFields {
  foreignText: unknown;
  english: unknown;
}

export function composeDefinitionsBody(raw: DefinitionsRawFields): string {
  const pos = raw.partsOfSpeech?.length ? raw.partsOfSpeech.join(', ') : '(none)';
  const defs = raw.definitions?.length
    ? raw.definitions.map((d, i) => `${i + 1}. ${d}`).join('\n')
    : '(none)';
  // Normalize the per-POS JSONB object (zh) into the same labeled display string the
  // client renders (DictionaryDAL hydrates it via the identical helper) before trimming
  // — calling `.trim()` on the raw object throws "trim is not a function" (was a 500 on
  // every definitions Approve). Handles the plain-string case (es / already-hydrated) too.
  const long = longDefObjectToDisplayString(raw.longDefinition)?.trim() || '(none)';
  return `Parts of Speech: ${pos}\n\nDefinitions:\n${defs}\n\nLong Definition:\n${long}`;
}

export function composeExampleSentenceBody(sentence: ExampleSentenceReviewableFields | null): string {
  if (!sentence) return '(no sentence)';
  const foreign = typeof sentence.foreignText === 'string' ? sentence.foreignText : '';
  const english = typeof sentence.english === 'string' ? sentence.english : '';
  return `Sentence:\n${foreign}\n\nTranslation:\n${english}`;
}

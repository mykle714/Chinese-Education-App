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

import { longDefToDisplayString, type LongDefinitionValue } from './definitions.js';

export interface DefinitionsRawFields {
  partsOfSpeech: string[] | null;
  definitions: string[] | null;
  // Raw det column: for zh this is a JSONB array of per-sense objects (and for older
  // rows / Spanish, a JSONB object keyed by POS — migration 70), NOT a plain string.
  // Callers pass the raw column value straight through (both ValidationService.composeBody
  // and DictionaryDAL's approval-freshness check read the fresh column), so the union
  // must be normalized here — see below.
  longDefinition: LongDefinitionValue | null;
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
  // Normalize the raw JSONB (per-sense array for zh, per-POS object for es/legacy) into
  // the ALL-senses labeled string before trimming — calling `.trim()` on the raw value
  // throws "trim is not a function" (was a 500 on every definitions Approve). Handles
  // the plain-string case (already-hydrated) too. The validator reviews the whole field,
  // so this deliberately shows EVERY sense — unlike the learner surfaces, which show only
  // the picked sense (resolveLongDefinition).
  const long = longDefToDisplayString(raw.longDefinition)?.trim() || '(none)';
  return `Parts of Speech: ${pos}\n\nDefinitions:\n${defs}\n\nLong Definition:\n${long}`;
}

export function composeExampleSentenceBody(sentence: ExampleSentenceReviewableFields | null): string {
  if (!sentence) return '(no sentence)';
  const foreign = typeof sentence.foreignText === 'string' ? sentence.foreignText : '';
  const english = typeof sentence.english === 'string' ? sentence.english : '';
  return `Sentence:\n${foreign}\n\nTranslation:\n${english}`;
}

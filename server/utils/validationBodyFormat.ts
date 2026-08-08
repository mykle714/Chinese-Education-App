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
  return `Definitions:\n${defs}\n\nLong Definition:\n${long}`;
}

export function composeExampleSentenceBody(sentence: ExampleSentenceReviewableFields | null): string {
  if (!sentence) return '(no sentence)';
  const foreign = typeof sentence.foreignText === 'string' ? sentence.foreignText : '';
  const english = typeof sentence.english === 'string' ? sentence.english : '';
  return `Sentence:\n${foreign}\n\nTranslation:\n${english}`;
}

/**
 * `partsOfSpeech` used to be the first block of composeDefinitionsBody; migration 132
 * split it into its own validation field so a validator can endorse the POS tags
 * without also endorsing the (much longer, much more churn-prone) definitions bundle.
 * The body text is deliberately byte-identical to the old prefix so migration 132 can
 * lift it out of existing `definitions` approvals and re-file it as a POS approval.
 */
export function composePartsOfSpeechBody(partsOfSpeech: string[] | null): string {
  const pos = partsOfSpeech?.length ? partsOfSpeech.join(', ') : '(none)';
  return `Parts of Speech: ${pos}`;
}

/**
 * The 1–6 difficulty level (zh's integers ARE HSK levels; other languages share the
 * scale under the neutral "Difficulty" name). Deliberately language-agnostic — the
 * body is a freshness FINGERPRINT compared byte-for-byte against the stored approval,
 * so baking the "HSK" prefix in would only add a way for zh and es to disagree.
 */
export function composeDifficultyBody(difficulty: number | null): string {
  return `Difficulty: ${difficulty ?? '(none)'}`;
}

/** The 1–5 everyday-conversation frequency score, surfaced to users as "Commonality". */
export function composeFrequencyScoreBody(frequencyScore: number | null): string {
  return `Commonality: ${frequencyScore ?? '(none)'}/5`;
}

/**
 * One SENSE's commonality — the per-cluster `frequencyScore` inside
 * `definitionClusters` (migration 139's `senseFrequencyScore` field).
 *
 * The sense label is part of the BODY, not just of the record's key, for the same
 * reason `composeExampleSentenceBody` omits its index: the body doubles as the
 * freshness FINGERPRINT compared byte-for-byte against the stored approval, and a
 * label in the text means a re-clustering that renames or merges the sense correctly
 * invalidates the approval instead of silently transferring it to a different meaning.
 */
export function composeSenseFrequencyScoreBody(sense: string, frequencyScore: number | null): string {
  return `Commonality (${sense}): ${frequencyScore ?? '(none)'}/5`;
}

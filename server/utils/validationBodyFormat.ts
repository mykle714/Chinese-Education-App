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

export interface DefinitionsRawFields {
  partsOfSpeech: string[] | null;
  definitions: string[] | null;
  longDefinition: string | null;
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
  const long = raw.longDefinition?.trim() || '(none)';
  return `Parts of Speech: ${pos}\n\nDefinitions:\n${defs}\n\nLong Definition:\n${long}`;
}

export function composeExampleSentenceBody(sentence: ExampleSentenceReviewableFields | null): string {
  if (!sentence) return '(no sentence)';
  const foreign = typeof sentence.foreignText === 'string' ? sentence.foreignText : '';
  const english = typeof sentence.english === 'string' ? sentence.english : '';
  return `Sentence:\n${foreign}\n\nTranslation:\n${english}`;
}

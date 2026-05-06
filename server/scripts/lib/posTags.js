/**
 * Canonical list of part-of-speech tags used across AI backfill scripts.
 * Keep in sync with any prompts that reference this taxonomy (e.g.
 * backfill-example-sentences.js generates partOfSpeechDict values from
 * this same set, and backfill-parts-of-speech.js writes them to
 * dictionaryentries."partsOfSpeech").
 */
export const ALLOWED_POS_TAGS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'numeral',
  'classifier',
  'preposition',
  'conjunction',
  'particle',
  'interjection',
  'onomatopoeia',
];

export const ALLOWED_POS_TAG_SET = new Set(ALLOWED_POS_TAGS);

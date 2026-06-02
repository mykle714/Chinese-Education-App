/**
 * Shared Spanish part-of-speech vocabulary + mapping.
 *
 * The Spanish det (`dictionaryentries_es`) stores POS in two shapes:
 *   - scalar `pos`  — the raw Wiktionary abbreviation (n, v, adj, …) and part of
 *     the logical key.
 *   - `partsOfSpeech` jsonb — the friendly token tags (noun, verb, …) consumed by
 *     the example-sentence generator's per-token `partOfSpeechDict`.
 *
 * Both the example-sentences backfill and the parts-of-speech backfill need the
 * raw→friendly mapping, so it lives here instead of being copy-pasted. (The
 * Chinese `shared/lib/posTags.js` set is CJK-specific — it has 'classifier' /
 * 'onomatopoeia' and lacks 'article'/'determiner' — so Spanish keeps its own.)
 */

// Friendly, sentence-worthy POS tags used for es `partsOfSpeech` and the
// per-token partOfSpeechDict in generated example sentences.
export const ALLOWED_POS_TAGS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'article',
  'determiner',
  'numeral',
  'preposition',
  'conjunction',
  'interjection',
  'particle',
];

export const ALLOWED_POS_TAG_SET = new Set(ALLOWED_POS_TAGS);

// Raw Wiktionary abbreviation → friendly tag. Tags that map to null
// (phrase, proverb, prop, letter, punct, symbol, diacrit, contraction) are not
// sentence-worthy grammatical roles and are dropped from coverage requirements.
export const WIKTIONARY_POS_TO_FRIENDLY = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  pron: 'pronoun',
  art: 'article',
  determiner: 'determiner',
  num: 'numeral',
  prep: 'preposition',
  conj: 'conjunction',
  interj: 'interjection',
  part: 'particle',
  particle: 'particle',
  // Non-lexical / not a role to exemplify in a sentence → dropped from coverage.
  prop: null, // proper noun
  phrase: null,
  proverb: null,
  letter: null,
  punct: null,
  symbol: null,
  diacrit: null,
  contraction: null,
};

/**
 * Map a single raw Wiktionary POS abbreviation to its friendly tag.
 * Returns null for non-lexical tags, or the tag itself if unknown (so a new
 * source tag still surfaces rather than being silently dropped).
 */
export function posAbbrevToFriendly(pos) {
  if (!pos) return null;
  return Object.prototype.hasOwnProperty.call(WIKTIONARY_POS_TO_FRIENDLY, pos)
    ? WIKTIONARY_POS_TO_FRIENDLY[pos]
    : pos;
}

/**
 * Map a raw partsOfSpeech array (Wiktionary tags) to the deduped set of friendly,
 * sentence-worthy POS tags. Unknown tags pass through unchanged.
 */
export function normalizePosList(partsOfSpeech) {
  const raw = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const friendly = [];
  for (const tag of raw) {
    const mapped = posAbbrevToFriendly(tag);
    if (mapped && !friendly.includes(mapped)) friendly.push(mapped);
  }
  return friendly;
}

const TONE_MARK_MAP: Record<string, number> = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};

/**
 * Extract tone numbers from a pinyin pronunciation string.
 * Each syllable (space-separated) is mapped to a digit 1–4 for toned vowels,
 * or 0 for neutral/toneless syllables.
 *
 * Example: "fēng kuáng" → "12"
 *          "yī jiàn shuāng diāo" → "1411"
 *          "ma" → "0"
 */
export function extractTones(pronunciation: string): string {
  return pronunciation
    .split(' ')
    .map(syllable => {
      for (const char of syllable) {
        if (TONE_MARK_MAP[char] !== undefined) return TONE_MARK_MAP[char];
      }
      return 0; // neutral tone
    })
    .join('');
}

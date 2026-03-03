const TONE_MARK_MAP: Record<string, number> = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};

export const TONE_COLORS: Record<number, string> = {
  1: '#EF476F', // red   — tone 1
  2: '#05C793', // green — tone 2
  3: '#779BE7', // blue  — tone 3
  4: '#FF8E47', // orange — tone 4
  0: '#9E9E9E', // grey  — neutral tone
};

export function getToneColor(pinyin: string): string {
  for (const char of pinyin) {
    const tone = TONE_MARK_MAP[char];
    if (tone !== undefined) return TONE_COLORS[tone];
  }
  return TONE_COLORS[0];
}

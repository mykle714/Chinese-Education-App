// Matches any CJK Unified Ideograph (common + extension A/B blocks).
export const hasChinese = (text: string): boolean => /[一-鿿㐀-䶿]/.test(text);

// Tone-marked vowel → [plain vowel, tone number]. Neutral tone carries no
// diacritic, so it never appears here (it maps to "no digit").
const TONE_VOWEL_MAP: Record<string, [string, number]> = {
  ā: ["a", 1], á: ["a", 2], ǎ: ["a", 3], à: ["a", 4],
  ē: ["e", 1], é: ["e", 2], ě: ["e", 3], è: ["e", 4],
  ī: ["i", 1], í: ["i", 2], ǐ: ["i", 3], ì: ["i", 4],
  ō: ["o", 1], ó: ["o", 2], ǒ: ["o", 3], ò: ["o", 4],
  ū: ["u", 1], ú: ["u", 2], ǔ: ["u", 3], ù: ["u", 4],
  ǖ: ["ü", 1], ǘ: ["ü", 2], ǚ: ["ü", 3], ǜ: ["ü", 4],
};

/**
 * Convert one tone-marked pinyin syllable to numbered form ("jiàn" → "jian4",
 * neutral "de" → "de"). The tone digit is appended at the syllable's end, matching
 * the `numberedPinyin` convention used by the dictionary search. Non-pinyin
 * characters pass through untouched.
 */
export const syllableToNumberedPinyin = (syllable: string): string => {
  let tone = 0;
  let base = "";
  for (const ch of syllable) {
    const mapped = TONE_VOWEL_MAP[ch];
    if (mapped) {
      base += mapped[0];
      tone = mapped[1];
    } else {
      base += ch;
    }
  }
  return tone ? `${base}${tone}` : base;
};

/**
 * Convert a whole tone-marked pinyin string to numbered form, per space-separated
 * syllable ("jiàn shēn" → "jian4 shen1").
 */
export const tonedToNumberedPinyin = (pinyin: string): string =>
  pinyin
    .split(/\s+/)
    .filter(Boolean)
    .map(syllableToNumberedPinyin)
    .join(" ");

// Plain vowel → its five tone forms, indexed by tone number (0/5 = neutral, no
// diacritic). The inverse of TONE_VOWEL_MAP, used to render numbered readings.
const TONE_MARK_BY_VOWEL: Record<string, string[]> = {
  a: ["a", "ā", "á", "ǎ", "à"],
  e: ["e", "ē", "é", "ě", "è"],
  i: ["i", "ī", "í", "ǐ", "ì"],
  o: ["o", "ō", "ó", "ǒ", "ò"],
  u: ["u", "ū", "ú", "ǔ", "ù"],
  ü: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
};

/**
 * Convert one numbered pinyin syllable to tone-marked form ("hui4" → "huì",
 * "de5"/"de" → "de", "lu:3"/"lv3" → "lǚ"). The tone diacritic is placed on the
 * syllable's main vowel by the standard rule (a/e win; else the last of i/o/u/ü).
 * Non-pinyin syllables pass through untouched. Complement of
 * `syllableToNumberedPinyin`.
 */
export const numberedToTonedSyllable = (syllable: string): string => {
  // Normalize the u-with-umlaut spellings CC-CEDICT uses ("u:" / "v") to "ü".
  const normalized = syllable.replace(/u:/gi, "ü").replace(/v/g, "ü").replace(/V/g, "Ü");
  const match = normalized.match(/^([a-züÜ]+)([1-5])$/i);
  if (!match) return normalized;

  const [, letters, toneStr] = match;
  const tone = parseInt(toneStr, 10);
  if (tone === 5) return letters; // neutral tone: no diacritic

  const lower = letters.toLowerCase();
  // Placement rule: a or e always takes the mark; otherwise the last o/i/u/ü.
  let vowelIndex = lower.search(/[ae]/);
  if (vowelIndex === -1) {
    const vowels = Array.from(lower.matchAll(/[iouü]/g));
    if (vowels.length > 0) vowelIndex = vowels[vowels.length - 1].index!;
  }
  if (vowelIndex === -1) return letters;

  const marked = TONE_MARK_BY_VOWEL[lower[vowelIndex]]?.[tone] ?? letters[vowelIndex];
  return letters.slice(0, vowelIndex) + marked + letters.slice(vowelIndex + 1);
};

/**
 * Convert a whole numbered pinyin reading to tone-marked form, per space-separated
 * syllable ("hui4 kuai4" → "huì kuài"). Inverse of `tonedToNumberedPinyin`.
 */
export const numberedToTonedPinyin = (reading: string): string =>
  reading
    .split(/\s+/)
    .filter(Boolean)
    .map(numberedToTonedSyllable)
    .join(" ");

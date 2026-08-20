/**
 * Numbered → tone-marked pinyin conversion (server side).
 *
 * The DB stores two spellings of the same reading: `pronunciation` is already
 * tone-marked ("huì"), while every *per-sense* reading — `definitionClusters[].reading`
 * (docs/DEFINITION_CLUSTERS.md) and the `numberedPinyin` column — is numbered ("hui4").
 * Anything that renders a per-sense reading in a UI that expects tone-marked pinyin
 * (cpcd rows, segment popups, TTS pinyin hints) has to convert first.
 *
 * This is the **twin** of `numberedToTonedSyllable` / `numberedToTonedPinyin` in
 * `src/utils/textUtils.ts` (same placement rule, same ü normalization) — the client and
 * server builds are separate, so the pair is duplicated exactly the way
 * `server/utils/definitions.ts` twins `src/utils/definitionUtils.ts`. Keep them in
 * lockstep: a divergence shows up as the same word rendering two different tone marks
 * on two surfaces.
 *
 * Consumers: `server/utils/definitions.ts` (`resolveDisplayPronunciation` — the card's
 * chosen sense) and `server/dal/shared/segmentString.ts` (`senseReading` — a sentence
 * segment's tagged sense).
 */

// Plain vowel → its five tone forms, indexed by tone number (0/5 = neutral, no diacritic).
const TONE_MARK_BY_VOWEL: Record<string, string[]> = {
  a: ['a', 'ā', 'á', 'ǎ', 'à'],
  e: ['e', 'ē', 'é', 'ě', 'è'],
  i: ['i', 'ī', 'í', 'ǐ', 'ì'],
  o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
  u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
  ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/**
 * Convert one numbered pinyin syllable to tone-marked form ("hui4" → "huì",
 * "de5"/"de" → "de", "lu:3"/"lv3" → "lǚ"). The tone diacritic is placed on the
 * syllable's main vowel by the standard rule: a, e, or o takes the mark (they never
 * co-occur in one syllable); otherwise the LAST of i/u/ü, which is what puts the mark on
 * the u of "iu" (liù) and the i of "ui" (huì).
 * Non-pinyin syllables pass through untouched.
 */
export function numberedToTonedSyllable(syllable: string): string {
  // Normalize the u-with-umlaut spellings CC-CEDICT uses ("u:" / "v") to "ü".
  const normalized = syllable.replace(/u:/gi, 'ü').replace(/v/g, 'ü').replace(/V/g, 'Ü');
  const match = normalized.match(/^([a-züÜ]+)([1-5])$/i);
  if (!match) return normalized;

  const [, letters, toneStr] = match;
  const tone = parseInt(toneStr, 10);
  if (tone === 5) return letters; // neutral tone: no diacritic

  const lower = letters.toLowerCase();
  // Placement rule: a, e, or o always takes the mark; otherwise the last i/u/ü.
  // `o` belongs in the FIRST group, not the fallback: leaving it out sent "tou2" to the
  // fallback's last-vowel rule and produced "toú" instead of "tóu" (likewise shoǔ/koǔ).
  let vowelIndex = lower.search(/[aeo]/);
  if (vowelIndex === -1) {
    const vowels = Array.from(lower.matchAll(/[iuü]/g));
    if (vowels.length > 0) vowelIndex = vowels[vowels.length - 1].index!;
  }
  if (vowelIndex === -1) return letters;

  const marked = TONE_MARK_BY_VOWEL[lower[vowelIndex]]?.[tone] ?? letters[vowelIndex];
  return letters.slice(0, vowelIndex) + marked + letters.slice(vowelIndex + 1);
}

/**
 * Convert a whole numbered pinyin reading to tone-marked form, per space-separated
 * syllable ("hui4 kuai4" → "huì kuài").
 */
export function numberedToTonedPinyin(reading: string): string {
  return reading
    .split(/\s+/)
    .filter(Boolean)
    .map(numberedToTonedSyllable)
    .join(' ');
}

/**
 * Syllable count of a space-separated reading ("hui4 kuai4" → 2).
 *
 * Twin of `readingSyllableCount` in `src/utils/textUtils.ts`. Both per-sense reading
 * consumers use it as the same shape guard: cpcd zips syllables to characters
 * positionally, so a reading whose syllable count disagrees with its target (the word's
 * character count for `senseReading`, the `pronunciation` column's count for
 * `resolveDisplayPronunciation`) must be rejected rather than rendered — otherwise it
 * shifts every character's pinyin one column over.
 */
export function readingSyllableCount(reading: string): number {
  return reading.split(/\s+/).filter(Boolean).length;
}

/**
 * cedictPinyin — the CC-CEDICT → det pinyin transform chain, shared.
 *
 * LAYER: data-enrichment (backfill) library. Pure, no I/O except `readCedict`.
 *
 * These are the transforms that produced det's `pronunciation` / `numberedPinyin` / `tone`
 * columns, copied VERBATIM from the scripts that ran them (see each function). They were
 * extracted from backfill-single-char-cedict.js when a second consumer
 * (backfill-search-readings.js) needed byte-identical column forms, so the two cannot drift.
 *
 * Column conventions they produce (and every consumer relies on):
 *   pronunciation   tone-marked, lowercase, space-separated        "nǚ", "lǜ shī", "de"
 *   numberedPinyin  ü → v, neutral tone carries NO digit            "nv3", "lv4 shi1", "de"
 *   tone            concatenated per-syllable digits, neutral = 0   "3", "41", "0"
 *
 * Referenced by: scripts/backfill/chinese/backfill-single-char-cedict.js,
 * scripts/backfill/chinese/lib/searchReadings.js, docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md.
 */

import fs from 'fs';

/**
 * import-cedict-pg.ts: numbered pinyin ("nu:3") → tone-marked ("nǚ").
 *
 * DIVERGENCE FROM import-cedict-pg.ts (verified against live rows):
 *   1. The tone mark on an "ou" final belongs on the 'o' (sǒu, not soǔ). The
 *      importer's "last vowel" fallback gets this wrong; we special-case "ou".
 *   2. CEDICT capitalizes proper-noun readings (Jiāo, Tán); the live table is
 *      uniformly lowercase, so callers lowercase rawPinyin before this runs.
 */
export function convertPinyinToToneMarks(pinyinWithNumbers) {
  const toneMarks = {
    a: ['a', 'ā', 'á', 'ǎ', 'à'],
    e: ['e', 'ē', 'é', 'ě', 'è'],
    i: ['i', 'ī', 'í', 'ǐ', 'ì'],
    o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
    u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
    ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
  };
  return pinyinWithNumbers
    .split(' ')
    .map(syllable => {
      const match = syllable.match(/^([a-züÜ]+)([1-5])$/i);
      if (!match) return syllable; // e.g. "nu:3" (has ':') passes through to fixUColon
      let [, letters, toneStr] = match;
      const tone = parseInt(toneStr, 10);
      letters = letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');
      let vowelIndex = letters.search(/[aeAE]/);
      if (vowelIndex === -1) {
        const ouIndex = letters.search(/ou/i); // "ou" final → mark the o
        if (ouIndex !== -1) {
          vowelIndex = ouIndex;
        } else {
          const vowelMatches = Array.from(letters.matchAll(/[iouüIOUÜ]/g));
          if (vowelMatches.length > 0) vowelIndex = vowelMatches[vowelMatches.length - 1].index;
        }
      }
      if (vowelIndex !== -1) {
        const vowel = letters[vowelIndex];
        const toneMarkedVowel = toneMarks[vowel]?.[tone] || vowel;
        letters = letters.substring(0, vowelIndex) + toneMarkedVowel + letters.substring(vowelIndex + 1);
      }
      return letters;
    })
    .join(' ');
}

/** backfill-pinyin-ucolon.js: CEDICT "u:" ASCII stand-in → proper ü tone marks. */
const U_COLON_REPLACEMENTS = [
  ['u:e1', 'üē'], ['u:e2', 'üé'], ['u:e3', 'üě'], ['u:e4', 'üè'],
  ['u:1', 'ǖ'], ['u:2', 'ǘ'], ['u:3', 'ǚ'], ['u:4', 'ǜ'], ['u:5', 'ü'],
];
export function fixUColon(pronunciation) {
  let result = pronunciation;
  for (const [from, to] of U_COLON_REPLACEMENTS) result = result.replaceAll(from, to);
  return result;
}

const TONE_MARK_MAP = {
  ā: 1, á: 2, ǎ: 3, à: 4, ē: 1, é: 2, ě: 3, è: 4, ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4, ū: 1, ú: 2, ǔ: 3, ù: 4, ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
};
/** backfill-pinyin-ucolon.js: per-syllable tone digits, neutral = 0. */
export function extractTones(pronunciation) {
  return pronunciation
    .split(' ')
    .map(syllable => {
      for (const char of syllable) if (TONE_MARK_MAP[char] !== undefined) return TONE_MARK_MAP[char];
      return 0;
    })
    .join('');
}

/** backfill-numbered-pinyin.js: tone-marked pronunciation → numbered pinyin (ü→v). */
const DIACRITIC_MAP = {
  ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4],
  ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4],
  ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4],
  ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4],
  ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4],
  ǖ: ['v', 1], ǘ: ['v', 2], ǚ: ['v', 3], ǜ: ['v', 4],
};
export function toNumberedPinyin(pronunciation) {
  return pronunciation
    .split(' ')
    .map(syllable => {
      let result = '';
      let tone = null;
      for (const char of syllable) {
        if (DIACRITIC_MAP[char]) {
          const [base, toneNum] = DIACRITIC_MAP[char];
          result += base;
          tone = toneNum;
        } else if (char === 'ü') {
          result += 'v';
        } else {
          result += char;
        }
      }
      if (tone !== null) result += tone;
      return result;
    })
    .join(' ');
}

/**
 * One NUMBERED reading, from any source, → the three det column forms.
 *
 * Accepts every spelling in circulation: CC-CEDICT's ("Nu:3", "de5"), a sense cluster's
 * `reading` ("lv4", "de5"), and det's own `numberedPinyin` ("lv4", "de" — neutral with no
 * digit). Runs the same chain as the live rows: lowercase → tone marks → u: fix → numbered.
 *
 * Returns null for a reading that is not pure pinyin (CEDICT spells Latin letters and
 * punctuation inside a reading — "ka3 la1 O K", "yi1 · er4"): such a string is not
 * something a learner types as pinyin, and would put junk in a search column.
 *
 * `requireToneDigits`: CEDICT and sense clusters write a digit on EVERY pinyin syllable
 * (neutral = 5), so a digit-less token from them is a Latin letter ("O", "K"), not a
 * syllable. Only det's own `numberedPinyin` writes the neutral tone digit-less — pass
 * false (the default) for that source alone.
 */
export function numberedReadingToColumnForms(reading, { requireToneDigits = false } = {}) {
  if (typeof reading !== 'string') return null;
  const lowered = reading.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!lowered) return null;
  const syllable = requireToneDigits ? /^[a-zü:]+[1-5]$/ : /^[a-zü:]+[1-5]?$/;
  if (!lowered.split(' ').every(syl => syllable.test(syl))) return null;
  const pronunciation = fixUColon(convertPinyinToToneMarks(lowered));
  return {
    pronunciation,
    numberedPinyin: toNumberedPinyin(pronunciation),
    tone: extractTones(pronunciation),
  };
}

/** Parse a CEDICT line → { simplified, rawPinyin, glosses[] } (import-cedict-pg.ts regex). */
export function parseCEDICTLine(line) {
  if (line.startsWith('#') || line.trim() === '') return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)/);
  if (!match) return null;
  const [, , simplified, rawPinyin, defsStr] = match;
  const glosses = defsStr.replace(/\/\s*$/, '').split('/').filter(d => d.trim().length > 0);
  return { simplified, rawPinyin, glosses };
}

/** Read and parse every line of a CEDICT dump (skips comments / malformed lines). */
export function readCedict(cedictPath) {
  return fs.readFileSync(cedictPath, 'utf-8')
    .split('\n')
    .map(parseCEDICTLine)
    .filter(Boolean);
}

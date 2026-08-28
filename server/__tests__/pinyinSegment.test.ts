import { describe, it, expect } from 'vitest';
import { segmentPinyin, isAllPinyin } from '../utils/pinyinSegment.js';

/**
 * Spaceless-pinyin segmentation for the dictionary search's stage-2 fallback
 * (docs/DICTIONARY_AI_FALLBACK_SEARCH.md § "Stage 2").
 *
 * These tests exist because every failure here is SILENT: a term that fails to tile
 * just falls through to "0 results", which looks like a missing dictionary entry
 * rather than a broken segmenter. The tone-mark cases in particular guard a
 * character-index mapping (stripToneMarks -> applyTones) that would drift the moment
 * a replacement stopped being one-character-for-one-character.
 */
describe('segmentPinyin', () => {
  // A tiling is "present" rather than "the only one" throughout: the segmenter
  // deliberately returns every valid parse (xian vs xi+an), and the DAL ORs them.
  const tiles = (input: string, expected: string[]) =>
    expect(segmentPinyin(input).some(t => t.join(' ') === expected.join(' '))).toBe(true);

  it('tiles plain spaceless pinyin', () => {
    tiles('nihao', ['ni', 'hao']);
    tiles('jianshen', ['jian', 'shen']);
  });

  it('binds a tone digit to the syllable it follows', () => {
    tiles('jian4shen1', ['jian4', 'shen1']);
  });

  it('lifts tone marks onto the syllable that carried them', () => {
    // The mark sits mid-syllable, so a naive in-place rewrite would give ["ha3","o"].
    tiles('nǐhǎo', ['ni3', 'hao3']);
    tiles('jiànshēn', ['jian4', 'shen1']);
  });

  it('normalizes ü (marked or bare) to the numberedPinyin column spelling', () => {
    tiles('lǚyóu', ['lv3', 'you2']);
    tiles('nǚ', ['nv3']);
    tiles('nü', ['nv']);
  });

  it('keeps an explicit digit when marks and digits are mixed', () => {
    tiles('nǐhao3', ['ni3', 'hao3']);
  });

  it('enumerates both parses of an absorbable starter syllable', () => {
    const parses = segmentPinyin('xian').map(t => t.join(' '));
    expect(parses).toContain('xian');
    expect(parses).toContain('xi an');
  });

  it('returns no tiling for non-pinyin, which is what gates the AI button', () => {
    expect(segmentPinyin('hello there')).toEqual([]);
    expect(isAllPinyin('hello there')).toBe(false);
    expect(isAllPinyin('nǐhǎo')).toBe(true);
  });
});

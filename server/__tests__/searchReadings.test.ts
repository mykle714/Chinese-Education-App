import { describe, it, expect } from 'vitest';
import { buildSearchReadings, defaultPrimaryForms } from '../scripts/backfill/chinese/lib/searchReadings.js';
import { numberedReadingToColumnForms } from '../scripts/backfill/chinese/lib/cedictPinyin.js';

/**
 * dictionaryentries_zh."searchReadings" (migration 165) — every reading a heteronym can be
 * searched under. See scripts/backfill/chinese/lib/searchReadings.js and
 * docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md.
 */
describe('numberedReadingToColumnForms — any source spelling → det column forms', () => {
  it('handles CEDICT, cluster and column spellings alike', () => {
    expect(numberedReadingToColumnForms('Xing2')).toEqual({ pronunciation: 'xíng', numberedPinyin: 'xing2', tone: '2' });
    expect(numberedReadingToColumnForms('nu:3')).toEqual({ pronunciation: 'nǚ', numberedPinyin: 'nv3', tone: '3' });
    expect(numberedReadingToColumnForms('lv4')).toEqual({ pronunciation: 'lǜ', numberedPinyin: 'lv4', tone: '4' });
    // Neutral tone: "5" (CEDICT / clusters) and no digit (the column) are the same reading.
    expect(numberedReadingToColumnForms('de5')).toEqual({ pronunciation: 'de', numberedPinyin: 'de', tone: '0' });
    expect(numberedReadingToColumnForms('de')).toEqual({ pronunciation: 'de', numberedPinyin: 'de', tone: '0' });
  });

  it('rejects readings that are not pure pinyin', () => {
    // CEDICT spells Latin letters digit-less; with tone digits required they are not syllables.
    expect(numberedReadingToColumnForms('ka3 la1 O K', { requireToneDigits: true })).toBeNull();
    expect(numberedReadingToColumnForms('yi1 · er4')).toBeNull();
    expect(numberedReadingToColumnForms('')).toBeNull();
  });
});

describe('buildSearchReadings', () => {
  it('unions CEDICT, clusters and the primary column: toned forms first, then numbered', () => {
    expect(buildSearchReadings({
      cedictReadings: ['hang2', 'heng2', 'xing2'],
      clusters: [{ reading: 'xing2' }, { reading: 'hang2' }],
      primaryNumbered: ['xing2'],
    })).toBe('háng|héng|xíng|hang2|heng2|xing2');
  });

  it('is NULL for a single-reading headword (the primary columns already cover it)', () => {
    expect(buildSearchReadings({ cedictReadings: ['hao3'], primaryNumbered: ['hao3'] })).toBeNull();
    // "de5" and "de" are one reading, not two.
    expect(buildSearchReadings({ clusters: [{ reading: 'de5' }], primaryNumbered: ['de'] })).toBeNull();
  });

  it('only ever grows: an existing value keeps its readings when clusters are rewritten', () => {
    const existing = 'le|liǎo|liào|liao3|liao4';
    expect(buildSearchReadings({ clusters: [{ reading: 'le' }], primaryNumbered: ['le'], existing }))
      .toBe('le|liǎo|liào|liao3|liao4');
  });
});

describe('defaultPrimaryForms — the primary column re-pointed at the default sense', () => {
  it('re-points a stale primary at the top-scored cluster', () => {
    expect(defaultPrimaryForms({
      pronunciation: 'háng', numberedPinyin: 'hang2',
      definitionClusters: [
        { sense: 'row', reading: 'hang2', frequencyScore: 4, glosses: ['row'] },
        { sense: 'OK', reading: 'xing2', frequencyScore: 5, glosses: ['OK'] },
      ],
    })).toEqual({ pronunciation: 'xíng', numberedPinyin: 'xing2', tone: '2' });
  });

  it('keeps a particle default even when its glosses are all parenthetical (了 stays le)', () => {
    expect(defaultPrimaryForms({
      pronunciation: 'le', numberedPinyin: 'le',
      definitionClusters: [
        { sense: 'particle', reading: 'le', frequencyScore: 5, glosses: ['(completed action marker)'] },
        { sense: 'to understand', reading: 'liao3', frequencyScore: 2, glosses: ['to understand'] },
      ],
    })).toBeNull();
  });

  it('is null for an unclustered row', () => {
    expect(defaultPrimaryForms({ pronunciation: 'hǎo', numberedPinyin: 'hao3', definitionClusters: null })).toBeNull();
  });
});

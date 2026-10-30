import { describe, expect, it } from 'vitest';
import type { DictionaryEntry, DictionaryMatchKind } from '../../../types';
import { groupByMatchSection, matchSectionLabel } from '../dictionaryMatchSections';

const row = (id: number, matchKind?: DictionaryMatchKind) => ({ id, word1: `w${id}`, matchKind }) as unknown as DictionaryEntry;

describe('groupByMatchSection', () => {
    it('makes one section per run, in the server order', () => {
        const sections = groupByMatchSection([
            row(1, 'meaning-exact'),
            row(2, 'word-exact'),
            row(3, 'meaning-prefix'),
            row(4, 'word-prefix'),
            row(5, 'meaning-partial'),
        ]);
        expect(sections.map((s) => s.key)).toEqual(['english-exact', 'word-exact', 'english-prefix', 'word-prefix', 'other']);
    });

    it('merges alternate readings into the reading section', () => {
        const sections = groupByMatchSection([row(1, 'word-exact'), row(2, 'reading-alternate'), row(3, 'word-prefix')]);
        expect(sections.map((s) => [s.key, s.entries.map((e) => e.id)])).toEqual([
            ['word-exact', [1, 2]],
            ['word-prefix', [3]],
        ]);
    });

    it('puts numbered-pinyin matches (and kindless rows) in the reading section', () => {
        expect(groupByMatchSection([row(1, 'word'), row(2)]).map((s) => [s.key, s.entries.length])).toEqual([['word-exact', 2]]);
    });

    it('continues the last section across an infinite-scroll page boundary', () => {
        const page1 = [row(1, 'word-exact'), row(2, 'word-prefix')];
        const page2 = [row(3, 'word-prefix'), row(4, 'meaning-partial')];
        expect(groupByMatchSection([...page1, ...page2]).map((s) => s.entries.length)).toEqual([1, 2, 1]);
    });

    it('returns no sections for no rows', () => {
        expect(groupByMatchSection([])).toEqual([]);
    });
});

describe('matchSectionLabel', () => {
    it('names the word side Pinyin for zh and Spanish for es', () => {
        expect(matchSectionLabel('english-exact', 'long', 'zh')).toBe('English “long”');
        expect(matchSectionLabel('word-exact', 'long', 'zh')).toBe('Pinyin “long”');
        expect(matchSectionLabel('word-prefix', 'casa', 'es')).toBe('Spanish starts with “casa”');
        expect(matchSectionLabel('other', 'long', 'zh')).toBe('Other');
    });
});

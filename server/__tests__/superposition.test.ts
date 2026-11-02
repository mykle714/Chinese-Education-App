/**
 * superposition.test.ts — the deal's word picking (server/contracts/superposition.ts,
 * docs/SUPERPOSITION_GAME.md § Deal).
 */
import { describe, expect, it } from 'vitest';
import { pickSuperpositionWords, type SuperpositionCandidate } from '../contracts/superposition.js';

const word = (entryKey: string, over: Partial<SuperpositionCandidate> = {}): SuperpositionCandidate => ({
  entryKey, pinyin: null, definition: null, cooled: false, preferred: false, ...over,
});
const charsOf = (picked: SuperpositionCandidate[]) => picked.flatMap((w) => Array.from(w.entryKey));

describe('pickSuperpositionWords', () => {
  it('builds exactly four distinct characters from mixed lengths', () => {
    const picked = pickSuperpositionWords([word('天气'), word('人'), word('水'), word('大学生'), word('图书馆里'), word('山')]);
    expect(charsOf(picked)).toHaveLength(4);
    expect(new Set(charsOf(picked)).size).toBe(4);
  });

  it('accepts one four-character word', () => {
    expect(pickSuperpositionWords([word('图书馆里')]).map((w) => w.entryKey)).toEqual(['图书馆里']);
  });

  it('refuses a word that repeats a character, and overlap between words', () => {
    const picked = pickSuperpositionWords([word('谢谢'), word('天气'), word('气温')]);
    expect(picked.map((w) => w.entryKey).includes('谢谢')).toBe(false);
    expect(new Set(charsOf(picked)).size).toBe(charsOf(picked).length);
  });

  it('refuses a one-stroke character, which would start finished', () => {
    expect(pickSuperpositionWords([word('一起'), word('天气')]).map((w) => w.entryKey)).toEqual(['天气']);
  });

  it('draws fresh preferred words first and cooled ones last', () => {
    const picked = pickSuperpositionWords([
      word('天气', { cooled: true, preferred: true }),
      word('人民', { preferred: true }),
      word('山水'),
      word('学生', { cooled: true }),
    ]);
    expect(picked.map((w) => w.entryKey)).toEqual(['人民', '山水']);
  });

  it('returns the fullest board when four characters cannot be reached', () => {
    expect(charsOf(pickSuperpositionWords([word('天气'), word('人')]))).toHaveLength(3);
  });
});

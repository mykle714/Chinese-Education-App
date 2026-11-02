import { describe, expect, it } from 'vitest';
import { sampleWritingGridCharacters, medalForWritingGrid } from '../contracts/writingGrid.js';
import { writingLevelForMastery, writingMarkCounts } from '../contracts/writingLevels.js';
import { writingMasteryFromChars } from '../contracts/mastery.js';
import { WritingGridService } from '../services/WritingGridService.js';
import type { IWritingGridDAL, WritingGridCharacterRow } from '../dal/interfaces/IWritingGridDAL.js';

const cand = (char: string, writingMastery: number, cooled = false) => ({ char, writingMastery, cooled, pinyin: null });

describe('sampleWritingGridCharacters', () => {
  it('returns distinct characters, at most `count`', () => {
    const pool = 'abcdefghijkl'.split('').map((c, i) => cand(c, i % 9));
    const picked = sampleWritingGridCharacters(pool, 8, () => 0.37);
    expect(picked).toHaveLength(8);
    expect(new Set(picked.map((p) => p.char)).size).toBe(8);
  });

  it('draws off-cooldown characters before cooled ones', () => {
    const pool = [cand('a', 0, true), cand('b', 0, false), cand('c', 0, true)];
    const picked = sampleWritingGridCharacters(pool, 1, () => 0.99);
    expect(picked[0].char).toBe('b');
  });

  it('returns what it has when the pool is short', () => {
    expect(sampleWritingGridCharacters([cand('a', 0)], 8)).toHaveLength(1);
  });
});

describe('sampleWritingGridCharacters: preferred characters (flp break)', () => {
  it('walks the ladder: fresh preferred, fresh, cooled preferred, cooled', () => {
    const pool = [
      { ...cand('d', 0, true) },
      { ...cand('c', 0, true), preferred: true },
      { ...cand('b', 0) },
      { ...cand('a', 0), preferred: true },
    ];
    expect(sampleWritingGridCharacters(pool, 4, () => 0).map((p) => p.char)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('WritingGridService.deal', () => {
  const row = (char: string, cardId: number | null, ownCard: boolean): WritingGridCharacterRow => ({
    char, cardId, ownCard, pinyin: null, definition: null, definitionClusters: null, selectedSense: null, typedMarkHistory: null,
  });
  const CHARS = '一二三四五六七八九十'.split('');
  // ids 1–10 are the characters' own rows; words live in `entryKeys`.
  const makeService = (entryKeys: Record<number, string>, rows = CHARS.map((c, i) => row(c, i + 1, i % 2 === 0))) => {
    const seen: number[][] = [];
    const dal: IWritingGridDAL = {
      findCandidateCharacters: async (_user, extraIds) => { seen.push(extraIds); return rows; },
      findCandidateWords: async () => [],
      findEntryKeys: async (_user, ids) => ids.flatMap((id) => (entryKeys[id] ? [entryKeys[id]] : [])),
      ensureCharacterRows: async (_user, chars) => new Map(chars.map((c) => [c, CHARS.indexOf(c) + 1])),
    };
    const lend = { acquireLentCards: async () => ({ lentIds: [99] }) };
    return { service: new WritingGridService(dal, lend as never, () => 0.5), seen };
  };

  it('puts a seed word on the board as its characters', async () => {
    const { service, seen } = makeService({ 50: '一二三', 51: '十' });
    const dealt = await service.deal('u', { seedIds: [50, 51] });
    expect(dealt).toHaveLength(8);
    expect(dealt.map((c) => c.char)).toEqual(expect.arrayContaining(['一', '二', '三', '十']));
    expect(seen[0]).toEqual([50, 51]);
  });

  it('reports which cells are the learner\'s own cards', async () => {
    const { service } = makeService({});
    const dealt = await service.deal('u');
    for (const cell of dealt) expect(cell.ownCard).toBe(CHARS.indexOf(cell.char) % 2 === 0);
    expect(dealt.some((cell) => cell.outsideFocus)).toBe(false);
  });

  it('a focused break keeps today\'s set for last and stamps cells outside it', async () => {
    // Set: 一二 (id 60, done today) and 三 (own row 3, remaining). 10 characters, 8 cells.
    const { service, seen } = makeService({ 60: '一二', 3: '三' });
    const dealt = await service.deal('u', { seedIds: [7], focusBreak: { setIds: [60, 3], remainingIds: [3] } });
    expect(seen[0]).toEqual([]); // the seed does not apply
    expect(dealt.map((c) => c.char).slice(0, 7).sort()).toEqual([...'四五六七八九十'].sort());
    const fallback = dealt[7];
    expect(['一', '二', '三']).toContain(fallback.char);
    expect(dealt.slice(0, 7).every((c) => c.outsideFocus)).toBe(true);
    expect(Boolean(fallback.outsideFocus)).toBe(fallback.char !== '三');
  });

  it('never lends to a focused break', async () => {
    const short = [row('一', 1, true)];
    const { service, seen } = makeService({}, short);
    await service.deal('u', { focusBreak: { setIds: [], remainingIds: [] } });
    expect(seen).toHaveLength(1);
    const ordinary = makeService({}, short);
    await ordinary.service.deal('u', { seedIds: [7] });
    expect(ordinary.seen[1]).toEqual([7, 99]);
  });
});

describe('writing level rules', () => {
  it('maps mastery to level: 0→1, 1→2, ≥7→8, fractional floors', () => {
    expect(writingLevelForMastery(0)).toBe(1);
    expect(writingLevelForMastery(1)).toBe(2);
    expect(writingLevelForMastery(2.5)).toBe(3);
    expect(writingLevelForMastery(7)).toBe(8);
    expect(writingLevelForMastery(8)).toBe(8);
  });
  it('counts a mark only when level > mastery', () => {
    expect(writingMarkCounts(1, 0)).toBe(true);
    expect(writingMarkCounts(3, 3)).toBe(false);
  });
  it('averages characters, skipping clock-only marks', () => {
    const correct = { timestamp: 't', isCorrect: true };
    expect(writingMasteryFromChars([{ writing: [correct, correct] }, { writing: [] }, undefined])).toBeCloseTo(2 / 3);
    expect(writingMasteryFromChars([{ writing: [{ ...correct, clockOnly: true }] }])).toBe(0);
  });
});

describe('medalForWritingGrid', () => {
  it('bands by total time', () => {
    expect(medalForWritingGrid(100_000)).toBe('gold');
    expect(medalForWritingGrid(200_000)).toBe('silver');
    expect(medalForWritingGrid(300_000)).toBe('bronze');
    expect(medalForWritingGrid(400_000)).toBeNull();
  });
});

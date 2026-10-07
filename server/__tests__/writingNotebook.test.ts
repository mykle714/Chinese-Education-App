import { describe, expect, it } from 'vitest';
import {
  decodeNotebookInk,
  distinctChars,
  encodeNotebookInk,
  isNotebookWord,
  sheetCount,
  type NotebookInk,
} from '../contracts/writingNotebook.js';
import { WritingNotebookService } from '../services/WritingNotebookService.js';
import type { IWritingNotebookDAL, NotebookCreditRow } from '../dal/interfaces/IWritingNotebookDAL.js';

/** A wobbly 200-point stroke — the shape a real pen drag produces. */
function wobblyStroke(): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 200; i++) {
    xs.push(0.1 + (0.8 * i) / 199);
    ys.push(0.5 + 0.2 * Math.sin(i / 15));
  }
  return { xs, ys };
}

describe('notebook ink codec', () => {
  it('round-trips within the quantisation + simplification tolerance', () => {
    const ink: NotebookInk = [wobblyStroke(), { xs: [0.5, 0.5], ys: [0.1, 0.9] }];
    const decoded = decodeNotebookInk(encodeNotebookInk(ink));
    expect(decoded).toHaveLength(2);
    // Endpoints survive exactly (to the grid).
    expect(decoded[1].xs).toEqual([0.5, 0.5]);
    expect(decoded[1].ys).toEqual([0.1, 0.9]);
    expect(decoded[0].xs[0]).toBeCloseTo(0.1, 3);
    expect(decoded[0].xs[decoded[0].xs.length - 1]).toBeCloseTo(0.9, 3);
  });

  it('is compact: a 200-point stroke shrinks well under raw JSON', () => {
    const ink: NotebookInk = [wobblyStroke()];
    const encoded = encodeNotebookInk(ink);
    expect(encoded.length).toBeLessThan(JSON.stringify(ink).length / 5);
    expect(decodeNotebookInk(encoded)[0].xs.length).toBeLessThan(200);
  });

  it('keeps a single-point tap as a dot', () => {
    expect(decodeNotebookInk(encodeNotebookInk([{ xs: [0.3], ys: [0.4] }]))).toEqual([{ xs: [0.3], ys: [0.4] }]);
  });

  it('clamps coordinates outside the cell', () => {
    const [s] = decodeNotebookInk(encodeNotebookInk([{ xs: [-0.2, 1.4], ys: [0.5, 0.5] }]));
    expect(s.xs).toEqual([0, 1]);
  });

  it('encodes empty ink as an empty sheet and decodes it back', () => {
    expect(decodeNotebookInk(encodeNotebookInk([]))).toEqual([]);
  });

  it('rejects malformed or out-of-cell encodings', () => {
    expect(() => decodeNotebookInk('{"xs":[]}')).toThrow();
    expect(() => decodeNotebookInk('v1:1,2,3')).toThrow(); // odd coordinate count
    expect(() => decodeNotebookInk('v1:zz,!!')).toThrow(); // not base 36
    expect(() => decodeNotebookInk('v1:rs,0,rs,0')).toThrow(); // 1000 + 1000 leaves the grid
  });
});

describe('sheetCount', () => {
  it('is the minimum over the word\'s distinct characters', () => {
    expect(sheetCount('明天', new Map([['明', 5], ['天', 2]]))).toBe(2);
  });
  it('is 0 while any character is unwritten', () => {
    expect(sheetCount('明天', new Map([['明', 5]]))).toBe(0);
  });
  it('counts a repeated character once (谢谢 needs only 谢)', () => {
    expect(distinctChars('谢谢')).toEqual(['谢']);
    expect(sheetCount('谢谢', new Map([['谢', 3]]))).toBe(3);
  });
});

describe('isNotebookWord', () => {
  it('admits all-Han words of one to four characters', () => {
    expect(isNotebookWord('一石二鸟')).toBe(true);
    expect(isNotebookWord('明')).toBe(true);
  });
  it('rejects words longer than four characters', () => {
    expect(isNotebookWord('中华人民共和国')).toBe(false);
  });
  it('rejects empty, non-Han and mixed words', () => {
    expect(isNotebookWord('')).toBe(false);
    expect(isNotebookWord('T恤')).toBe(false);
    expect(isNotebookWord(42)).toBe(false);
  });
});

/** In-memory DAL with the real counter semantics. */
function fakeDAL() {
  const cells = new Map<string, { ink: string; matchedChar: string | null }>();
  const key = (word: string, i: number) => `${word}#${i}`;
  const dal: IWritingNotebookDAL = {
    touchSheet: async () => {},
    findLastWord: async () => null,
    listCells: async (_u, _l, word, from, to) =>
      [...cells.entries()]
        .filter(([k]) => k.startsWith(`${word}#`))
        .map(([k, v]) => ({ cellIndex: Number(k.split('#')[1]), ink: v.ink }))
        .filter((c) => c.cellIndex >= from && c.cellIndex < to),
    upsertCell: async (_u, _l, word, i, ink, matchedChar) => { cells.set(key(word, i), { ink, matchedChar }); },
    deleteCell: async (_u, _l, word, i) => { cells.delete(key(word, i)); },
    listCredits: async (_u, _l, word) => {
      const tally = new Map<string, NotebookCreditRow>();
      for (const [k, v] of cells) {
        const w = k.split('#')[0];
        if ((word && w !== word) || !v.matchedChar) continue;
        const t = tally.get(`${w}|${v.matchedChar}`) ?? { word: w, matchedChar: v.matchedChar, credited: 0 };
        t.credited += 1;
        tally.set(`${w}|${v.matchedChar}`, t);
      }
      return [...tally.values()];
    },
    findNextEmpty: async () => 0,
  };
  return { dal, cells };
}

const INK = encodeNotebookInk([{ xs: [0.2, 0.8], ys: [0.5, 0.5] }]);

describe('WritingNotebookService.saveCell', () => {
  it('credits a top-1 match and reports the sheet counter', async () => {
    const { dal } = fakeDAL();
    const queue = ['明', '天'];
    const service = new WritingNotebookService(dal, async () => [queue.shift()!]);
    expect((await service.saveCell('u', 'zh', '明天', 0, INK)).count).toBe(0);
    expect((await service.saveCell('u', 'zh', '明天', 5, INK)).count).toBe(1);
  });

  it('does not credit a character outside the word, or a non-top-1 match', async () => {
    const { dal, cells } = fakeDAL();
    const service = new WritingNotebookService(dal, async () => ['朋', '明']);
    await service.saveCell('u', 'zh', '明', 0, INK);
    expect(cells.get('明#0')?.matchedChar).toBeNull();
  });

  it('re-validates an edited cell, so a count can fall', async () => {
    const { dal } = fakeDAL();
    let next = '明';
    const service = new WritingNotebookService(dal, async () => [next]);
    expect((await service.saveCell('u', 'zh', '明', 0, INK)).count).toBe(1);
    next = '朋';
    expect((await service.saveCell('u', 'zh', '明', 0, INK)).count).toBe(0);
  });

  it('reopening and closing unchanged never double counts', async () => {
    const { dal } = fakeDAL();
    const service = new WritingNotebookService(dal, async () => ['明']);
    await service.saveCell('u', 'zh', '明', 0, INK);
    expect((await service.saveCell('u', 'zh', '明', 0, INK)).count).toBe(1);
  });

  it('erasing a cell to blank deletes it', async () => {
    const { dal, cells } = fakeDAL();
    const service = new WritingNotebookService(dal, async () => ['明']);
    await service.saveCell('u', 'zh', '明', 0, INK);
    expect((await service.saveCell('u', 'zh', '明', 0, encodeNotebookInk([]))).count).toBe(0);
    expect(cells.has('明#0')).toBe(false);
  });

  it('saves the ink uncredited when the recogniser fails', async () => {
    const { dal, cells } = fakeDAL();
    const service = new WritingNotebookService(dal, async () => { throw new Error('upstream down'); });
    expect((await service.saveCell('u', 'zh', '明', 3, INK)).count).toBe(0);
    expect(cells.get('明#3')).toEqual({ ink: INK, matchedChar: null });
  });

  it('rejects bad words, indexes and ink', async () => {
    const { dal } = fakeDAL();
    const service = new WritingNotebookService(dal, async () => ['明']);
    await expect(service.saveCell('u', 'zh', 'abc', 0, INK)).rejects.toThrow();
    await expect(service.saveCell('u', 'zh', '明', -1, INK)).rejects.toThrow();
    await expect(service.saveCell('u', 'zh', '明', 1.5, INK)).rejects.toThrow();
    await expect(service.saveCell('u', 'zh', '明', 0, 'garbage')).rejects.toThrow();
  });
});

describe('WritingNotebookService.getSummary', () => {
  it('sums every sheet counter', async () => {
    const { dal } = fakeDAL();
    const queue = ['明', '天', '明', '谢', '谢'];
    const service = new WritingNotebookService(dal, async () => [queue.shift()!]);
    await service.saveCell('u', 'zh', '明天', 0, INK);
    await service.saveCell('u', 'zh', '明天', 1, INK);
    await service.saveCell('u', 'zh', '明天', 2, INK); // 明 ×2, 天 ×1 → 1
    await service.saveCell('u', 'zh', '谢谢', 0, INK);
    await service.saveCell('u', 'zh', '谢谢', 1, INK); // 谢 ×2 → 2
    expect((await service.getSummary('u', 'zh')).totalCount).toBe(3);
  });
});

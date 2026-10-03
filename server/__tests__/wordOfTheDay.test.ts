import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { WordOfTheDayService } from '../services/WordOfTheDayService.js';
import { parseWordOfTheDayContent } from '../contracts/wordOfTheDay.js';
import type { IDailyWordDAL, DailyWordRow } from '../dal/interfaces/IDailyWordDAL.js';
import type { WordOfTheDayContent } from '../contracts/wordOfTheDay.js';

// Word of the Day (docs/READING_WRITING_CENTERS.md § Phase 3). The model call is
// disabled here (no ANTHROPIC_API_KEY), so these cover the pin / read-back / validation
// paths; the prompt itself was verified once against the real API on dev.

const NOW = new Date('2026-10-02T12:00:00Z');

/** In-memory DAL: one det row per id, days pinned in a map. */
class FakeDailyWordDAL implements IDailyWordDAL {
  days = new Map<string, { detId: number; content: unknown }>();
  pickCalls: number[] = [];
  constructor(private readonly candidates: number[]) {}

  async findByDay(day: string): Promise<DailyWordRow | null> {
    const d = this.days.get(day);
    if (!d) return null;
    return {
      day, detId: d.detId, content: d.content, word1: '休', pronunciation: 'xiū',
      definition: 'to rest', definitionClusters: null, components: null,
    };
  }
  async pickCandidateDetId(excludeRecentDays: number): Promise<number | null> {
    this.pickCalls.push(excludeRecentDays);
    return this.candidates.shift() ?? null;
  }
  async pinDay(day: string, detId: number): Promise<void> {
    if (!this.days.has(day)) this.days.set(day, { detId, content: null });
  }
  async fillContent(day: string, content: WordOfTheDayContent): Promise<void> {
    const d = this.days.get(day);
    if (d && d.content == null) d.content = content;
  }
}

describe('WordOfTheDayService', () => {
  let savedKey: string | undefined;
  beforeEach(() => { savedKey = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => { if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey; });

  it('pins on the first request and reads the same word back afterwards', async () => {
    const dal = new FakeDailyWordDAL([7, 8]);
    const svc = new WordOfTheDayService(dal);
    const a = await svc.getForDay('2026-10-02', NOW);
    const b = await svc.getForDay('2026-10-02', NOW);
    expect(a.detId).toBe(7);
    expect(b.detId).toBe(7);
    expect(dal.pickCalls).toHaveLength(1);
    // No key → no body, but the word is still pinned and served.
    expect(a.content).toBeNull();
    expect(a.word).toBe('休');
  });

  it('keeps the word a concurrent first request pinned', async () => {
    const dal = new FakeDailyWordDAL([9]);
    dal.days.set('2026-10-02', { detId: 3, content: null }); // landed between our read and pin
    const svc = new WordOfTheDayService(dal);
    // findByDay sees the existing row, so no pick happens at all.
    expect((await svc.getForDay('2026-10-02', NOW)).detId).toBe(3);
  });

  it('serves a stored body as-is', async () => {
    const dal = new FakeDailyWordDAL([]);
    const body = { parts: [{ char: '亻', gloss: 'person', pinyin: 'rén', isRadical: true }, { char: '木', gloss: 'tree', pinyin: 'mù', isRadical: false }], explanation: '亻 (person) leans on 木 (tree).' };
    dal.days.set('2026-10-02', { detId: 1, content: body });
    const w = await new WordOfTheDayService(dal).getForDay('2026-10-02', NOW);
    expect(w.content).toEqual(body);
  });

  it('allows ±1 day (every timezone) and rejects anything further or malformed', async () => {
    const svc = new WordOfTheDayService(new FakeDailyWordDAL([1, 2, 3]));
    await expect(svc.getForDay('2026-10-01', NOW)).resolves.toBeTruthy();
    await expect(svc.getForDay('2026-10-03', NOW)).resolves.toBeTruthy();
    await expect(svc.getForDay('2026-10-05', NOW)).rejects.toThrow(/within one day/);
    await expect(svc.getForDay('10/02/2026', NOW)).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('falls back to allowing repeats when the recent-use window leaves no candidate', async () => {
    const dal = new FakeDailyWordDAL([]);
    dal.pickCandidateDetId = async (window: number) => { dal.pickCalls.push(window); return window === 0 ? 5 : null; };
    const w = await new WordOfTheDayService(dal).getForDay('2026-10-02', NOW);
    expect(w.detId).toBe(5);
    expect(dal.pickCalls).toEqual([365, 0]);
  });
});

describe('parseWordOfTheDayContent', () => {
  const ok = { parts: [{ char: '日', gloss: 'sun', pinyin: 'rì', isRadical: true }], explanation: 'x' };
  it('accepts a well-formed body', () => expect(parseWordOfTheDayContent(ok)).toEqual(ok));
  it('rejects multi-character parts, two radicals, or a missing explanation', () => {
    expect(parseWordOfTheDayContent({ ...ok, parts: [{ ...ok.parts[0], char: '日月' }] })).toBeNull();
    expect(parseWordOfTheDayContent({ ...ok, parts: [ok.parts[0], ok.parts[0]] })).toBeNull();
    expect(parseWordOfTheDayContent({ parts: ok.parts, explanation: ' ' })).toBeNull();
    expect(parseWordOfTheDayContent(null)).toBeNull();
  });
});

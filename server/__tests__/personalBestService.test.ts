import { describe, expect, it } from 'vitest';
import { PersonalBestService } from '../services/PersonalBestService.js';
import type { IPersonalBestDAL } from '../dal/interfaces/IPersonalBestDAL.js';
import type { PersonalBestRecord } from '../contracts/personalBests.js';

/** In-memory DAL honouring the same conditional-upsert rule as the SQL. */
function memoryDAL(): IPersonalBestDAL {
  const rows = new Map<string, PersonalBestRecord>();
  const key = (u: string, l: string, g: string, m: string) => `${u}|${l}|${g}|${m}`;
  return {
    async listForUser() { return [...rows.values()]; },
    async findOne(u, l, g, m) { return rows.get(key(u, l, g, m)) ?? null; },
    async upsertIfBetter(u, l, g, m, value, direction) {
      const k = key(u, l, g, m);
      const cur = rows.get(k);
      const better = !cur || (direction === 'lower' ? value < cur.bestValue : value > cur.bestValue);
      if (better) rows.set(k, { game: g, mode: m, bestValue: value, achievedAt: new Date().toISOString() });
      return rows.get(k)!;
    },
  };
}

describe('PersonalBestService', () => {
  it('first run is always a new best', async () => {
    const svc = new PersonalBestService(memoryDAL());
    const r = await svc.submit('u', 'zh', 'writing-grid', 'default', 90_000);
    expect(r).toMatchObject({ isNewBest: true, previousValue: null, best: { bestValue: 90_000 } });
  });

  it('time games keep the LOWER value', async () => {
    const svc = new PersonalBestService(memoryDAL());
    await svc.submit('u', 'zh', 'word-search', 'pinyin', 60_000);
    const slower = await svc.submit('u', 'zh', 'word-search', 'pinyin', 70_000);
    expect(slower).toMatchObject({ isNewBest: false, previousValue: 60_000, best: { bestValue: 60_000 } });
    const faster = await svc.submit('u', 'zh', 'word-search', 'pinyin', 50_000);
    expect(faster).toMatchObject({ isNewBest: true, previousValue: 60_000, best: { bestValue: 50_000 } });
  });

  it('score games keep the HIGHER value; modes are separate', async () => {
    const svc = new PersonalBestService(memoryDAL());
    await svc.submit('u', 'zh', 'match-speed', '1', 6);
    expect((await svc.submit('u', 'zh', 'match-speed', '1', 5)).isNewBest).toBe(false);
    expect((await svc.submit('u', 'zh', 'match-speed', '2', 5)).isNewBest).toBe(true);
  });

  it('rejects games without a personal best (Bubble Match, Memory Map)', async () => {
    const svc = new PersonalBestService(memoryDAL());
    await expect(svc.submit('u', 'zh', 'bubble-match', '1', 3)).rejects.toThrow();
    await expect(svc.submit('u', 'zh', 'memory-map', '1', 3)).rejects.toThrow();
  });
});

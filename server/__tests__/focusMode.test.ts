import { describe, it, expect } from 'vitest';
import { selectFocusSet, FocusModeService } from '../services/FocusModeService.js';
import type {
  FocusCardRow,
  FocusSnapshot,
  FocusState,
  IFocusModeDAL,
} from '../dal/interfaces/IFocusModeDAL.js';
import type { MasteryWorldId, ReviewMark, TypedMarkHistory } from '../contracts/wire.js';
import { FOCUS_DAILY_CARDS, FOCUS_QUOTAS } from '../contracts/focusMode.js';
import { barCategory } from '../contracts/mastery.js';

/**
 * Focus mode (docs/FOCUS_MODE.md): the daily set's selection (§ 3) and the service's
 * lazy snapshot / auto-off / correct-today rules (§ 2, § 4).
 */

// 12:00 UTC — mid streak day in UTC, so "today" is unambiguous.
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * Correct core marks per band, all 200 days old (past even Mastered's 180-day window),
 * so every such card is off cooldown. Probed against `barCategory`.
 */
const MARKS_FOR_BAND = { Unfamiliar: 1, Target: 3, Comfortable: 5, Mastered: 6 } as const;
type Band = keyof typeof MARKS_FOR_BAND;

let nextId = 1;
/** A core card in `band`; `newestAgoMs` moves its newest correct mark (cooling / today). */
function card(band: Band, newestAgoMs = 200 * DAY): FocusCardRow {
  const marks = (n: number): ReviewMark[] =>
    Array.from({ length: n }, (_, i) => ({
      isCorrect: true,
      timestamp: new Date(NOW - (i === 0 ? newestAgoMs : 200 * DAY + i * DAY)).toISOString(),
    })) as ReviewMark[];
  const n = MARKS_FOR_BAND[band];
  return {
    id: nextId++,
    typedMarkHistory: { recognition: marks(n), production: marks(n) } as TypedMarkHistory,
    writingMastery: null,
  };
}
const many = (band: Band, n: number) => Array.from({ length: n }, () => card(band));

describe('the band fixtures', () => {
  it('land in the band they name', () => {
    for (const band of Object.keys(MARKS_FOR_BAND) as Band[]) {
      expect(barCategory(card(band).typedMarkHistory, 'core')).toBe(band);
    }
  });
});

describe('selectFocusSet', () => {
  it('fills the Study Mix quotas scaled to 40 when every band has supply', () => {
    const cards = [...many('Unfamiliar', 30), ...many('Target', 30), ...many('Comfortable', 30), ...many('Mastered', 30)];
    const { ids, offCooldownTotal } = selectFocusSet(cards, NOW, 'core');
    expect(offCooldownTotal).toBe(120);
    expect(ids).toHaveLength(FOCUS_DAILY_CARDS);
    const byId = new Map(cards.map((c) => [c.id, c]));
    for (const quota of FOCUS_QUOTAS) {
      const inBand = ids.filter((id) => barCategory(byId.get(id)!.typedMarkHistory, 'core') === quota.category);
      expect(inBand).toHaveLength(quota.count);
    }
  });

  it('borrows a short band\'s shortfall from the others', () => {
    // No Mastered or Comfortable at all: their 12 slots go to Target, then Unfamiliar.
    const cards = [...many('Unfamiliar', 30), ...many('Target', 30)];
    const { ids } = selectFocusSet(cards, NOW, 'core');
    expect(ids).toHaveLength(FOCUS_DAILY_CARDS);
    expect(new Set(ids).size).toBe(FOCUS_DAILY_CARDS);
  });

  it('never picks a cooling card, and does not count it as off cooldown', () => {
    // Target's window is 12 h; a mark a minute ago rests it.
    const cooling = Array.from({ length: 10 }, () => card('Target', MINUTE));
    const ready = many('Target', 5);
    const { ids, offCooldownTotal } = selectFocusSet([...cooling, ...ready], NOW, 'core');
    expect(offCooldownTotal).toBe(5);
    expect(ids.sort()).toEqual(ready.map((c) => c.id).sort());
  });
});

/** In-memory IFocusModeDAL: one (user, language), cards held in a map. */
class FakeFocusDAL implements IFocusModeDAL {
  state: FocusState = { timezone: 'UTC', focusWorlds: [], focusEndedNotices: [] };
  snapshots = new Map<MasteryWorldId, FocusSnapshot>();
  cards = new Map<number, FocusCardRow>();

  async getState() { return { ...this.state, focusWorlds: [...this.state.focusWorlds], focusEndedNotices: [...this.state.focusEndedNotices] }; }
  async setWorldOn(_u: string, _l: string, world: MasteryWorldId, on: boolean) {
    const rest = this.state.focusWorlds.filter((w) => w !== world);
    this.state.focusWorlds = on ? [...rest, world] : rest;
  }
  async endWithNotice(_u: string, _l: string, world: MasteryWorldId) {
    this.state.focusWorlds = this.state.focusWorlds.filter((w) => w !== world);
    this.state.focusEndedNotices = [...this.state.focusEndedNotices.filter((w) => w !== world), world];
  }
  async clearNotices(_u: string, _l: string, worlds: MasteryWorldId[]) {
    this.state.focusEndedNotices = this.state.focusEndedNotices.filter((w) => !worlds.includes(w));
  }
  async getSnapshot(_u: string, _l: string, world: MasteryWorldId) { return this.snapshots.get(world) ?? null; }
  async claimSnapshot(_u: string, _l: string, world: MasteryWorldId, streakDate: string, vetIds: number[]) {
    const stored = this.snapshots.get(world);
    if (stored && stored.streakDate === streakDate) return stored;
    const snap = { streakDate, vetIds };
    this.snapshots.set(world, snap);
    return snap;
  }
  async listWorldCards() { return [...this.cards.values()]; }
  async listCardsByIds(_u: string, _l: string, ids: number[]) {
    return ids.map((id) => this.cards.get(id)).filter((c): c is FocusCardRow => !!c);
  }
}

function setup(cards: FocusCardRow[], focused: MasteryWorldId[] = ['core']) {
  const dal = new FakeFocusDAL();
  for (const c of cards) dal.cards.set(c.id, c);
  dal.state.focusWorlds = [...focused];
  let now = NOW;
  const service = new FocusModeService(dal, () => now);
  return { dal, service, setNow: (t: number) => { now = t; } };
}

describe('FocusModeService.resolveWorld', () => {
  it('is inactive for a world that is not focused', async () => {
    const { service } = setup(many('Target', 50), ['reading']);
    expect(await service.resolveWorld('u', 'zh', 'core')).toEqual({ active: false, ended: false });
  });

  it('takes the day\'s snapshot on first use and serves it unchanged on later calls', async () => {
    const { service, dal } = setup(many('Target', 60));
    const first = await service.resolveWorld('u', 'zh', 'core');
    expect(first.active && first.ids).toHaveLength(FOCUS_DAILY_CARDS);
    expect(dal.snapshots.get('core')?.streakDate).toBe('2026-10-20');
    const second = await service.resolveWorld('u', 'zh', 'core');
    expect(second).toEqual(first);
  });

  it('drops a card marked correct today, but keeps one marked wrong', async () => {
    const { service, dal } = setup(many('Target', 60));
    const first = await service.resolveWorld('u', 'zh', 'core');
    if (!first.active) throw new Error('expected active');
    const [right, wrong] = first.ids;
    const stamp = new Date(NOW - MINUTE).toISOString();
    const h = (id: number) => dal.cards.get(id)!.typedMarkHistory!;
    h(right).recognition = [{ isCorrect: true, timestamp: stamp } as ReviewMark, ...h(right).recognition!];
    h(wrong).recognition = [{ isCorrect: false, timestamp: stamp } as ReviewMark, ...h(wrong).recognition!];

    const after = await service.resolveWorld('u', 'zh', 'core');
    if (!after.active) throw new Error('expected active');
    expect(after.ids).not.toContain(right);
    expect(after.ids).toContain(wrong);
    expect(after.ids).toHaveLength(FOCUS_DAILY_CARDS - 1);
  });

  it('re-snapshots on a new streak day', async () => {
    const { service, dal, setNow } = setup(many('Target', 60));
    await service.resolveWorld('u', 'zh', 'core');
    setNow(NOW + DAY);
    await service.resolveWorld('u', 'zh', 'core');
    expect(dal.snapshots.get('core')?.streakDate).toBe('2026-10-21');
  });

  it('switches focus off and queues the popup when fewer than 40 cards are off cooldown', async () => {
    const { service, dal } = setup(many('Target', FOCUS_DAILY_CARDS - 1));
    expect(await service.resolveWorld('u', 'zh', 'core')).toEqual({ active: false, ended: true });
    expect(dal.state.focusWorlds).toEqual([]);
    expect(dal.state.focusEndedNotices).toEqual(['core']);
  });
});

describe('FocusModeService.getStatus / setFocus', () => {
  it('reports remaining counts for focused worlds and owed notices', async () => {
    const { service } = setup(many('Target', 60));
    const status = await service.getStatus('u', 'zh');
    expect(status.worlds.core).toEqual({ on: true, remaining: FOCUS_DAILY_CARDS });
    expect(status.worlds.reading).toEqual({ on: false, remaining: null });
    expect(status.endedNotices).toEqual([]);
  });

  it('turning a world back on clears its owed notice', async () => {
    const { service, dal } = setup(many('Target', 60), []);
    dal.state.focusEndedNotices = ['core'];
    const status = await service.setFocus('u', 'zh', 'core', true);
    expect(status.worlds.core.on).toBe(true);
    expect(status.endedNotices).toEqual([]);
  });
});

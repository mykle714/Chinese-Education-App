import { describe, it, expect } from 'vitest';
import { MemoryMapService, type MemoryMapLender } from '../services/MemoryMapService.js';
import type {
  IMemoryMapDAL,
  MemoryMapCandidateRow,
  MemoryMapSlotRow,
  NewSlot,
} from '../dal/interfaces/IMemoryMapDAL.js';
import { MEMORY_MAP_CAPACITY } from '../contracts/wire.js';

/**
 * MemoryMapService policy (docs/MEMORY_MAP_GAME.md § 2.1, § 3.6): the map fills to
 * capacity, empty slots fill before new ones are added, lending covers only what the
 * learner's own cards cannot, and a graduate's SLOT gets the replacement.
 *
 * The DAL is an in-memory fake with the real one's contract: slots by id ascending,
 * candidates = sorted cards (plus named lent ids) that occupy no slot.
 */

interface FakeCard {
  id: number;
  entryKey: string;
  lent: boolean;
  mastered?: boolean;
  definition?: string;
}

function fakeDal(cards: FakeCard[], initialSlots: MemoryMapSlotRow[] = []) {
  const slots = [...initialSlots];
  let nextId = Math.max(0, ...slots.map((s) => s.slotId)) + 1;
  const byId = new Map(cards.map((c) => [c.id, c]));

  const occupant = (row: MemoryMapSlotRow): MemoryMapSlotRow => {
    const card = row.vocabEntryId === null ? undefined : byId.get(row.vocabEntryId);
    return { ...row, entryKey: card?.entryKey ?? null, definition: card?.definition ?? null };
  };

  const dal: IMemoryMapDAL = {
    async getSlots() {
      return slots.map(occupant).sort((a, b) => a.slotId - b.slotId);
    },
    async getUnplacedCandidates(_u, _l, lentIds = []) {
      const placed = new Set(slots.map((s) => s.vocabEntryId));
      return cards
        .filter((c) => !c.mastered && !placed.has(c.id) && (!c.lent || lentIds.includes(c.id)))
        .map(
          (c): MemoryMapCandidateRow => ({
            vocabEntryId: c.id,
            entryKey: c.entryKey,
            language: 'zh',
            readingCategory: 'Unfamiliar',
            isLent: c.lent,
            definition: c.definition ?? `def-${c.id}`,
          })
        );
    },
    async writeSpawn(_u, _l, expected, fills, inserts: NewSlot[]) {
      if (slots.length !== expected) return false;
      for (const fill of fills) {
        const row = slots.find((s) => s.slotId === fill.slotId);
        if (row && row.vocabEntryId === null) row.vocabEntryId = fill.vocabEntryId;
      }
      const real = new Map<number, number>();
      for (const ins of inserts) {
        const id = nextId++;
        real.set(ins.tempId, id);
        slots.push({
          slotId: id,
          parentSlotId: ins.parentSlotId === null ? null : real.get(ins.parentSlotId) ?? ins.parentSlotId,
          link: ins.link,
          angle: ins.angle,
          tilt: ins.tilt,
          bow: ins.bow,
          scale: ins.scale,
          vocabEntryId: ins.vocabEntryId,
          entryKey: null,
          language: 'zh',
          pronunciation: null,
          definition: null,
          definitionClusters: null,
          selectedSense: null,
        });
      }
      return true;
    },
    async replaceOccupant(_u, _l, from, to) {
      const row = slots.find((s) => s.vocabEntryId === from);
      if (!row) return null;
      row.vocabEntryId = to;
      return row.slotId;
    },
    async isReadingMastered(_u, _l, id) {
      return byId.get(id)?.mastered === true;
    },
  };
  return { dal, slots, cards };
}

/** A lender that mints new lent cards on demand, recording what it was asked for. */
function fakeLender(cards: FakeCard[], supply = Infinity, definitionFor?: (n: number) => string | undefined) {
  const calls: number[] = [];
  let minted = 0;
  const lender: MemoryMapLender = {
    async acquireLentCards(_u, _l, count) {
      calls.push(count);
      const lentIds: number[] = [];
      while (lentIds.length < count && minted < supply) {
        const id = 10_000 + minted++;
        cards.push({ id, entryKey: '借', lent: true, definition: definitionFor?.(minted - 1) });
        lentIds.push(id);
      }
      return { lentIds, granted: lentIds.length, grantedWords: [] };
    },
  };
  return { lender, calls };
}

function ownCards(n: number): FakeCard[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, entryKey: '你好', lent: false }));
}

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('MemoryMapService.loadMap', () => {
  it('fills an empty map to capacity from the learner’s own cards, lending nothing', async () => {
    const { dal } = fakeDal(ownCards(80));
    const { lender, calls } = fakeLender([]);
    const map = await new MemoryMapService(dal, lender, seeded(1)).loadMap('u', 'zh');
    expect(map.slots).toHaveLength(MEMORY_MAP_CAPACITY);
    expect(map.words).toHaveLength(MEMORY_MAP_CAPACITY);
    expect(map.newlyPlaced).toHaveLength(MEMORY_MAP_CAPACITY);
    expect(calls).toEqual([]);
    expect(map.slots[0].parentSlotId).toBeNull();
  });

  it('lends exactly the shortfall when the learner cannot fill the map', async () => {
    const cards = ownCards(12);
    const { dal } = fakeDal(cards);
    const { lender, calls } = fakeLender(cards);
    const map = await new MemoryMapService(dal, lender, seeded(2)).loadMap('u', 'zh');
    expect(calls).toEqual([MEMORY_MAP_CAPACITY - 12]);
    expect(map.words).toHaveLength(MEMORY_MAP_CAPACITY);
  });

  it('lends again when a lent word loses the dd guard, so the map still ends full', async () => {
    const cards = ownCards(10).map((c) => (c.id === 1 ? { ...c, definition: 'happy' } : c));
    const { dal } = fakeDal(cards);
    // The first three lent words all read "happy", like card 1 already on the map.
    const { lender, calls } = fakeLender(cards, Infinity, (n) => (n < 3 ? 'happy' : undefined));
    const map = await new MemoryMapService(dal, lender, seeded(12)).loadMap('u', 'zh');
    expect(map.words).toHaveLength(MEMORY_MAP_CAPACITY);
    expect(calls).toEqual([MEMORY_MAP_CAPACITY - 10, 3]);
  });

  it('is a no-op on a full map', async () => {
    const cards = ownCards(80);
    const { dal } = fakeDal(cards);
    const service = new MemoryMapService(dal, fakeLender(cards).lender, seeded(3));
    await service.loadMap('u', 'zh');
    const again = await service.loadMap('u', 'zh');
    expect(again.newlyPlaced).toEqual([]);
    expect(again.slots).toHaveLength(MEMORY_MAP_CAPACITY);
  });

  it('fills EMPTY slots before adding new ones', async () => {
    const cards = ownCards(80);
    const { dal, slots } = fakeDal(cards);
    const service = new MemoryMapService(dal, fakeLender(cards).lender, seeded(4));
    await service.loadMap('u', 'zh');
    // A card was deleted: ON DELETE SET NULL empties its slot.
    slots[5].vocabEntryId = null;
    const map = await service.loadMap('u', 'zh');
    expect(map.slots).toHaveLength(MEMORY_MAP_CAPACITY);
    expect(map.newlyPlaced).toHaveLength(1);
    expect(map.slots[5].vocabEntryId).toBe(map.newlyPlaced[0]);
  });

  it('never puts two words with the same dd on one map', async () => {
    const cards = ownCards(80).map((c) => ({ ...c, definition: c.id % 2 === 0 ? 'happy' : `d${c.id}` }));
    const { dal } = fakeDal(cards);
    const map = await new MemoryMapService(dal, fakeLender(cards).lender, seeded(5)).loadMap('u', 'zh');
    expect(map.words.filter((w) => w.definition === 'happy')).toHaveLength(1);
  });
});

describe('MemoryMapService.graduate', () => {
  it('moves the replacement into the SAME slot', async () => {
    const cards = ownCards(80);
    const { dal, slots } = fakeDal(cards);
    const service = new MemoryMapService(dal, fakeLender(cards).lender, seeded(6));
    await service.loadMap('u', 'zh');
    const target = slots[7];
    const graduate = cards.find((c) => c.id === target.vocabEntryId)!;
    graduate.mastered = true;

    const result = await service.graduate('u', 'zh', graduate.id);
    expect(result.graduated).toBe(true);
    expect(result.replacement?.slotId).toBe(target.slotId);
    expect(slots).toHaveLength(MEMORY_MAP_CAPACITY);
    expect(slots[7].vocabEntryId).toBe(result.replacement?.vocabEntryId);
  });

  it('lends the replacement when the learner has none left', async () => {
    const cards = ownCards(MEMORY_MAP_CAPACITY);
    const { dal, slots } = fakeDal(cards);
    const { lender, calls } = fakeLender(cards);
    const service = new MemoryMapService(dal, lender, seeded(7));
    await service.loadMap('u', 'zh');
    const graduate = cards.find((c) => c.id === slots[0].vocabEntryId)!;
    graduate.mastered = true;

    const result = await service.graduate('u', 'zh', graduate.id);
    expect(calls).toEqual([1]);
    expect(result.replacement?.vocabEntryId).toBeGreaterThanOrEqual(10_000);
  });

  it('leaves the slot empty when nothing can be found or lent', async () => {
    const cards = ownCards(MEMORY_MAP_CAPACITY);
    const { dal, slots } = fakeDal(cards);
    const service = new MemoryMapService(dal, fakeLender(cards, 0).lender, seeded(8));
    await service.loadMap('u', 'zh');
    const graduate = cards.find((c) => c.id === slots[3].vocabEntryId)!;
    graduate.mastered = true;

    const result = await service.graduate('u', 'zh', graduate.id);
    expect(result).toEqual({ graduated: true, replacement: null });
    expect(slots[3].vocabEntryId).toBeNull();
    expect(slots).toHaveLength(MEMORY_MAP_CAPACITY);
  });

  it('does nothing for a word that is not yet mastered', async () => {
    const cards = ownCards(60);
    const { dal, slots } = fakeDal(cards);
    const service = new MemoryMapService(dal, fakeLender(cards).lender, seeded(9));
    await service.loadMap('u', 'zh');
    const before = slots.map((s) => s.vocabEntryId);
    expect(await service.graduate('u', 'zh', slots[0].vocabEntryId as number)).toEqual({
      graduated: false,
      replacement: null,
    });
    expect(slots.map((s) => s.vocabEntryId)).toEqual(before);
  });
});

import { describe, it, expect } from 'vitest';
import {
  bucketCandidates,
  orderByLocality,
  chunk,
  separateDuplicateHumans,
  commonGeoPrefix,
  clusterBucket,
} from '../services/arenaClustering.js';
import type { ArenaCandidate } from '../dal/interfaces/IArenaDAL.js';
import { ARENA_SIZE } from '../contracts/wire.js';

/** Terse candidate builder. */
function c(
  userId: string,
  opts: Partial<ArenaCandidate> = {},
): ArenaCandidate {
  return {
    userId,
    language: opts.language ?? 'zh',
    division: opts.division ?? 1,
    timezone: opts.timezone ?? 'America/New_York',
    geoCell: opts.geoCell === undefined ? 'dr5ru' : opts.geoCell,
  };
}

describe('bucketCandidates', () => {
  it('partitions on timezone AND division, never merging across either', () => {
    const buckets = bucketCandidates([
      c('a', { timezone: 'America/New_York', division: 1 }),
      c('b', { timezone: 'America/New_York', division: 1 }),
      c('c', { timezone: 'America/New_York', division: 2 }),
      c('d', { timezone: 'Asia/Tokyo', division: 1 }),
    ]);

    expect(buckets).toHaveLength(3);
    const ny1 = buckets.find((b) => b.timezone === 'America/New_York' && b.division === 1)!;
    expect(ny1.candidates.map((x) => x.userId)).toEqual(['a', 'b']);
  });

  it('keeps a timezone hard-partitioned even when geography would merge it', () => {
    // Detroit and Windsor are ~3km apart but in different zones by construction
    // here; timezone wins, because the arena needs one close instant.
    const buckets = bucketCandidates([
      c('detroit', { timezone: 'America/Detroit', geoCell: 'dpsc0' }),
      c('windsor', { timezone: 'America/Toronto', geoCell: 'dpsc0' }),
    ]);
    expect(buckets).toHaveLength(2);
  });
});

describe('orderByLocality', () => {
  it('sorts located candidates by geohash cell', () => {
    const out = orderByLocality([
      c('c3', { geoCell: 'gcpvj' }),
      c('c1', { geoCell: 'dr5ru' }),
      c('c2', { geoCell: 'dr72h' }),
    ]);
    expect(out.map((x) => x.geoCell)).toEqual(['dr5ru', 'dr72h', 'gcpvj']);
  });

  it('puts the location-less pool in its own group, after the located ones', () => {
    const out = orderByLocality([
      c('n1', { geoCell: null }),
      c('l1', { geoCell: 'dr5ru' }),
      c('n2', { geoCell: null }),
      c('l2', { geoCell: 'aaaaa'.replace(/a/g, 'b') }),
    ]);
    const cells = out.map((x) => x.geoCell);
    const firstNull = cells.indexOf(null);
    // Every located candidate precedes every location-less one.
    expect(cells.slice(0, firstNull).every((x) => x !== null)).toBe(true);
    expect(cells.slice(firstNull).every((x) => x === null)).toBe(true);
  });

  it('is deterministic — equal cells break ties on userId', () => {
    const input = [c('z', { geoCell: 'dr5ru' }), c('a', { geoCell: 'dr5ru' })];
    expect(orderByLocality(input).map((x) => x.userId)).toEqual(['a', 'z']);
    expect(orderByLocality([...input].reverse()).map((x) => x.userId)).toEqual(['a', 'z']);
  });
});

describe('chunk', () => {
  it('fills each arena to 25 before opening the next (§ 5.4)', () => {
    const candidates = Array.from({ length: 32 }, (_, i) => c(`u${i}`));
    const chunks = chunk(candidates);
    // 25 + 7, NOT 16 + 16 — splitting evenly would double the bot-heavy boards.
    expect(chunks.map((x) => x.length)).toEqual([25, 7]);
  });

  it('produces one chunk when the bucket is smaller than a full arena', () => {
    expect(chunk(Array.from({ length: 3 }, (_, i) => c(`u${i}`))).map((x) => x.length))
      .toEqual([3]);
  });

  it('produces exact runs when the bucket divides evenly', () => {
    const chunks = chunk(Array.from({ length: ARENA_SIZE * 3 }, (_, i) => c(`u${i}`)));
    expect(chunks).toHaveLength(3);
    expect(chunks.every((x) => x.length === ARENA_SIZE)).toBe(true);
  });

  it('handles an empty bucket', () => {
    expect(chunk([])).toEqual([]);
  });
});

describe('separateDuplicateHumans (Q18)', () => {
  it('separates a bilingual learner who would otherwise meet themselves', () => {
    // The default case, not an edge case: both memberships share a geoCell, so
    // they sort adjacent and land in the same chunk.
    const chunks = [
      [c('shared', { language: 'zh' }), c('shared', { language: 'es' }), c('other1')],
      [c('other2'), c('other3')],
    ];
    separateDuplicateHumans(chunks);

    for (const arena of chunks) {
      const ids = arena.map((m) => m.userId);
      expect(new Set(ids).size, `duplicate on board: ${ids}`).toBe(ids.length);
    }
  });

  it('preserves every membership — a swap moves, it never drops', () => {
    const chunks = [
      [c('shared', { language: 'zh' }), c('shared', { language: 'es' }), c('a')],
      [c('b'), c('d')],
    ];
    const before = chunks.flat().length;
    separateDuplicateHumans(chunks);
    expect(chunks.flat()).toHaveLength(before);

    const keys = chunks.flat().map((m) => `${m.userId}/${m.language}`).sort();
    expect(keys).toEqual(['a/zh', 'b/zh', 'd/zh', 'shared/es', 'shared/zh']);
  });

  it('keeps chunk sizes unchanged (a swap is symmetric)', () => {
    const chunks = [
      [c('x', { language: 'zh' }), c('x', { language: 'es' }), c('a')],
      [c('b'), c('d'), c('e')],
    ];
    separateDuplicateHumans(chunks);
    expect(chunks.map((x) => x.length)).toEqual([3, 3]);
  });

  it('leaves a lone chunk alone rather than corrupting it', () => {
    // Nowhere legal to move to. Better to leave the board imperfect than to
    // drop a membership or loop forever.
    const chunks = [[c('x', { language: 'zh' }), c('x', { language: 'es' })]];
    separateDuplicateHumans(chunks);
    expect(chunks[0]).toHaveLength(2);
  });

  it('resolves duplicates across a realistic multi-language bucket', () => {
    // 60 memberships, 20 of them bilingual humans sharing a cell.
    const candidates: ArenaCandidate[] = [];
    for (let i = 0; i < 20; i++) {
      candidates.push(c(`bi${i}`, { language: 'zh', geoCell: 'dr5ru' }));
      candidates.push(c(`bi${i}`, { language: 'es', geoCell: 'dr5ru' }));
    }
    for (let i = 0; i < 20; i++) candidates.push(c(`solo${i}`, { geoCell: 'dr5rv' }));

    const chunks = clusterBucket({
      timezone: 'America/New_York',
      division: 1,
      candidates,
    });

    expect(chunks.flat()).toHaveLength(60);
    for (const arena of chunks) {
      const ids = arena.map((m) => m.userId);
      expect(new Set(ids).size, `duplicate on board: ${ids}`).toBe(ids.length);
    }
  });
});

describe('commonGeoPrefix', () => {
  it('returns the longest shared prefix of the located members', () => {
    expect(commonGeoPrefix([c('a', { geoCell: 'dr5ru' }), c('b', { geoCell: 'dr5rv' })]))
      .toBe('dr5r');
  });

  it('returns null when members share nothing', () => {
    expect(commonGeoPrefix([c('a', { geoCell: 'dr5ru' }), c('b', { geoCell: 'gcpvj' })]))
      .toBeNull();
  });

  it('returns null for an all-location-less arena', () => {
    expect(commonGeoPrefix([c('a', { geoCell: null }), c('b', { geoCell: null })]))
      .toBeNull();
  });

  it('ignores location-less members rather than being defeated by them', () => {
    expect(commonGeoPrefix([
      c('a', { geoCell: 'dr5ru' }),
      c('b', { geoCell: null }),
      c('c', { geoCell: 'dr5rz' }),
    ])).toBe('dr5r');
  });
});

describe('clusterBucket determinism', () => {
  it('produces identical arenas from identical candidates, regardless of input order', () => {
    const base = Array.from({ length: 40 }, (_, i) =>
      c(`u${i}`, { geoCell: `dr5r${'0123456789bcdefghjkmnpqrstuvwxyz'[i % 32]}` }));

    const a = clusterBucket({ timezone: 'UTC', division: 1, candidates: [...base] });
    const b = clusterBucket({ timezone: 'UTC', division: 1, candidates: [...base].reverse() });

    expect(a.map((x) => x.map((m) => m.userId)))
      .toEqual(b.map((x) => x.map((m) => m.userId)));
  });
});

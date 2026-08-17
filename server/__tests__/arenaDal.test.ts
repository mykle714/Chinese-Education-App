import { describe, it, expect } from 'vitest';
import { ArenaDAL } from '../dal/implementations/ArenaDAL.js';

/**
 * ArenaDAL — the resolution transaction and the member insert.
 *
 * These are STATEMENT-SHAPE tests, not database tests. The suite runs without a
 * DB (see the other files here), and the hazard being guarded is a code shape
 * rather than a query result: docs/ARENA_FEATURE.md § 9 warns that if
 * resolveArena ever stops clearing `isLive` — or starts clearing it only for the
 * members it happens to have ranked — every member of that arena is permanently
 * locked out of all future arenas, silently. That is a refactor someone could
 * plausibly make while "tidying up", so it is asserted directly.
 *
 * The DB-level behaviour of the constraints themselves (the live-uniqueness
 * index blocking a second membership, and resolution freeing the seat) was
 * verified against the dev database when migration 146 was applied.
 */

/** A PoolClient stand-in that records every statement it is handed. */
function recordingClient(responses: Record<string, any> = {}) {
  const queries: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      for (const [needle, response] of Object.entries(responses)) {
        if (sql.includes(needle)) return response;
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { client, queries };
}

/** Normalise whitespace so assertions are not hostage to SQL formatting. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('ArenaDAL.resolveArena', () => {
  const rows = [
    { memberId: 'm1', finalRank: 1, divisionChange: 1 },
    { memberId: 'm2', finalRank: 2, divisionChange: 0 },
  ];

  it('clears isLive for EVERY member of the arena, not just the ranked ones', async () => {
    const dal = new ArenaDAL({} as any);
    const { client, queries } = recordingClient({
      'UPDATE arenas SET "resolvedAt"': { rows: [], rowCount: 1 },
    });

    await dal.resolveArena('arena-1', rows, client);

    const flip = queries.find((q) => flat(q.sql).includes('SET "isLive" = false'));
    expect(flip, 'resolveArena must clear isLive — see § 9 Q21').toBeDefined();

    // Scoped to the ARENA, never to a member list. If this assertion is failing
    // because someone scoped the flip to `rows`, that is the lockout bug.
    expect(flat(flip!.sql)).toContain('WHERE "arenaId" = $1');
    expect(flip!.params).toEqual(['arena-1']);
    expect(flat(flip!.sql)).not.toContain('"userId" = ANY');
    expect(flat(flip!.sql)).not.toContain('id = ANY');
  });

  it('flips liveness LAST, after the arena stamp and the rank writes', async () => {
    const dal = new ArenaDAL({} as any);
    const { client, queries } = recordingClient({
      'UPDATE arenas SET "resolvedAt"': { rows: [], rowCount: 1 },
    });

    await dal.resolveArena('arena-1', rows, client);

    const stampIdx = queries.findIndex((q) => flat(q.sql).includes('UPDATE arenas SET "resolvedAt"'));
    const flipIdx = queries.findIndex((q) => flat(q.sql).includes('SET "isLive" = false'));
    const rankIdx = queries.findIndex((q) => flat(q.sql).includes('SET "finalRank"'));

    expect(stampIdx).toBeGreaterThanOrEqual(0);
    expect(rankIdx).toBeGreaterThan(stampIdx);
    expect(flipIdx).toBeGreaterThan(rankIdx);
    expect(flipIdx).toBe(queries.length - 1);
  });

  it('stamps resolvedAt only while it is still NULL — the idempotency guard', async () => {
    const dal = new ArenaDAL({} as any);
    const { client, queries } = recordingClient({
      'UPDATE arenas SET "resolvedAt"': { rows: [], rowCount: 1 },
    });

    await dal.resolveArena('arena-1', rows, client);

    const stamp = queries.find((q) => flat(q.sql).includes('UPDATE arenas SET "resolvedAt"'))!;
    expect(flat(stamp.sql)).toContain('"resolvedAt" IS NULL');
  });

  it('does nothing at all when the arena was already resolved', async () => {
    const dal = new ArenaDAL({} as any);
    // rowCount 0 => the guard matched nothing => a concurrent run already won.
    const { client, queries } = recordingClient({
      'UPDATE arenas SET "resolvedAt"': { rows: [], rowCount: 0 },
    });

    await dal.resolveArena('arena-1', rows, client);

    expect(queries).toHaveLength(1);
    expect(queries.some((q) => flat(q.sql).includes('SET "finalRank"'))).toBe(false);
    expect(queries.some((q) => flat(q.sql).includes('SET "isLive"'))).toBe(false);
  });

  it('writes each member’s final rank and division change', async () => {
    const dal = new ArenaDAL({} as any);
    const { client, queries } = recordingClient({
      'UPDATE arenas SET "resolvedAt"': { rows: [], rowCount: 1 },
    });

    await dal.resolveArena('arena-1', rows, client);

    const rankWrites = queries.filter((q) => flat(q.sql).includes('SET "finalRank"'));
    expect(rankWrites).toHaveLength(2);
    expect(rankWrites[0].params).toEqual(['m1', 1, 1, 'arena-1']);
    expect(rankWrites[1].params).toEqual(['m2', 2, 0, 'arena-1']);
  });
});

describe('ArenaDAL.createArenaWithMembers', () => {
  const arena = {
    division: 3,
    timezone: 'America/New_York',
    geoCellPrefix: 'dr5ru',
    formationKind: 'batch' as const,
    weekStartsAt: new Date('2026-08-18T08:00:00Z'),
    closesAt: new Date('2026-08-23T20:00:00Z'),
  };

  it('binds every member value as a parameter — no interpolated SQL', async () => {
    const dal = new ArenaDAL({} as any);
    const { client, queries } = recordingClient({
      'INSERT INTO arenas': { rows: [{ id: 'arena-9' }], rowCount: 1 },
    });

    await dal.createArenaWithMembers(arena, [
      { userId: 'u1', language: 'zh' },
      { userId: null, language: 'es', syntheticName: "O'Brien", syntheticSeed: 7, syntheticTarget: 400 },
    ], client);

    const insert = queries.find((q) => flat(q.sql).includes('INSERT INTO arena_members'))!;
    // The apostrophe must travel as a parameter, never inside the statement.
    expect(insert.sql).not.toContain("O'Brien");
    expect(insert.params).toContain("O'Brien");
    // $1 is the shared arena id; 2 members x 6 columns = 12 more.
    expect(insert.params[0]).toBe('arena-9');
    expect(insert.params).toHaveLength(13);
    expect(flat(insert.sql)).toContain('($1, $2, $3, $4, $5, $6, $7), ($1, $8, $9, $10, $11, $12, $13)');
  });

  it('refuses to create an arena with no members', async () => {
    const dal = new ArenaDAL({} as any);
    const { client } = recordingClient();
    await expect(dal.createArenaWithMembers(arena, [], client)).rejects.toThrow(/members/i);
  });
});

describe('ArenaDAL.addMinutes', () => {
  it('only ever credits a LIVE membership', async () => {
    const dal = new ArenaDAL({} as any);
    const { client, queries } = recordingClient();

    await dal.addMinutes('u1', 'zh', 5, client);

    expect(flat(queries[0].sql)).toContain('"isLive"');
    expect(queries[0].params).toEqual(['u1', 'zh', 5]);
  });

  it('ignores non-positive and non-finite amounts without touching the database', async () => {
    const dal = new ArenaDAL({} as any);
    const { client, queries } = recordingClient();

    await dal.addMinutes('u1', 'zh', 0, client);
    await dal.addMinutes('u1', 'zh', -3, client);
    await dal.addMinutes('u1', 'zh', NaN, client);

    expect(queries).toHaveLength(0);
  });
});

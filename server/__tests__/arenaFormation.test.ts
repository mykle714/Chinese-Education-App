import { describe, it, expect } from 'vitest';
import { ArenaService } from '../services/ArenaService.js';
import type { IArenaDAL, ArenaCandidate, ArenaMemberSeed } from '../dal/interfaces/IArenaDAL.js';
import type { Arena } from '../types/arena.js';
import { ARENA_SIZE } from '../contracts/wire.js';

/**
 * Arena FORMATION TIMING and straggler seating (docs/ARENA_FEATURE.md § 5.3).
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * On 2026-08-17 the prod formation run fired at 21:06 local SUNDAY — roughly 31
 * hours before the Tuesday 03:00 snapshot it was supposed to take — because
 * `arenaFormationAt` was written, exported and never called. The bucket froze
 * around the five accounts that had opted in by then, and `arenaExistsForBucket`
 * then skipped every later opt-in for the rest of the break. Four real users
 * spent the week with no arena.
 *
 * Neither half of that produced an error: `formed 0` is also what a correct
 * quiet hour looks like. So the timing gate, the straggler seating that was
 * supposed to catch late arrivals, and the stranded-member alarm are all
 * asserted directly here rather than left to be noticed in production.
 *
 * These run against a fake DAL — the hazard is service-layer control flow
 * (which hour acts, and on whom), not SQL.
 */

/** Tuesday 2026-08-18 04:00 America/Los_Angeles (PDT, UTC-7). */
const LA_WEEK_START = new Date('2026-08-18T11:00:00Z');
/** The 03:00 local snapshot instant for that week. */
const LA_FORMATION_AT = new Date('2026-08-18T10:00:00Z');
/** The real instant prod formed at: Sunday 21:06 local, 31h early. */
const THE_BAD_HOUR = new Date('2026-08-17T04:06:01Z');
/** The hourly tick that lands just after the week goes live. */
const FIRST_LIVE_TICK = new Date('2026-08-18T11:06:00Z');

const LA_WEEK_KEY = '2026-08-18';

function candidate(userId: string, over: Partial<ArenaCandidate> = {}): ArenaCandidate {
  return {
    userId,
    language: 'zh',
    division: 1,
    timezone: 'America/Los_Angeles',
    geoCell: null,
    optInWeek: LA_WEEK_KEY,
    ...over,
  };
}

interface FakeState {
  arenas: (Arena & { seats: ArenaMemberSeed[] })[];
  seated: Set<string>;
}

/**
 * A DAL stand-in that models the two invariants formation actually depends on:
 * a bucket's arenas exist or they do not, and a seated (user, language) never
 * reappears as a candidate.
 */
function fakeDAL(candidates: ArenaCandidate[]) {
  const state: FakeState = { arenas: [], seated: new Set() };
  const key = (u: string, l: string) => `${u}|${l}`;
  let nextId = 1;

  const dal: Partial<IArenaDAL> = {
    async listUnseatedCandidates() {
      return candidates.filter((c) => !state.seated.has(key(c.userId, c.language)));
    },
    async arenaExistsForBucket(timezone, division, weekStartsAt) {
      return state.arenas.some(
        (a) => a.timezone === timezone && a.division === division
          && a.weekStartsAt.getTime() === weekStartsAt.getTime(),
      );
    },
    async findArenaWithFreeSeat(timezone, division, weekStartsAt) {
      const match = state.arenas
        .filter((a) => a.timezone === timezone && a.division === division
          && a.weekStartsAt.getTime() === weekStartsAt.getTime()
          && a.seats.some((s) => s.userId === null))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return match[0] ?? null;
    },
    async replaceSyntheticWithHuman(arenaId, userId, language) {
      const arena = state.arenas.find((a) => a.id === arenaId);
      const seat = arena?.seats.find((s) => s.userId === null);
      if (!arena || !seat) return false;
      seat.userId = userId;
      seat.language = language;
      seat.syntheticName = null;
      state.seated.add(key(userId, language));
      return true;
    },
    async createArenaWithMembers(arena, members) {
      const row = {
        ...arena,
        id: `arena-${nextId++}`,
        resolvedAt: null,
        createdAt: new Date(Date.now() + nextId),
        seats: members.map((m) => ({ ...m })),
      } as Arena & { seats: ArenaMemberSeed[] };
      for (const m of members) {
        if (m.userId) state.seated.add(key(m.userId, m.language));
      }
      state.arenas.push(row);
      return row;
    },
    async listUnresolvedArenas() {
      return [];
    },
  };

  return { dal: dal as IArenaDAL, state };
}

function service(candidates: ArenaCandidate[]) {
  const { dal, state } = fakeDAL(candidates);
  const userLookup = { async findById() { return null; } };
  return { svc: new ArenaService(dal, userLookup), state };
}

/** Every human seated across every arena, as "userId|language". */
function seatedHumans(state: FakeState): string[] {
  return state.arenas
    .flatMap((a) => a.seats)
    .filter((s) => s.userId !== null)
    .map((s) => `${s.userId}|${s.language}`)
    .sort();
}

describe('formArenas — the formation window', () => {
  it('does NOT form a bucket before its 03:00 snapshot, however many candidates are waiting', async () => {
    // THE REGRESSION. This is the exact instant, timezone and population shape
    // of the 2026-08-17 prod run.
    const { svc, state } = service([candidate('early-bird')]);

    const formed = await svc.formArenas(THE_BAD_HOUR);

    expect(formed).toEqual([]);
    expect(state.arenas).toHaveLength(0);
  });

  it('forms once the snapshot instant is reached', async () => {
    const { svc, state } = service([candidate('a'), candidate('b')]);

    const formed = await svc.formArenas(LA_FORMATION_AT);

    expect(formed).toHaveLength(1);
    expect(state.arenas[0].weekStartsAt.getTime()).toBe(LA_WEEK_START.getTime());
    expect(state.arenas[0].formationKind).toBe('batch');
    // Two humans, padded to a full board.
    expect(state.arenas[0].seats).toHaveLength(ARENA_SIZE);
    expect(seatedHumans(state)).toEqual(['a|zh', 'b|zh']);
  });

  it('ignores a stale opt-in left over from a previous week', async () => {
    // The opt-in column is self-expiring by design (§ 8) — nothing cleans it up,
    // so formation has to be the thing that refuses to act on last week's value.
    const { svc, state } = service([candidate('ghost', { optInWeek: '2026-08-11' })]);

    await svc.formArenas(LA_FORMATION_AT);

    expect(state.arenas).toHaveLength(0);
  });

  it('compares the opt-in key against the BUCKET\'s timezone, not the server\'s', async () => {
    // A Tokyo opt-in names the Tuesday in Tokyo. Formation must not measure it
    // against a week computed anywhere else.
    const { svc, state } = service([
      candidate('tokyo', { timezone: 'Asia/Tokyo', optInWeek: LA_WEEK_KEY }),
    ]);

    // Tokyo's snapshot is Tue 03:00 JST = Mon 18:00 UTC — well before LA's.
    await svc.formArenas(new Date('2026-08-17T18:30:00Z'));

    expect(state.arenas).toHaveLength(1);
    expect(state.arenas[0].timezone).toBe('Asia/Tokyo');
  });
});

describe('formArenas — stragglers', () => {
  it('seats a late opt-in into a formed bucket instead of skipping it', async () => {
    // THE SECOND REGRESSION. Before this, `arenaExistsForBucket` returned true
    // and the whole bucket was `continue`d — the late opt-in was dropped in
    // silence for the rest of the break.
    const candidates = [candidate('punctual')];
    const { svc, state } = service(candidates);

    await svc.formArenas(LA_FORMATION_AT);
    expect(state.arenas).toHaveLength(1);

    candidates.push(candidate('latecomer'));
    const formed = await svc.formArenas(FIRST_LIVE_TICK);

    // Seated into the existing board's synthetic seat — no second arena.
    expect(formed).toEqual([]);
    expect(state.arenas).toHaveLength(1);
    expect(seatedHumans(state)).toEqual(['latecomer|zh', 'punctual|zh']);
  });

  it('opens a straggler arena when every seat in the bucket is taken', async () => {
    const candidates = Array.from({ length: ARENA_SIZE }, (_, i) => candidate(`u${i}`));
    const { svc, state } = service(candidates);

    await svc.formArenas(LA_FORMATION_AT);
    expect(state.arenas[0].seats.every((s) => s.userId !== null)).toBe(true);

    candidates.push(candidate('overflow'));
    await svc.formArenas(FIRST_LIVE_TICK);

    expect(state.arenas).toHaveLength(2);
    // Tagged distinctly: straggler arenas are geographically worse by
    // construction and must never be averaged in with batch ones (§ 5.3).
    expect(state.arenas[1].formationKind).toBe('straggler');
    expect(seatedHumans(state)).toContain('overflow|zh');
  });

  it('never re-seats someone who already holds a live seat', async () => {
    const candidates = [candidate('a')];
    const { svc, state } = service(candidates);

    await svc.formArenas(LA_FORMATION_AT);
    await svc.formArenas(FIRST_LIVE_TICK);
    await svc.formArenas(FIRST_LIVE_TICK);

    expect(state.arenas).toHaveLength(1);
    expect(seatedHumans(state)).toEqual(['a|zh']);
  });
});

describe('tick — the stranded alarm', () => {
  it('reports zero when everyone who opted in got a seat', async () => {
    const { svc } = service([candidate('a'), candidate('b')]);

    const result = await svc.tick(LA_FORMATION_AT);

    expect(result.formed).toBe(1);
    expect(result.stranded).toBe(0);
  });

  it('counts an opted-in member whose week is live and who has no arena', async () => {
    // Simulates the prod state: seating is broken, the week has opened anyway.
    const { dal } = fakeDAL([candidate('abandoned')]);
    const broken: IArenaDAL = {
      ...dal,
      // Claim the bucket is formed, but offer no seat and refuse every insert —
      // exactly the shape that left four users boardless.
      async arenaExistsForBucket() { return true; },
      async findArenaWithFreeSeat() { return null; },
      async createArenaWithMembers() { throw new Error('insert rejected'); },
    };
    const svc = new ArenaService(broken, { async findById() { return null; } });

    const result = await svc.tick(FIRST_LIVE_TICK);

    expect(result.formed).toBe(0);
    expect(result.stranded).toBe(1);
  });

  it('does not count a member whose formation window has not arrived yet', async () => {
    const { svc } = service([candidate('waiting')]);

    const result = await svc.tick(THE_BAD_HOUR);

    expect(result.formed).toBe(0);
    expect(result.stranded).toBe(0);
  });
});

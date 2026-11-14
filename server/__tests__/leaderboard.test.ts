import { describe, expect, it, vi } from 'vitest';
import { LeaderboardService } from '../services/LeaderboardService.js';
import type { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import type { IUserMinutePointsDAL } from '../dal/interfaces/IUserMinutePointsDAL.js';
import type { IUserLanguagesDAL, UserPointsTotals } from '../dal/interfaces/IUserLanguagesDAL.js';
import type { IWinsDAL } from '../dal/interfaces/IWinsDAL.js';

/**
 * Tests for the leaderboard aggregate.
 *
 * Why this file exists: `getLeaderboard` used to call `getMinutesForDate` once per
 * user per date inside a sequential `for` loop — 2N round trips, with the minutes
 * for zero-point users fetched and then discarded by a filter that ran afterwards
 * (docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 1). It is now one grouped
 * query over the already-filtered user set.
 *
 * What these tests pin is the QUERY SHAPE, not just the output: a rewrite that
 * silently reintroduces per-user lookups still produces correct numbers, so the
 * call-count assertions are the point. They are only writable because every DAL
 * now takes an injected `dbManager` and can be substituted (finding 2).
 */

/**
 * One fixture user. `total`/`streak` are what the leaderboard should REPORT, which since
 * migration 130 no longer comes from `users` — the roster carries identity only and the figures
 * come from a grouped read over user_languages. `makeUsers` therefore splits each row into
 * the two sources the service actually consults, and `total`/`streak` stand for the user's
 * cross-language Σ wallet and MAX streak respectively.
 */
type MinuteRow = { userId: string; total: number; streak: number };

function makeUsers(rows: MinuteRow[]) {
  return rows;
}

/** Builds a service whose four DALs are spies over fixed data. */
function makeService(
  users: MinuteRow[],
  minutes: Map<string, Map<string, number>> = new Map(),
  weekly: Map<string, number> = new Map()
) {
  const getMinutesForDatesByUser = vi.fn().mockResolvedValue(minutes);
  const getMinutesForDate = vi.fn().mockResolvedValue(0);

  // Public identity only (username, never email) — no points live on `users` any more.
  const roster = users.map((r) => ({
    userId: r.userId,
    username: r.userId,
    name: r.userId,
    avatarIconId: null,
  }));

  // A user at zero is represented by an ABSENT row, exactly as the real grouped query does
  // (rows are created lazily on the first earned minute), so this also pins that
  // "no row" and "zero points" are treated identically.
  const totals = new Map<string, UserPointsTotals>(
    users
      .filter((r) => r.total > 0 || r.streak > 0)
      .map((r) => [r.userId, { userId: r.userId, totalMinutePoints: r.total, bestStreak: r.streak }])
  );

  const getTotalsForAllUsers = vi.fn().mockResolvedValue(totals);

  const userDAL = { getLeaderboardRoster: vi.fn().mockResolvedValue(roster) } as unknown as IUserDAL;
  const minutePointsDAL = { getMinutesForDatesByUser, getMinutesForDate } as unknown as IUserMinutePointsDAL;
  const languagePointsDAL = { getTotalsForAllUsers } as unknown as IUserLanguagesDAL;
  const winsDAL = { getWeeklyCountsByUser: vi.fn().mockResolvedValue(weekly) } as unknown as IWinsDAL;

  return {
    service: new LeaderboardService(userDAL, minutePointsDAL, languagePointsDAL, winsDAL),
    getMinutesForDatesByUser,
    getMinutesForDate,
    getTotalsForAllUsers,
  };
}

/** The service's own notion of "today" — local calendar day, YYYY-MM-DD. */
const TODAY = new Intl.DateTimeFormat('en-CA').format(new Date());

describe('LeaderboardService.getLeaderboard', () => {
  it('issues ONE batched minutes query, never a per-user lookup', async () => {
    const { service, getMinutesForDatesByUser, getMinutesForDate, getTotalsForAllUsers } = makeService(
      makeUsers([
        { userId: 'a', total: 100, streak: 3 },
        { userId: 'b', total: 50, streak: 1 },
        { userId: 'c', total: 25, streak: 0 },
      ])
    );

    await service.getLeaderboard();

    expect(getMinutesForDatesByUser).toHaveBeenCalledTimes(1);
    // The N+1 regression guard: the single-row method must not be reached at all.
    expect(getMinutesForDate).not.toHaveBeenCalled();
    // Same guard for the per-language wallets: one grouped read for everybody, never
    // a getProgress()/getAllProgress() per user inside the render loop.
    expect(getTotalsForAllUsers).toHaveBeenCalledTimes(1);
  });

  it('asks only for users that will be rendered, and for exactly two dates', async () => {
    const { service, getMinutesForDatesByUser } = makeService(
      makeUsers([
        { userId: 'ranked', total: 100, streak: 3 },
        { userId: 'zero', total: 0, streak: 0 },
      ])
    );

    await service.getLeaderboard();

    const [userIds, dates] = getMinutesForDatesByUser.mock.calls[0];
    // 'zero' is filtered out BEFORE the query — fetching its minutes would be work
    // thrown away, which is what the old ordering did.
    expect(userIds).toEqual(['ranked']);
    expect(dates).toHaveLength(2);
    expect(dates[0]).toBe(TODAY);
  });

  it('defaults a user with no recorded minutes to 0 rather than undefined', async () => {
    // 'b' is absent from the map entirely — the DAL omits empty pairs.
    const minutes = new Map([['a', new Map([[TODAY, 42]])]]);
    const { service } = makeService(
      makeUsers([
        { userId: 'a', total: 100, streak: 3 },
        { userId: 'b', total: 50, streak: 1 },
      ]),
      minutes
    );

    const result = await service.getLeaderboard();

    expect(result.data[0].todaysMinutes).toBe(42);
    expect(result.data[0].yesterdaysMinutes).toBe(0);
    expect(result.data[1].todaysMinutes).toBe(0);
  });

  it('ranks by yesterday minutes, then by lifetime total', async () => {
    const yesterday = new Intl.DateTimeFormat('en-CA').format(
      new Date(Date.parse(`${TODAY}T12:00:00Z`) - 24 * 3600 * 1000)
    );
    const minutes = new Map([
      ['low', new Map([[yesterday, 10]])],
      ['high', new Map([[yesterday, 90]])],
    ]);
    const { service } = makeService(
      makeUsers([
        { userId: 'low', total: 999, streak: 0 },
        { userId: 'high', total: 1, streak: 0 },
      ]),
      minutes
    );

    const result = await service.getLeaderboard();

    // Yesterday's minutes win over the much larger lifetime total.
    expect(result.data.map((e) => e.userId)).toEqual(['high', 'low']);
    expect(result.data.map((e) => e.rank)).toEqual([1, 2]);
  });

  it('shows every account\'s streak and never ships an email (isPublic removed, LOGIN_REWORK Q7/Q20)', async () => {
    const { service } = makeService(
      makeUsers([
        { userId: 'quiet', total: 100, streak: 7 },
        { userId: 'open', total: 50, streak: 5 },
      ])
    );

    const result = await service.getLeaderboard();

    expect(result.data.find((e) => e.userId === 'quiet')!.currentStreak).toBe(7);
    expect(result.data.find((e) => e.userId === 'open')!.currentStreak).toBe(5);
    expect(result.data.every((e) => !('email' in e))).toBe(true);
    expect(result.data.find((e) => e.userId === 'open')!.username).toBe('open');
  });

  it('returns empty without querying minutes when every user has zero points', async () => {
    const { service, getMinutesForDatesByUser } = makeService(
      makeUsers([{ userId: 'zero', total: 0, streak: 0 }])
    );

    const result = await service.getLeaderboard();

    expect(result.data).toEqual([]);
    expect(result.totalUsers).toBe(0);
    // Nothing to rank means the query is skipped entirely, not run with an empty list.
    expect(getMinutesForDatesByUser).not.toHaveBeenCalled();
  });
});

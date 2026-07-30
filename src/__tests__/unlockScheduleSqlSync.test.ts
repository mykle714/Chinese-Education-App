/**
 * Guards that the GENERATED unlock-schedule block in the inactivity-penalty cron SQL is current.
 *
 * The night-market unlock schedule is written down in exactly ONE place —
 * `server/dal/shared/unlockSchedule.ts`. The grant flow imports it; the cron
 * (`database/cron/expire-stale-streaks.sql`) can't, so it calls a SQL function whose body is
 * generated from that table by `renderUnlocksForMinutesSql`. This test fails when the checked-in
 * block no longer matches the render — i.e. when someone moved a breakpoint and forgot
 * `npm run gen:unlock-schedule-sql`. A stale block means the cron trims occupants to a DIFFERENT
 * target than the grant flow fills to: the two then fight every hour.
 *
 * It also re-derives the whole curve from the SQL arms and checks it against `unlocksForMinutes`,
 * so a bug in the RENDERER (wrong arm order, a dropped breakpoint) is caught too — not just drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { unlocksForMinutes, UNLOCK_BREAKPOINTS } from '../../server/dal/shared/unlockSchedule';
import {
  renderUnlocksForMinutesSql,
  withRenderedUnlockSql,
  UNLOCK_SQL_BEGIN_MARKER,
  UNLOCKS_FN_NAME,
} from '../../server/dal/shared/unlockScheduleSql';

const CRON_SQL_PATH = resolve(__dirname, '../../database/cron/expire-stale-streaks.sql');
const cronSql = readFileSync(CRON_SQL_PATH, 'utf8');

describe('unlock-schedule SQL generation', () => {
  it('the cron SQL carries the current generated block (run npm run gen:unlock-schedule-sql)', () => {
    expect(withRenderedUnlockSql(cronSql)).toBe(cronSql);
  });

  it('the cron SQL states no breakpoints of its own — it calls the generated function', () => {
    const outsideBlock = cronSql.slice(0, cronSql.indexOf(UNLOCK_SQL_BEGIN_MARKER));
    const decayCte = cronSql.slice(cronSql.indexOf('decay_targets AS ('));

    // The decay target must be the function call, not a hand-written ladder.
    expect(decayCte).toContain(`${UNLOCKS_FN_NAME}(new_total)`);
    expect(decayCte).not.toMatch(/WHEN new_total >=/);
    // Nothing before the generated block should be computing unlocks either.
    expect(outsideBlock).not.toMatch(/WHEN new_total >=/);
  });

  /**
   * Evaluate the generated CASE the way Postgres would (first matching arm wins) and compare to
   * the TS function across every breakpoint boundary ±1 plus a few steady-state hours.
   */
  it('the generated SQL computes the same curve as unlocksForMinutes', () => {
    const arms = [...renderUnlocksForMinutesSql().matchAll(/WHEN minutes >= (\d+) THEN (.+)$/gm)].map(
      ([, threshold, expr]) => ({ threshold: Number(threshold), expr: expr.trim() }),
    );
    expect(arms.length).toBeGreaterThan(0);

    const evalSql = (m: number): number => {
      for (const { threshold, expr } of arms) {
        if (m < threshold) continue;
        // Two shapes only: a bare integer, or the steady-state `A + floor((m - B) / C)::int`.
        const steady = expr.match(/^(\d+) \+ floor\(\(minutes - (\d+)\) \/ (\d+)\)::int$/);
        if (!steady) return Number(expr);
        const [, base, from, per] = steady;
        return Number(base) + Math.floor((m - Number(from)) / Number(per));
      }
      return 0;
    };

    const probes = new Set<number>([0, 1, 121, 180, 600, 1440]);
    for (const [minMinutes] of UNLOCK_BREAKPOINTS) {
      probes.add(Math.max(0, minMinutes - 1));
      probes.add(minMinutes);
      probes.add(minMinutes + 1);
    }

    for (const m of [...probes].sort((a, b) => a - b)) {
      expect({ m, sql: evalSql(m) }).toEqual({ m, sql: unlocksForMinutes(m) });
    }
  });
});

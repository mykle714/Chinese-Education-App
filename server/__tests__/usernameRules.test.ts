import { describe, expect, it } from 'vitest';
import { usernameProblem, normalizeUsername } from '../contracts/wire.js';

/**
 * The username rule (Instagram's, owner 2026-11-15): server/contracts/wire.ts → usernameProblem,
 * mirrored by migration 190's chk_users_username_shape. Docs: docs/LOGIN_REWORK.md Q21.
 */
describe('usernameProblem (Instagram rules)', () => {
  it('accepts letters, numbers, underscores and periods, 1–30 long, any first character but a period', () => {
    for (const ok of ['a', 'x1', '1abc', '_under', 'first.last', 'a.b.c', 'a_b.c_d', 'z'.repeat(30)]) {
      expect(usernameProblem(ok), ok).toBeNull();
    }
  });
  it('accepts every old-shape (migration 188) name, so migration 190 is a superset', () => {
    for (const old of ['abc', 'learner_2', 'a'.repeat(20)]) expect(usernameProblem(old), old).toBeNull();
  });
  it('rejects empty and over-long names', () => {
    expect(usernameProblem('')).toBe('Enter a username');
    expect(usernameProblem('z'.repeat(31))).toBe('Please use at most 30 characters');
  });
  it('rejects other characters', () => {
    for (const bad of ['a-b', 'a b', 'émile', 'a@b']) expect(usernameProblem(bad), bad).toBe('Only letters, numbers, underscores and periods');
  });
  it('rejects a period at either end, or two in a row', () => {
    expect(usernameProblem('.abc')).toBe("Can't start or end with a period");
    expect(usernameProblem('abc.')).toBe("Can't start or end with a period");
    expect(usernameProblem('a..b')).toBe("Can't have two periods in a row");
  });
  it('rejects reserved names', () => {
    expect(usernameProblem('admin')).toBe('That username is reserved');
  });
  it('normalizes before checking: trims, drops a leading @, lowercases', () => {
    expect(normalizeUsername('  @First.Last ')).toBe('first.last');
  });
});

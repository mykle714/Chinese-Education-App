/**
 * gamePool.test.ts — `gamePoolParams`, the one querystring builder every game's pool
 * request goes through (src/api/gamePool.ts).
 *
 * Pinned because it replaced six hand-built querystrings, and the wire contract is read by
 * the server param by param (OnDeckVocabController.getGamePool): a dropped `seedIds`
 * loses an flp break's working loop, a dropped `anytime` 400s a tester's challenge board,
 * and a stray `contested=exclude` outside a challenge means nothing.
 */

import { describe, it, expect } from 'vitest';
import { gamePoolParams } from '../gamePool';

describe('gamePoolParams', () => {
  it('builds a full board: markType, surface and the band quotas, nothing else', () => {
    expect(gamePoolParams({
      markType: 'recognition',
      surface: 'bubble-match',
      distribution: { Unfamiliar: 2, Target: 10 },
    })).toEqual({ markType: 'recognition', surface: 'bubble-match', Unfamiliar: 2, Target: 10 });
  });

  it('adds refill params, joining id lists and dropping empty ones', () => {
    const params = gamePoolParams({
      markType: 'reading',
      need: 4,
      exclude: [1, 2, 3],
      avoid: [],
    });
    expect(params.need).toBe(4);
    expect(params.exclude).toBe('1,2,3');
    expect(params).not.toHaveProperty('avoid');
  });

  it('flags an flp break, and leaves the param off otherwise', () => {
    expect(gamePoolParams({ markType: 'recognition', flpBreak: true }).flpBreak).toBe(1);
    expect('flpBreak' in gamePoolParams({ markType: 'recognition' })).toBe(false);
  });

  it('joins seedIds (an flp game break\'s working loop) and drops an empty seed', () => {
    expect(gamePoolParams({ markType: 'recognition', seedIds: [7, 8, 9] }).seedIds).toBe('7,8,9');
    expect('seedIds' in gamePoolParams({ markType: 'recognition', seedIds: [] })).toBe(false);
  });

  it('keeps need=0 (a real value, not "absent")', () => {
    expect(gamePoolParams({ markType: 'recognition', need: 0 }).need).toBe(0);
  });

  it('serializes strictBuckets and lendLevelOffset (including offset 0)', () => {
    const params = gamePoolParams({ markType: 'recognition', strictBuckets: true, lendLevelOffset: 0 });
    expect(params.strictBuckets).toBe(1);
    expect(params.lendLevelOffset).toBe(0);
  });

  it('passes the challenge suffix through verbatim, including the anytime hatch', () => {
    const params = gamePoolParams({
      markType: 'recognition',
      challengeParams: '&challengeId=abc&gameId=match-speed&mode=mixed&anytime=1',
    });
    expect(params).toMatchObject({ challengeId: 'abc', gameId: 'match-speed', mode: 'mixed', anytime: '1' });
  });

  it('sends contested=exclude only inside a challenge round', () => {
    expect(gamePoolParams({ markType: 'recognition', excludeContested: true })).not.toHaveProperty('contested');
    expect(gamePoolParams({
      markType: 'recognition',
      excludeContested: true,
      challengeParams: '&challengeId=abc&gameId=match-speed',
    }).contested).toBe('exclude');
  });
});

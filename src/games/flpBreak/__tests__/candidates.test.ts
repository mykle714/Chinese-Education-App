/**
 * candidates.test.ts — which games an flp game break may offer, and how one is picked
 * (src/games/flpBreak/candidates.ts, docs/FLP_GAME_BREAKS.md § 3).
 *
 * Pinned because the set is DERIVED, not listed: a wrong track/bar match would offer a
 * game whose marks land on a different bar than the session is studying.
 */

import { describe, it, expect } from 'vitest';
import type { GameDef } from '../../types';
import { flpBreakCandidates, pickBreakCandidate, breakShowsPinyin } from '../candidates';

// Only the fields the derivation reads; the rest of GameDef is irrelevant here.
const game = (over: Partial<GameDef> & { gameId: string }): GameDef =>
  ({ title: over.gameId, glyph: 'x', route: `/games/${over.gameId}`, hue: 'blu', Component: null, ...over }) as unknown as GameDef;

const REGISTRY: GameDef[] = [
  game({ gameId: 'match-speed', markType: 'recognition' }),
  game({ gameId: 'bubble-match', markType: 'recognition', noPinyinMarkType: 'reading' }),
  game({ gameId: 'speed-reading', markType: 'reading', languages: ['zh'], hiddenFromHub: true }),
  game({ gameId: 'word-search', modes: [{ mode: 'pinyin', markType: 'production' }, { mode: 'no-pinyin', markType: 'reading' }] }),
  game({ gameId: 'writing-grid', markType: 'writing', languages: ['zh'], hiddenFromHub: true }),
];
const all = (_id: string): boolean => true; // eslint-disable-line @typescript-eslint/no-unused-vars
const keys = (world: 'core' | 'reading' | 'writing', language: 'zh' | 'es' = 'zh', has = all) =>
  flpBreakCandidates(REGISTRY, has, world, language).map((c) => c.key);

describe('flpBreakCandidates', () => {
  it('core flp: recognition + production games, pinyin shown', () => {
    expect(keys('core')).toEqual(['match-speed:', 'bubble-match:', 'word-search:pinyin']);
    expect(flpBreakCandidates(REGISTRY, all, 'core', 'zh').every((c) => c.showPinyin)).toBe(true);
  });

  it('reading flp: reading games incl. hub-hidden ones and Bubble Match with pinyin hidden', () => {
    expect(keys('reading')).toEqual(['bubble-match:', 'speed-reading:', 'word-search:no-pinyin']);
    const bubble = flpBreakCandidates(REGISTRY, all, 'reading', 'zh').find((c) => c.game.gameId === 'bubble-match');
    expect(bubble?.markType).toBe('reading');
    expect(bubble?.showPinyin).toBe(false);
  });

  it('a pinyin-tracked game stays on recognition outside zh, so es reading never gets it', () => {
    expect(keys('reading', 'es')).toEqual(['word-search:no-pinyin']);
  });

  it('writing flp: writing games only', () => {
    expect(keys('writing')).toEqual(['writing-grid:']);
    expect(keys('writing', 'es')).toEqual([]);
  });

  it('a game without a break adapter is never offered', () => {
    expect(keys('core', 'zh', (id) => id === 'match-speed')).toEqual(['match-speed:']);
  });
});

describe('pickBreakCandidate', () => {
  const pool = flpBreakCandidates(REGISTRY, all, 'core', 'zh');

  it('never repeats the previous break when another option exists', () => {
    for (let i = 0; i < 20; i++) {
      expect(pickBreakCandidate(pool, 'match-speed:', () => i / 20)?.key).not.toBe('match-speed:');
    }
  });

  it('repeats when the previous break is the only option', () => {
    const only = pool.filter((c) => c.key === 'match-speed:');
    expect(pickBreakCandidate(only, 'match-speed:')?.key).toBe('match-speed:');
  });

  it('returns null with nothing to offer, and clamps rng() === 1', () => {
    expect(pickBreakCandidate([], null)).toBeNull();
    expect(pickBreakCandidate(pool, null, () => 1)).not.toBeNull();
  });
});

describe('breakShowsPinyin', () => {
  it('hides pinyin only on the reading flp', () => {
    expect([breakShowsPinyin('core'), breakShowsPinyin('reading'), breakShowsPinyin('writing')]).toEqual([true, false, true]);
  });
});

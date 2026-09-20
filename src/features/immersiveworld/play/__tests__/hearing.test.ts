/**
 * hearing.test.ts — who can hear a line at a given volume (§ 4c).
 *
 * The old version of this file tested an automatic earshot model with radii and occluders,
 * and was deleted with it. What is tested now is much smaller and has one property worth
 * defending above all others: **each rule is a sentence a learner could be told.** A test
 * that is hard to state in one line is a rule that will read as a bug in play.
 */

import { describe, it, expect } from 'vitest';
import { audibleListeners, hears, whisperCell } from '../hearing';
import { IW_TALK_RADIUS } from '../../../../../server/contracts/iw';

const at = (col: number, row: number) => ({ col, row });
const ORIGIN = at(5, 5);

describe('whisperCell', () => {
  it('is the single square the avatar is looking at', () => {
    expect(whisperCell(ORIGIN, 'n')).toBe('5,4');
    expect(whisperCell(ORIGIN, 's')).toBe('5,6');
    expect(whisperCell(ORIGIN, 'e')).toBe('6,5');
    expect(whisperCell(ORIGIN, 'w')).toBe('4,5');
  });
});

describe('hears — whisper', () => {
  it('reaches the body directly in front', () => {
    expect(hears('whisper', ORIGIN, 'e', at(6, 5))).toBe(true);
  });

  /**
   * ⚠️ The rule is a CELL, not a radius, and this is the case that proves it: a body one
   * tile away diagonally, or behind, is as unreachable as one across the room. "Within one
   * tile" would be eight squares and would include the person at your shoulder.
   */
  it('does not reach a neighbour who is merely adjacent', () => {
    expect(hears('whisper', ORIGIN, 'e', at(6, 6))).toBe(false);
    expect(hears('whisper', ORIGIN, 'e', at(4, 5))).toBe(false);
    expect(hears('whisper', ORIGIN, 'e', at(5, 4))).toBe(false);
  });

  it('follows the facing, so turning changes who hears it', () => {
    const listener = at(5, 4);
    expect(hears('whisper', ORIGIN, 'e', listener)).toBe(false);
    expect(hears('whisper', ORIGIN, 'n', listener)).toBe(true);
  });

  it('never reaches the speaker’s own square', () => {
    expect(hears('whisper', ORIGIN, 'n', ORIGIN)).toBe(false);
  });
});

describe('hears — talk', () => {
  it('reaches exactly to the radius and no further', () => {
    expect(hears('talk', ORIGIN, 'n', at(5 + IW_TALK_RADIUS, 5))).toBe(true);
    expect(hears('talk', ORIGIN, 'n', at(5 + IW_TALK_RADIUS + 1, 5))).toBe(false);
  });

  it('ignores the facing — a normal voice carries behind you', () => {
    const behind = at(5, 7);
    expect(hears('talk', ORIGIN, 'n', behind)).toBe(true);
    expect(hears('talk', ORIGIN, 's', behind)).toBe(true);
  });

  it('measures in Chebyshev cells, so a diagonal is not further', () => {
    expect(hears('talk', ORIGIN, 'n', at(5 + IW_TALK_RADIUS, 5 + IW_TALK_RADIUS))).toBe(true);
  });
});

describe('hears — shout', () => {
  it('reaches everybody, at any distance and any facing', () => {
    expect(hears('shout', ORIGIN, 'n', at(500, 500))).toBe(true);
    expect(hears('shout', ORIGIN, 's', at(5, 4))).toBe(true);
  });
});

describe('audibleListeners', () => {
  const cast = [
    { id: 'front', cell: at(6, 5) },
    { id: 'beside', cell: at(5, 6) },
    { id: 'across', cell: at(30, 5) },
  ];

  it('narrows to one body on a whisper, and to nobody when that square is empty', () => {
    expect(audibleListeners('whisper', ORIGIN, 'e', cast)).toEqual(['front']);
    expect(audibleListeners('whisper', ORIGIN, 'w', cast)).toEqual([]);
  });

  it('drops the far body at a normal voice and keeps it on a shout', () => {
    expect(audibleListeners('talk', ORIGIN, 'e', cast)).toEqual(['front', 'beside']);
    expect(audibleListeners('shout', ORIGIN, 'e', cast)).toEqual(['front', 'beside', 'across']);
  });
});

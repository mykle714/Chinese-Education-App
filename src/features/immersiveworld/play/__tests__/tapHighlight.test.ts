import { describe, expect, it } from 'vitest';
import { freeFarmTileset } from '../../../../engine/market/freeFarmTileset';
import { lumeishTileset } from '../../../../engine/market/lumeishTileset';
import { furnitureCells } from '../../../../engine/market/furniture';
import {
  resolveTapHighlight, TAP_HIGHLIGHT_MS, TAP_RIPPLE_MS, tapHighlightAlpha, tapRippleRings,
} from '../tapHighlight';

/**
 * resolveTapHighlight — what a tap lights up, given what `resolveTapTarget` selected.
 *
 * Uses the real tilesets rather than fixtures: "is this decor solid?" and "how many cells does
 * this piece cover?" are art facts, and a fixture would be testing a sprite that does not exist.
 */

// The widest piece in the pack, so "any cell of it" really means more than the foot cell.
const WIDE_ID = lumeishTileset.ids()
  .map(id => ({ id, cells: furnitureCells({ col: 0, row: 0, id }).length }))
  .sort((a, b) => b.cells - a.cells)[0].id;
const SOLID_DECOR = freeFarmTileset.getDecorUrls('common')[0];
const FLUSH_DECOR = freeFarmTileset.getDecorUrls('dirt')[0];

describe('resolveTapHighlight', () => {
  it('outlines a tapped person, whatever stands on their cell', () => {
    const piece = { col: 2, row: 2, id: WIDE_ID };
    expect(resolveTapHighlight({ kind: 'body', id: 'npc', col: 2, row: 2 }, [piece], new Map()))
      .toEqual({ kind: 'body', id: 'npc' });
  });

  it('outlines the WHOLE furniture piece from any cell it covers', () => {
    const piece = { col: 2, row: 2, id: WIDE_ID };
    for (const key of furnitureCells(piece)) {
      const [col, row] = key.split(',').map(Number);
      expect(resolveTapHighlight({ kind: 'cell', col, row }, [piece], new Map()))
        .toEqual({ kind: 'furniture', placement: piece });
    }
  });

  it('outlines what stands on a PLACE rather than the square, a place being only a tag', () => {
    const piece = { col: 4, row: 1, id: WIDE_ID };
    expect(resolveTapHighlight({ kind: 'place', tag: 'counter', col: 4, row: 1 }, [piece], new Map()))
      .toEqual({ kind: 'furniture', placement: piece });
  });

  it('outlines solid decor, but treats flush ground decor as an empty square', () => {
    const decor = new Map([['1,1', SOLID_DECOR], ['3,3', FLUSH_DECOR]]);
    expect(resolveTapHighlight({ kind: 'cell', col: 1, row: 1 }, [], decor))
      .toEqual({ kind: 'decor', col: 1, row: 1, url: SOLID_DECOR });
    expect(resolveTapHighlight({ kind: 'cell', col: 3, row: 3 }, [], decor))
      .toEqual({ kind: 'cell', col: 3, row: 3 });
  });

  it('highlights the square itself when the cell is empty', () => {
    expect(resolveTapHighlight({ kind: 'cell', col: 0, row: 5 }, [], new Map()))
      .toEqual({ kind: 'cell', col: 0, row: 5 });
  });
});

describe('tap timing', () => {
  it('holds the highlight at full, then fades it out by TAP_HIGHLIGHT_MS', () => {
    expect(tapHighlightAlpha(0)).toBe(1);
    expect(tapHighlightAlpha(1000)).toBe(1);
    const late = tapHighlightAlpha(TAP_HIGHLIGHT_MS - 100);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
    expect(tapHighlightAlpha(TAP_HIGHLIGHT_MS)).toBe(0);
  });

  it('runs the ripple outward and is gone by TAP_RIPPLE_MS', () => {
    const early = tapRippleRings(50);
    const later = tapRippleRings(250);
    expect(early.length).toBeGreaterThan(0);
    expect(later[0].radius).toBeGreaterThan(early[0].radius);
    expect(later[0].alpha).toBeLessThan(early[0].alpha);
    expect(tapRippleRings(TAP_RIPPLE_MS)).toEqual([]);
  });
});

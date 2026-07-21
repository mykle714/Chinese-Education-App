import { describe, it, expect } from 'vitest';
import {
  HOUSE_STRIPS, HOUSE_TEX_SIZE, HOUSE_BASE_CORNER, HOUSE_FOOTPRINT_X, HOUSE_FOOTPRINT_Y,
} from '../engine/market/house';
import { computeSpriteStrips, computeStripPlacements, TILE_WIDTH } from '../engine/market/isometric';

/**
 * Geometry guards for the house depth-slicing (docs/NIGHT_MARKET_FEATURE.md § Sprite-strip
 * slicing). The two properties that must never break:
 *   1. the strips retile the ORIGINAL sprite pixel-for-pixel (a gap or overlap is a visible seam),
 *   2. each strip's implied foot walks one of the two FRONT edges of the footprint (that is what
 *      makes the painter's-algorithm sort resolve per screen column instead of per sprite).
 */

const RIGHT_OF_ANCHOR = HOUSE_TEX_SIZE - HOUSE_BASE_CORNER.x; // 69.5px of art right of the base corner

describe('HOUSE_STRIPS', () => {
  it('retiles the sprite exactly (no gaps, no overlap) in both orientations', () => {
    for (const [name, strips, expLeft, expRight] of [
      ['normal', HOUSE_STRIPS.normal, -HOUSE_BASE_CORNER.x, RIGHT_OF_ANCHOR],
      // Mirrored about the anchor → the sprite's two side extents swap.
      ['flipped', HOUSE_STRIPS.flipped, -RIGHT_OF_ANCHOR, HOUSE_BASE_CORNER.x],
    ] as const) {
      // 160px frame / 16px strips = 10 strips on integer texture boundaries.
      expect(strips.length, name).toBe(HOUSE_TEX_SIZE / (TILE_WIDTH / 2));
      const spans = strips
        .map((s) => [s.offsetX, s.offsetX + s.frame.w])
        .sort((a, b) => a[0] - b[0]);
      expect(spans[0][0], name).toBeCloseTo(expLeft);
      expect(spans[spans.length - 1][1], name).toBeCloseTo(expRight);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0], name).toBeCloseTo(spans[i - 1][1]);
      // Full-height slices only — never a vertical cut.
      for (const s of strips) expect(s.frame.h, name).toBe(HOUSE_TEX_SIZE);
    }
  });

  it('gives each strip a foot on one of the two front edges, spanning the footprint', () => {
    const reach = (strips: typeof HOUSE_STRIPS.normal) => ({
      x: Math.max(...strips.map((p) => p.footIsoX)),
      y: Math.max(...strips.map((p) => p.footIsoY)),
    });
    for (const strips of [HOUSE_STRIPS.normal, HOUSE_STRIPS.flipped]) {
      // A foot never advances both axes: it sits on the SW edge or the SE edge, not inside.
      for (const p of strips) expect(p.footIsoX === 0 || p.footIsoY === 0).toBe(true);
    }
    // The feet reach the far corners of the footprint (to within the art's ~0.2-cell roof
    // overhang), and the flip transposes 4×5 → 5×4.
    const n = reach(HOUSE_STRIPS.normal);
    const f = reach(HOUSE_STRIPS.flipped);
    expect(n.x).toBeCloseTo(HOUSE_FOOTPRINT_X, 0);
    expect(n.y).toBeCloseTo(HOUSE_FOOTPRINT_Y, 0);
    expect(f.x).toBeCloseTo(HOUSE_FOOTPRINT_Y, 0);
    expect(f.y).toBeCloseTo(HOUSE_FOOTPRINT_X, 0);
  });
});

describe('computeStripPlacements (stand flavour)', () => {
  it('still cuts a bottom-centre-anchored square footprint into 2F strips', () => {
    // 3-cell stand, art authored at exactly 3 tiles wide (96px).
    const strips = computeStripPlacements(10, 20, 3, 96, 64, 1);
    expect(strips.length).toBe(6);
    expect(strips[0].offsetX).toBeCloseTo(-48); // left edge = half the art
    expect(strips[0].footIsoX).toBe(10);        // left half walks +isoY off the SW corner
    expect(strips[0].footIsoY).toBeCloseTo(20 + 2.5);
    expect(strips[5].footIsoY).toBe(20);        // right half walks +isoX
    expect(strips[5].footIsoX).toBeCloseTo(10 + 2.5);
  });

  it('is the anchorTexX = texW/2 case of computeSpriteStrips', () => {
    expect(computeStripPlacements(1, 2, 2, 64, 64, 1)).toEqual(
      computeSpriteStrips({
        footIsoX: 1, footIsoY: 2, texW: 64, texH: 64, anchorTexX: 32, stripTexW: 16, scale: 1,
      }),
    );
  });
});

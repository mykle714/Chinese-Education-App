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
      // Cuts step outward from the anchor (texel-rounded to 90), so the 160px frame gives
      // 9 aligned 16px columns plus the two overhang partials.
      expect(strips.length, name).toBe(11);
      // Every cut is a whole texel — a fractional frame resamples under `nearest`.
      for (const s of strips) expect(Number.isInteger(s.frame.x) && Number.isInteger(s.frame.w), name).toBe(true);
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

  /**
   * THE REGRESSION THAT BIT: a strip must never sort DEEPER than a footprint cell whose screen
   * column it covers, or that cell's own terrain — worst case its scatter decor at `z + 0.15` —
   * draws over the house and the ground punches through its wings. Guaranteed by taking each
   * strip's NEAREST edge and cutting on the anchor-aligned grid; assert it directly.
   */
  it('never sorts behind the terrain of a footprint cell it covers', () => {
    const HALF = TILE_WIDTH / 2;
    const DECOR_Z = 0.15;   // EditorTerrainLayer's highest terrain sub-layer
    const ENTITY_Z = 0.25;  // the slot every house strip renders in
    for (const [name, strips, fx, fy] of [
      ['normal', HOUSE_STRIPS.normal, HOUSE_FOOTPRINT_X, HOUSE_FOOTPRINT_Y],
      ['flipped', HOUSE_STRIPS.flipped, HOUSE_FOOTPRINT_Y, HOUSE_FOOTPRINT_X],
    ] as const) {
      for (let i = 0; i < fx; i++) {
        for (let j = 0; j < fy; j++) {
          // The cell's diamond spans one iso unit either side of its centre column.
          const cellL = (i - j - 1) * HALF;
          const cellR = (i - j + 1) * HALF;
          for (const s of strips) {
            const overlap = Math.min(cellR, s.offsetX + s.frame.w) - Math.max(cellL, s.offsetX);
            if (overlap <= 0.5) continue; // sub-pixel touch at a shared corner isn't coverage
            const stripZ = -(s.footIsoX + s.footIsoY) + ENTITY_Z;
            const terrainZ = -(i + j) + DECOR_Z;
            expect(stripZ, `${name} strip@${s.offsetX} vs cell ${i},${j}`).toBeGreaterThan(terrainZ);
          }
        }
      }
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
    // Outermost strip spans screen [-48, -32]; its NEAREST edge is 32px = 2 iso units out.
    expect(strips[0].footIsoY).toBeCloseTo(20 + 2);
    expect(strips[5].footIsoY).toBe(20);        // right half walks +isoX
    expect(strips[5].footIsoX).toBeCloseTo(10 + 2);
    // The two innermost strips touch the anchor, so they sit at the front corner itself.
    expect(strips[2].footIsoX + strips[2].footIsoY).toBeCloseTo(30);
    expect(strips[3].footIsoX + strips[3].footIsoY).toBeCloseTo(30);
  });

  it('is the anchorTexX = texW/2 case of computeSpriteStrips', () => {
    expect(computeStripPlacements(1, 2, 2, 64, 64, 1)).toEqual(
      computeSpriteStrips({
        footIsoX: 1, footIsoY: 2, texW: 64, texH: 64, anchorTexX: 32, stripTexW: 16, scale: 1,
      }),
    );
  });
});

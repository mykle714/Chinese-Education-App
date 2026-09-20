/**
 * The shared multi-cell occupancy system.
 *
 * These matter more than they look: three unrelated surfaces (placeholder areas, houses,
 * lumeish furniture) now answer "which cells does this cover?" through this one module, so a
 * regression here desynchronises the editor's drop validation, the unlock economy's slot
 * identity, and prop collision all at once.
 */
import { describe, it, expect } from 'vitest';
import {
  transposeSpan,
  spanForFlip,
  placeFootprint,
  footprintCells,
  footprintCoversCell,
  footprintsOverlap,
  footprintOverlapsAny,
  footprintFitsBoard,
  footprintAt,
  footprintUnionCells,
  propAnchorFraction,
  propFootprint,
  propStrips,
  type PropArt,
} from '../footprint';
import {
  placeholderAreaCells,
  placeholderCoversCell,
  placeholderAreasOverlap,
  placeholderAreaFits,
  placeholderCoveredCells,
} from '../placeholderArea';
import { HOUSE_ART, HOUSE_FOOTPRINT_X, HOUSE_FOOTPRINT_Y, houseFootprint } from '../house';

describe('spans and flipping', () => {
  it('transposes a span, and is its own inverse', () => {
    expect(transposeSpan({ w: 4, h: 5 })).toEqual({ w: 5, h: 4 });
    expect(transposeSpan(transposeSpan({ w: 2, h: 1 }))).toEqual({ w: 2, h: 1 });
  });

  it('only transposes when flipped', () => {
    expect(spanForFlip({ w: 2, h: 1 }, false)).toEqual({ w: 2, h: 1 });
    expect(spanForFlip({ w: 2, h: 1 }, true)).toEqual({ w: 1, h: 2 });
  });

  it('anchors a placed footprint at the near (min-iso) corner', () => {
    expect(placeFootprint(3, 4, { w: 2, h: 5 })).toEqual({ col: 3, row: 4, w: 2, h: 5 });
    expect(placeFootprint(3, 4, { w: 2, h: 5 }, true)).toEqual({ col: 3, row: 4, w: 5, h: 2 });
  });
});

describe('occupancy', () => {
  const fp = { col: 2, row: 3, w: 2, h: 2 };

  it('enumerates cells from the anchor outward along +isoX / +isoY', () => {
    expect(footprintCells(fp).sort()).toEqual(['2,3', '2,4', '3,3', '3,4']);
  });

  it('covers exactly its own cells', () => {
    expect(footprintCoversCell(fp, 2, 3)).toBe(true);
    expect(footprintCoversCell(fp, 3, 4)).toBe(true);
    expect(footprintCoversCell(fp, 4, 3)).toBe(false); // one past the isoX span
    expect(footprintCoversCell(fp, 2, 2)).toBe(false); // one before the anchor
  });

  it('detects overlap, including the shared-edge case that must NOT count', () => {
    expect(footprintsOverlap(fp, { col: 3, row: 3, w: 1, h: 1 })).toBe(true);
    // Abutting along isoX — adjacent, not overlapping.
    expect(footprintsOverlap(fp, { col: 4, row: 3, w: 2, h: 2 })).toBe(false);
    expect(footprintsOverlap(fp, { col: 2, row: 5, w: 2, h: 2 })).toBe(false);
  });

  it('refuses a footprint that overhangs the board rather than clipping it', () => {
    expect(footprintFitsBoard(fp, 4, 5)).toBe(true);
    expect(footprintFitsBoard(fp, 3, 5)).toBe(false); // 1 col short
    expect(footprintFitsBoard({ col: -1, row: 0, w: 1, h: 1 }, 10, 10)).toBe(false);
  });

  it('finds the covering footprint and unions many', () => {
    const placed = [fp, { col: 6, row: 6, w: 1, h: 1 }];
    expect(footprintAt(placed, 3, 4)).toBe(fp);
    expect(footprintAt(placed, 9, 9)).toBeUndefined();
    expect(footprintOverlapsAny({ col: 6, row: 6, w: 1, h: 1 }, placed)).toBe(true);
    expect(footprintUnionCells(placed).size).toBe(5);
  });
});

describe('placeholder areas delegate to the shared system', () => {
  // The placeholder helpers are now thin wrappers; this pins that they did not drift while
  // being rewired, since the server mirrors this contract.
  const area = { col: 1, row: 2, w: 4, h: 5 };

  it('produces the same answers as the generic helpers', () => {
    expect(placeholderAreaCells(area)).toEqual(footprintCells(area));
    expect(placeholderCoversCell(area, 4, 6)).toBe(footprintCoversCell(area, 4, 6));
    expect(placeholderCoversCell(area, 5, 6)).toBe(false);
    expect(placeholderAreasOverlap(area, { col: 5, row: 2, w: 4, h: 5 })).toBe(false);
    expect(placeholderAreaFits(area, 5, 7)).toBe(true);
    expect(placeholderAreaFits(area, 4, 7)).toBe(false);
    expect(placeholderCoveredCells([area]).size).toBe(20);
  });
});

describe('the house is just a prop on the shared system', () => {
  it('kept its 4×5 footprint through the migration', () => {
    expect(HOUSE_ART.span).toEqual({ w: 4, h: 5 });
    expect(HOUSE_FOOTPRINT_X).toBe(4);
    expect(HOUSE_FOOTPRINT_Y).toBe(5);
    expect(houseFootprint(10, 20)).toEqual({ col: 10, row: 20, w: 4, h: 5 });
  });

  it('transposes to 5×4 when mirrored — the placeholder unit sizes depend on this', () => {
    expect(houseFootprint(0, 0, true)).toEqual({ col: 0, row: 0, w: 5, h: 4 });
  });

  it('anchors on its measured base corner, not the frame centre', () => {
    const anchor = propAnchorFraction(HOUSE_ART);
    expect(anchor.x).toBeCloseTo(90.5 / 160, 5);
    expect(anchor.y).toBeCloseTo(155 / 160, 5);
    expect(anchor.x).not.toBeCloseTo(0.5, 2); // the whole reason the constant is measured
  });
});

describe('propStrips', () => {
  // A synthetic 2×1 prop, bottom-centre anchored — the shape most furniture has.
  const art: PropArt = {
    texW: 64,
    texH: 32,
    anchorTex: { x: 32, y: 31 },
    span: { w: 2, h: 1 },
  };

  it('slices into per-screen-column strips that tile the texture exactly', () => {
    const strips = propStrips(art);
    expect(strips.length).toBeGreaterThan(1);
    // Frames are contiguous, full-height, and cover the whole texture with no gap/overlap.
    let x = 0;
    for (const s of strips) {
      expect(s.frame.x).toBe(x);
      expect(s.frame.h).toBe(art.texH);
      x += s.frame.w;
    }
    expect(x).toBe(art.texW);
  });

  it('gives near strips a shallower depth than far ones', () => {
    const strips = propStrips(art);
    const depth = (s: (typeof strips)[number]) => s.footIsoX + s.footIsoY;
    // The strip containing the anchor is the nearest point of the block.
    const nearest = Math.min(...strips.map(depth));
    expect(nearest).toBe(0);
    expect(Math.max(...strips.map(depth))).toBeGreaterThan(0);
  });

  it('mirrors the depth mapping when flipped', () => {
    const normal = propStrips(art);
    const flipped = propStrips(art, true);
    expect(flipped).toHaveLength(normal.length);
    // A flip swaps which iso axis each screen side walks.
    expect(Math.max(...normal.map((s) => s.footIsoX))).toBeCloseTo(
      Math.max(...flipped.map((s) => s.footIsoY)),
      5,
    );
  });

  it('places a prop the same way regardless of which pack it came from', () => {
    expect(propFootprint(art, 4, 4)).toEqual({ col: 4, row: 4, w: 2, h: 1 });
    expect(propFootprint(HOUSE_ART, 4, 4)).toEqual({ col: 4, row: 4, w: 4, h: 5 });
  });
});

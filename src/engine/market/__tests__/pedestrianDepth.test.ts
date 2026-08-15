import { describe, it, expect } from 'vitest';
import { computePedestrianZ, computeLayerZ } from '../isometric';

/**
 * Tests for the pedestrian depth quantisation (`computePedestrianZ`) — see
 * docs/NIGHT_MARKET_FEATURE.md § "Terrain performance".
 *
 * Two properties matter, and they pull in the same direction:
 *
 *  1. **STABILITY (performance).** The returned value must not change while a walker is mid-step.
 *     Pixi's `zIndex` setter early-returns on an unchanged value; a changed one sets
 *     `parentRenderGroup.structureDidChange`, forcing a full re-sort AND a rebuild of the whole
 *     render group's instruction set across every terrain sprite sharing the container. A value
 *     that moves every frame is therefore a per-frame full rebuild.
 *  2. **CORRECTNESS (occlusion).** The value must land in the gap between the walker's own cell's
 *     terrain and the next cell toward the camera, or the walker is drawn under the tile it is
 *     standing on.
 */

/** The `entity` render slot offset walkers sort in — mirrors RENDER_SLOT_Z.entity. */
const RENDER_SLOT_ENTITY = 0.25;

/** The terrain sub-slots `EditorTerrainLayer` emits for a cell at depth `d`, lowest first. */
const terrainZRange = (col: number, row: number) => {
  const base = computeLayerZ(col, row, 'background');
  return {
    min: base - 0.5,  // dirt slab
    max: base + 0.15, // decor above the surface caps
  };
};

describe('computePedestrianZ — stability across a step', () => {
  it('is constant while a walker lerps across the near half of a cell', () => {
    // A walker stepping from (4,4) toward (5,4): sampled at 20 sub-positions past the midpoint.
    const z = computePedestrianZ(4.5, 4);
    for (let t = 0.5; t <= 1; t += 0.025) {
      expect(computePedestrianZ(4 + t, 4)).toBe(z);
    }
  });

  it('takes at most two distinct values across a whole one-cell step', () => {
    const seen = new Set<number>();
    for (let t = 0; t <= 1; t += 0.01) seen.add(computePedestrianZ(4 + t, 4));
    // One value for each half of the step — i.e. it changes ONCE, at the boundary.
    expect(seen.size).toBe(2);
  });

  it('changes only at cell boundaries, not continuously', () => {
    // Walk four whole cells and count transitions; a lerped depth would change on every sample.
    let changes = 0;
    let prev = computePedestrianZ(0, 0);
    for (let t = 0; t <= 4; t += 0.02) {
      const z = computePedestrianZ(t, 0);
      if (z !== prev) changes++;
      prev = z;
    }
    expect(changes).toBe(4); // one per cell crossed, out of 200 samples
  });
});

describe('computePedestrianZ — occlusion correctness', () => {
  it('sits ABOVE its own cell terrain and BELOW the next cell toward the camera', () => {
    for (const [col, row] of [[0, 0], [4, 4], [-3, 7], [12, -5]]) {
      const own = terrainZRange(col, row);
      // "Toward the camera" is the lower depth sum — i.e. drawn later, higher z.
      const nearer = terrainZRange(col - 1, row);
      const z = computePedestrianZ(col, row);

      expect(z).toBeGreaterThan(own.max);
      expect(z).toBeLessThan(nearer.min);
    }
  });

  it('never sinks below the grass cap of the cell it is standing on, at any sub-position', () => {
    // The defect rounding removes. A cell's grass cap sits at exactly `-depth`; a walker must draw
    // above it. With an UNROUNDED depth of `d + f`, z is `-d - f + 0.25`, which drops below `-d`
    // as soon as `f > 0.25` — so for most of every step the walker's feet were painted under the
    // tile it was walking on. The rounded depth is always `own cap + 0.25`.
    for (let t = 0; t < 1; t += 0.05) {
      const isoX = 4 + t;
      const isoY = 4;
      const sum = isoX + isoY;

      // The cap of whichever cell the walker is currently sorted against.
      const roundedCap = -Math.round(sum);
      expect(computePedestrianZ(isoX, isoY)).toBeGreaterThan(roundedCap);

      // ...whereas the unrounded value dips under the cap of the cell it is leaving.
      const unrounded = -sum + RENDER_SLOT_ENTITY;
      if (t > 0.25) expect(unrounded).toBeLessThan(-Math.floor(sum));
    }
  });

  it('preserves back-to-front ordering between walkers on different cells', () => {
    // Deeper (larger isoX+isoY) must draw FIRST, i.e. carry a lower z.
    expect(computePedestrianZ(9, 9)).toBeLessThan(computePedestrianZ(4, 4));
    expect(computePedestrianZ(5, 4)).toBeLessThan(computePedestrianZ(4, 4));
  });
});

// The Pixi-integration counterpart — which proves the `sortDirty` cost this
// rounding exists to avoid, against a REAL Pixi container — deliberately does NOT
// live here: `src/engine/` is renderer-free, tests included, because that
// zero-import property is what lets the simulation move into a Web Worker
// unchanged. It is in
// `src/features/nightmarket/__tests__/pedestrianDepthPixi.test.ts`.
// See docs/REACT_NATIVE_MIGRATION.md § The Night Market finding.

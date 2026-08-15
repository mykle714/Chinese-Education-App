import { describe, it, expect } from 'vitest';
import { computePedestrianZ } from '../../../engine/market/isometric';

/**
 * The Pixi-integration half of the pedestrian-depth tests.
 *
 * ── Why this lives HERE and not next to the engine ─────────────────────────────
 * The pure-math assertions for `computePedestrianZ` are in
 * `src/engine/market/__tests__/pedestrianDepth.test.ts`. This block is separate
 * because it imports `pixi.js`, and `src/engine/` is deliberately renderer-free:
 * every file under `src/engine/market/` imports only its siblings, which is what
 * lets the whole simulation move into a Web Worker unchanged and what makes it
 * portable. A renderer import anywhere under `src/engine/` — tests included —
 * erodes an invariant whose value is that it holds without exception.
 *
 * The test is not weakened to remove the dependency: exercising a REAL Pixi
 * container is the entire point (see below). It just belongs on the renderer side
 * of the line, which is this directory.
 *
 * See docs/REACT_NATIVE_MIGRATION.md § The Night Market finding and § Action
 * items, Tier 4 item 14.
 */

describe('computePedestrianZ — the Pixi cost it controls (integration)', () => {
  /**
   * Exercises REAL Pixi containers rather than trusting a reading of the source. `sortDirty` is set
   * by the same `depthOfChildModified()` that sets `parentRenderGroup.structureDidChange`, so
   * counting the frames that set it counts the frames that force a full re-sort AND a full
   * instruction rebuild across every sprite sharing the container.
   *
   * If this regresses, nmp's frame budget regresses with it — the walkers share the camera
   * container with the entire terrain, so the cost is paid over thousands of sprites.
   */
  it('dirties the container on ~5% of frames, where a lerped depth dirtied 100%', async () => {
    const { Container, Sprite } = await import('pixi.js');

    const camera = new Container({ sortableChildren: true });
    // Stand in for the terrain: static sprites sharing the camera container with the walkers.
    for (let i = 0; i < 2000; i++) {
      const s = new Sprite();
      s.zIndex = -i;
      camera.addChild(s);
    }
    const peds = Array.from({ length: 8 }, () => {
      const s = new Sprite();
      camera.addChild(s);
      return s;
    });

    // 120 frames of walking at ~25 frames per cell step (roughly the real walk speed).
    const dirtyFrames = (depthOf: (isoX: number, isoY: number) => number) => {
      camera.sortDirty = false;
      let frames = 0;
      for (let f = 0; f < 120; f++) {
        peds.forEach((p, i) => {
          p.x = f;                                   // position: always changes, cheap path
          p.zIndex = depthOf(3 + i + f / 25, 4 + i); // depth: the expensive one
        });
        if (camera.sortDirty) {
          frames++;
          camera.sortDirty = false;
        }
      }
      return frames;
    };

    const lerped = dirtyFrames((isoX, isoY) => -(isoX + isoY) + 0.25);
    const rounded = dirtyFrames(computePedestrianZ);

    expect(lerped).toBe(120);          // every single frame, as it was before
    expect(rounded).toBeLessThan(20);  // only genuine cell crossings
  });
});

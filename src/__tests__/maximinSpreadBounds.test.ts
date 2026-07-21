/**
 * Pins the BOUNDING-BOX OPTIMIZATION in `maximinSpread` (server/dal/shared/templatePlacement.ts)
 * to the behavior of the original unbounded march.
 *
 * The optimization stops each outward ray once it leaves the continent's bounding box (and skips
 * rays whose fixed coordinate is outside the box entirely) instead of walking the full `voidGap`
 * sentinel distance. That is a pure speedup — ~11× on a sparse continent — and MUST NOT change a
 * single returned value, because `maximinSpread` is a ranking key: shifting one gap by one cell
 * silently changes which template gets placed.
 *
 * The guard is differential: an inlined copy of the pre-optimization implementation acts as the
 * oracle, and both are run over randomized disjoint layouts. Keep `referenceSpread` frozen — it is
 * the specification, not a second implementation to maintain. If a future change is *meant* to
 * alter spread values, this test should be updated deliberately, not deleted.
 *
 * Lives under `src/__tests__` because the vitest `include` glob only spans `src/**`
 * (vite.config.ts) — same precedent as anchorFlankBan.test.ts / continentSeal.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  maximinSpread,
  type PlacedTemplate,
  type CandidatePlacement,
} from '../../server/dal/shared/templatePlacement';

const tileKey = (col: number, row: number): string => `${col},${row}`;
const OUTWARD = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] } as const;

/** FROZEN ORACLE — the unbounded march, exactly as it read before the bounding box was added. */
function referenceSpread(candidate: CandidatePlacement, placed: readonly PlacedTemplate[], voidGap = 1000): number {
  const occupied = new Set<string>();
  for (const p of placed) {
    for (let c = 0; c < p.width; c++) {
      for (let r = 0; r < p.height; r++) occupied.add(tileKey(c + p.offsetCol, r + p.offsetRow));
    }
  }
  let min = voidGap;
  for (const edge of ['n', 's', 'e', 'w'] as const) {
    const [dc, dr] = OUTWARD[edge];
    const cells: Array<[number, number]> = [];
    if (edge === 'n' || edge === 's') {
      const row = edge === 'n' ? candidate.height - 1 : 0;
      for (let col = 0; col < candidate.width; col++) cells.push([col, row]);
    } else {
      const col = edge === 'e' ? candidate.width - 1 : 0;
      for (let row = 0; row < candidate.height; row++) cells.push([col, row]);
    }
    for (const [lc, lr] of cells) {
      const gc = lc + candidate.offsetCol;
      const gr = lr + candidate.offsetRow;
      if (occupied.has(tileKey(gc + dc, gr + dr))) continue;
      let gap = voidGap;
      for (let step = 1; step <= voidGap; step++) {
        if (occupied.has(tileKey(gc + dc * step, gr + dr * step))) {
          gap = step;
          break;
        }
      }
      if (gap < min) min = gap;
    }
  }
  return min;
}

/** Deterministic LCG, so any failure reproduces from its seed. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** A disjoint random layout — non-overlap is what `isPlacementLegal` guarantees in production. */
function randomLayout(rng: () => number, n: number): PlacedTemplate[] {
  const placed: PlacedTemplate[] = [];
  for (let i = 0; i < n; i++) {
    const width = 1 + Math.floor(rng() * 5);
    const height = 1 + Math.floor(rng() * 5);
    const offsetCol = Math.floor(rng() * 40) - 20;
    const offsetRow = Math.floor(rng() * 40) - 20;
    const c = { offsetCol, offsetRow, width, height };
    const overlaps = placed.some(
      (p) =>
        c.offsetCol < p.offsetCol + p.width &&
        p.offsetCol < c.offsetCol + c.width &&
        c.offsetRow < p.offsetRow + p.height &&
        p.offsetRow < c.offsetRow + c.height,
    );
    if (overlaps) continue;
    placed.push({ id: `t${i}`, templateName: `t${i}`, activeVersion: 0, ...c, street: new Set() });
  }
  return placed;
}

describe('maximinSpread — bounding-box march is value-identical to the unbounded march', () => {
  it('agrees with the frozen oracle across randomized layouts', () => {
    let checked = 0;
    let realGaps = 0;

    for (let seed = 1; seed <= 500; seed++) {
      const all = randomLayout(makeRng(seed), 8);
      if (all.length < 2) continue;
      const [candSrc, ...placed] = all;
      const candidate: CandidatePlacement = {
        templateName: 'cand',
        version: 0,
        offsetCol: candSrc.offsetCol,
        offsetRow: candSrc.offsetRow,
        width: candSrc.width,
        height: candSrc.height,
        street: new Set(),
      };
      expect(maximinSpread(candidate, placed), `seed ${seed}`).toBe(referenceSpread(candidate, placed));
      checked++;
      if (referenceSpread(candidate, placed) !== 1000) realGaps++;
    }

    // Guard against a vacuous pass: the corpus must exercise real finite gaps, not just the
    // void sentinel (which would agree trivially).
    expect(checked).toBeGreaterThan(350);
    expect(realGaps).toBeGreaterThan(100);
  });

  it('returns the void sentinel when nothing is placed', () => {
    const candidate: CandidatePlacement = {
      templateName: 'cand', version: 0, offsetCol: 0, offsetRow: 0, width: 3, height: 3, street: new Set(),
    };
    // The bounding box is empty here (±Infinity), which must degrade to "no ray can hit anything".
    expect(maximinSpread(candidate, [])).toBe(1000);
    expect(maximinSpread(candidate, [])).toBe(referenceSpread(candidate, []));
  });

  it('agrees for a candidate parked far outside the continent', () => {
    // Every ray either points away from the box or runs alongside it — the case the fixed-coordinate
    // early-out handles, and the one that used to burn a full 1000-step march per perimeter cell.
    const placed = randomLayout(makeRng(99), 12);
    const candidate: CandidatePlacement = {
      templateName: 'cand', version: 0, offsetCol: 200, offsetRow: 200, width: 4, height: 4, street: new Set(),
    };
    expect(maximinSpread(candidate, placed)).toBe(referenceSpread(candidate, placed));
  });
});

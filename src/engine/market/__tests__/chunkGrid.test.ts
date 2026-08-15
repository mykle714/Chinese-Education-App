import { describe, it, expect } from 'vitest';
import {
  CHUNK_PX,
  NATIVE_LEVEL,
  ALL_LEVELS,
  FARM_TERRAIN_OVERHANG,
  cellPxAtLevel,
  scaleForLevel,
  levelForScale,
  isChunkBakingActive,
  chunkNativeSpan,
  chunkKey,
  chunkScreenRect,
  chunksForScreenRect,
  cellWindowForScreenRect,
  cellWindowForChunk,
  chunksForCellBounds,
  type ScreenRect,
} from '../chunkGrid';
import { isoToScreen, TILE_WIDTH, TILE_HEIGHT } from '../isometric';

/**
 * Tests for the baked-terrain chunk grid (docs/NIGHT_MARKET_TERRAIN_CHUNKING.md).
 *
 * These carry more weight than usual: the chunk cache's failure mode is a SEAM —
 * a strip of clipped sprites along a chunk boundary — which renders perfectly,
 * crashes nothing, and is invisible to anything but a human looking at the
 * screen. The coordinate math is the half that CAN be pinned mechanically, so it
 * is pinned hard here.
 */

describe('level ladder', () => {
  it('makes level 5 native, matching TILE_WIDTH', () => {
    expect(NATIVE_LEVEL).toBe(5);
    expect(cellPxAtLevel(NATIVE_LEVEL)).toBe(TILE_WIDTH);
    expect(scaleForLevel(NATIVE_LEVEL)).toBe(1);
  });

  it('matches the ladder in the migration doc', () => {
    expect(cellPxAtLevel(0)).toBe(1);
    expect(cellPxAtLevel(2)).toBe(4);
    expect(cellPxAtLevel(4)).toBe(16);
  });

  it('never magnifies: the chosen level is always at least the displayed size', () => {
    // The whole point of picking a level is that the baked texture is scaled DOWN.
    // A level whose cells are smaller than what the camera shows would be upscaled
    // and visibly soft.
    for (const s of [0.02, 0.11, 0.15, 0.3, 0.49, 0.5, 0.51, 0.9, 1]) {
      const L = levelForScale(s);
      expect(cellPxAtLevel(L)).toBeGreaterThanOrEqual(s * TILE_WIDTH - 1e-9);
      expect(L).toBeLessThanOrEqual(NATIVE_LEVEL);
      expect(L).toBeGreaterThanOrEqual(0);
    }
  });

  it('picks a coarser level as the camera zooms out, and clamps at both ends', () => {
    expect(levelForScale(1)).toBe(NATIVE_LEVEL);
    expect(levelForScale(0.5)).toBe(4);
    expect(levelForScale(0.25)).toBe(3);
    // Past the bottom of the ladder it clamps rather than going negative.
    expect(levelForScale(0.0001)).toBe(0);
    // Magnified cameras never bake — they clamp to native and draw sprites.
    expect(levelForScale(4)).toBe(NATIVE_LEVEL);
    expect(levelForScale(0)).toBe(NATIVE_LEVEL);
  });

  it('spans more of the world per chunk at coarser levels', () => {
    expect(chunkNativeSpan(NATIVE_LEVEL)).toBe(CHUNK_PX);
    expect(chunkNativeSpan(4)).toBe(CHUNK_PX * 2);
    expect(chunkNativeSpan(0)).toBe(CHUNK_PX * TILE_WIDTH);
  });
});

describe('chunk ↔ screen rect', () => {
  it('tiles screen space with no gap and no overlap', () => {
    const a = chunkScreenRect({ level: 4, cx: 0, cy: 0 });
    const b = chunkScreenRect({ level: 4, cx: 1, cy: 0 });
    expect(a.maxX).toBe(b.minX);
    expect(a.maxX - a.minX).toBe(chunkNativeSpan(4));
  });

  it('handles negative coordinates — the market extends in every direction', () => {
    // isoToScreen puts the origin at 0,0 and grows both ways, so chunk indices
    // are signed. Math.floor (not truncation) is what makes this work.
    const r = chunkScreenRect({ level: 5, cx: -1, cy: -1 });
    expect(r.minX).toBe(-CHUNK_PX);
    expect(r.maxX).toBe(0);
  });

  it('returns ~8 chunks for a phone viewport, which is the memory budget claim', () => {
    // 390×844 logical px at 1:1. The doc's "≈8 visible chunks → ~4 MB resident"
    // budget depends on this number staying small.
    const viewport: ScreenRect = { minX: 0, maxX: 390, minY: 0, maxY: 844 };
    const chunks = chunksForScreenRect(NATIVE_LEVEL, viewport);
    expect(chunks.length).toBeLessThanOrEqual(12);
    expect(chunks.length).toBeGreaterThanOrEqual(6);
  });

  it('does not return a chunk the rect merely touches at its edge', () => {
    // A rect ending exactly on a boundary covers zero area of the next chunk.
    const rect: ScreenRect = { minX: 0, maxX: CHUNK_PX, minY: 0, maxY: CHUNK_PX };
    expect(chunksForScreenRect(NATIVE_LEVEL, rect)).toEqual([{ level: NATIVE_LEVEL, cx: 0, cy: 0 }]);
  });

  it('keys are stable and distinct across levels', () => {
    expect(chunkKey({ level: 4, cx: -1, cy: 2 })).toBe('4/-1/2');
    expect(chunkKey({ level: 5, cx: -1, cy: 2 })).not.toBe(chunkKey({ level: 4, cx: -1, cy: 2 }));
  });
});

describe('cellWindowForScreenRect — the inverse projection', () => {
  const NO_OVERHANG = { above: 0, below: 0 };

  it('round-trips a cell through project → invert', () => {
    for (const [col, row] of [[0, 0], [4, 4], [-3, 7], [12, -5], [100, 100]]) {
      const { screenX, screenY } = isoToScreen(col, row);
      // A degenerate rect at exactly the cell's anchor must contain that cell.
      const w = cellWindowForScreenRect(
        { minX: screenX, maxX: screenX, minY: screenY, maxY: screenY },
        NO_OVERHANG,
      );
      expect(col).toBeGreaterThanOrEqual(w.minCol);
      expect(col).toBeLessThanOrEqual(w.maxCol);
      expect(row).toBeGreaterThanOrEqual(w.minRow);
      expect(row).toBeLessThanOrEqual(w.maxRow);
      expect(col + row).toBeGreaterThanOrEqual(w.minSum);
      expect(col + row).toBeLessThanOrEqual(w.maxSum);
      expect(col - row).toBeGreaterThanOrEqual(w.minDiag);
      expect(col - row).toBeLessThanOrEqual(w.maxDiag);
    }
  });

  it('gets the Y sign right — deeper cells are HIGHER on screen', () => {
    // isoToScreen negates (col+row) on Y, so the rect's LOWER edge (maxY) bounds
    // the MINIMUM sum. Getting this backwards yields a window that excludes every
    // cell actually in the rect, i.e. blank chunks.
    const rect: ScreenRect = { minX: -100, maxX: 100, minY: -800, maxY: -400 };
    const w = cellWindowForScreenRect(rect, NO_OVERHANG);
    // screenY = -800 ⇒ sum = 100; screenY = -400 ⇒ sum = 50. So sums run 50..100.
    expect(w.minSum).toBe(50);
    expect(w.maxSum).toBe(100);
  });

  it('the exact (diag, sum) bounds are tighter than the col/row bounding box', () => {
    // This is the reason CellWindow carries diagonals at all: the bounding box is
    // roughly twice the area of the true diamond, so culling on it alone would
    // bake about half of every chunk off-rect.
    const rect: ScreenRect = { minX: 0, maxX: CHUNK_PX, minY: 0, maxY: CHUNK_PX };
    const w = cellWindowForScreenRect(rect, NO_OVERHANG);
    const boxArea = (w.maxCol - w.minCol + 1) * (w.maxRow - w.minRow + 1);
    let inDiamond = 0;
    for (let c = w.minCol; c <= w.maxCol; c++) {
      for (let r = w.minRow; r <= w.maxRow; r++) {
        const sum = c + r, diag = c - r;
        if (sum >= w.minSum && sum <= w.maxSum && diag >= w.minDiag && diag <= w.maxDiag) inDiamond++;
      }
    }
    expect(inDiamond).toBeLessThan(boxArea * 0.65);
  });
});

describe('overhang — the seam defence', () => {
  it('widens the window, never narrows it', () => {
    const rect: ScreenRect = { minX: 0, maxX: CHUNK_PX, minY: 0, maxY: CHUNK_PX };
    const tight = cellWindowForScreenRect(rect, { above: 0, below: 0 });
    const loose = cellWindowForScreenRect(rect, FARM_TERRAIN_OVERHANG);
    expect(loose.minSum).toBeLessThanOrEqual(tight.minSum);
    expect(loose.maxSum).toBeGreaterThanOrEqual(tight.maxSum);
    expect(loose.minCol).toBeLessThanOrEqual(tight.minCol);
    expect(loose.maxCol).toBeGreaterThanOrEqual(tight.maxCol);
  });

  it('includes a cell whose ANCHOR is outside the chunk but whose ART paints inside', () => {
    // THE seam case, stated concretely. Take the chunk at level 5, (0,0) — screen
    // rect [0,256]×[0,256]. A cell anchored just BELOW its bottom edge draws up to
    // `overhang.above` px upward, i.e. into the chunk. It must be baked.
    const coord = { level: NATIVE_LEVEL, cx: 0, cy: 0 };
    const rect = chunkScreenRect(coord);

    // Find a real cell whose anchor sits below the rect but within the overhang.
    let found: { col: number; row: number } | null = null;
    for (let col = -60; col <= 60 && !found; col++) {
      for (let row = -60; row <= 60; row++) {
        const { screenX, screenY } = isoToScreen(col, row);
        const belowByALittle = screenY > rect.maxY && screenY < rect.maxY + FARM_TERRAIN_OVERHANG.above;
        if (belowByALittle && screenX > rect.minX && screenX < rect.maxX) {
          found = { col, row };
          break;
        }
      }
    }
    expect(found).not.toBeNull();

    const tight = cellWindowForChunk(coord, { above: 0, below: 0 });
    const loose = cellWindowForChunk(coord, FARM_TERRAIN_OVERHANG);
    const inWindow = (w: typeof loose, col: number, row: number) =>
      col + row >= w.minSum && col + row <= w.maxSum &&
      col - row >= w.minDiag && col - row <= w.maxDiag;

    const { col, row } = found!;
    // Without the overhang this cell is skipped — that is the seam.
    expect(inWindow(tight, col, row)).toBe(false);
    // With it, the cell is baked and the seam cannot appear.
    expect(inWindow(loose, col, row)).toBe(true);
  });

  it('the farm overhang covers the dirt slab drawn a tile-height BELOW the anchor', () => {
    // EditorTerrainLayer draws the slab at `y + TILE_HEIGHT`, so the art extends
    // below the anchor too. If `below` were 0, slab bottoms would clip at seams.
    expect(FARM_TERRAIN_OVERHANG.below).toBeGreaterThanOrEqual(TILE_HEIGHT);
    expect(FARM_TERRAIN_OVERHANG.above).toBeGreaterThanOrEqual(TILE_WIDTH);
  });
});

describe('invalidation', () => {
  it('dirties only a handful of chunks for one 16×16 template', () => {
    // A layout edit must not invalidate the world; that is what makes baking
    // affordable. 16×16 is the authored default (TemplateEditorPage DEFAULT_DIM).
    const keys = chunksForCellBounds(
      { minCol: 0, maxCol: 15, minRow: 0, maxRow: 15 },
      [NATIVE_LEVEL],
      FARM_TERRAIN_OVERHANG,
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThanOrEqual(12);
  });

  it('dirties every level, because all levels cached that region', () => {
    const one = chunksForCellBounds({ minCol: 0, maxCol: 15, minRow: 0, maxRow: 15 }, [5], FARM_TERRAIN_OVERHANG);
    const all = chunksForCellBounds({ minCol: 0, maxCol: 15, minRow: 0, maxRow: 15 }, ALL_LEVELS, FARM_TERRAIN_OVERHANG);
    expect(all.length).toBeGreaterThan(one.length);
    // Coarser levels collapse to fewer chunks, so the total is far below 6×.
    expect(all.length).toBeLessThan(one.length * 6);
  });

  it('returns no duplicate keys', () => {
    const keys = chunksForCellBounds({ minCol: -20, maxCol: 40, minRow: -20, maxRow: 40 }, ALL_LEVELS, FARM_TERRAIN_OVERHANG);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('dirties the NEIGHBOUR of an edit whose art overhangs into it', () => {
    // The invalidation counterpart of the seam test: a stale neighbour is the same
    // bug arriving one edit later.
    const bounds = { minCol: 0, maxCol: 15, minRow: 0, maxRow: 15 };
    const tight = chunksForCellBounds(bounds, [NATIVE_LEVEL], { above: 0, below: 0 });
    const loose = chunksForCellBounds(bounds, [NATIVE_LEVEL], FARM_TERRAIN_OVERHANG);
    expect(loose.length).toBeGreaterThanOrEqual(tight.length);
    for (const k of tight) expect(loose).toContain(k);
  });
});

describe('resident memory claim', () => {
  it('is bounded by the SCREEN, not the world — the entire point of the design', () => {
    const viewport: ScreenRect = { minX: 0, maxX: 390, minY: 0, maxY: 844 };
    // A tiny market and an enormous one show the same number of chunks, because
    // chunks are cut from screen space. This is what makes 4 MB resident hold at
    // 240×240 cells.
    const atNative = chunksForScreenRect(NATIVE_LEVEL, viewport).length;
    const atCoarse = chunksForScreenRect(0, viewport).length;
    expect(atCoarse).toBeLessThanOrEqual(atNative);

    const bytes = (atNative + atCoarse) * CHUNK_PX * CHUNK_PX * 4;
    expect(bytes).toBeLessThan(8 * 1024 * 1024); // ~4 MB claim, with headroom
  });
});

describe('isChunkBakingActive — the shared threshold', () => {
  it('is off at and above native scale, on below it', () => {
    // Both renderers ask this ONE function. If the chunk layer and the live layer
    // ever disagree about the boundary, a whole zoom band draws no ground at all.
    expect(isChunkBakingActive(1)).toBe(false);
    expect(isChunkBakingActive(2)).toBe(false);
    expect(isChunkBakingActive(0.9)).toBe(false); // still level 5 — NOT a naive `zoom < 1`
    expect(isChunkBakingActive(0.5)).toBe(true);
    expect(isChunkBakingActive(0.11)).toBe(true);
  });

  it('agrees with levelForScale exactly, across the whole range', () => {
    for (let s = 0.01; s <= 2; s += 0.01) {
      expect(isChunkBakingActive(s)).toBe(levelForScale(s) < NATIVE_LEVEL);
    }
  });
});

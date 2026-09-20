/**
 * Invariants of the normalized lumeish pack and its registry.
 *
 * These guard the *pipeline contract* rather than the art: if someone edits the raw
 * pack and forgets to re-run `scripts/normalize-lumeish.mjs`, or hand-edits the
 * manifest, these fail. They intentionally assert on the manifest+registry pair, not
 * on pixel data — decoding PNGs belongs to the build script.
 */
import { describe, it, expect } from 'vitest';
import { lumeishTileset, LUMEISH_CELL_PX } from '../lumeishTileset';
import { TILE_WIDTH } from '../isometric';
import { footprintCells, footprintCoversCell, transposeSpan } from '../footprint';
import manifest from '../../../assets/test-assets/lumeish-normalized/manifest.json';

describe('lumeishTileset', () => {
  it('sits on the engine tile pitch', () => {
    expect(LUMEISH_CELL_PX).toBe(TILE_WIDTH);
  });

  it('indexes every manifest sprite (no stale/missing normalized files)', () => {
    expect(lumeishTileset.all()).toHaveLength(manifest.spriteCount);
    expect(manifest.spriteCount).toBe(manifest.sprites.length);
  });

  it('gives every sprite a whole-cell padded box big enough for its source art', () => {
    for (const sprite of lumeishTileset.all()) {
      const [cellsW, cellsH] = sprite.cells;
      expect(cellsW).toBeGreaterThanOrEqual(1);
      expect(cellsH).toBeGreaterThanOrEqual(1);
      // The padded canvas must contain the original crop — otherwise art was clipped.
      expect(cellsW * LUMEISH_CELL_PX).toBeGreaterThanOrEqual(sprite.srcSize[0]);
      expect(cellsH * LUMEISH_CELL_PX).toBeGreaterThanOrEqual(sprite.srcSize[1]);
      // …and be the SMALLEST such box, or the normalizer over-padded.
      expect((cellsW - 1) * LUMEISH_CELL_PX).toBeLessThan(sprite.srcSize[0]);
      expect((cellsH - 1) * LUMEISH_CELL_PX).toBeLessThan(sprite.srcSize[1]);
    }
  });

  it('keeps every sprite inside its padded canvas', () => {
    for (const sprite of lumeishTileset.all()) {
      const [px, py] = lumeishTileset.pixelSize(sprite.id);
      expect(sprite.offset[0]).toBeGreaterThanOrEqual(0);
      expect(sprite.offset[1]).toBeGreaterThanOrEqual(0);
      expect(sprite.offset[0] + sprite.srcSize[0]).toBeLessThanOrEqual(px);
      expect(sprite.offset[1] + sprite.srcSize[1]).toBeLessThanOrEqual(py);
      // The measured foot anchor is a real point of the padded canvas.
      expect(sprite.anchorTex.x).toBeGreaterThanOrEqual(0);
      expect(sprite.anchorTex.x).toBeLessThanOrEqual(px);
      expect(sprite.anchorTex.y).toBeGreaterThan(0);
      expect(sprite.anchorTex.y).toBeLessThanOrEqual(py);
    }
  });

  it('pairs facings symmetrically, and never points a sprite at itself', () => {
    for (const sprite of lumeishTileset.all()) {
      const sibling = lumeishTileset.facingSibling(sprite.id);
      if (!sibling) continue;
      expect(sibling.id).not.toBe(sprite.id);
      // The relation is walkable from either end.
      expect(lumeishTileset.facingSibling(sibling.id)?.id).toBe(sprite.id);
      // A pair shares a silhouette, so it must share a padded box…
      expect(sibling.cells).toEqual(sprite.cells);
      // …and a mirror must TRANSPOSE the iso footprint. The normalizer measures the two
      // sprites independently, so this agreeing across all 65 pairs is a real cross-check
      // on the span measurement rather than a tautology.
      expect(sibling.isoSpan).toEqual(transposeSpan(sprite.isoSpan));
    }
  });

  it('lists each object once in canonical(), covering every unpaired sprite', () => {
    const canonical = lumeishTileset.canonical();
    const paired = lumeishTileset.all().filter((s) => s.mirrorOf !== null);
    // every sprite is either canonical or the mirror half of exactly one canonical
    expect(canonical.length + paired.length).toBe(lumeishTileset.all().length);
    for (const sprite of canonical) expect(sprite.mirrorOf).toBeNull();
  });

  it('resolves urls in both directions', () => {
    for (const sprite of lumeishTileset.all()) {
      expect(lumeishTileset.get(sprite.id)).toBe(sprite.url);
      expect(lumeishTileset.idOf(sprite.url)).toBe(sprite.id);
    }
  });

  it('falls back to a single cell for an unknown id', () => {
    expect(lumeishTileset.get(-1)).toBeUndefined();
    expect(lumeishTileset.art(-1)).toBeUndefined();
    expect(lumeishTileset.paddedCells(-1)).toEqual([1, 1]);
    expect(lumeishTileset.span(-1)).toEqual({ w: 1, h: 1 });
    expect(lumeishTileset.footprintAt(-1, 3, 4)).toEqual({ col: 3, row: 4, w: 1, h: 1 });
    expect(lumeishTileset.strips(-1)).toEqual([]);
  });

  it('gives every sprite an iso footprint of at least one cell', () => {
    for (const sprite of lumeishTileset.all()) {
      expect(sprite.isoSpan.w).toBeGreaterThanOrEqual(1);
      expect(sprite.isoSpan.h).toBeGreaterThanOrEqual(1);
      // The base diamond cannot be wider than the art that draws it: its screen width is
      // (w + h) * TILE_WIDTH/2, which must fit the padded canvas.
      const [px] = lumeishTileset.pixelSize(sprite.id);
      expect((sprite.isoSpan.w + sprite.isoSpan.h) * (TILE_WIDTH / 2)).toBeLessThanOrEqual(px);
    }
  });

  it('places a footprint through the shared prop system, transposing on flip', () => {
    // 151 is the room shell — the pack's only multi-cell-in-both-axes prop (3×3).
    const room = lumeishTileset.sprite(151);
    expect(room?.isoSpan).toEqual({ w: 3, h: 3 });

    // A 2×1 prop is the interesting flip case.
    const wide = lumeishTileset.all().find((s) => s.isoSpan.w === 2 && s.isoSpan.h === 1);
    expect(wide).toBeDefined();
    if (!wide) return;

    const fp = lumeishTileset.footprintAt(wide.id, 5, 7);
    expect(fp).toEqual({ col: 5, row: 7, w: 2, h: 1 });
    expect(footprintCells(fp)).toEqual(['5,7', '6,7']);
    expect(footprintCoversCell(fp, 6, 7)).toBe(true);
    expect(footprintCoversCell(fp, 7, 7)).toBe(false);

    const flipped = lumeishTileset.footprintAt(wide.id, 5, 7, true);
    expect(flipped).toEqual({ col: 5, row: 7, w: 1, h: 2 });
  });

  it('slices multi-cell props into per-column depth strips, and memoises them', () => {
    const room = 151;
    const strips = lumeishTileset.strips(room);
    // A 3×3 prop spans 6 iso units of front edge, so it must resolve to more than one depth.
    expect(strips.length).toBeGreaterThan(1);
    // Strips are returned in texture order and each carries its own foot anchor.
    for (const s of strips) {
      expect(s.footIsoX).toBeGreaterThanOrEqual(0);
      expect(s.footIsoY).toBeGreaterThanOrEqual(0);
    }
    // Memoised: the same array instance comes back, so a render loop cannot recompute it.
    expect(lumeishTileset.strips(room)).toBe(strips);
    expect(lumeishTileset.strips(room, true)).not.toBe(strips);
  });
});

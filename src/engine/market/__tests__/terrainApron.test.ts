import { describe, it, expect } from 'vitest';
import { buildEditorField, padTerrainField, type EditorMasks, type TerrainField } from '../farmTerrain';

/**
 * Tests for the DEFAULT GROUND APRON and the visible-window culling that makes it affordable —
 * see docs/NIGHT_MARKET_FEATURE.md § "Default ground apron", and
 * {@link ../../features/nightmarket/TemplateTerrainLayer} which wires both.
 *
 * The apron is the ring of default ground (tallDirt slab + lightGrass cap) padded around the market.
 * It is deliberately THIN: its job is to give the market's edge tiles in-field neighbours to
 * autotile against, while the rest of the viewport is filled by the flat
 * {@link ../../features/nightmarket/GroundBackdropLayer} for the cost of one quad. The `boundless`
 * suite at the bottom pins the property that makes that pairing seamless.
 */

/** A 4×4 market at the origin whose cells are all painted light grass (terrain1). */
function market4x4(): { masks: EditorMasks; field: TerrainField } {
  const terrain1 = new Set<string>();
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) terrain1.add(`${c},${r}`);
  return {
    masks: {
      terrain1,
      terrain2: new Set(),
      street: new Set(),
      communal: new Set(),
      placeholders: [],
      condition: new Set(),
      decor: new Map(),
    } as unknown as EditorMasks,
    field: {
      originCol: 0,
      originRow: 0,
      contains: (c, r) => c >= 0 && c < 4 && r >= 0 && r < 4,
    },
  };
}

const cellKey = (t: { isoX: number; isoY: number }) => `${t.isoX},${t.isoY}`;

describe('padTerrainField', () => {
  it('returns the field untouched for a zero pad (pre-apron behavior)', () => {
    const { field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 0);
    expect(padded.field).toBe(field);
    expect(padded.width).toBe(4);
    expect(padded.field.apron).toBeUndefined();
  });

  it('grows the span and origin on every side', () => {
    const { field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 3);
    expect(padded.width).toBe(10);
    expect(padded.height).toBe(10);
    expect(padded.field.originCol).toBe(-3);
    expect(padded.field.originRow).toBe(-3);
  });

  it('marks the ring apron and the market itself not-apron', () => {
    const { field } = market4x4();
    const { field: padded } = padTerrainField(field, 4, 4, 3);
    expect(padded.apron!(-2, -2)).toBe(true);  // in the ring
    expect(padded.apron!(1, 1)).toBe(false);   // inside the market
    expect(padded.contains(-2, -2)).toBe(true);
    expect(padded.contains(-99, -99)).toBe(false); // outside the padded rect entirely
  });

  it('treats an interior hole as apron, not as a gap through to the background', () => {
    // An L-shaped silhouette: the (3,3) corner is absent from the footprint union.
    const holed: TerrainField = {
      originCol: 0,
      originRow: 0,
      contains: (c, r) => c >= 0 && c < 4 && r >= 0 && r < 4 && !(c === 3 && r === 3),
    };
    const { field: padded } = padTerrainField(holed, 4, 4, 2);
    expect(padded.apron!(3, 3)).toBe(true);
    expect(padded.contains(3, 3)).toBe(true);
  });

  it('composes: re-padding an already-padded field keeps the earlier apron', () => {
    const { field } = market4x4();
    const once = padTerrainField(field, 4, 4, 2);
    const twice = padTerrainField(once.field, once.width, once.height, 2);
    expect(twice.field.apron!(-1, -1)).toBe(true); // apron from the FIRST pad
    expect(twice.field.apron!(-3, -3)).toBe(true); // apron from the second (span is [-4, 8))
    expect(twice.field.apron!(1, 1)).toBe(false);  // still the market
    expect(twice.field.contains(-5, -5)).toBe(false); // beyond both pads
  });
});

describe('buildEditorField — apron surface', () => {
  it('renders apron cells as light grass, like the default ground', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 2);
    const tiles = buildEditorField(padded.width, padded.height, masks, padded.field);
    const apronTile = tiles.find((t) => t.isoX === -1 && t.isoY === -1)!;
    expect(apronTile.kind).toBe('grass');
    expect(apronTile.darkGrass).toBe(false);
    expect(apronTile.decorUrl).toBeNull();
  });

  it('autotiles the market grass continuously into the apron (no boundary seam)', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 2);
    const tiles = buildEditorField(padded.width, padded.height, masks, padded.field);
    // A market edge cell sees light grass on its outward side because the apron counts as grass —
    // that shared membership is what removes the seam the market's rim used to draw.
    const edge = tiles.find((t) => t.isoX === 0 && t.isoY === 0)!;
    expect(edge.grassNeighbours.s).toBe(true);
    expect(edge.grassNeighbours.w).toBe(true);
  });

  it('paints the whole padded rectangle', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 2);
    const tiles = buildEditorField(padded.width, padded.height, masks, padded.field);
    expect(tiles).toHaveLength(8 * 8);
  });
});

describe('buildEditorField — cull window', () => {
  it('builds only the cells inside the window', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 20);
    const tiles = buildEditorField(padded.width, padded.height, masks, padded.field, {
      minCol: 0, maxCol: 1, minRow: 0, maxRow: 1,
    });
    expect(tiles.map(cellKey).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('costs far less than the full padded field (the reason the apron is affordable)', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 50); // 104×104 = 10,816 cells
    const full = buildEditorField(padded.width, padded.height, masks, padded.field);
    const culled = buildEditorField(padded.width, padded.height, masks, padded.field, {
      minCol: -8, maxCol: 8, minRow: -8, maxRow: 8,
    });
    expect(full.length).toBeGreaterThan(10_000);
    expect(culled).toHaveLength(17 * 17);
  });

  it('clips the window to the field rather than inventing cells outside it', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 1); // field spans [-1, 4]
    const tiles = buildEditorField(padded.width, padded.height, masks, padded.field, {
      minCol: -100, maxCol: 100, minRow: -100, maxRow: 100,
    });
    expect(tiles).toHaveLength(6 * 6);
  });

  it('autotiles window-edge cells against their real neighbours (no phantom rim at the cut)', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 5);
    const windowed = buildEditorField(padded.width, padded.height, masks, padded.field, {
      minCol: 0, maxCol: 2, minRow: 0, maxRow: 2,
    });
    const full = buildEditorField(padded.width, padded.height, masks, padded.field);
    // The tile at the window's edge must be IDENTICAL to its uncelled counterpart: culling limits
    // iteration only, never the field-membership tests the autotiler reads.
    const at = (ts: typeof full, c: number, r: number) => ts.find((t) => t.isoX === c && t.isoY === r)!;
    expect(at(windowed, 0, 0)).toEqual(at(full, 0, 0));
    expect(at(windowed, 2, 2)).toEqual(at(full, 2, 2));
  });
});

describe('padTerrainField — boundless (the backdrop pairing)', () => {
  it('treats every cell as in-field while still bounding the drawn span', () => {
    const { field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 4, true);
    expect(padded.field.contains(10_000, -10_000)).toBe(true); // membership is infinite…
    expect(padded.width).toBe(12);                             // …but only the ring is drawn
    expect(padded.height).toBe(12);
  });

  it('autotiles the ring as interior ground, so no cliff appears at the ring edge', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 4, true);
    const tiles = buildEditorField(padded.width, padded.height, masks, padded.field);
    // The outermost drawn cell must be a plain `center` tile: that is what makes it identical to the
    // GroundBackdropLayer motif and keeps the ring→backdrop transition invisible.
    const outer = tiles.find((t) => t.isoX === -4 && t.isoY === -4)!;
    expect(outer.fieldEdge).toBe('center');
    expect(outer.kind).toBe('grass');
  });

  it('draws vastly fewer tiles than sizing the pad to the camera reach would', () => {
    const { masks, field } = market4x4();
    const ringField = padTerrainField(field, 4, 4, 4, true);
    const ring = buildEditorField(ringField.width, ringField.height, masks, ringField.field);
    // The pad the first cut computed for a portrait phone viewport was ~94 cells per side.
    const cameraReach = padTerrainField(field, 4, 4, 94, true);
    expect(ring).toHaveLength(12 * 12);
    expect((cameraReach.width * cameraReach.height) / ring.length).toBeGreaterThan(200);
  });
});

/**
 * The tallDirt slab is skipped where it cannot be seen — see `EditorTile.slabHidden` and
 * `HIDE_OCCLUDED_SLABS` in {@link ../../features/nightmarket/EditorTerrainLayer}. On a field of
 * ordinary grass this halves the emitted sprites, which is why it matters for nmp's frame budget.
 */
describe('buildEditorField — slabHidden (occlusion cull)', () => {
  it('hides the slab on a grass cell whose S/W/SW neighbours are all in-field', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 4, true);
    const tiles = buildEditorField(padded.width, padded.height, masks, padded.field);
    const interior = tiles.find((t) => t.isoX === 2 && t.isoY === 2)!;
    expect(interior.slabHidden).toBe(true);
  });

  it('keeps the slab where a covering neighbour is missing', () => {
    const { masks, field } = market4x4();
    // Bounded field: the SW-most cell has no S/W/SW neighbours, so its cliff band is exposed.
    const tiles = buildEditorField(4, 4, masks, field);
    const corner = tiles.find((t) => t.isoX === 0 && t.isoY === 0)!;
    expect(corner.slabHidden).toBe(false);
  });

  it('keeps the slab on a DIRT cell — the slab top is that cell’s visible surface', () => {
    // No terrain1 anywhere: every cell is bare dirt, fully surrounded.
    const bare = {
      terrain1: new Set<string>(), terrain2: new Set<string>(), street: new Set<string>(),
      communal: new Set<string>(), placeholders: [], condition: new Set<string>(),
      decor: new Map<string, string>(),
    } as unknown as EditorMasks;
    const field: TerrainField = { originCol: 0, originRow: 0, contains: () => true };
    const tiles = buildEditorField(6, 6, bare, field);
    expect(tiles.every((t) => t.slabHidden === false)).toBe(true);
  });

  it('hides the slab on apron cells, which is where the bulk of the saving is', () => {
    const { masks, field } = market4x4();
    const padded = padTerrainField(field, 4, 4, 4, true);
    const tiles = buildEditorField(padded.width, padded.height, masks, padded.field);
    // Every ring cell is default grass with ground on all sides.
    const apron = tiles.filter((t) => t.isoX < 0 || t.isoY < 0);
    expect(apron.length).toBeGreaterThan(0);
    expect(apron.every((t) => t.slabHidden)).toBe(true);
  });
});

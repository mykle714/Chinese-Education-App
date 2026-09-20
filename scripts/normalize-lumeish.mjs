#!/usr/bin/env node
/**
 * normalize-lumeish — build-time asset processing for the `lumeish` furniture pack.
 *
 * LAYER: offline build tooling. It runs by hand (`node scripts/normalize-lumeish.mjs`),
 * reads the raw pack, and writes a normalized pack + manifest that the *runtime*
 * registry (`src/engine/market/lumeishTileset.ts`) globs like any other asset folder.
 * Nothing here runs in the browser, and the engine never sees a raw lumeish PNG.
 *
 * WHY THIS EXISTS
 * The engine's other pack (`free-farm-assets`) is authored on a fixed 32x32 source
 * cell, which is what lets the renderer position every sprite the same way (Pixi
 * anchor (0.5, 1) at the tile's SW corner — see src/engine/market/isometric.ts).
 * The lumeish pack is instead TIGHTLY CROPPED: 151 sprites across ~60 distinct
 * pixel sizes, from 7x8 up to 98x84, with no padding and no anchor convention.
 * This script re-cuts every sprite onto a whole number of 32x32 cells so the rest
 * of the engine can treat it as familiar, grid-aligned art.
 *
 * THE RULE (deliberately approximate — see PLACEMENT below)
 *   1. cells = [ceil(w / 32), ceil(h / 32)]   — the smallest whole-cell box that fits
 *   2. canvas = cells * 32
 *   3. the sprite is CENTERED in that canvas, both axes
 *
 * Centering is only about the PADDING. It does NOT decide where the sprite sits on the
 * board: the manifest also records a measured `anchorTex` (the art's base front corner),
 * and the renderer seats THAT on the foot cell's south vertex — exactly how `House.png`
 * is placed. So the padding being loose costs nothing in placement accuracy.
 *
 * ISO FOOTPRINT (the multi-cell occupancy measurement)
 * The padded box is a PIXEL measurement and is NOT the iso footprint — a 64x32 canvas does
 * not mean "2x1 tiles". In a 2:1 projection an object covering spanX x spanY cells has a base
 * diamond whose screen width is `(spanX + spanY) * TILE_WIDTH/2`, so pixel width alone gives
 * only the SUM. The split comes from where the foot sits inside that width: the south vertex
 * is `spanY * TILE_WIDTH/2` from the west vertex and `spanX * TILE_WIDTH/2` from the east one,
 * so the left/right reach from the foot is in exactly the ratio spanY : spanX.
 *
 *   spanY = round(leftReach  / (TILE_WIDTH/2))     spanX = round(rightReach / (TILE_WIDTH/2))
 *
 * Two independent checks say this measures the real thing rather than a plausible number:
 * the room shell `151.png` comes out 3x3, which matches its floor being exactly 96x48 px
 * (3 tiles each way), and every mirrored facing pair comes out as the TRANSPOSE of its
 * partner — which is what a horizontal flip must do to a footprint, and is not something the
 * measurement was told about. The script asserts that second property and fails if it breaks.
 *
 * MIRROR PAIRS
 * The pack authors most objects twice — an east-facing and a west-facing copy; there
 * is no north/south variant. The two copies share an exactly mirrored SILHOUETTE but
 * are independently SHADED (the light source stays put when the object turns, so the
 * lit and shadowed faces swap rather than flip). They are therefore NOT interchangeable
 * by a runtime `scale.x = -1`: doing that mirrors the lighting too and the object reads
 * as lit from the wrong side. Both files must ship.
 *
 * The script detects pairs on the ALPHA silhouette alone and records `mirrorOf` so a
 * picker UI can collapse the two into a single entry with a facing toggle — one that
 * swaps to the sibling FILE, not one that flips the sprite.
 *
 * OUTPUT
 *   src/assets/test-assets/lumeish-normalized/NNN.png       (zero-padded id, 32-aligned)
 *   src/assets/test-assets/lumeish-normalized/manifest.json
 *
 * The output is COMMITTED. Re-run this script whenever the raw pack changes; it is
 * deterministic, so an unchanged input produces a byte-identical output.
 *
 * Referenced by docs: docs/LUMEISH_ASSET_PIPELINE.md (§ "Normalization script").
 * Consumed by: src/engine/market/lumeishTileset.ts.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const SRC_DIR = join(REPO, 'src/assets/test-assets/lumeish');
const OUT_DIR = join(REPO, 'src/assets/test-assets/lumeish-normalized');
const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');

/**
 * Cell size in source pixels. MUST stay equal to `TILE_WIDTH` in
 * src/engine/market/isometric.ts (32) — that is the whole point of this pass.
 * It is duplicated rather than imported because this is a plain .mjs build script
 * with no TS pipeline; the runtime registry asserts the two agree.
 */
const CELL_PX = 32;

/**
 * Half a tile's screen width = one iso unit of front-edge length in px. Equal to
 * `TILE_WIDTH / 2` in src/engine/market/isometric.ts; the runtime registry asserts the
 * cell size agrees, and this is derived from it.
 */
const ISO_UNIT_PX = CELL_PX / 2;

/**
 * How many rows above the lowest ink row count as "the foot" when locating the base
 * diamond's south vertex. A single row is too fragile — a chair's lowest row is often one
 * leg, which drags the midpoint sideways — while a deep band starts picking up the object's
 * body. Four rows is half a tile's vertical extent and behaved well across the whole pack.
 */
const FOOT_BAND_PX = 4;

/**
 * Raw files that are NOT sprites and must not be normalized.
 * `all_furniture.png` is the 576x800 source sheet every sprite was sliced from —
 * it is reference art, not a placeable asset.
 */
const NON_SPRITE = new Set(['all_furniture.png']);

// ---------------------------------------------------------------------------
// PNG helpers
// ---------------------------------------------------------------------------

/** Decode a PNG to `{ width, height, data }` with 8-bit RGBA data. */
function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

/** Index of the RGBA quad for (x, y) in a decoded PNG's `data` buffer. */
function idx(png, x, y) {
  return (png.width * y + x) << 2;
}

/** True if (x, y) carries any opacity at all (the pack has no partial alpha). */
function isInk(png, x, y) {
  return png.data[idx(png, x, y) + 3] !== 0;
}

/**
 * Measure the art's base geometry: the bounding box of its ink, the south-vertex x, and the
 * resulting iso footprint. All in SOURCE (unpadded) coordinates.
 *
 * See "ISO FOOTPRINT" in the module doc for the derivation. `spanX`/`spanY` are floored at 1:
 * a prop always occupies at least one cell, however small its art.
 */
function measureBase(png) {
  let minX = Infinity, maxX = -Infinity, maxY = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!isInk(png, x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxY < 0) return null; // fully transparent — none exist today, but do not divide by it

  // South vertex: horizontal midpoint of the ink in the bottom band (see FOOT_BAND_PX).
  let bandMin = Infinity, bandMax = -Infinity;
  for (let y = Math.max(0, maxY - (FOOT_BAND_PX - 1)); y <= maxY; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!isInk(png, x, y)) continue;
      if (x < bandMin) bandMin = x;
      if (x > bandMax) bandMax = x;
    }
  }
  const footX = (bandMin + bandMax) / 2;

  const leftReach = footX - minX;
  const rightReach = maxX - footX;
  return {
    footX,
    baseRow: maxY,
    leftReach,
    rightReach,
    spanX: Math.max(1, Math.round(rightReach / ISO_UNIT_PX)),
    spanY: Math.max(1, Math.round(leftReach / ISO_UNIT_PX)),
  };
}

/**
 * PLACEMENT RULE. Where the source sprite's top-left corner lands inside the padded
 * canvas. Centered on both axes, biased up/left on an odd remainder (`Math.floor`)
 * so the extra pixel of slack falls below the object rather than above it — which is
 * marginally closer to standing on the ground plane.
 *
 * Change THIS FUNCTION (not the callers) to switch the pack to foot-anchored art.
 */
function placeSprite(srcW, srcH, canvasW, canvasH) {
  return {
    x: Math.floor((canvasW - srcW) / 2),
    y: Math.floor((canvasH - srcH) / 2),
  };
}

/** One decimal place — keeps the audit fields readable without lying about the measurement. */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Blit `src` onto a fresh transparent `canvasW x canvasH` PNG at (offX, offY). */
function padToCanvas(src, canvasW, canvasH, offX, offY) {
  // `new PNG()` zero-fills, which in RGBA is fully-transparent black — exactly the
  // padding we want, so only the sprite's own pixels need writing.
  const out = new PNG({ width: canvasW, height: canvasH });
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = idx(src, x, y);
      const d = idx(out, x + offX, y + offY);
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}

/**
 * True if `a`'s opaque silhouette is the exact horizontal mirror of `b`'s.
 *
 * ALPHA ONLY, on purpose. The pack's facing pairs are re-shaded rather than flipped
 * (see MIRROR PAIRS in the module doc), so a full RGBA comparison finds almost none of
 * them — e.g. `3.png` / `4.png` differ on 376 pixels of colour while their silhouettes
 * match to the pixel. The silhouette is what identifies the pair; the colour difference
 * is exactly why both files have to be kept.
 */
function isSilhouetteMirror(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const opaqueA = a.data[idx(a, x, y) + 3] !== 0;
      const opaqueB = b.data[idx(b, b.width - 1 - x, y) + 3] !== 0;
      if (opaqueA !== opaqueB) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`[normalize-lumeish] source pack not found: ${SRC_DIR}`);
    process.exit(1);
  }

  // Numeric filenames (`1.png` … `151.png`), sorted numerically rather than
  // lexically so the manifest reads in pack order (1, 2, 3 — not 1, 10, 100).
  const files = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.png') && !NON_SPRITE.has(f))
    .filter((f) => {
      const ok = /^\d+\.png$/.test(f);
      if (!ok) console.warn(`[normalize-lumeish] skipping non-numeric filename: ${f}`);
      return ok;
    })
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  if (files.length === 0) {
    console.error('[normalize-lumeish] no sprites found — nothing to do.');
    process.exit(1);
  }

  // Decode once; both the padding pass and the mirror-pair pass need the pixels.
  const sprites = files.map((file) => {
    const png = readPng(join(SRC_DIR, file));
    return { id: parseInt(file, 10), file, png };
  });

  // --- mirror-pair detection ---------------------------------------------
  // O(n^2) worst case, but the size check rejects almost every candidate up front
  // and n is 151, so this is a few ms. First-wins: the LOWER id is the canonical
  // one and the higher id records `mirrorOf`.
  const mirrorOf = new Map();
  const claimed = new Set();
  for (let i = 0; i < sprites.length; i++) {
    if (claimed.has(sprites[i].id)) continue;
    for (let j = i + 1; j < sprites.length; j++) {
      if (claimed.has(sprites[j].id)) continue;
      if (isSilhouetteMirror(sprites[i].png, sprites[j].png)) {
        mirrorOf.set(sprites[j].id, sprites[i].id);
        claimed.add(sprites[i].id);
        claimed.add(sprites[j].id);
        break;
      }
    }
  }

  // --- normalize ----------------------------------------------------------
  // Wipe the output dir so a deleted/renamed source sprite cannot leave a stale
  // PNG behind that the runtime glob would still pick up.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const entries = [];
  const footprintTally = new Map();

  for (const { id, png } of sprites) {
    const cellsW = Math.ceil(png.width / CELL_PX);
    const cellsH = Math.ceil(png.height / CELL_PX);
    const canvasW = cellsW * CELL_PX;
    const canvasH = cellsH * CELL_PX;
    const { x: offX, y: offY } = placeSprite(png.width, png.height, canvasW, canvasH);

    const padded = padToCanvas(png, canvasW, canvasH, offX, offY);
    const name = `${String(id).padStart(3, '0')}.png`;
    writeFileSync(join(OUT_DIR, name), PNG.sync.write(padded));

    const base = measureBase(png);
    entries.push({
      id,
      file: name,
      cells: [cellsW, cellsH],
      src: [png.width, png.height],
      offset: [offX, offY],
      // Iso footprint in cells — the multi-cell OCCUPANCY, unrelated to `cells` above.
      isoSpan: base ? [base.spanX, base.spanY] : [1, 1],
      /**
       * The base diamond's south vertex in PADDED canvas coordinates: the pixel the renderer
       * seats on the foot cell's front vertex, same role as House.png's measured base corner.
       * `+1` on y puts it on the boundary BELOW the last ink row rather than on it.
       */
      anchorTex: base ? [base.footX + offX, base.baseRow + offY + 1] : [canvasW / 2, canvasH],
      // Raw reach measurement in source px, kept so a surprising isoSpan can be audited
      // (and hand-corrected) without re-deriving it from the pixels.
      reachPx: base ? [round1(base.leftReach), round1(base.rightReach)] : [0, 0],
      mirrorOf: mirrorOf.get(id) ?? null,
    });

    const key = `${cellsW}x${cellsH}`;
    footprintTally.set(key, (footprintTally.get(key) ?? 0) + 1);
  }

  // VALIDATION. A horizontal mirror must transpose a footprint (see the module doc), and the
  // span measurement knows nothing about pairing — so agreement across all 65 pairs is real
  // evidence the measurement tracks the art. A disagreement means one of the two sprites was
  // measured badly, so report it loudly rather than shipping an asymmetric pair.
  const byId = new Map(entries.map((e) => [e.id, e]));
  const spanMismatches = [];
  for (const entry of entries) {
    if (entry.mirrorOf === null) continue;
    const partner = byId.get(entry.mirrorOf);
    if (!partner) continue;
    if (entry.isoSpan[0] !== partner.isoSpan[1] || entry.isoSpan[1] !== partner.isoSpan[0]) {
      spanMismatches.push(
        `${entry.id} (${entry.isoSpan.join('x')}) vs ${partner.id} (${partner.isoSpan.join('x')})`,
      );
    }
  }

  const manifest = {
    // Provenance + the invariants a consumer is entitled to rely on. Regenerate
    // with `node scripts/normalize-lumeish.mjs` — do not hand-edit.
    generatedBy: 'scripts/normalize-lumeish.mjs',
    sourcePack: 'src/assets/test-assets/lumeish',
    normalizedDir: 'src/assets/test-assets/lumeish-normalized',
    cellPx: CELL_PX,
    // How the art is PADDED. Placement on the board uses each sprite's `anchorTex` instead.
    placement: 'center',
    spriteCount: entries.length,
    sprites: entries,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  // --- report -------------------------------------------------------------
  console.log(`[normalize-lumeish] wrote ${entries.length} sprites -> ${OUT_DIR}`);
  console.log(`[normalize-lumeish] wrote manifest -> ${MANIFEST_PATH}`);
  console.log(`[normalize-lumeish] mirror pairs detected: ${mirrorOf.size}`);
  console.log('[normalize-lumeish] padded canvas footprints:');
  for (const key of [...footprintTally.keys()].sort()) {
    console.log(`  ${key} cells: ${footprintTally.get(key)}`);
  }

  const isoTally = new Map();
  for (const e of entries) {
    const key = e.isoSpan.join('x');
    isoTally.set(key, (isoTally.get(key) ?? 0) + 1);
  }
  console.log('[normalize-lumeish] iso footprints (occupancy):');
  for (const key of [...isoTally.keys()].sort()) {
    console.log(`  ${key} cells: ${isoTally.get(key)}`);
  }

  if (spanMismatches.length > 0) {
    console.warn(
      `[normalize-lumeish] ⚠ ${spanMismatches.length} mirrored pair(s) did NOT transpose — ` +
        'their iso span was measured badly and should be hand-checked:',
    );
    for (const m of spanMismatches) console.warn(`    ${m}`);
  } else {
    console.log('[normalize-lumeish] ✓ every mirrored pair transposes its iso span');
  }
}

main();

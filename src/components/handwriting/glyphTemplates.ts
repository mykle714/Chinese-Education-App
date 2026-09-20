/**
 * Loader for the beginner keyboard's glyph stroke-template asset.
 *
 * LAYER: client data access for the keyboard. Parses the binary blob produced by
 * server/scripts/backfill/chinese/generate-handwriting-templates.js into the flat
 * typed arrays the matcher scans.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6s ("The template asset").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SINGLE BLOB, LAZILY FETCHED
 *
 * The matcher is a closed-set scan: every submission is scored against the whole
 * set, so it must be resident before the learner draws. But the keyboard is one
 * surface among many, so the asset is loaded on first use and cached for the
 * session — never as part of the initial bundle.
 *
 * Templates are decoded into ONE flat Float32Array rather than nested arrays.
 * At 7,258 glyphs / 77,416 strokes / 8 points, the nested form would be ~620k
 * tiny arrays; the flat form is a single allocation the scoring loop can walk
 * without chasing pointers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COARSE DESCRIPTOR IS DERIVED HERE, NOT STORED
 *
 * The matcher's prefilter needs a cheap summary of each template — the centroid
 * of every stroke, 2 floats where the full stroke is 16. That summary is a pure
 * function of the coordinates, so computing it once at load time is strictly
 * better than storing it: the asset stays smaller, and there is no second copy
 * that can drift out of sync with the shape it claims to summarize.
 */
import templatesUrl from '../../assets/handwriting/glyph-templates.bin?url';
import { POINTS_PER_STROKE, QUANT_SCALE } from './inkGeometry';

const MAGIC = 'HWCT';
const SUPPORTED_VERSION = 2;

/**
 * Role bits, mirroring the generator's constants.
 *
 * A glyph is very often BOTH — 木 is a component of 想 and a word in its own
 * right — which is why this is a bitfield and not an enum. The candidate row is
 * a single mixed ranked list, so these bits are what decide whether tapping a
 * chip APPENDS it to the component buffer or COMMITS it as text.
 */
export const KIND_COMPONENT = 1;
export const KIND_CHARACTER = 2;

export interface GlyphTemplates {
  /** The glyph for template i. */
  chars: string[];
  /** KIND_COMPONENT | KIND_CHARACTER bitfield for template i. */
  kinds: Uint8Array;
  /** Stroke count for template i. */
  strokeCounts: Uint8Array;
  /** Index into `coords` (in floats) where template i's first stroke begins. */
  offsets: Uint32Array;
  /** All coordinates, x/y interleaved, POINTS_PER_STROKE points per stroke. */
  coords: Float32Array;
  /**
   * Per-stroke centroids, x/y interleaved — the prefilter's coarse descriptor.
   * Template i's first centroid is at `centroidOffsets[i]`.
   */
  centroids: Float32Array;
  /** Index into `centroids` (in floats) where template i's first centroid begins. */
  centroidOffsets: Uint32Array;
  /** Points per stroke, read from the asset header (must equal POINTS_PER_STROKE). */
  pointsPerStroke: number;
}

/**
 * Decode the asset. Throws on any header mismatch rather than reading on — a
 * stale asset paired with new geometry constants produces silently wrong scores,
 * which is far harder to notice than a load failure.
 */
export function parseGlyphTemplates(buffer: ArrayBuffer): GlyphTemplates {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) {
    throw new Error(`glyph-templates.bin: bad magic "${magic}" (expected "${MAGIC}")`);
  }
  const version = view.getUint8(4);
  if (version !== SUPPORTED_VERSION) {
    throw new Error(
      `glyph-templates.bin: format version ${version}, expected ${SUPPORTED_VERSION}. ` +
        `Regenerate the asset (scripts/backfill/chinese/generate-handwriting-templates.js).`,
    );
  }
  const pointsPerStroke = view.getUint8(5);
  if (pointsPerStroke !== POINTS_PER_STROKE) {
    throw new Error(
      `glyph-templates.bin was generated with ${pointsPerStroke} points per stroke but the ` +
        `client expects ${POINTS_PER_STROKE}. Regenerate the asset ` +
        `(scripts/backfill/chinese/generate-handwriting-templates.js).`,
    );
  }
  const quantBits = view.getUint8(6);
  if (quantBits !== 8) {
    throw new Error(`glyph-templates.bin: unsupported quantization width ${quantBits}`);
  }
  const count = view.getUint32(8, true);

  const chars: string[] = new Array(count);
  const kinds = new Uint8Array(count);
  const strokeCounts = new Uint8Array(count);
  const offsets = new Uint32Array(count);
  const centroidOffsets = new Uint32Array(count);

  const HEADER_BYTES = 12;
  const RECORD_BYTES = 6; // codepoint u32 + kind u8 + strokes u8

  // First pass: header walk to total the coordinate count, so `coords` is a
  // single right-sized allocation instead of a growing array.
  let cursor = HEADER_BYTES;
  let floatCount = 0;
  for (let i = 0; i < count; i++) {
    const codePoint = view.getUint32(cursor, true);
    kinds[i] = view.getUint8(cursor + 4);
    const strokes = view.getUint8(cursor + 5);
    cursor += RECORD_BYTES;

    chars[i] = String.fromCodePoint(codePoint);
    strokeCounts[i] = strokes;
    offsets[i] = floatCount;
    centroidOffsets[i] = floatCount / pointsPerStroke; // 2 floats per stroke vs 2×points

    const coordsHere = strokes * pointsPerStroke * 2;
    floatCount += coordsHere;
    cursor += coordsHere; // int8, one byte each
  }

  // Second pass: dequantize, and accumulate each stroke's centroid in the same
  // walk. Division by QUANT_SCALE is the exact inverse of the generator's
  // multiplication, so runtime ink and stored templates share one space.
  const coords = new Float32Array(floatCount);
  const centroids = new Float32Array(floatCount / pointsPerStroke);
  cursor = HEADER_BYTES;
  let write = 0;
  let centroidWrite = 0;
  for (let i = 0; i < count; i++) {
    const strokes = view.getUint8(cursor + 5);
    cursor += RECORD_BYTES;
    for (let s = 0; s < strokes; s++) {
      let sumX = 0;
      let sumY = 0;
      for (let k = 0; k < pointsPerStroke; k++) {
        const x = view.getInt8(cursor++) / QUANT_SCALE;
        const y = view.getInt8(cursor++) / QUANT_SCALE;
        coords[write++] = x;
        coords[write++] = y;
        sumX += x;
        sumY += y;
      }
      centroids[centroidWrite++] = sumX / pointsPerStroke;
      centroids[centroidWrite++] = sumY / pointsPerStroke;
    }
  }

  return {
    chars,
    kinds,
    strokeCounts,
    offsets,
    coords,
    centroids,
    centroidOffsets,
    pointsPerStroke,
  };
}

let cached: Promise<GlyphTemplates> | null = null;

/**
 * Fetch and decode the templates, once per session.
 *
 * The promise itself is cached, so concurrent callers during the keyboard's first
 * open share one request. A REJECTED promise is cleared, so a transient network
 * failure does not permanently disable the keyboard for the session.
 */
export function loadGlyphTemplates(): Promise<GlyphTemplates> {
  if (!cached) {
    cached = fetch(templatesUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`glyph-templates.bin: HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then(parseGlyphTemplates)
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}

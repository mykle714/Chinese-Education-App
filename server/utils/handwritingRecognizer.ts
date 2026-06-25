/**
 * Handwriting recognizer — Google Input Tools adapter (server-side).
 *
 * This is the ONLY place the unofficial Google handwriting endpoint is touched.
 * Per docs/HANDWRITING_RECOGNITION.md the endpoint is undocumented and may change
 * or rate-limit without notice, so we contain it here behind a stable contract:
 * canonical `Ink` in, ranked candidate strings out. Swapping to another backend
 * (e.g. HanziLookupJS, a cloud API) means replacing only this module.
 *
 * Referenced by: server/server.ts (POST /api/handwriting/recognize).
 * Spec: docs/HANDWRITING_RECOGNITION.md (canonical stroke format, decisions).
 */

/** One stroke = parallel arrays of sampled points, in draw order. ts = capture ms. */
export interface Stroke {
  xs: number[];
  ys: number[];
  ts: number[];
}

/** Strokes in the order they were drawn. */
export type Ink = Stroke[];

const GOOGLE_ENDPOINT =
  'https://inputtools.google.com/request?ime=handwriting&app=mobile&dbg=1&cs=1&oe=UTF-8';

// Defensive caps so a malicious/buggy client can't push an unbounded payload to
// Google through us. A normal character is < ~40 strokes / a few hundred points.
const MAX_STROKES = 60;
const MAX_POINTS_PER_STROKE = 600;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Validates that a value is a well-formed `Ink`: a non-empty array of strokes,
 * each with equal-length numeric xs/ys (ts optional but normalized). Returns a
 * sanitized copy or throws on malformed input.
 */
export function validateInk(value: unknown): Ink {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('ink must be a non-empty array of strokes');
  }
  if (value.length > MAX_STROKES) {
    throw new Error(`too many strokes (max ${MAX_STROKES})`);
  }
  return value.map((stroke: any, i: number) => {
    const xs = stroke?.xs;
    const ys = stroke?.ys;
    if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length === 0) {
      throw new Error(`stroke ${i} must have equal-length non-empty xs/ys arrays`);
    }
    if (xs.length > MAX_POINTS_PER_STROKE) {
      throw new Error(`stroke ${i} has too many points (max ${MAX_POINTS_PER_STROKE})`);
    }
    const numeric = (arr: any[]) =>
      arr.map((n) => {
        const v = Number(n);
        if (!Number.isFinite(v)) throw new Error(`stroke ${i} contains a non-numeric coordinate`);
        return v;
      });
    // ts is optional; synthesize a monotonic fallback if absent so the Google
    // payload always carries a timestamp array (the recognizer expects one).
    const ts = Array.isArray(stroke.ts) && stroke.ts.length === xs.length
      ? numeric(stroke.ts)
      : xs.map((_: number, j: number) => j * 30);
    return { xs: numeric(xs), ys: numeric(ys), ts };
  });
}

/**
 * Recognizes a hand-drawn character from canonical `Ink`.
 *
 * @param ink              validated strokes
 * @param writingAreaWidth  declared canvas width the coords live in
 * @param writingAreaHeight declared canvas height the coords live in
 * @returns ranked candidate strings (best first); empty array if nothing matched
 *
 * Locale is hardcoded to zh_CN (simplified) for v1; traditional (zh_TW) is future
 * work (see docs/HANDWRITING_RECOGNITION.md open questions).
 */
export async function recognizeChinese(
  ink: Ink,
  writingAreaWidth: number,
  writingAreaHeight: number,
): Promise<string[]> {
  // Google's `ink` is an array of strokes, each stroke [ [xs], [ys], [ts] ].
  const googleInk = ink.map((s) => [s.xs, s.ys, s.ts]);

  const body = {
    options: 'enable_pre_space',
    requests: [
      {
        writing_guide: {
          writing_area_width: writingAreaWidth,
          writing_area_height: writingAreaHeight,
        },
        ink: googleInk,
        language: 'zh_CN',
      },
    ],
  };

  // Bound the upstream call so a hung Google request doesn't pin our handler.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(GOOGLE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`handwriting upstream returned HTTP ${res.status}`);
  }

  // Response shape: ["SUCCESS", [[ "<id>", ["想","柤",…], [], {...} ]], "", {...}]
  const data: any = await res.json();
  if (!Array.isArray(data) || data[0] !== 'SUCCESS') {
    return [];
  }
  const candidates = data?.[1]?.[0]?.[1];
  return Array.isArray(candidates) ? candidates.filter((c: any) => typeof c === 'string') : [];
}

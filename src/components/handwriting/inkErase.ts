/**
 * inkErase — the PARTIAL eraser's geometry (docs/WRITING_NOTEBOOK.md § "Canvas").
 *
 * Rubbing the eraser through a stroke cuts that piece out and leaves the parts on either
 * side as separate strokes, so the result is still canonical `Ink` (real strokes, in
 * draw order) and stays recognisable — unlike a pixel eraser, which would leave nothing
 * a recogniser can read. The cut lands exactly on the eraser's circle (segments are
 * clipped analytically, not by dropping whole sample points), so a fast stroke with
 * sparse samples erases as cleanly as a slow one.
 *
 * Pure: no DOM. Used by WritingCanvas (`tool="eraser"`).
 */
import type { Ink, Stroke } from "./types";

/** A clipped piece shorter than this many points is dropped (a lone dot left at a cut edge). */
const MIN_PIECE_POINTS = 2;

/** The point at parameter t along the segment i → i + 1, with an interpolated timestamp. */
function lerpPoint(s: Stroke, i: number, t: number): [number, number, number] {
    const j = i + 1;
    return [
        s.xs[i] + (s.xs[j] - s.xs[i]) * t,
        s.ys[i] + (s.ys[j] - s.ys[i]) * t,
        (s.ts[i] ?? 0) + ((s.ts[j] ?? 0) - (s.ts[i] ?? 0)) * t,
    ];
}

/**
 * Erase the disc (cx, cy, r) out of one stroke. Returns the surviving pieces — the SAME
 * stroke object when the disc misses it (so callers can keep per-stroke caches), [] when
 * it is erased entirely.
 */
export function eraseDiscFromStroke(stroke: Stroke, cx: number, cy: number, r: number): Stroke[] {
    const n = stroke.xs.length;
    if (n === 0) return [];
    const r2 = r * r;
    const inside = (k: number) => (stroke.xs[k] - cx) ** 2 + (stroke.ys[k] - cy) ** 2 <= r2;

    // Cheap reject: the disc does not reach the stroke's bounding box.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < n; k++) {
        minX = Math.min(minX, stroke.xs[k]); maxX = Math.max(maxX, stroke.xs[k]);
        minY = Math.min(minY, stroke.ys[k]); maxY = Math.max(maxY, stroke.ys[k]);
    }
    if (cx + r < minX || cx - r > maxX || cy + r < minY || cy - r > maxY) return [stroke];

    // A dot (single-point tap) is either wholly erased or untouched.
    if (n === 1) return inside(0) ? [] : [stroke];

    const pieces: Stroke[] = [];
    let cur: Stroke | null = null;
    let touched = false;
    const push = (p: [number, number, number]) => {
        if (!cur) cur = { xs: [], ys: [], ts: [] };
        cur.xs.push(p[0]); cur.ys.push(p[1]); cur.ts.push(p[2]);
    };
    const flush = () => {
        if (cur && cur.xs.length >= MIN_PIECE_POINTS) pieces.push(cur);
        cur = null;
    };

    if (!inside(0)) push([stroke.xs[0], stroke.ys[0], stroke.ts[0] ?? 0]);
    else touched = true;

    for (let i = 0; i < n - 1; i++) {
        const q: [number, number, number] = [stroke.xs[i + 1], stroke.ys[i + 1], stroke.ts[i + 1] ?? 0];
        // Solve |P + t·d − C|² = r² for the segment P → Q (t ∈ [0, 1]).
        const dx = stroke.xs[i + 1] - stroke.xs[i];
        const dy = stroke.ys[i + 1] - stroke.ys[i];
        const fx = stroke.xs[i] - cx;
        const fy = stroke.ys[i] - cy;
        const a = dx * dx + dy * dy;
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - r2;
        const disc = b * b - 4 * a * c;
        if (a === 0 || disc <= 0) {
            // Degenerate (repeated point) or the line misses the disc: Q's fate is its own.
            if (inside(i + 1)) { touched = true; flush(); } else push(q);
            continue;
        }
        const root = Math.sqrt(disc);
        const t0 = (-b - root) / (2 * a);
        const t1 = (-b + root) / (2 * a);
        if (t1 <= 0 || t0 >= 1) {
            // The disc lies off this segment's span.
            push(q);
            continue;
        }
        touched = true;
        // Enters the disc inside this segment: end the current piece on the circle.
        if (t0 > 0) { push(lerpPoint(stroke, i, t0)); flush(); }
        // Leaves the disc inside this segment: start a new piece on the circle.
        if (t1 < 1) { cur = null; push(lerpPoint(stroke, i, t1)); push(q); }
        else cur = null; // Q is inside — nothing survives to it.
    }
    flush();
    return touched ? pieces : [stroke];
}

/**
 * Sweep the eraser from (ax, ay) to (bx, by) — the path between two pointer samples —
 * through the whole ink. The sweep is sampled every half radius so a fast drag erases a
 * continuous band rather than a string of separate discs. Returns the same `ink` array
 * when nothing was touched.
 */
export function eraseSweep(ink: Ink, ax: number, ay: number, bx: number, by: number, r: number): Ink {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r / 2)));
    let out = ink;
    for (let k = 0; k <= steps; k++) {
        const cx = ax + ((bx - ax) * k) / steps;
        const cy = ay + ((by - ay) * k) / steps;
        let changed = false;
        const next: Ink = [];
        for (const s of out) {
            const pieces = eraseDiscFromStroke(s, cx, cy, r);
            if (pieces.length !== 1 || pieces[0] !== s) changed = true;
            next.push(...pieces);
        }
        if (changed) out = next;
    }
    return out;
}

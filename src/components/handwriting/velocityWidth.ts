/**
 * Velocity-based stroke width for the writing canvas (presentation-only).
 *
 * A marker-like look: a fast pointer lays down a thick line, a slow one a thin line.
 * Width is a pure function of a stroke's (xs, ys, ts), so it is never stored — the
 * canonical `Stroke` / recognition contract is untouched, and a restored draft
 * re-renders exactly as it was drawn.
 *
 * Two knobs keep it from looking jittery:
 *  1. Speed is smoothed (EMA) before it is mapped to a width, so one noisy sample
 *     can't spike the line.
 *  2. The width is SLEW-RATE LIMITED per CSS px travelled: it may grow by at most
 *     `maxGrowthPerPx` and shrink by at most `maxShrinkPerPx` (both fractions of the
 *     base width). Limiting per distance rather than per sample makes the taper
 *     independent of how densely the browser samples the pointer.
 *
 * Desktop (mouse) and mobile (touch / stylus) get separate profiles because a mouse
 * moves several times faster than a finger across the same canvas — one speed range
 * would leave a finger permanently "slow" (thick) or a mouse permanently "fast" (thin).
 *
 * Consumed by: src/components/handwriting/WritingCanvas.tsx (`redrawAll`).
 * Docs: docs/HANDWRITING_RECOGNITION.md ("Reading in user writing inputs" → velocity width).
 */
import type { Stroke } from "./types";

export type WidthProfileKey = "desktop" | "mobile";

export interface VelocityWidthProfile {
  /** At or below this speed (CSS px / ms) the line is at its thinnest. */
  slowSpeed: number;
  /** At or above this speed the line is at its thickest. */
  fastSpeed: number;
  /** Width multiplier (× base strokeWidth) at `slowSpeed` — the thinnest the line gets. */
  slowScale: number;
  /** Width multiplier at `fastSpeed` — the thickest the line gets. */
  fastScale: number;
  /** Max width increase per CSS px travelled, as a fraction of base width. */
  maxGrowthPerPx: number;
  /** Max width decrease per CSS px travelled, as a fraction of base width. */
  maxShrinkPerPx: number;
  /** EMA weight of the newest speed sample (0–1; higher = more responsive). */
  speedSmoothing: number;
}

export const VELOCITY_WIDTH_PROFILES: Record<WidthProfileKey, VelocityWidthProfile> = {
  // Mouse: fast and precise, so a wide speed range and a slightly gentler taper.
  desktop: {
    slowSpeed: 0.25,
    fastSpeed: 3.0,
    slowScale: 0.55,
    fastScale: 3.0,
    maxGrowthPerPx: 0.12,
    maxShrinkPerPx: 0.03,
    speedSmoothing: 0.3,
  },
  // Finger / stylus: slower absolute speeds on a small canvas.
  mobile: {
    slowSpeed: 0.1,
    fastSpeed: 1.2,
    slowScale: 0.6,
    fastScale: 3.0,
    maxGrowthPerPx: 0.16,
    maxShrinkPerPx: 0.03,
    speedSmoothing: 0.35,
  },
};

/** Profile for a live pointer: mouse → desktop, touch/pen → mobile. */
export function profileForPointerType(pointerType: string): WidthProfileKey {
  return pointerType === "mouse" ? "desktop" : "mobile";
}

/**
 * Profile for a stroke whose pointer we never saw (a restored draft, a Snap-substituted
 * median): guess from the device's primary input.
 */
export function defaultProfileKey(): WidthProfileKey {
  if (typeof window === "undefined" || !window.matchMedia) return "desktop";
  return window.matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Per-point line widths (CSS px) for a stroke; same length as `stroke.xs`. */
export function computeStrokeWidths(stroke: Stroke, baseWidth: number, profile: VelocityWidthProfile): number[] {
  const n = stroke.xs.length;
  if (n === 0) return [];
  const slowW = baseWidth * profile.slowScale;
  const fastW = baseWidth * profile.fastScale;
  const targetFor = (speed: number) => {
    const t = clamp((speed - profile.slowSpeed) / (profile.fastSpeed - profile.slowSpeed), 0, 1);
    return slowW + (fastW - slowW) * t; // slow → thin, fast → thick
  };
  // Pen-down starts at the at-rest (thinnest) width, then swells as the pointer gets going.
  const widths = [targetFor(0)];
  let smoothedSpeed = 0;
  for (let i = 1; i < n; i++) {
    const dist = Math.hypot(stroke.xs[i] - stroke.xs[i - 1], stroke.ys[i] - stroke.ys[i - 1]);
    // Coalesced pointer events can share a timestamp; floor dt at 1 ms so speed stays finite.
    const dt = Math.max(1, (stroke.ts[i] ?? 0) - (stroke.ts[i - 1] ?? 0));
    smoothedSpeed += profile.speedSmoothing * (dist / dt - smoothedSpeed);
    const prev = widths[i - 1];
    const wanted = targetFor(smoothedSpeed);
    // Slew limit: the allowed change scales with the distance just covered.
    const maxUp = baseWidth * profile.maxGrowthPerPx * dist;
    const maxDown = baseWidth * profile.maxShrinkPerPx * dist;
    widths.push(clamp(wanted, prev - maxDown, prev + maxUp));
  }
  return widths;
}

/**
 * Builds a fillable outline for a variable-width stroke: a disc at every point plus a
 * quad joining consecutive discs. Every sub-path is wound the same way, so a single
 * nonzero `fill()` paints the union exactly once — overlaps don't double up, which
 * matters when the stroke is drawn translucent (the rejected-stroke fade).
 */
export function buildVariableStrokePath(stroke: Stroke, widths: number[]): Path2D {
  const path = new Path2D();
  const { xs, ys } = stroke;
  for (let i = 0; i < xs.length; i++) {
    const r = widths[i] / 2;
    path.moveTo(xs[i] + r, ys[i]);
    path.arc(xs[i], ys[i], r, 0, Math.PI * 2); // increasing angle → positive shoelace winding
  }
  for (let i = 1; i < xs.length; i++) {
    const dx = xs[i] - xs[i - 1];
    const dy = ys[i] - ys[i - 1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    // Unit normal to the segment. Using plain normals (not exact tangent lines) is a
    // fine approximation because the slew limit keeps adjacent radii close.
    const nx = -dy / len;
    const ny = dx / len;
    const r0 = widths[i - 1] / 2;
    const r1 = widths[i] / 2;
    const quad: [number, number][] = [
      [xs[i - 1] + nx * r0, ys[i - 1] + ny * r0],
      [xs[i] + nx * r1, ys[i] + ny * r1],
      [xs[i] - nx * r1, ys[i] - ny * r1],
      [xs[i - 1] - nx * r0, ys[i - 1] - ny * r0],
    ];
    // Match the discs' winding (positive shoelace area) so nonzero fill unions them.
    let area = 0;
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = quad[k];
      const [bx, by] = quad[(k + 1) % 4];
      area += ax * by - bx * ay;
    }
    if (area < 0) quad.reverse();
    path.moveTo(quad[0][0], quad[0][1]);
    for (let k = 1; k < 4; k++) path.lineTo(quad[k][0], quad[k][1]);
    path.closePath();
  }
  return path;
}

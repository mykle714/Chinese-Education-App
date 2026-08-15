/**
 * nmpPerf — a dev-only probe for the night market's render cost.
 *
 * LAYER: feature diagnostic. No React, no Pixi imports — anything in nmp can call it.
 *
 * WHY: nmp's lag has been diagnosed twice from static reading and twice incompletely. The costs that
 * matter are not visible in the source: how many cells the loaded market actually spans, how many
 * Pixi children end up in the camera container, whether the terrain is being rebuilt per frame, and
 * what the frame time actually is on the target device. This reports all four to the console.
 *
 * ON BY DEFAULT IN DEV (`import.meta.env.DEV`) — requiring an opt-in flag meant the numbers were
 * never actually to hand when the lag was being discussed. Force it on in a production build with
 * `localStorage.setItem('nmpPerf', '1')`; force it OFF anywhere with `'0'`. It is a hard no-op when
 * disabled, so it costs nothing in normal use. Summary lands on the console every {@link REPORT_MS}.
 *
 * SHIPS ITS FRAME STATS, TOO. Every report window also goes to the client-diagnostics pipeline via
 * {@link reportFrameStats}, so a synthetic load test (docs/REACT_NATIVE_MIGRATION.md action item 4a)
 * and real prod telemetry land in the same JSONL and are read by the same analyzer. The console is
 * for watching; the records are for measuring. That leg is inert unless `initPerfDiagnostics()` ran
 * (`localStorage.perfDiag = '1'` in dev), so normal dev sessions still only pay for the console line.
 *
 * Referenced by: MarketEngineViewer.tsx (frame + container census + ped load), EditorTerrainLayer.tsx
 * (tile and sprite counts), GroundBackdropLayer.tsx (motif generation), docs/NIGHT_MARKET_FEATURE.md
 * § "Terrain performance", docs/CLIENT_PERF_DIAGNOSTICS.md § "Frame records".
 */

import { reportFrameStats } from '../../utils/perfDiagnostics';

const REPORT_MS = 2_000;

/** Surface name stamped on every shipped frame record, for grouping in the analyzer. */
const SURFACE = 'night-market';

/** Resolved once: the flag cannot change without a reload, and `enabled()` is called per frame. */
const ENABLED = (() => {
  let flag: string | null = null;
  try {
    flag = typeof localStorage !== 'undefined' ? localStorage.getItem('nmpPerf') : null;
  } catch {
    flag = null; // private-mode / blocked storage — fall back to the env default
  }
  if (flag === '1') return true;
  if (flag === '0') return false;
  return !!import.meta.env?.DEV;
})();

function enabled(): boolean {
  return ENABLED;
}

/** Counters keyed by label; each records how many times it fired and the last value reported. */
const counts = new Map<string, { fires: number; last: number }>();
const notes = new Map<string, string>();

/**
 * Current load descriptor ("peds=1000"), set by the load harness. It is the x-axis of any scale
 * experiment, so it rides on every shipped frame record — a frame time without the load it was
 * measured under is not a data point.
 */
let loadLabel: string | undefined;

let frames = 0;
let frameTimeTotal = 0;
let worstFrame = 0;
let lastFrameAt = 0;
let lastReportAt = 0;
let reportScheduled = false;

/**
 * Record that `label` did work `value` units big (tiles built, sprites emitted, …). The FIRE COUNT is
 * the diagnostic that matters most: a `terrain-build` firing once per frame means memoisation is
 * broken, which is invisible in a sprite count.
 */
export function count(label: string, value: number): void {
  if (!enabled()) return;
  const entry = counts.get(label) ?? { fires: 0, last: 0 };
  entry.fires += 1;
  entry.last = value;
  counts.set(label, entry);
  schedule();
}

/**
 * Declare what load the scene is currently under, e.g. `load('peds=1000')`.
 *
 * Unlike {@link count}, this is NOT cleared between reports — it describes the experiment, not the
 * work done in one window, and every subsequent frame record carries it until it changes.
 *
 * NOT gated on `enabled()`: the label must survive being set before/while the probe is off, so a
 * caller cannot produce unlabelled records by ordering. Setting a string costs nothing.
 */
export function load(label: string | undefined): void {
  loadLabel = label;
}

/** Attach a one-off fact to the next report (e.g. the generated motif's size). */
export function note(label: string, text: string): void {
  if (!enabled()) return;
  notes.set(label, text);
  schedule();
}

/** Call once per rendered frame. Tracks mean + worst frame time between reports. */
export function frame(now: number): void {
  if (!enabled()) return;
  if (lastFrameAt > 0) {
    const dt = now - lastFrameAt;
    frames += 1;
    frameTimeTotal += dt;
    if (dt > worstFrame) worstFrame = dt;
  }
  lastFrameAt = now;
  schedule();
}

function schedule(): void {
  if (reportScheduled) return;
  reportScheduled = true;
  setTimeout(() => {
    reportScheduled = false;
    report();
  }, REPORT_MS);
}

function report(): void {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (now - lastReportAt < REPORT_MS * 0.5) return;
  lastReportAt = now;

  const mean = frames > 0 ? frameTimeTotal / frames : 0;
  const lines: string[] = [];
  if (frames > 0) {
    lines.push(`frame: ${mean.toFixed(1)}ms mean (${(1000 / mean).toFixed(0)}fps), worst ${worstFrame.toFixed(0)}ms over ${frames} frames`);
  }
  for (const [label, { fires, last }] of counts) {
    // fires-per-second exposes per-frame rebuilds; `last` is the size of the work.
    lines.push(`${label}: ${last} (rebuilt ${fires}× in the last ${(REPORT_MS / 1000).toFixed(0)}s)`);
  }
  for (const [label, text] of notes) lines.push(`${label}: ${text}`);

  if (lines.length > 0) console.info(`[nmpPerf]\n  ${lines.join('\n  ')}`);

  // Ship the window's frame cost to the diagnostics pipeline BEFORE the counters reset. No-ops
  // unless the reporter was initialised, so this is free in an ordinary dev session.
  if (frames > 0) reportFrameStats(SURFACE, mean, worstFrame, frames, loadLabel);

  frames = 0;
  frameTimeTotal = 0;
  worstFrame = 0;
  counts.clear();
}

export const nmpPerf = { count, note, frame, load };
export default nmpPerf;

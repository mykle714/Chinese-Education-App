/**
 * Aggregate client interaction-latency telemetry into a readable report.
 *
 * LAYER: observability utility (read-only analysis over the diagnostics sink).
 *
 * Reads server/logs/client-perf.jsonl — the JSONL written by the
 * `POST /api/diagnostics/perf` endpoint in server.ts, which receives batches
 * emitted by src/utils/perfDiagnostics.ts — and prints per-route percentile
 * breakdowns so we can diagnose the prod-only "buttons take 1–2s before
 * working" lag on the mobile-demo footer/decks.
 *
 * The key question this answers: of the total tap→paint lag, how much is
 *   inputDelay   (main thread busy BEFORE the handler — click delay / stall)
 *   processing   (our click handler)
 *   presentation (render/paint after the handler — post-navigation burst)
 * Comparing the p50/p95 of those three columns per route tells us which one
 * dominates, and therefore what to actually fix.
 *
 * Usage (from server/):
 *   npx tsx scripts/analyze-client-perf.ts                 # all data
 *   npx tsx scripts/analyze-client-perf.ts --path /flashcards/decks
 *   npx tsx scripts/analyze-client-perf.ts --since 2026-06-13
 *   npx tsx scripts/analyze-client-perf.ts --min 500       # only taps ≥500ms
 *
 * Read-only: it never writes, mutates, or touches the database.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// scripts/ sits directly under server/, so logs/ is one level up.
const LOG_PATH = path.join(__dirname, '..', 'logs', 'client-perf.jsonl');

// ---- CLI args -------------------------------------------------------------
function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const filterPath = argVal('--path');
const sinceStr = argVal('--since');
const sinceTs = sinceStr ? new Date(sinceStr).getTime() : undefined;
const minDuration = argVal('--min') ? parseInt(argVal('--min')!, 10) : 0;

// ---- Flattened record shape ----------------------------------------------
interface FlatRecord {
  kind: string;
  path: string;
  target?: string;
  name?: string;
  duration: number;
  inputDelay?: number;
  processing?: number;
  presentation?: number;
}

// Accumulate per (kind + path) so footer taps, decks taps, longtasks etc. are
// each summarised separately.
interface Bucket {
  durations: number[];
  inputDelays: number[];
  processings: number[];
  presentations: number[];
  // Count of each tapped target, to surface the worst offenders.
  targets: Map<string, number>;
}
const buckets = new Map<string, Bucket>();

function bucketFor(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { durations: [], inputDelays: [], processings: [], presentations: [], targets: new Map() };
    buckets.set(key, b);
  }
  return b;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

async function main() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error(`No telemetry log found at ${LOG_PATH}`);
    console.error('It is created once a client beacons data to POST /api/diagnostics/perf.');
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(LOG_PATH),
    crlfDelay: Infinity,
  });

  let batches = 0;
  let kept = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let batch: any;
    try {
      batch = JSON.parse(line);
    } catch {
      continue; // tolerate a truncated final line / partial write
    }
    if (sinceTs && batch.receivedAt && new Date(batch.receivedAt).getTime() < sinceTs) {
      continue;
    }
    batches++;
    const records: FlatRecord[] = Array.isArray(batch.records) ? batch.records : [];
    for (const r of records) {
      if (!r || typeof r.duration !== 'number') continue;
      if (filterPath && r.path !== filterPath) continue;
      if (r.duration < minDuration) continue;
      kept++;
      const b = bucketFor(`${r.kind}  ${r.path}`);
      b.durations.push(r.duration);
      if (typeof r.inputDelay === 'number') b.inputDelays.push(r.inputDelay);
      if (typeof r.processing === 'number') b.processings.push(r.processing);
      if (typeof r.presentation === 'number') b.presentations.push(r.presentation);
      if (r.target) b.targets.set(r.target, (b.targets.get(r.target) || 0) + 1);
    }
  }

  console.log(`\nParsed ${batches} batch(es), ${kept} matching record(s) from ${LOG_PATH}`);
  if (filterPath) console.log(`Filter: path = ${filterPath}`);
  if (sinceStr) console.log(`Filter: since = ${sinceStr}`);
  if (minDuration) console.log(`Filter: duration ≥ ${minDuration}ms`);
  if (kept === 0) {
    console.log('\nNo records matched.');
    return;
  }

  // Sort buckets by p95 duration desc so the worst surfaces first.
  const rows = [...buckets.entries()]
    .map(([key, b]) => {
      const dur = [...b.durations].sort((a, c) => a - c);
      const inp = [...b.inputDelays].sort((a, c) => a - c);
      const proc = [...b.processings].sort((a, c) => a - c);
      const pres = [...b.presentations].sort((a, c) => a - c);
      return { key, n: b.durations.length, dur, inp, proc, pres, targets: b.targets };
    })
    .sort((a, b) => pct(b.dur, 95) - pct(a.dur, 95));

  console.log('\nLatency by (kind, route) — all values are milliseconds.');
  console.log('duration = whole tap→paint; inputDelay = pre-handler stall; processing = handler; presentation = paint.\n');
  console.log(
    pad('kind / route', 40) + pad('n', 6) +
    pad('dur p50', 9) + pad('dur p95', 9) +
    pad('inDly p95', 11) + pad('proc p95', 10) + pad('pres p95', 10)
  );
  console.log('-'.repeat(95));
  for (const r of rows) {
    console.log(
      pad(r.key, 40) + pad(r.n, 6) +
      pad(pct(r.dur, 50), 9) + pad(pct(r.dur, 95), 9) +
      pad(pct(r.inp, 95), 11) + pad(pct(r.proc, 95), 10) + pad(pct(r.pres, 95), 10)
    );
  }

  // Where the time goes, in aggregate, for interaction buckets — the headline.
  console.log('\nDominant cost (p95) per interaction route:');
  for (const r of rows) {
    if (!r.key.startsWith('interaction')) continue;
    const parts: Array<[string, number]> = [
      ['inputDelay', pct(r.inp, 95)],
      ['processing', pct(r.proc, 95)],
      ['presentation', pct(r.pres, 95)],
    ];
    parts.sort((a, b) => b[1] - a[1]);
    const route = r.key.replace(/^interaction\s+/, '');
    console.log(`  ${pad(route, 32)} → ${parts[0][0]} dominates (${parts[0][1]}ms of ${pct(r.dur, 95)}ms p95)`);
  }

  // Top tapped targets across everything, so we can see if a specific button is hot.
  const allTargets = new Map<string, number>();
  for (const b of buckets.values()) {
    for (const [t, c] of b.targets) allTargets.set(t, (allTargets.get(t) || 0) + c);
  }
  const topTargets = [...allTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topTargets.length) {
    console.log('\nMost-reported tap targets:');
    for (const [t, c] of topTargets) console.log(`  ${pad(c, 6)} ${t}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('analyze-client-perf failed:', err);
  process.exit(1);
});

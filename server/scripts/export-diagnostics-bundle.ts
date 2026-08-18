/**
 * export-diagnostics-bundle.ts — package prod's client-diagnostics JSONL for
 * transport to a dev box, with client IPs stripped.
 *
 * LAYER: script (read-only against the log directory; writes only to --out).
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 * The diagnostics sinks write to the prod HOST FILESYSTEM, not to Postgres, so
 * `/data-prod-to-dev`'s pg_dump machinery does not reach them. And there is no
 * cross-machine SSH on this project, so the only transport is a commit — which
 * makes scrubbing mandatory rather than advisory: every perf batch carries the
 * reporting client's `ip` (stamped from `x-forwarded-for` in
 * server/routes/diagnosticsRoutes.ts), and committing those would publish user IP
 * addresses into git history, where deleting them later does not un-publish them.
 *
 * A `cp` + `gzip` one-liner in the skill would have been shorter and would have
 * shipped the IPs. Hence a script.
 *
 * Usage (on prod, from the repo root):
 *   npx tsx server/scripts/export-diagnostics-bundle.ts --days 30 --out database/diagnostics
 *
 * Flags:
 *   --days N    only include files whose date stamp is within the last N days (default 30)
 *   --out DIR   destination directory (default database/diagnostics)
 *   --logs DIR  source directory (default $DIAGNOSTICS_LOG_DIR, else server/logs)
 *   --dry-run   report what would be written; write nothing
 *
 * Consumed by: .claude/commands/diagnostics-pull.md.
 * Record shapes: docs/CLIENT_PERF_DIAGNOSTICS.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/** Top-level keys removed from every record before it leaves the machine. */
const SCRUBBED_KEYS = ['ip'] as const;

interface Args {
  days: number;
  out: string;
  logs: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const days = Number(get('--days') ?? 30);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`--days must be a positive number, got ${get('--days')}`);
  }
  return {
    days,
    out: get('--out') ?? 'database/diagnostics',
    // Mirrors the writer's own resolution order (server/utils/diagnosticsLog.ts).
    logs: get('--logs') ?? process.env.DIAGNOSTICS_LOG_DIR ?? 'server/logs',
    dryRun: argv.includes('--dry-run'),
  };
}

/** `client-perf-2026-08-13.jsonl` → `2026-08-13`, or null if it is not a dated log. */
function dateStampOf(filename: string): string | null {
  const m = /^client-(?:perf|error)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(filename);
  return m ? m[1] : null;
}

/**
 * Strip the scrubbed keys from one JSONL line.
 *
 * Unparseable lines are DROPPED rather than passed through: a line we cannot
 * parse is a line we cannot prove is scrubbed, and a truncated tail is normal in
 * an append-only log that was read mid-write.
 */
function scrubLine(line: string): { out: string | null; dropped: boolean } {
  const trimmed = line.trim();
  if (!trimmed) return { out: null, dropped: false };
  try {
    const rec = JSON.parse(trimmed) as Record<string, unknown>;
    for (const k of SCRUBBED_KEYS) delete rec[k];
    return { out: JSON.stringify(rec), dropped: false };
  } catch {
    return { out: null, dropped: true };
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.logs)) {
    console.error(
      `❌ No diagnostics log directory at "${args.logs}".\n` +
      `   The perf/error pipeline is probably NOT DEPLOYED here. Do not report an\n` +
      `   empty result as "no performance problem" — they are not the same thing.\n` +
      `   See docs/CLIENT_PERF_DIAGNOSTICS.md § Persistence & rotation.`,
    );
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - args.days * 86_400_000).toISOString().slice(0, 10);
  const files = fs.readdirSync(args.logs)
    .filter((f) => {
      const stamp = dateStampOf(f);
      return stamp !== null && stamp >= cutoff;
    })
    .sort();

  if (files.length === 0) {
    console.error(
      `❌ "${args.logs}" exists but holds no client-perf/client-error files within ${args.days} days.\n` +
      `   Either no traffic has been reported, or clients are not initialising the\n` +
      `   reporter. Check that initPerfDiagnostics() runs in the prod build.`,
    );
    process.exit(1);
  }

  if (!args.dryRun) fs.mkdirSync(args.out, { recursive: true });

  let totalRecords = 0;
  let totalDropped = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(args.logs, file), 'utf8');
    const kept: string[] = [];
    let dropped = 0;
    for (const line of raw.split('\n')) {
      const { out, dropped: bad } = scrubLine(line);
      if (bad) dropped++;
      else if (out) kept.push(out);
    }
    totalRecords += kept.length;
    totalDropped += dropped;

    const dest = path.join(args.out, `${file}.gz`);
    if (!args.dryRun) {
      fs.writeFileSync(dest, zlib.gzipSync(Buffer.from(kept.join('\n') + '\n', 'utf8')));
    }
    console.log(
      `${args.dryRun ? 'would write' : 'wrote'} ${dest} — ${kept.length} records` +
      (dropped ? ` (${dropped} unparseable line(s) dropped)` : ''),
    );
  }

  console.log(
    `\n✅ ${files.length} file(s), ${totalRecords} records, ` +
    `scrubbed keys: ${SCRUBBED_KEYS.join(', ')}` +
    (totalDropped ? `, ${totalDropped} line(s) dropped as unparseable` : '') +
    `\n   Report the record count — the local half of /diagnostics-pull verifies against it.`,
  );
}

main();

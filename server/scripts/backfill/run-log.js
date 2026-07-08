/**
 * Centralized run-logging for all backfill scripts (Chinese + Spanish).
 *
 * LAYER: observability utility for the data-enrichment (backfill) layer.
 *
 * Each backfill script calls `initRunLog({ script, version, anthropic })` once,
 * right after it constructs its Anthropic client. From then on this module:
 *   1. wraps `anthropic.messages.create` to accumulate token usage per model,
 *   2. records how long the script ran and which args/words/mode it ran with,
 *   3. estimates USD cost from an (approximate) price table,
 *   4. appends a single JSON line to server/logs/backfill-runs.jsonl on exit.
 *
 * The record is written from a `process.on('exit')` hook (synchronous append),
 * so it is captured even when a script ends via `process.exit(1)` after an error.
 * (A hard SIGKILL — e.g. the OS or a `kill -9` — cannot be intercepted, so those
 * runs will not be logged.)
 *
 * VERSIONING: every script declares `const SCRIPT_VERSION = 1;` today. Bump that
 * integer by hand whenever a script's enrichment logic/prompt changes, so the log
 * can attribute results to a specific version of the script.
 *
 * The log file lives under server/logs/, which is already git-ignored.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// run-log.js is at server/scripts/backfill/ → server/ is two levels up.
const SERVER_DIR = path.resolve(__dirname, '..', '..');
const LOG_PATH = path.join(SERVER_DIR, 'logs', 'backfill-runs.jsonl');

/**
 * Approximate Anthropic list pricing in USD per 1,000,000 tokens.
 * Used only for a rough cost estimate in the run log — UPDATE when pricing or
 * model lineup changes. Cache-write is billed at 1.25x base input, cache-read at
 * 0.1x base input (standard Anthropic prompt-cache multipliers).
 */
const PRICING_PER_MTOK = {
  // Opus 4.8 list price is $5/$25 per Mtok (NOT the old $15/$75 Opus-3-era rate).
  'claude-opus-4-8':   { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  // Sonnet 5 list price ($3/$15; intro pricing through 2026-08-31 is $2/$10 —
  // we log at list so estimates don't silently drop when the intro ends).
  'claude-sonnet-5':   { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5':  { input: 1, output: 5,  cacheWrite: 1.25, cacheRead: 0.1 },
  // Dated full ID used by DictionaryService.generateLongDefinition — same model,
  // same price as the alias above.
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/**
 * Build a cache-enabled `system` parameter for anthropic.messages.create.
 *
 * Prompt caching is a PREFIX match: the cached span must lead the request and be
 * byte-identical across calls. The backfill scripts send the same large static
 * instructions/few-shots on every entry and vary only a small per-entry tail, so
 * we hoist the static text into a single `system` block with an ephemeral
 * cache_control breakpoint and keep the variable data in the user message.
 *
 * Caveat: the cached prefix must clear the model's minimum-cacheable length or it
 * silently won't cache — keep the full static instruction set in `staticText`, not
 * just a one-line persona. Observed floor is ~1024 tokens for Sonnet 4.6 (a
 * 1038-token system block caches; see the backfill-example-sentences cache
 * write/read in backfill-runs.jsonl) and ~1024 for Opus 4.8. A one-line persona
 * (~tens of tokens) will not cache.
 *
 * Returns the value for the `system` field: a one-element array of a text block
 * carrying `cache_control: { type: 'ephemeral' }` (5-minute TTL).
 */
export function cachedSystem(staticText) {
  return [{ type: 'text', text: staticText, cache_control: { type: 'ephemeral' } }];
}

function humanizeMs(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h ? `${h}h` : null, (h || m) ? `${m}m` : null, `${sec}s`].filter(Boolean).join('');
}

/**
 * Parse the raw process args into a small {words, flags} shape so the log records
 * which words and which mode (--dry-run, --prune-mode=..., --all-discoverable, …)
 * a run targeted. The full raw argv is also stored for completeness.
 */
function parseArgs(argv) {
  let words = null;
  const flags = [];
  for (const a of argv) {
    if (a.startsWith('--words=')) {
      words = a.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean);
    } else if (a.startsWith('--')) {
      flags.push(a);
    }
  }
  return { words, wordCount: words ? words.length : null, flags };
}

// Tables that carry the per-entry `enrichmentLog` provenance column (migration 68).
// Whitelisted because stampEntryRun interpolates the table name into SQL.
const STAMP_TABLES = new Set(['dictionaryentries_zh', 'dictionaryentries_es']);

/**
 * Stamp the per-entry `enrichmentLog` provenance column for the given row id(s).
 *
 * Merges `{ [scriptId]: { ranAt, version } }` into the row's existing enrichmentLog
 * (so other scripts' keys are preserved). Call this right after a backfill script's
 * successful per-row UPDATE so the DB records which script/version last touched the row.
 *
 * Prefer the bound `stampEntries` returned by initRunLog (it fills in scriptId/version
 * for you); this standalone form is exported for callers that don't hold that handle.
 *
 * @param {object} client   - a pg client (already checked out by the caller)
 * @param {string} table    - 'dictionaryentries_zh' | 'dictionaryentries_es'
 * @param {number|number[]} ids - one row id or an array of ids
 * @param {string} scriptId - the run-log script id, e.g. 'chinese/backfill-long-definitions'
 * @param {number} version  - the script's SCRIPT_VERSION
 */
export async function stampEntryRun(client, table, ids, scriptId, version) {
  if (!STAMP_TABLES.has(table)) throw new Error(`stampEntryRun: unknown table "${table}"`);
  const idArr = (Array.isArray(ids) ? ids : [ids]).filter(v => v != null);
  if (idArr.length === 0) return;
  await client.query(
    `UPDATE ${table}
        SET "enrichmentLog" = COALESCE("enrichmentLog", '{}'::jsonb)
            || jsonb_build_object($1::text, jsonb_build_object('ranAt', to_jsonb(now()), 'version', $2::int))
      WHERE id = ANY($3::int[])`,
    [scriptId, version ?? null, idArr]
  );
}

/**
 * Initialize run-logging for a backfill script.
 * @param {object}  opts
 * @param {string}  opts.script    - identifier, e.g. 'spanish/backfill-long-definitions'
 * @param {number}  opts.version   - SCRIPT_VERSION integer (start at 1)
 * @param {object} [opts.anthropic]- the Anthropic client to instrument (omit for deterministic scripts)
 * @param {string[]}[opts.argv]    - defaults to process.argv.slice(2)
 * @returns {{ finalize: (extra?: object) => void, state: object, stampEntries: (client: object, table: string, ids: number|number[]) => Promise<void>, accrueUsage: (model: string, usage: object) => void }}
 */
export function initRunLog({ script, version, anthropic, argv } = {}) {
  const rawArgs = argv ?? process.argv.slice(2);
  const state = {
    script: script ?? 'unknown',
    version: version ?? null,
    startedAt: new Date().toISOString(),
    startMs: Date.now(),
    args: rawArgs,
    parsed: parseArgs(rawArgs),
    apiCalls: 0,
    usage: {}, // model -> { input, output, cacheWrite, cacheRead }
    extra: {},
    finalized: false,
  };

  /**
   * Accrue one API response's token usage into the run record. Used by the
   * messages.create wrapper below, and exported (bound) so the Batches API
   * runner can account usage too — batch results come back through
   * messages.batches.results(), which the wrapper never sees.
   * @param {string} model - model id the request ran on
   * @param {object} u     - the response `usage` object (snake_case fields)
   */
  const accrueUsage = (model, u) => {
    state.apiCalls++;
    if (!u) return;
    const acc = (state.usage[model || 'unknown'] ||= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    acc.input += u.input_tokens || 0;
    acc.output += u.output_tokens || 0;
    acc.cacheWrite += u.cache_creation_input_tokens || 0;
    acc.cacheRead += u.cache_read_input_tokens || 0;
  };

  // Instrument the Anthropic client so every messages.create accrues token usage.
  if (anthropic?.messages?.create) {
    const orig = anthropic.messages.create.bind(anthropic.messages);
    anthropic.messages.create = async (params, ...rest) => {
      const res = await orig(params, ...rest);
      accrueUsage(params?.model, res?.usage);
      return res;
    };
  }

  const finalize = (extra = {}) => {
    Object.assign(state.extra, extra);
    if (state.finalized) return;
    state.finalized = true;

    const durationMs = Date.now() - state.startMs;
    let totalCostUsd = 0;
    const usageByModel = {};
    for (const [model, u] of Object.entries(state.usage)) {
      const p = PRICING_PER_MTOK[model];
      const costUsd = p
        ? (u.input * p.input + u.output * p.output + u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead) / 1e6
        : null;
      if (costUsd != null) totalCostUsd += costUsd;
      usageByModel[model] = { ...u, costUsd: costUsd == null ? null : Number(costUsd.toFixed(4)) };
    }

    const record = {
      script: state.script,
      version: state.version,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      durationMs,
      durationHuman: humanizeMs(durationMs),
      words: state.parsed.words,
      wordCount: state.parsed.wordCount,
      mode: state.parsed.flags,
      args: state.args,
      apiCalls: state.apiCalls,
      usageByModel,
      estimatedCostUsd: Number(totalCostUsd.toFixed(4)),
      ...state.extra,
    };

    try {
      fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
    } catch (e) {
      console.error('run-log: failed to write log line:', e.message);
    }
  };

  // Fallback: guarantee a line is written on normal exit / process.exit().
  process.on('exit', () => finalize({ via: state.extra.via ?? 'exit-hook' }));

  // Bound stamper: fills in this script's id + version so callers only pass the
  // client, table, and row id(s). See stampEntryRun.
  const stampEntries = (client, table, ids) =>
    stampEntryRun(client, table, ids, state.script, state.version);

  // SQL predicate selecting rows this script has NOT yet processed at its CURRENT
  // version — i.e. rows whose `enrichmentLog` stamp for this script is below
  // `SCRIPT_VERSION`, OR that carry no stamp for this script at all (never run, or
  // ran before stamping existed). Drop it into a backfill's WHERE (usually OR'd with
  // the script's own `<col> IS NULL` gate) to power a shared `--stale`/re-enrich
  // mode that revisits out-of-date rows a plain `col IS NULL` run would skip. See
  // docs backfill-staleness. `logCol` is the jsonb column holding the log (default
  // the det column "enrichmentLog"); COALESCE guards a wholly-NULL log so a row with
  // no log at all still qualifies (it has no stamp for this script).
  const staleClause = (logCol = '"enrichmentLog"') => {
    const safeCol = `COALESCE(${logCol}, '{}'::jsonb)`;
    const key = state.script.replace(/'/g, "''");
    return `((${safeCol} #>> ARRAY['${key}','version'])::int < ${Number(state.version) || 0}`
      + ` OR NOT (${safeCol} ? '${key}'))`;
  };

  // SQL predicate selecting det rows whose given validation field(s) have NOT been
  // human-approved/flagged — i.e. rows a backfill is still allowed to overwrite.
  // AND this into a script's WHERE (its `doneGate`) so the data-validation system
  // (migration 104, docs/DATA_VALIDATION_SYSTEM.md) protects reviewed fields from
  // being clobbered by regeneration.
  //
  // Review records live in the dedicated `validations` table (NOT a det column —
  // det is TRUNCATE+restored on every data deploy), keyed by the det row id +
  // language. This clause correlates that table against the det row via the
  // (unaliased) table name, so pass the exact table the backfill selects from:
  //   - definitions-bundle writers (partsOfSpeech / definitions / longDefinition):
  //       validatedClause(['definitions'], 'dictionaryentries_zh')
  //   - the whole-array example-sentence writer:
  //       validatedClause(['exampleSentence0','exampleSentence1','exampleSentence2'], 'dictionaryentries_es')
  // `fields` are code constants (the script→field mapping), safe to inline.
  const validatedClause = (fields, table = 'dictionaryentries_zh') => {
    const list = (Array.isArray(fields) ? fields : [fields])
      .map((f) => `'${String(f).replace(/'/g, "''")}'`)
      .join(', ');
    return `NOT EXISTS (SELECT 1 FROM validations val`
      + ` WHERE val."entryId" = ${table}.id AND val.language = ${table}.language`
      + ` AND val.field IN (${list}) AND val.action IN ('approve','flag'))`;
  };

  return { finalize, state, stampEntries, accrueUsage, staleClause, validatedClause };
}

export default initRunLog;

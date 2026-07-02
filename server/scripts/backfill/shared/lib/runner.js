/**
 * Shared per-entry execution engine for AI backfill scripts — serial and batch.
 *
 * LAYER: data-enrichment (backfill) utility layer.
 *
 * A script describes its work as two functions and picks a mode:
 *
 *   buildRequest(row)  → the anthropic.messages.create params for one entry
 *                        (model, max_tokens, system, messages, ...)
 *   handleResponse(row, message) → parse the model message and apply the DB
 *                        update; return true if the row was updated, false to
 *                        count it as failed. Throw for hard errors.
 *
 * Modes:
 *   - serial (default): one messages.create per entry with a throttle delay.
 *     Same behavior as the old hand-rolled loops.
 *   - batch (--batch):  submit ALL entries as one Message Batches API batch
 *     (50% of standard token price), poll until it ends, then apply results.
 *     Use for full-table runs where wall-clock latency doesn't matter.
 *     Prompt caching still applies within a batch (best-effort).
 *
 * Referenced by: scripts under scripts/backfill/{chinese,spanish}/,
 * README_BACKFILL_SCRIPT.md, docs (backfill sections).
 */

const BATCH_POLL_MS = 60_000; // batches typically finish within an hour; poll each minute

function labelFor(row) {
  // Best-effort per-row label for progress lines (zh uses word1, es rows too).
  return row.word1 ?? row.word ?? row.id;
}

/**
 * Serial mode: one request per entry, in order, with a throttle.
 * @returns {{updated: number, failed: number}}
 */
async function runSerial({ anthropic, entries, buildRequest, handleResponse, throttleMs = 200 }) {
  let updated = 0;
  let failed = 0;
  for (const row of entries) {
    try {
      process.stdout.write(`  ${labelFor(row)} ... `);
      const message = await anthropic.messages.create(buildRequest(row));
      const ok = await handleResponse(row, message);
      if (ok) { updated++; } else { console.log('FAILED: unusable model output'); failed++; continue; }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
    if (throttleMs > 0) await new Promise(r => setTimeout(r, throttleMs));
  }
  return { updated, failed };
}

/**
 * Batch mode: submit every entry as one Batches API request, poll to completion,
 * then hand each succeeded result to handleResponse. Results arrive in ARBITRARY
 * order, so rows are matched by custom_id (`row-<id>`), never by position.
 *
 * @param {function} [accrueUsage] - optional run-log hook (model, usage) so batch
 *   token usage lands in backfill-runs.jsonl (batch results bypass the
 *   instrumented messages.create wrapper).
 * @returns {{updated: number, failed: number}}
 */
async function runBatched({ anthropic, entries, buildRequest, handleResponse, accrueUsage }) {
  const byCustomId = new Map();
  const requests = entries.map((row) => {
    const customId = `row-${row.id}`;
    byCustomId.set(customId, row);
    return { custom_id: customId, params: buildRequest(row) };
  });

  console.log(`📦 Submitting batch of ${requests.length} requests (50% batch pricing)...`);
  const batch = await anthropic.messages.batches.create({ requests });
  console.log(`   batch id: ${batch.id}`);

  let status = batch;
  while (status.processing_status !== 'ended') {
    const c = status.request_counts;
    console.log(`   ⏳ ${status.processing_status} — processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`);
    await new Promise(r => setTimeout(r, BATCH_POLL_MS));
    status = await anthropic.messages.batches.retrieve(batch.id);
  }
  console.log(`   ✅ batch ended: succeeded=${status.request_counts.succeeded} errored=${status.request_counts.errored} expired=${status.request_counts.expired}`);

  let updated = 0;
  let failed = 0;
  for await (const result of await anthropic.messages.batches.results(batch.id)) {
    const row = byCustomId.get(result.custom_id);
    if (!row) { console.warn(`   ⚠️ unknown custom_id ${result.custom_id}`); continue; }
    if (result.result.type !== 'succeeded') {
      console.log(`  ${labelFor(row)} FAILED: batch result ${result.result.type}`);
      failed++;
      continue;
    }
    const message = result.result.message;
    accrueUsage?.(message.model, message.usage);
    try {
      const ok = await handleResponse(row, message);
      if (ok) { updated++; } else { console.log(`  ${labelFor(row)} FAILED: unusable model output`); failed++; }
    } catch (err) {
      console.log(`  ${labelFor(row)} FAILED: ${err.message}`);
      failed++;
    }
  }
  return { updated, failed };
}

/**
 * Run a backfill over `entries` in the requested mode and print the standard
 * completion summary.
 *
 * @param {object}   opts
 * @param {object}   opts.anthropic      - Anthropic client (run-log instrumented)
 * @param {object[]} opts.entries        - rows to process (each must have .id)
 * @param {boolean}  [opts.batch]        - true → Batches API mode
 * @param {function} opts.buildRequest   - (row) => messages.create params
 * @param {function} opts.handleResponse - async (row, message) => boolean (updated?)
 * @param {number}   [opts.throttleMs]   - serial-mode delay between calls (default 200)
 * @param {function} [opts.accrueUsage]  - run-log usage hook for batch mode
 * @returns {{updated: number, failed: number}}
 */
export async function runBackfill(opts) {
  const { entries, batch = false } = opts;
  const result = batch ? await runBatched(opts) : await runSerial(opts);

  console.log('\n' + '='.repeat(60));
  console.log('📊 Backfill Complete!');
  console.log('='.repeat(60));
  console.log(`Total processed : ${entries.length}`);
  console.log(`Updated         : ${result.updated}`);
  console.log(`Errors          : ${result.failed}`);
  console.log('='.repeat(60) + '\n');

  return result;
}

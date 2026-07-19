import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { dbManager } from '../dal/base/DatabaseManager.js';
// The required-scripts manifest is the ONE source of truth for "fully enriched"
// (docs/DISCOVER_LAZY_ENRICHMENT.md §5). It lives in the backfill utility layer;
// importing it here keeps the request-time candidacy check byte-for-byte identical
// to the worker's. It is plain ESM JS with no types, hence the ts-ignore.
// @ts-ignore — untyped JS module (scripts/backfill utility layer)
import { buildIncompletePredicate } from '../scripts/backfill/shared/lib/requiredScripts.js';

/**
 * Lazy-enrichment trigger — the RUNTIME (request-time) entry point for the Chinese
 * discover lazy-enrichment pipeline (docs/DISCOVER_LAZY_ENRICHMENT.md §5).
 *
 * LAYER: service layer (orchestration). This is what makes "enrich on first touch"
 * actually fire live — the standing cron was retired in favour of two request-time
 * triggers, both routed through `triggerForWord`:
 *   - on-open : a validator opens a word's card-detail page (the eip drill-in link) →
 *               DictionaryController.lookupTerm.
 *   - on-sort : a validator sorts a word into Learn Now / Already-Learned →
 *               StarterPacksService.sortCard.
 * `run-lazy-enrichment.js` remains only as a MANUAL/bulk backfill CLI, not a scheduler.
 *
 * GATING (all three conditions, else no-op):
 *   1. language === 'zh'      — Spanish is out of scope for lazy enrichment.
 *   2. requester isValidator  — AI spend is bounded to trusted curators.
 *   3. the row is sortable AND incomplete per the manifest (buildIncompletePredicate).
 *
 * MECHANISM: fire-and-forget. `triggerForWord` is `void` and NEVER throws — a caller
 * fires it without awaiting so the AI spend never sits on the request. It de-dupes
 * concurrent triggers for the same word (in-process `inFlight` set) and spawns the
 * worker for that ONE word: `run-lazy-enrichment.js --words=<word> --apply --stale`
 * (which runs only the pending steps, honours validator-approved fields, and promotes
 * to discoverable on completion). The spawn is best-effort: if it can't start (e.g.
 * prod, which runs compiled `node` with no `tsx`), it logs and no-ops — enrichment
 * stays a dev/curation activity feeding the normal data-deploy, never mutating prod
 * det rows out-of-band.
 *
 * Referenced by: server/controllers/DictionaryController.ts (lookupTerm),
 * server/services/StarterPacksService.ts (sortCard), docs/DISCOVER_LAZY_ENRICHMENT.md §5.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/ root — cwd for the spawned worker so its relative script/.env/db paths resolve.
const SERVER_DIR = path.join(__dirname, '..');
const WORKER_SCRIPT = 'scripts/backfill/run-lazy-enrichment.js';
// Per-host child command. Dev runs `tsx server.ts`, so `npx tsx` is available.
// Override via ENRICH_STEP_CMD for other hosts. (Same knob the worker uses.)
const WORKER_CMD = (process.env.ENRICH_STEP_CMD || 'npx tsx').split(' ');

export class LazyEnrichmentService {
  // Words with a worker currently spawned, keyed `${language}:${word}`. Prevents a
  // burst of opens/sorts of the same card from launching duplicate workers. Purely
  // in-process (best-effort): a second server instance would not see it, but the
  // worker's own per-step doneGates make a duplicate run idempotent anyway.
  private readonly inFlight = new Set<string>();

  constructor(private userDAL: IUserDAL) {}

  /**
   * Fire-and-forget: enrich `word` iff the requester is a validator and the row is an
   * incomplete zh candidate. Safe to call unconditionally on any lookup/sort — it
   * self-gates and never throws. `isValidator` may be passed when the caller already
   * loaded the user (avoids a redundant lookup); otherwise it is resolved from `userId`.
   */
  triggerForWord(params: {
    word: string;
    language: string;
    userId?: string;
    isValidator?: boolean;
  }): void {
    // Detach from the request: resolve gates and spawn on a microtask, swallowing all
    // errors so a trigger failure can never surface on the caller's response path.
    void this.run(params).catch((err) => {
      console.error('[LazyEnrich] trigger failed:', err);
    });
  }

  private async run({
    word,
    language,
    userId,
    isValidator,
  }: {
    word: string;
    language: string;
    userId?: string;
    isValidator?: boolean;
  }): Promise<void> {
    if (language !== 'zh') return;
    if (!word || !word.trim()) return;
    const w = word.trim();

    // Gate 2: validator only. Prefer the caller-supplied flag; fall back to a lookup.
    let validator = isValidator;
    if (validator === undefined) {
      if (!userId) return;
      const user = await this.userDAL.findById(userId);
      validator = !!user?.isValidator;
    }
    if (!validator) return;

    // Gate 3: the row must be sortable AND not yet fully enriched per the manifest.
    // Reuses the worker's exact predicate so runtime candidacy == worker candidacy.
    const predicate = buildIncompletePredicate('de');
    // executeQuery returns { recordset, rowsAffected } (see DatabaseManager).
    const candidate = await dbManager.executeQuery<{ one: number }>(async (client) =>
      client.query(
        `SELECT 1 AS one
           FROM dictionaryentries_zh de
          WHERE de.word1 = $1 AND de.language = 'zh'
            AND de.sortable = TRUE
            AND ${predicate}
          LIMIT 1`,
        [w]
      )
    );
    if (candidate.recordset.length === 0) return; // complete, not sortable, or unknown word

    // De-dupe concurrent triggers for the same word.
    const key = `${language}:${w}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);

    try {
      const child = spawn(
        WORKER_CMD[0],
        [...WORKER_CMD.slice(1), WORKER_SCRIPT, `--words=${w}`, '--apply', '--stale'],
        { cwd: SERVER_DIR, detached: true, stdio: 'ignore', env: process.env }
      );
      // Free the parent from the child's lifetime (fire-and-forget).
      child.unref();
      const clear = () => this.inFlight.delete(key);
      child.on('exit', clear);
      child.on('error', (err) => {
        // Most likely cause: the child command is unavailable (e.g. prod without tsx).
        console.error(`[LazyEnrich] worker spawn failed for "${w}" (no-op):`, err.message);
        clear();
      });
      console.log(`[LazyEnrich] enriching "${w}" (validator-triggered)`);
    } catch (err) {
      // spawn() can throw synchronously on some errors — keep the trigger non-fatal.
      this.inFlight.delete(key);
      console.error(`[LazyEnrich] could not spawn worker for "${w}" (no-op):`, err);
    }
  }
}

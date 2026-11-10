import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import type { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';

/**
 * Lazy-enrichment trigger — the RUNTIME (request-time) entry point for the Chinese
 * discover lazy-enrichment pipeline (docs/DISCOVER_LAZY_ENRICHMENT.md §5).
 *
 * LAYER: service layer (orchestration). This is what makes "enrich on first touch"
 * actually fire live — the standing cron was retired in favour of two request-time
 * triggers, both routed through `triggerForWord`:
 *   - on-open : a validator opens a word's card-detail page (the eip drill-in link) →
 *               DictionaryController.lookupTerm.
 *   - on-sort : a validator sorts a word into Learning / Already-Learned →
 *               StarterPacksService.sortCard.
 * `run-lazy-enrichment.js` remains only as a MANUAL/bulk backfill CLI, not a scheduler.
 *
 * GATING (all three conditions, else no-op):
 *   1. language === 'zh'      — Spanish is out of scope for lazy enrichment.
 *   2. requester isValidator  — AI spend is bounded to trusted curators.
 *   3. the row is discoverable AND incomplete per the manifest
 *      (`IDictionaryDAL.isLazyEnrichmentCandidate`, which compiles buildIncompletePredicate).
 *      Since the `sortable` bar was retired (migration 144) every row a learner can
 *      reach is already discoverable, so this trigger is now purely a HEAL path: it
 *      re-runs steps that went version-stale under a shipped row, rather than carrying
 *      a half-enriched row up to discoverable.
 *
 * MECHANISM: fire-and-forget. `triggerForWord` is `void` and NEVER throws — a caller
 * fires it without awaiting so the AI spend never sits on the request. It de-dupes
 * concurrent triggers for the same word (in-process `inFlight` set) and spawns the
 * worker for that ONE word: `run-lazy-enrichment.js --words=<word> --apply --stale`
 * (which runs only the pending steps, honours validator-approved fields, and promotes
 * to discoverable on completion).
 *
 * FAILURE VISIBILITY + BACK-OFF: the worker's stdout/stderr are appended to
 * `logs/lazy-enrichment.log` (one header line per spawn), and a nonzero exit (the
 * worker exits 2 when a step failed) is logged with the word and the code. A failed
 * word is then held off for `FAILURE_BACKOFF_MS` (in-process, like `inFlight`), so a
 * step that crashes deterministically is retried hourly rather than on every lookup —
 * a crashing step never stamps, so the word would otherwise stay a candidate forever.
 * The spawn is best-effort: if it can't start (e.g.
 * PPE, which runs compiled `node` with no `tsx`), it logs and no-ops — enrichment
 * stays a dev/curation activity, never mutating PPE det rows out-of-band. (Its
 * output no longer feeds a dev → PPE data push — that flow is retired and PPE is
 * the source of truth; PPE-side enrichment goes through the backfill scripts.)
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
// Where each worker's output is appended (gitignored `server/logs/`, bind-mounted on PPE).
const WORKER_LOG = path.join(SERVER_DIR, 'logs', 'lazy-enrichment.log');
/** How long a word whose worker exited nonzero is skipped before the next retry. */
const FAILURE_BACKOFF_MS = 60 * 60 * 1000;

export class LazyEnrichmentService {
  // Words with a worker currently spawned, keyed `${language}:${word}`. Prevents a
  // burst of opens/sorts of the same card from launching duplicate workers. Purely
  // in-process (best-effort): a second server instance would not see it, but the
  // worker's own per-step doneGates make a duplicate run idempotent anyway.
  private readonly inFlight = new Set<string>();
  // Words whose last worker exited nonzero → epoch ms before which they are not retried.
  // In-process like `inFlight`; a restart clears it, which just means one early retry.
  private readonly failedUntil = new Map<string, number>();

  constructor(
    private userDAL: IUserDAL,
    private dictionaryDAL: IDictionaryDAL
  ) {}

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

    // Gate 3: the row must be discoverable AND not yet fully enriched per the manifest.
    // The DAL reuses the worker's exact predicate so runtime candidacy == worker candidacy.
    if (!(await this.dictionaryDAL.isLazyEnrichmentCandidate(w))) return; // complete, not discoverable, or unknown word

    // De-dupe concurrent triggers for the same word, and hold off a recently failed one.
    const key = `${language}:${w}`;
    if (this.inFlight.has(key)) return;
    const retryAt = this.failedUntil.get(key);
    if (retryAt !== undefined && Date.now() < retryAt) return;
    this.failedUntil.delete(key);
    this.inFlight.add(key);

    // The worker's output goes to WORKER_LOG; the fd is the child's to keep, so the
    // parent closes its copy right after spawn. Falls back to discarding output if the
    // log can't be opened (e.g. a read-only logs dir) — logging must not block the run.
    const logFd = openWorkerLog(w);
    try {
      const child = spawn(
        WORKER_CMD[0],
        [...WORKER_CMD.slice(1), WORKER_SCRIPT, `--words=${w}`, '--apply', '--stale'],
        {
          cwd: SERVER_DIR,
          detached: true,
          stdio: logFd === null ? 'ignore' : ['ignore', logFd, logFd],
          env: process.env,
        }
      );
      // Free the parent from the child's lifetime (fire-and-forget).
      child.unref();
      const clear = () => this.inFlight.delete(key);
      child.on('exit', (code, signal) => {
        clear();
        if (code === 0) return;
        // 2 = a step failed (run-lazy-enrichment.js exit codes); 1 = the runner crashed;
        // null + signal = killed (e.g. a container restart). All back off the same way.
        this.failedUntil.set(key, Date.now() + FAILURE_BACKOFF_MS);
        console.error(
          `[LazyEnrich] worker for "${w}" exited ${code ?? signal} — retry in ` +
            `${FAILURE_BACKOFF_MS / 60000} min; output in logs/lazy-enrichment.log`
        );
      });
      child.on('error', (err) => {
        // Most likely cause: the child command is unavailable (e.g. PPE without tsx).
        console.error(`[LazyEnrich] worker spawn failed for "${w}" (no-op):`, err.message);
        clear();
      });
      console.log(`[LazyEnrich] enriching "${w}" (validator-triggered)`);
    } catch (err) {
      // spawn() can throw synchronously on some errors — keep the trigger non-fatal.
      this.inFlight.delete(key);
      console.error(`[LazyEnrich] could not spawn worker for "${w}" (no-op):`, err);
    } finally {
      if (logFd !== null) fs.closeSync(logFd);
    }
  }
}

/**
 * Open WORKER_LOG for appending and write a header line for this spawn. Returns the fd,
 * or null when the log is unavailable (the spawn then discards output, as it used to).
 */
function openWorkerLog(word: string): number | null {
  try {
    fs.mkdirSync(path.dirname(WORKER_LOG), { recursive: true });
    const fd = fs.openSync(WORKER_LOG, 'a');
    fs.writeSync(fd, `\n=== ${new Date().toISOString()} lazy-enrich "${word}" ===\n`);
    return fd;
  } catch (err) {
    console.error('[LazyEnrich] could not open worker log (output discarded):', (err as Error).message);
    return null;
  }
}

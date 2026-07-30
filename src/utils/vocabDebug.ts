/**
 * Vocabulary-pipeline tracing.
 *
 * LAYER: client utility (no React, no network) — importable from the processing
 * hook, the API module, and the cache alike.
 *
 * Why this exists: the vocab path (extract tokens → dedupe against the cache →
 * batch the misses → merge personal + dictionary hits) had ~35 bare `console.log`
 * calls spread across four modules, several of which printed whole token arrays.
 * They ran on EVERY Reader document open, in production, for every user — the
 * diagnostics are genuinely useful when the batching misbehaves, but they should
 * not be on by default. This is the same shape as authDebug.ts, which the auth
 * path already uses for exactly this reason.
 *
 * OFF by default (the inverse of authDebug, which defaults on because a failed
 * login is user-reported and rare — a document open is neither). Turn it on with
 * `localStorage.vocabDebug = 'on'` and reload.
 *
 * Filter the console with `[vocab]` to isolate it.
 *
 * Referenced by: src/hooks/useVocabularyProcessing.ts, src/utils/vocabApi.ts,
 * src/utils/vocabCache.ts, src/contexts/VocabularyUpdateContext.tsx,
 * docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 5a.
 */

/**
 * Runtime switch. Off unless explicitly enabled, so the pipeline is silent in
 * production. Read per-call rather than cached so it can be flipped from the
 * console without a reload for any log emitted afterwards.
 */
const enabled = (): boolean => {
  try {
    return localStorage.getItem('vocabDebug') === 'on';
  } catch {
    // localStorage can throw in a sandboxed/private context — never let a debug
    // helper break the pipeline it is tracing.
    return false;
  }
};

/** One traced vocab event. `detail` is any serializable context object. */
export function vocabLog(event: string, detail?: unknown): void {
  if (!enabled()) return;
  if (detail === undefined) {
    console.log(`[vocab] ${event}`);
  } else {
    console.log(`[vocab] ${event}`, detail);
  }
}

/**
 * A genuine failure in the vocab path. Unlike vocabLog this is NOT gated — a
 * swallowed lookup failure shows up as silently missing highlights, which is very
 * hard to diagnose after the fact.
 */
export function vocabError(event: string, detail?: unknown): void {
  console.error(`[vocab] ${event}`, detail);
}

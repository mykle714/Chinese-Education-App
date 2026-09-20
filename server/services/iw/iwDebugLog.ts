/**
 * iwDebugLog — opt-in verbose tracing for the turn endpoint.
 *
 * LAYER: service utility. The client half is `src/features/immersiveworld/iwDebugLog.ts`;
 * they are deliberately separate files rather than a shared one, because the switches differ
 * (an env var here, `localStorage` there) and neither side should import the other's.
 *
 * ⚠️ **OFF BY DEFAULT: set `IW_DEBUG=1`.** The turn path runs a model call per utterance, so
 * a permanently verbose log would bury the one line that matters. `iwFault` is the exception
 * — it prints unconditionally, because the things it reports (a codeless refusal reaching the
 * learner as a polite decline) are precisely what has been going unnoticed.
 *
 * Referenced by: server/controllers/ImmersiveWorldRuntimeController.ts,
 * server/services/ImmersiveWorldService.ts; docs/IMMERSIVE_WORLD.md § 5.2.
 */

export function iwDebugEnabled(): boolean {
  return process.env.IW_DEBUG === '1';
}

export function iwLog(topic: string, event: string, detail?: unknown): void {
  if (!iwDebugEnabled()) return;
  if (detail === undefined) console.log(`[iw:${topic}] ${event}`);
  else console.log(`[iw:${topic}] ${event}`, JSON.stringify(detail));
}

/**
 * Something is wrong and the learner is about to be told something bland about it. Always
 * printed — see the header.
 */
export function iwFault(topic: string, event: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[iw:${topic}] FAULT ${event}`);
  else console.warn(`[iw:${topic}] FAULT ${event}`, JSON.stringify(detail));
}

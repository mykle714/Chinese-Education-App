/**
 * iwDebugLog — opt-in verbose tracing for one scene run.
 *
 * LAYER: feature utility, client only. Deliberately NOT the § 4 debug overlay's `note()`:
 * that is a short, learner-legible answer to "why didn't he answer me" and is rendered on a
 * phone, so it must stay a handful of sentences. This is the developer's firehose — the whole
 * turn lifecycle, every SSE frame, every branch that can end in a banner.
 *
 * ⚠️ **OFF BY DEFAULT, AND THE SWITCH IS NOT A REBUILD.** The turn path is the one place in
 * the app where a bug can only be reproduced against a live model call, so the tracing has to
 * be flippable on a device that is already mid-scene. Two ways in, both read once per call so
 * they can be toggled without a reload:
 *
 *   localStorage.setItem('iw:debug', '1')   ← persists across reloads
 *   ?iwdebug=1                              ← one session, easy to paste to someone
 *
 * ⚠️ **IT MUST NEVER THROW.** It is called from inside an SSE frame handler and from inside
 * an animation-driven code path; a logger that explodes on a circular payload would take the
 * turn down with it. Every call is wrapped, and a serialization failure degrades to a marker
 * rather than an exception.
 *
 * Referenced by: src/features/immersiveworld/immersiveWorldTurnApi.ts,
 * src/features/immersiveworld/play/useIWSceneRuntime.ts,
 * src/features/immersiveworld/play/iwSceneActors.ts; docs/IMMERSIVE_WORLD.md § 4.
 */

/** Read fresh on every call — see the header: the switch must work without a reload. */
export function iwDebugEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.localStorage?.getItem('iw:debug') === '1') return true;
    return new URLSearchParams(window.location.search).get('iwdebug') === '1';
  } catch {
    // A browser with site data blocked throws on the localStorage read. Tracing off is the
    // right answer there; it is a debug aid, not a feature.
    return false;
  }
}

/** Milliseconds since the page loaded, so a log line can be lined up against the audio clock. */
function stamp(): string {
  return `+${Math.round(performance.now())}ms`;
}

/**
 * One trace line. `topic` is a coarse area (`turn`, `sse`, `scene`, `banner`) and `event` is
 * the specific thing; both are printed so the console's own filter box is useful.
 */
export function iwLog(topic: string, event: string, detail?: unknown): void {
  if (!iwDebugEnabled()) return;
  try {
    if (detail === undefined) console.log(`%c[iw:${topic}]%c ${stamp()} ${event}`, 'color:#7c4dff;font-weight:bold', 'color:inherit');
    else console.log(`%c[iw:${topic}]%c ${stamp()} ${event}`, 'color:#7c4dff;font-weight:bold', 'color:inherit', detail);
  } catch {
    /* see the header: tracing never takes the turn down with it */
  }
}

/**
 * A trace line for something that is WRONG but not thrown — the class of bug this module was
 * written for. Printed at `warn` so it survives a console filtered to warnings, and printed
 * even when tracing is off, because a silent inconsistency is exactly what went unnoticed.
 */
export function iwWarn(topic: string, event: string, detail?: unknown): void {
  try {
    if (detail === undefined) console.warn(`[iw:${topic}] ${event}`);
    else console.warn(`[iw:${topic}] ${event}`, detail);
  } catch {
    /* never throws */
  }
}

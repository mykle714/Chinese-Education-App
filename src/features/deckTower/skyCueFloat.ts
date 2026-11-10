/**
 * skyCueFloat — the shared float clock of td's white sky cues: the two WorldIndicators
 * (drifting outward) and the CardsCue (bobbing down). One period, one page clock, so
 * every cue moves in step however far apart they mounted (the home screen's enter cue too).
 *
 * Lives in its own module so WorldIndicator.tsx and CardsCue.tsx export only components
 * (react-refresh/only-export-components).
 *
 * Depended on by: WorldIndicator.tsx, CardsCue.tsx, home/HomeButtons.tsx (the "Swipe down to
 * enter" cue). Docs: docs/DECK_TOWER.md § "Worlds", § "The cards page" → "The cards cue";
 * docs/HOME_SCREEN.md § "The buttons".
 */

/** One full drift out (or down) and back, ms. */
export const FLOAT_MS = 2800;

/**
 * A negative `animation-delay` that puts this mount's float on a shared page clock:
 * whenever a cue mounts (a world change can mount one edge's arrow apart from the
 * other's), its cycle is at the same phase as every other cue's — `performance.now()`
 * mod FLOAT_MS — so they always move together.
 */
export const floatPhaseDelay = () => `-${Math.round(performance.now() % FLOAT_MS)}ms`;

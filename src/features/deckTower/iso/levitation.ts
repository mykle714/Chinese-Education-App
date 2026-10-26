/**
 * levitation.ts — the bob of a floating object (docs/ISO_ART_FRAMEWORK.md § "Levitation").
 *
 * A floating object, and everything standing on it, rises `BOB_HEIGHT` world units and
 * sinks back once per `BOB_PERIOD_MS`; its shadow shrinks and fades in step.
 *
 * Depended on by: IsoLevitate.tsx (the keyframes), DeckTowerPage.tsx (fitting the viewBox
 * to the top of the bob), deckTower/useTowerStudy.ts (`frozenBobOffsetPx`: aiming the
 * study camera at a paused platform).
 */

/** How far a floating object rises at the top of its bob, in world units. */
export const BOB_HEIGHT = 0.35;
/** One full rise-and-fall. Slowed from 3.2 s (2026-10-17): the faster bob felt busy. */
export const BOB_PERIOD_MS = 5200;

/**
 * The screen-y offset (viewBox px, negative = up) a paused bob is frozen at, read from the
 * first `.iso-levitate__body` inside `root`; 0 when there is none or it is not moving.
 * Reading a transform the CSS animation owns is the only way to learn where it stopped.
 */
export function frozenBobOffsetPx(root: Element | null): number {
    const body = root?.querySelector(".iso-levitate__body");
    if (!body) return 0;
    const t = getComputedStyle(body).transform;
    if (!t || t === "none") return 0;
    // matrix(a, b, c, d, e, f) — f is the y translation.
    const parts = t.match(/matrix\(([^)]+)\)/)?.[1].split(",").map(Number);
    return parts && parts.length === 6 && Number.isFinite(parts[5]) ? parts[5] : 0;
}

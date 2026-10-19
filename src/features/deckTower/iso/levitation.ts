/**
 * levitation.ts — the bob of a floating object (docs/ISO_ART_FRAMEWORK.md § "Levitation").
 *
 * A floating object, and everything standing on it, rises `BOB_HEIGHT` world units and
 * sinks back once per `BOB_PERIOD_MS`; its shadow shrinks and fades in step.
 *
 * Depended on by: IsoLevitate.tsx (the keyframes), DeckTowerPage.tsx (fitting the viewBox
 * to the top of the bob).
 */

/** How far a floating object rises at the top of its bob, in world units. */
export const BOB_HEIGHT = 0.35;
/** One full rise-and-fall. Slowed from 3.2 s (2026-10-17): the faster bob felt busy. */
export const BOB_PERIOD_MS = 5200;

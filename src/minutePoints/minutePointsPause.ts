// Global pause flag for minute-points accumulation.
//
// Some focused, non-study interactions should NOT count as study time — e.g. the flp
// custom card icon-layout editor (docs/CARD_ICON_LAYOUT.md), where the user is
// decorating a card rather than reviewing. The flp page sets this while editing.
//
// Implemented as a tiny external store (not React context) because useMinutePoints is
// a leaf hook used in many places and the per-second tick reads the flag imperatively;
// a module singleton avoids threading a prop/provider through every consumer. The
// `useMinutePointsPaused` hook lets components (the fire badge) react to changes.

import { useSyncExternalStore } from 'react';

let paused = false;
const listeners = new Set<() => void>();

/** Set/clear the pause flag and notify subscribers (badge re-render). */
export function setMinutePointsPaused(value: boolean): void {
  if (paused === value) return;
  paused = value;
  listeners.forEach((l) => l());
}

/** Imperative read for the per-second tick (no React subscription). */
export function getMinutePointsPaused(): boolean {
  return paused;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive read for components that should reflect the paused state. */
export function useMinutePointsPaused(): boolean {
  return useSyncExternalStore(subscribe, getMinutePointsPaused);
}

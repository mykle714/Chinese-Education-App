/**
 * § 6z-4 hint-bubble motion timing, shared by the bubble (HintBubble.tsx — how it
 * animates) and the row (CandidateRow.tsx — when bubbles enter, stagger, pop and
 * come back after a scroll).
 *
 * LAYER: client feature constants. Its own module so HintBubble.tsx exports only
 * a component (React fast refresh requires that).
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-4 ("Motion").
 */
/**
 * The bubbles' timing, in one place so the feel can be tuned without hunting.
 * `popMs` is also how long the row keeps a popped bubble mounted, so the pop and
 * the unmount cannot drift apart.
 */
export const HINT_MOTION = {
  /**
   * Pause after the row settles (a stroke, or a scroll stopping) before the first
   * bubble. Deliberately long (raised 260 → 750 ms, 2026-09-24): mid-character,
   * every stroke re-ranks the chips and churns the hints, and bubbles flickering
   * up while the learner is still writing are chaos, not help. A bubble that is
   * replaced before its delay runs out is dropped unseen, so the wait also acts as
   * a "has the learner paused?" filter.
   */
  enterDelayMs: 750,
  /** Extra pause per bubble, left to right. */
  staggerMs: 70,
  growMs: 340,
  popMs: 240,
  /** How long the strip must be still before bubbles come back after a scroll. */
  scrollSettleMs: 180,
} as const;

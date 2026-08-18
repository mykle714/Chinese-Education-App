/**
 * cooldown.ts — the per-mark-type review cooldown, shared by server and client.
 *
 * This used to live entirely in `server/services/cardQueueRanking.ts`, which is a
 * server module the client may not import (docs/FRONTEND_LAYERING.md). The cdp now
 * DISPLAYS the remaining cooldown under each mastery bar, so the table and the
 * "is this track resting?" predicate had to become a contract — exactly the move
 * `contracts/mastery.ts` made for the pbh formula. `cardQueueRanking` re-exports
 * these, so every existing server import keeps working and there is still one
 * definition.
 *
 * Contract rules (same as wire.ts): no relative VALUE imports, no enums, no Node or
 * DOM globals; callers pass `now` rather than the module reading a clock.
 *
 * See docs/MASTERY_REWORK.md § Per-type cooldown.
 */
import type { MarkType, TypedMarkHistory } from './wire.js';

/**
 * Per-category cooldown after a correct mark: a card marked correct recently should
 * not come back until its window elapses. Shorter windows for weaker categories, so a
 * struggling card gets more repetition.
 *
 * The timer is always applied PER MARK TYPE (see `isTypeOnCooldown`) — tracks cool
 * down on independent clocks. Only the window's DURATION comes from a category, and
 * WHICH category is the caller's choice (see cardQueueRanking's module docblock).
 */
export const COOLDOWN_MS_BY_CATEGORY: Record<string, number> = {
  Unfamiliar: 5 * 60 * 1000,             // 5 minutes
  Target: 24 * 60 * 60 * 1000,           // 24 hours
  Comfortable: 14 * 24 * 60 * 60 * 1000, // 14 days
  Mastered: 180 * 24 * 60 * 60 * 1000,   // 6 months (180 days)
};

/**
 * Newest correct-mark timestamp within ONE type's track, or null when that track holds
 * no valid correct mark. Per-type so each track cools down on its own clock.
 */
export function lastCorrectMarkTimestamp(
  typedMarkHistory: TypedMarkHistory | undefined,
  type: MarkType
): number | null {
  const track = typedMarkHistory?.[type];
  if (!Array.isArray(track)) return null;

  let latest: number | null = null;
  for (const mark of track) {
    if (!mark?.isCorrect || !mark.timestamp) continue;
    const ts = new Date(mark.timestamp).getTime();
    if (Number.isNaN(ts)) continue;
    if (latest === null || ts > latest) latest = ts;
  }
  return latest;
}

/**
 * Milliseconds left on ONE mark type's cooldown; 0 when the track is ready.
 *
 * The single source of the arithmetic — `isTypeOnCooldown` is this predicate's
 * boolean face, and the cdp renders the number itself.
 *
 * An unrecognized or absent `windowCategory` means "no cooldown configured" and the
 * track is treated as ready — deliberately permissive, because the alternative (a card
 * whose category could not be computed silently disappearing from every queue) fails
 * invisibly.
 */
export function cooldownRemainingMs(
  typedMarkHistory: TypedMarkHistory | undefined,
  type: MarkType,
  now: number,
  windowCategory: string | null | undefined
): number {
  const cooldownMs = COOLDOWN_MS_BY_CATEGORY[windowCategory ?? ''];
  if (cooldownMs === undefined) return 0;

  const lastCorrect = lastCorrectMarkTimestamp(typedMarkHistory, type);
  if (lastCorrect === null) return 0;

  return Math.max(0, lastCorrect + cooldownMs - now);
}

/** Whether ONE mark type of a card is still cooling down. */
export function isTypeOnCooldown(
  typedMarkHistory: TypedMarkHistory | undefined,
  type: MarkType,
  now: number,
  windowCategory: string | null | undefined
): boolean {
  return cooldownRemainingMs(typedMarkHistory, type, now, windowCategory) > 0;
}

/** The subset of `types` whose per-type cooldown has elapsed. Empty ⇒ fully rested. */
export function readyMarkTypes(
  typedMarkHistory: TypedMarkHistory | undefined,
  now: number,
  types: readonly MarkType[],
  windowCategory: string | null | undefined
): MarkType[] {
  return types.filter((type) => !isTypeOnCooldown(typedMarkHistory, type, now, windowCategory));
}

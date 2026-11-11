import {
  MINUTE_POINTS_ELIGIBLE_PAGES,
  MINUTE_POINTS_AUTO_ACTIVE_PAGES,
} from '../constants';

/**
 * eligibility — does THIS route earn minute points, and does it start earning on entry?
 *
 * LAYER: pure helper. Extracted from `useMinutePoints` (2026-09-07) so the rule can be unit
 * tested — getting it wrong in either direction is invisible: a study page that silently
 * earns nothing, or a menu that silently farms points. (A third, EXCLUSION list existed for
 * Immersive World's parameterized play route; it went with that feature on 2026-11-09.)
 *
 * The lists themselves stay in `src/constants.ts` beside the doctrine comment that explains
 * what belongs on each.
 *
 * Referenced by: src/minutePoints/useMinutePoints.ts;
 * docs/MINUTE_POINTS_SYSTEM.md.
 */

/** A route matches a prefix when it IS that prefix, or is a path segment beneath it. */
function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/**
 * Does this route accrue minute points at all?
 */
export function isMinutePointsEligiblePath(pathname: string): boolean {
  return MINUTE_POINTS_ELIGIBLE_PAGES.some(prefix => underPrefix(pathname, prefix));
}

/**
 * Does this route start accruing on ENTRY, without waiting for a first interaction?
 *
 * Only game boards, which are read for a few seconds before the first tap. Everywhere else
 * requires an interaction, which is what stops a page from being farmed by being left open.
 */
export function isMinutePointsAutoActivePath(pathname: string): boolean {
  return MINUTE_POINTS_AUTO_ACTIVE_PAGES.some(prefix => underPrefix(pathname, prefix));
}

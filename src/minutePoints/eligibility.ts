import {
  MINUTE_POINTS_ELIGIBLE_PAGES,
  MINUTE_POINTS_ELIGIBLE_EXACT_PAGES,
  MINUTE_POINTS_EXCLUDED_EXACT_PAGES,
  MINUTE_POINTS_AUTO_ACTIVE_PAGES,
} from '../constants';

/**
 * eligibility — does THIS route earn minute points, and does it start earning on entry?
 *
 * LAYER: pure helper. Extracted from `useMinutePoints` (2026-09-07) when the lists grew a
 * third member: an EXCLUSION list, needed because the immersive-world play surface is a
 * parameterized child (`/immersive-world/:sceneId`) that can only be admitted by a prefix
 * broad enough to also admit its non-study siblings. Three interacting lists resolved inline
 * in a 450-line hook is the kind of rule that is impossible to test and easy to get subtly
 * wrong — and getting it wrong in either direction is invisible: a study page that silently
 * earns nothing, or a menu that silently farms points.
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
 *
 * Order matters: the exclusion list is applied LAST and wins, because it exists precisely to
 * carve browse screens back out of a prefix that had to be broad.
 */
export function isMinutePointsEligiblePath(pathname: string): boolean {
  if (MINUTE_POINTS_EXCLUDED_EXACT_PAGES.includes(pathname)) return false;
  return MINUTE_POINTS_ELIGIBLE_PAGES.some(prefix => underPrefix(pathname, prefix))
    || MINUTE_POINTS_ELIGIBLE_EXACT_PAGES.includes(pathname);
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

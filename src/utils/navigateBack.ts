import type { NavigateFunction } from "react-router-dom";

/**
 * Go back one history entry, or to `fallback` when there is no in-app entry to go back to.
 * This is the Rule 1 helper of docs/BACK_NAVIGATION.md § 2.1.
 *
 * React Router stamps every entry it pushes with `history.state.idx`; `idx === 0` means
 * the page on screen IS the first entry (deep-linked, bookmarked or reloaded), where a
 * bare `navigate(-1)` would leave the app entirely. `idx == null` (a state React Router
 * did not write) is treated as "has history", the same reading the callers below
 * always made.
 *
 * Used by the Menu-popover destinations (Reader, Community, Night Market, Tester
 * Dashboard, Immersive World, the template/scene editors) and the Friends drill-ins
 * (Sent, Requests, Remove, Challenges — opened from the AccountSheet's Friends tab). Since
 * the `/menu`, `/games` and `/friends` pages were deleted (2026-11-06) these have no fixed
 * parent, so Back returns to whatever page they were opened over. Also used by the saved-card
 * cdp's delete (VocabCardDetailPage → `handleDelete`) and acp's exit
 * (AddCardsPage → `exitToOrigin`).
 *
 * Docs: docs/BACK_NAVIGATION.md, docs/NAVIGATION.md.
 * LAYER: shared client utility (no React, no feature knowledge).
 */
export function navigateBackOr(navigate: NavigateFunction, fallback: string): void {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (idx == null || idx > 0) navigate(-1);
    // Replace, not push: the first-entry page is left behind for good, so Back from the
    // fallback must not walk back into it (docs/BACK_NAVIGATION.md § 2.1 Rule 1).
    else navigate(fallback, { replace: true });
}

/**
 * The card view's ONE motion: td fades its scroller and header out (and back in) on exactly
 * the duration and curve TowerCardView zooms the card and fades its chrome on, and all of it
 * starts in the same frame, so the open and the close read as a single gesture rather than a
 * fade followed by a zoom. Shared here so the two sides cannot drift. Its own module so
 * TowerCardView keeps fast refresh.
 *
 * Used by: cardView/TowerCardView.tsx (the zoom, the cross-fade, the chrome),
 * DeckTowerPage.tsx (`CARD_VIEW_FADE`). Docs: docs/DECK_TOWER.md § "The card view".
 */

/** The whole open (or close), ms. */
export const CARD_VIEW_MOTION_MS = 480;

/**
 * The curve everything rides: a quick start that settles long, so the page is mostly gone
 * while the card is still travelling, and the card glides into place rather than stopping.
 */
export const CARD_VIEW_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

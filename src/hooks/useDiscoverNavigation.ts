import { useAuth } from "../AuthContext";

// Default language used when the user has no selectedLanguage yet (e.g. brand
// new account). Kept in sync with the rest of the app's Chinese-first default.
const DEFAULT_DISCOVER_LANGUAGE = "zh";

/**
 * The path of Add New Cards (ancp), `/discover/sort/{language}`, keyed by the user's
 * selected language.
 *
 * The Discover hub (`/discover`) that used to sit above ancp was deleted 2026-10-17; the
 * `/discover/` URL prefix survives only as ancp's path. ancp is reached from the Deck
 * Tower's mini sort platform, which navigates with `state.exitTo` (DeckTowerPage →
 * `SORT_EXIT`) so its back arrow returns to the tower's main world.
 *
 * Callers: src/features/deckTower/DeckTowerPage.tsx (`sortPath`, the mini sort platform).
 * Docs: docs/DISCOVER_FLOW.md, docs/DECK_TOWER.md § "The sort platform".
 *
 * Returns:
 * - `sortPath` — the language-keyed sort page.
 */
export function useDiscoverNavigation() {
  const { user } = useAuth();
  const language = user?.selectedLanguage || DEFAULT_DISCOVER_LANGUAGE;
  return { sortPath: `/discover/sort/${language}` };
}

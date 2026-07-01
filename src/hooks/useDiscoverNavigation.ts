import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

// Default language used when the user has no selectedLanguage yet (e.g. brand
// new account). Kept in sync with the rest of the app's Chinese-first default.
const DEFAULT_DISCOVER_LANGUAGE = "zh";

/**
 * Encapsulates Discover-flow navigation.
 *
 * The Discover flow is a two-level surface:
 * - `/discover` — the Discover hub (menu of discover activities; lists Sort Cards
 *   today). This is where the footer's Discover tab lands.
 * - `/discover/sort/{language}` — the drag-to-sort page, reached from the hub and
 *   keyed by the user's selected language.
 *
 * Centralizing the default language + route shapes here keeps them in one place
 * (previously duplicated across MobileFooter / FlashcardsDecksPage).
 *
 * Returns:
 * - `goToDiscover()` / `discoverPath` — the Discover hub menu.
 * - `goToSort()` / `sortPath` — the language-keyed sort page.
 */
export function useDiscoverNavigation() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const language = user?.selectedLanguage || DEFAULT_DISCOVER_LANGUAGE;
  const discoverPath = "/discover";
  const sortPath = `/discover/sort/${language}`;
  const skippedPath = `/discover/skipped/${language}`;

  const goToDiscover = useCallback(() => {
    navigate(discoverPath);
  }, [navigate, discoverPath]);

  const goToSort = useCallback(() => {
    navigate(sortPath);
  }, [navigate, sortPath]);

  const goToSkipped = useCallback(() => {
    navigate(skippedPath);
  }, [navigate, skippedPath]);

  return { goToDiscover, discoverPath, goToSort, sortPath, goToSkipped, skippedPath };
}

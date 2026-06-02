import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

// Default language used when the user has no selectedLanguage yet (e.g. brand
// new account). Kept in sync with the rest of the app's Chinese-first default.
const DEFAULT_DISCOVER_LANGUAGE = "zh";

/**
 * Encapsulates navigation to the Discover (sort cards) page, which is keyed by
 * the user's selected language: `/discover/sort/{language}`.
 *
 * Previously this language-resolution + route-building logic was duplicated in
 * MobileFooter and FlashcardsDecksPage. Centralizing it here keeps the default
 * language and route shape in one place.
 *
 * Returns:
 * - `goToDiscover()` — navigate to the Discover page for the user's language.
 * - `discoverPath` — the resolved path, for cases that need the string directly.
 */
export function useDiscoverNavigation() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const language = user?.selectedLanguage || DEFAULT_DISCOVER_LANGUAGE;
  const discoverPath = `/discover/sort/${language}`;

  const goToDiscover = useCallback(() => {
    navigate(discoverPath);
  }, [navigate, discoverPath]);

  return { goToDiscover, discoverPath };
}

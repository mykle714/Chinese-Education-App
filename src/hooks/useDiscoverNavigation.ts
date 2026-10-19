import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

// Default language used when the user has no selectedLanguage yet (e.g. brand
// new account). Kept in sync with the rest of the app's Chinese-first default.
const DEFAULT_DISCOVER_LANGUAGE = "zh";

/**
 * Encapsulates navigation to Sort Cards (scp), `/discover/sort/{language}`, keyed by
 * the user's selected language.
 *
 * The Discover hub (`/discover`) that used to sit above scp was deleted 2026-10-17;
 * scp is now a drill-in from Home (the decks rail's Sort shortcut) and its back arrow
 * returns to Home. The `/discover/` URL prefix survives only as scp's path.
 *
 * Callers: src/features/flashcards/DecksTopRail.tsx, src/games/memory-map/MemoryMapPage.tsx.
 * Docs: docs/DISCOVER_FLOW.md.
 *
 * Returns:
 * - `goToSort()` / `sortPath` — the language-keyed sort page.
 */
export function useDiscoverNavigation() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const language = user?.selectedLanguage || DEFAULT_DISCOVER_LANGUAGE;
  const sortPath = `/discover/sort/${language}`;

  const goToSort = useCallback(() => {
    navigate(sortPath);
  }, [navigate, sortPath]);

  return { goToSort, sortPath };
}

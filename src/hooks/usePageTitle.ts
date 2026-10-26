import { useEffect } from "react";

const APP_NAME = "Cow";

/**
 * Sets the browser tab title for a page.
 * - If a pageTitle is provided: "<pageTitle> | Cow"
 * - If no pageTitle is provided (home page): "Cow"
 * - If pageTitle is null: leaves the title alone (a component mounted inside another page,
 *   e.g. the flp parked under the Deck Tower — docs/DECK_TOWER.md § "Studying the tower" → "Parked sessions")
 */
export function usePageTitle(pageTitle?: string | null) {
  useEffect(() => {
    if (pageTitle === null) return;
    document.title = pageTitle ? `${pageTitle} | ${APP_NAME}` : APP_NAME;
  }, [pageTitle]);
}

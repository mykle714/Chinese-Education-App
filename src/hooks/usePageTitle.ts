import { useEffect } from "react";

const APP_NAME = "Cow";

/**
 * Sets the browser tab title for a page.
 * - If a pageTitle is provided: "<pageTitle> | Cow"
 * - If no pageTitle is provided (home page): "Cow"
 */
export function usePageTitle(pageTitle?: string) {
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} | ${APP_NAME}` : APP_NAME;
  }, [pageTitle]);
}

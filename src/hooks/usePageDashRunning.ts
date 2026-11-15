import { useSyncExternalStore } from "react";
import { isPageDashRunning, subscribePageDash } from "./pageDash";

/**
 * True while a page dash (src/hooks/pageDash.ts) is running: from its navigation until the
 * arriving page has slid in and settled. An arriving page reads it to hold JS-driven
 * motion it wants seen — the dash pauses CSS animations on its own, not JS ones.
 *
 * Used by: src/features/deckTower/DeckTowerPage.tsx (docs/DECK_TOWER.md § "Back from Add Cards").
 */
export function usePageDashRunning(): boolean {
    return useSyncExternalStore(subscribePageDash, isPageDashRunning, isPageDashRunning);
}

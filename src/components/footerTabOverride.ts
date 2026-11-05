import { useEffect, useRef } from "react";
import type { FooterTab } from "./MobileFooter";

/**
 * footerTabOverride — lets the page on screen take over ONE footer tab's tap
 * (docs/LEAF_NODE_PAGES.md § "Footer tab overrides").
 *
 * The footer is rendered once, at frame level (FooterPresenter), outside every page, so a
 * page cannot hand it a prop. A page that needs a tab to do something other than its
 * plain `navigate` registers a handler here while it is mounted; MobileFooter asks
 * `runFooterTabOverride` before navigating and skips its own navigation when a handler
 * ran.
 *
 * Today's one user: ancp opened from the Deck Tower's sort platform. Its Deck tab leads back
 * to the tower anyway, so a tap on it plays the page's Back — the circle closing onto the
 * platform — instead of the footer's plain jump (NodePage `backOnFooterTab`).
 *
 * A module-level store, not a context: the footer and the pages sit under different
 * providers, and there is only ever one page on screen to claim a tab. Each handler is
 * removed on unmount, so a claim never outlives its page.
 *
 * Layer: shared component plumbing (src/components). Depended on by: MobileFooter.tsx,
 * NodePage.tsx.
 */

const overrides = new Map<FooterTab, () => void>();

/** Run the override for `tab`, if a page holds one. True when it ran (the footer then does not navigate). */
export function runFooterTabOverride(tab: FooterTab): boolean {
    const handler = overrides.get(tab);
    if (!handler) return false;
    handler();
    return true;
}

/**
 * While mounted, a tap on footer tab `tab` calls `handler` instead of the tab's own
 * navigation. `tab` undefined: no claim. The latest `handler` is always the one called
 * (kept in a ref), so a caller need not memoise it.
 */
export function useFooterTabOverride(tab: FooterTab | undefined, handler: () => void): void {
    const latest = useRef(handler);
    latest.current = handler;
    useEffect(() => {
        if (!tab) return;
        const run = () => latest.current();
        overrides.set(tab, run);
        return () => {
            // Only remove our own claim — a page mounting during this one's exit may
            // already have registered a newer one for the same tab.
            if (overrides.get(tab) === run) overrides.delete(tab);
        };
    }, [tab]);
}

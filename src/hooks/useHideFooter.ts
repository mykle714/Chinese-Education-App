import { createContext, useContext, useEffect } from 'react';

/**
 * FOOTER SUPPRESSION — lets a page temporarily hide the floating footer pill.
 *
 * Which routes show the footer is a static fact of the route table (`footerTab` in
 * src/routes/registry.ts, read by FooterPresenter). That is the right model for
 * navigation, but it has no way to express a *transient* "not right now": a modal
 * surface that owns the whole screen while it is open. The first such surface is the
 * eip bottom sheet on the sort cards page (docs/SORT_CARDS_REQUIREMENTS.md §4.7) — the
 * pill would otherwise float on top of the sheet's content, since it is rendered at
 * frame level (MobileDemoFrame) and is outside every page's DOM by design.
 *
 * The state is a COUNT, not a boolean, so two suppressors open at once (or a new one
 * mounting before the old one's cleanup runs, as React's effect ordering allows during a
 * swap) can't have the first release un-hide the footer out from under the second. The
 * footer hides while the count is above zero.
 *
 * The context + hooks live HERE, in a plain .ts module, while the provider component
 * lives in src/components/FooterVisibilityContext.tsx — the split keeps that file
 * exporting only components (react-refresh/only-export-components).
 *
 * LAYER: shared UI context. It carries no route or feature knowledge — a consumer only
 * ever says "hide it while I'm up".
 */

export interface FooterVisibilityValue {
    /** True while at least one caller is holding the footer hidden. */
    suppressed: boolean;
    /** Take a suppression hold; call the returned function to release it (idempotent). */
    acquire: () => () => void;
}

export const FooterVisibilityContext = createContext<FooterVisibilityValue>({
    // Default for trees rendered outside the provider (tests, isolated mounts):
    // never suppressed, and acquiring is a no-op rather than a crash.
    suppressed: false,
    acquire: () => () => {},
});

/** Read the current suppression state. Used by FooterPresenter, not by pages. */
export function useFooterSuppressed(): boolean {
    return useContext(FooterVisibilityContext).suppressed;
}

/**
 * Hide the floating footer pill for as long as `hidden` is true and this component is
 * mounted. Releasing on unmount is automatic, so a page that navigates away with its
 * modal still open can't strand the footer off-screen.
 *
 * Callers: SortCardsPage and VocabCardDetailPage (both while the eip sheet is open).
 */
export function useHideFooter(hidden: boolean): void {
    const { acquire } = useContext(FooterVisibilityContext);
    useEffect(() => {
        if (!hidden) return;
        return acquire();
    }, [hidden, acquire]);
}

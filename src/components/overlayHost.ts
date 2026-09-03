/**
 * Where a full-screen overlay (scrim + panel, popup, modal sheet) must be portaled to.
 *
 * ⚠️ A PAGE'S OWN DOM IS THE WRONG PLACE FOR ONE, AND SILENTLY SO. Rendering an
 * overlay inside `MobileTabScreen`'s ScrollArea looks correct — `position: fixed`
 * ignores the scroll — but the ScrollArea carries the edge-fade **mask**
 * (`EDGE_FADE_MASK`), and a mask clips its entire rendered subtree, fixed descendants
 * included. The bottom band of that mask is fully transparent for the footer's height,
 * so an overlay's pinned action bar is masked away: the panel looks fine and its
 * buttons are simply not there. (That is exactly what happened to the challenge
 * sheet's Send button, 2026-09-01.)
 *
 * So an overlay portals OUT of the page and into the nearest ancestor that both fills
 * the screen and can host it without inverting paint order.
 *
 * The phone frame (`.mobile-demo-frame`) satisfies that on a plain page. It does NOT on
 * a page that creates its own stacking context in between: `NodePage`'s `Surface`
 * carries the page-slide `transform` (usePageSlide), and a transformed element both
 * creates a stacking context and becomes the containing block for its positioned
 * descendants. An overlay sealed inside Surface competes at Surface's `auto`, so
 * anything hosted at the frame above it — a scrim, the footer bar — paints over the
 * whole page including the overlay.
 *
 * So: walk up and stop at the first ancestor that creates a stacking context AND is a
 * containing block for positioned children (`transform`, `filter`, `perspective`,
 * `will-change: transform`, `contain`, `backdrop-filter` — all of which establish both)
 * AND covers the frame, or at the frame itself, whichever comes first — so `inset: 0`
 * always covers the whole screen.
 *
 * ⚠️ HOSTING BELOW THE FRAME DOES NOT CLEAR THE FOOTER. The footer bar is rendered at
 * frame level (`FooterPresenter`, z-index 100) and therefore paints above any host
 * inside a page surface. An overlay that owns the screen must ALSO take a suppression
 * hold (`useHideFooter`) for as long as it is up, or the bar sits on top of its action
 * bar — the same 74px of missing buttons, by a different route.
 *
 * Callers: `SheetPanel` (flp/decks/scp/cdp modal sheet), `ChallengeSheet` and
 * `ChallengeHelpPopup` (Study Challenge). Documented in docs/UX_AND_NAVIGATION.md.
 *
 * LAYER: shared UI utility. It knows about the phone frame and about stacking
 * contexts, and nothing about any feature.
 */
export function nearestOverlayHost(el: HTMLElement): HTMLElement {
    const frame = el.closest(".mobile-demo-frame") as HTMLElement | null;
    const frameRect = frame?.getBoundingClientRect();
    for (let node = el.parentElement; node && node !== frame; node = node.parentElement) {
        const cs = getComputedStyle(node);
        const createsContext =
            cs.transform !== "none" ||
            cs.filter !== "none" ||
            cs.perspective !== "none" ||
            cs.backdropFilter !== "none" ||
            (cs.contain !== "none" && cs.contain !== "normal") ||
            /transform|filter|perspective/.test(cs.willChange);
        if (!createsContext) continue;
        // Only host here if this ancestor actually COVERS the frame. A page surface does
        // (`position: absolute; inset: 0`); an animated inner box would not, and covering
        // just that box is worse than the paint-order bug it would be dodging — fall back
        // to the frame in that case, which is what every page did before this helper.
        if (!frameRect) return node;
        const r = node.getBoundingClientRect();
        if (r.top <= frameRect.top + 1 && r.left <= frameRect.left + 1 &&
            r.bottom >= frameRect.bottom - 1 && r.right >= frameRect.right - 1) {
            return node;
        }
    }
    return frame ?? document.body;
}

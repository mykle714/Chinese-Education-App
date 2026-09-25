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
 * ⚠️ THE HOST MUST BE A POSITIONED ELEMENT, OR IT IS NOT REALLY THE HOST. An overlay
 * pinned with `position: absolute` resolves against its nearest POSITIONED ancestor, not
 * against whatever element it happens to be a child of. The phone frame
 * (`.mobile-demo-frame`, MobileDemoFrame's `FrameRoot`) used to be static, so an overlay
 * hosted there escaped it and resolved against the initial containing block — invisible
 * on mobile, where the frame is full-bleed and the two rects coincide, but on DESKTOP the
 * frame is a 402px centered card and the sheet spanned the whole browser window
 * (found 2026-09-06). `FrameRoot` now carries `position: relative` itself — it is what
 * the footer bar pins against — so it is the frame-level host.
 *
 * The phone frame satisfies that on a plain page. It does NOT on
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
 * The one overlay that must NOT take a suppression hold is the beginner keyboard: by
 * design the footer stays put and the keyboard simply covers it. It hosts at the frame
 * (`frameOverlayHost`) and out-stacks the bar there.
 *
 * Callers: `SheetPanel` (the flp eip, the decks sheet, scp, both cdps and the compare
 * sheet — `src/components/sheet/SheetPanel.tsx`), `ChallengeSheet` and `SteppedHelpPopup`
 * (Study Challenge). Documented in docs/UX_AND_NAVIGATION.md.
 *
 * LAYER: shared UI utility. It knows about the phone frame and about stacking
 * contexts, and nothing about any feature.
 */
/**
 * The FRAME-level host alone: the positioned phone frame, or `document.body` for an
 * element outside the frame entirely (e.g. inside an MUI dialog, which portals to body).
 *
 * Use this instead of `nearestOverlayHost` when the overlay must paint above the
 * frame-level chrome (the footer bar) rather than merely above its own page. A host
 * found inside a transformed page Surface is its own stacking context, so no z-index
 * inside it can beat the footer; a host here competes with the footer directly.
 * Caller: `BeginnerKeyboardHost` (docs/BEGINNER_KEYBOARD.md § 7a).
 */
export function frameOverlayHost(el: HTMLElement): HTMLElement {
    // Until 2026-09-13 this first looked for an inner `.mobile-demo-frame__viewport`
    // box; that box existed only to reserve an unpaintable strip that turned out not to
    // exist, and is gone.
    return (el.closest(".mobile-demo-frame") ?? document.body) as HTMLElement;
}

export function nearestOverlayHost(el: HTMLElement): HTMLElement {
    // The frame-level host is the positioned phone frame (see the warning above).
    const frameHost = frameOverlayHost(el);
    const frameRect = frameHost.getBoundingClientRect();
    for (let node = el.parentElement; node && node !== frameHost; node = node.parentElement) {
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
        const r = node.getBoundingClientRect();
        if (r.top <= frameRect.top + 1 && r.left <= frameRect.left + 1 &&
            r.bottom >= frameRect.bottom - 1 && r.right >= frameRect.right - 1) {
            return node;
        }
    }
    return frameHost;
}

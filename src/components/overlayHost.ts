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
 * inside a page surface, whatever z-index the overlay states.
 *
 * ── THE RULE FOR A DIM (2026-10-06): IT HOSTS AT THE FRAME ──────────────────────────
 * Anything that dims the background — a scrim behind a modal sheet, a popup, a stepped
 * explainer, a scoreboard — must dim the ENTIRE screen: status band, page header and the
 * footer bar included. So a dim does not use `nearestOverlayHost` at all: it portals to
 * `frameOverlayHost` (normally via `useScreenOverlayHost`, src/hooks/useScreenOverlayHost.ts),
 * pins itself `position: absolute; inset: 0` (never `fixed` — the frame is not a
 * containing block for fixed children, so on desktop a fixed scrim would dim the whole
 * browser window instead of the phone card) and states a z-index above the footer's 100.
 * The footer then stays exactly where it is and is dimmed with everything else; a dim
 * takes NO `useHideFooter` hold. (Until 2026-10-06 the convention was the reverse —
 * host inside the page surface and slide the footer away — which left headers lit above
 * game popups and the footer lit above scp's completion popup.)
 *
 * One deliberate exception: the Writing Notebook's cell canvas (NotebookCellEditor) dims
 * ONLY the scrollable sheet and leaves the header + word slot lit, by user decision
 * (docs/WRITING_NOTEBOOK.md § Canvas). It hosts inside the sheet's own box, not here.
 *
 * The one cost: a frame-hosted overlay is not inside the page surface, so the page-slide
 * exit clone (usePageSlide) does not carry it — navigating away with one open removes it
 * at once rather than sliding it off with the page.
 *
 * `nearestOverlayHost` remains for an overlay that does NOT dim and must sit UNDER the
 * footer: a PERSISTENT SheetPanel (`minHeight > 0`, `showScrim={false}`), page furniture
 * the bar is meant to float over. No page mounts one today (the /decks sheets are modal),
 * so in practice every SheetPanel hosts at the frame.
 *
 * The beginner keyboard also hosts at the frame (`frameOverlayHost`) and simply covers
 * the footer; it is not a dim, but it obeys the same paint-order reasoning.
 *
 * MUI Dialogs follow the same rule through the theme: `MuiDialog.defaultProps.container`
 * mounts them in the frame (src/contexts/ThemeContext.tsx).
 *
 * Callers: `useScreenOverlayHost` (every dim), `SheetPanel` (modal → frame, persistent →
 * nearest), `BeginnerKeyboardHost`. Documented in docs/UX_AND_NAVIGATION.md § Dimming
 * the background.
 *
 * LAYER: shared UI utility. It knows about the phone frame and about stacking
 * contexts, and nothing about any feature.
 */
/**
 * The FRAME-level host alone: the positioned phone frame, or `document.body` for an
 * element outside the frame entirely (a page on the plain shell). MUI dialogs used to be
 * that case — they portaled to body — but since 2026-10-06 they mount inside the frame
 * (`dialogContainer` below), so a field inside one resolves to the frame like any other.
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

/**
 * The container every MUI Dialog mounts into (`MuiDialog.defaultProps.container`,
 * src/contexts/ThemeContext.tsx): the phone frame when one is on screen, else `body`
 * (the plain shell — login, the font labs). A function MUI calls at open time, so it
 * always finds the live frame.
 *
 * Why the frame and not MUI's default `body`: a dialog's backdrop is a dim, and a dim
 * covers exactly the screen — on desktop that is the 402px phone card, not the whole
 * browser window around it (§ "THE RULE FOR A DIM" above). The theme also re-pins the
 * Modal root `absolute` inside the frame, because the frame is not a containing block
 * for `position: fixed`.
 */
export function dialogContainer(): HTMLElement {
    return document.querySelector<HTMLElement>(".mobile-demo-frame") ?? document.body;
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

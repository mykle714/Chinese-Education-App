import { useLayoutEffect, type RefObject } from "react";

/**
 * SCROLL-AWARE EDGE FADE — tells a scroller's edge-fade mask how much content is
 * actually cut off at each edge, so a band only appears where something is cut off.
 *
 * The edge fade exists for one reason: to soften the line where SCROLLED content
 * meets the scroller's wall. A band parked at an edge that is not cutting anything off
 * is wrong. At `scrollTop = 0` the top band used to eat the top 28px of the page
 * HEADER, which lives inside the scroll area so it can scroll away. That visibly faded
 * /arena's full-bleed division banner and the top edge of every header's icon buttons.
 * Likewise, the bottom band used to fade the last row even when the list was scrolled
 * all the way to the end.
 *
 * How it works: this writes two CSS custom properties onto the scroller, the px of
 * content scrolled out past the top (`--edge-fade-above`) and still waiting below
 * (`--edge-fade-below`). The masks clamp each one to their own band size with
 * `min(var(...), <band>px)`. So a band GROWS in over the first few px of scroll
 * instead of popping in, and each mask family (page 28/34, panel 20/24) keeps its
 * own geometry. Values are written straight to the element's style inside a
 * rAF, with no React state, so a scroll never re-renders the page.
 *
 * A scroller that wears a mask but is NOT tracked falls back to the full band (the
 * masks' `var()` fallbacks are the band sizes), i.e. the old always-on behaviour. So
 * forgetting to wire this in is a cosmetic regression, never a hidden-content bug.
 *
 * Consumers (keep current):
 *   • src/components/MobileTabScreen.tsx → `ScrollArea` (every page / NodePage)
 *   • src/features/flashcards/FlashcardsLearnPage/SheetBody.tsx → `SheetBody`
 *   • src/features/flashcards/DecksPanelBody.tsx → `DecksPanelBody`
 *   • src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx → tab panes
 *   • src/features/studyChallenge/ChallengeSheet.tsx → `.challenge-sheet__body`
 * Masks that read the variables: `EDGE_FADE_MASK` / `EDGE_FADE_MASK_NO_TOP`
 * (MobileTabScreen) and `SHEET_EDGE_FADE_MASK` / `SHEET_EDGE_FADE_MASK_NO_TOP`
 * (components/sheet/sheetStyled). Every one of them is worn through `edgeFadeMaskSx`.
 *
 * SCROLLBAR EXEMPTION: a mask on a scroller clips the scroller's own scrollbar too, so
 * a classic (desktop) scrollbar used to dissolve at both ends along with the content.
 * The tracker also writes `--edge-fade-scrollbar`, the px width of the scrollbar
 * gutter. `edgeFadeMaskSx` uses it to apply the fade only to the content column, and
 * puts a solid layer over the gutter. So the fade is drawn BEHIND the scrollbar and the
 * scrollbar itself stays fully drawn. Overlay scrollbars (mobile, macOS) take no gutter
 * (width 0), so they still fade with the content. They are transient and float over
 * it anyway.
 * Documented in docs/UX_AND_NAVIGATION.md § Edge fade.
 */

export const EDGE_FADE_ABOVE_VAR = "--edge-fade-above";
export const EDGE_FADE_BELOW_VAR = "--edge-fade-below";
export const EDGE_FADE_SCROLLBAR_VAR = "--edge-fade-scrollbar";

// Written values are capped here. Every band is smaller than this, and capping keeps
// the style write a no-op (same string) for the whole middle of a long scroll. The
// tallest band today is the Mastery Centers' page bottom (`CENTER_BOTTOM_FADE_BAND`,
// 110px, MasteryCenterPage) — raise this if a taller one arrives.
const EDGE_FADE_VAR_CAP = 128;

/** `min(var(--edge-fade-above, band), band)`. A band that ramps in with the content scrolled past the top wall. */
export const edgeFadeAboveBand = (bandPx: number) =>
    `min(var(${EDGE_FADE_ABOVE_VAR}, ${bandPx}px), ${bandPx}px)`;
/** Same, for the content still waiting below the bottom wall. */
export const edgeFadeBelowBand = (bandPx: number) =>
    `min(var(${EDGE_FADE_BELOW_VAR}, ${bandPx}px), ${bandPx}px)`;

/**
 * The `sx` that makes a scroller wear an edge-fade `gradient`, with the scrollbar gutter
 * exempt (see "SCROLLBAR EXEMPTION" above). Two mask layers:
 *   1. the fade gradient, sized to the content column (`100%` minus the gutter), left;
 *   2. a solid layer the width of the gutter, right, so the scrollbar stays fully drawn.
 * The gradient runs vertically, so narrowing its layer leaves every stop unchanged.
 * An untracked scroller has no gutter var, so it gets 0 and the old full-width fade.
 * Both spellings throughout, because iOS Safari still needs the prefixed properties.
 */
export function edgeFadeMaskSx(gradient: string) {
    const gutter = `var(${EDGE_FADE_SCROLLBAR_VAR}, 0px)`;
    const image = `${gradient}, linear-gradient(#000, #000)`;
    const size = `calc(100% - ${gutter}) 100%, ${gutter} 100%`;
    const position = "left top, right top";
    return {
        maskImage: image,
        WebkitMaskImage: image,
        maskSize: size,
        WebkitMaskSize: size,
        maskPosition: position,
        WebkitMaskPosition: position,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
    } as const;
}

/**
 * Start tracking `el`. Returns the cleanup. Shaped as a React 19 ref callback, so a
 * scroller with no other ref can take `ref={trackScrollEdgeFade}` directly. It is a
 * stable module function, so React attaches it once, not on every render.
 */
export function trackScrollEdgeFade(el: HTMLElement): () => void {
    let frame = 0;
    let lastAbove = "";
    let lastBelow = "";
    let lastScrollbar = "";

    const write = () => {
        frame = 0;
        const above = Math.min(Math.max(el.scrollTop, 0), EDGE_FADE_VAR_CAP);
        const below = Math.min(
            Math.max(el.scrollHeight - el.clientHeight - el.scrollTop, 0),
            EDGE_FADE_VAR_CAP
        );
        // Round so sub-pixel scroll positions don't churn the style every frame.
        const aboveStr = `${Math.round(above)}px`;
        const belowStr = `${Math.round(below)}px`;
        if (aboveStr !== lastAbove) el.style.setProperty(EDGE_FADE_ABOVE_VAR, (lastAbove = aboveStr));
        if (belowStr !== lastBelow) el.style.setProperty(EDGE_FADE_BELOW_VAR, (lastBelow = belowStr));
        // Scrollbar gutter width: the border box minus the client box minus the side
        // borders. It changes when the scrollbar appears or disappears, and the
        // ResizeObserver catches that (the content box resizes when it does).
        const style = getComputedStyle(el);
        const gutter = Math.max(
            el.offsetWidth - el.clientWidth -
                (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0),
            0
        );
        const scrollbarStr = `${Math.round(gutter)}px`;
        if (scrollbarStr !== lastScrollbar) el.style.setProperty(EDGE_FADE_SCROLLBAR_VAR, (lastScrollbar = scrollbarStr));
    };
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(write);
    };

    // The "below" distance also changes when CONTENT changes height without any
    // scroll: async data arriving, a section expanding, the page shrinking under a
    // keyboard. A ResizeObserver on the scroller alone would miss content growth, so
    // it also watches each direct child. A MutationObserver adds children that
    // mount later (e.g. a list that renders after its fetch).
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(el);
    for (const child of Array.from(el.children)) resizeObserver.observe(child);
    const mutationObserver = new MutationObserver((records) => {
        for (const record of records) {
            record.addedNodes.forEach((node) => {
                if (node instanceof Element) resizeObserver.observe(node);
            });
        }
        schedule();
    });
    mutationObserver.observe(el, { childList: true });

    el.addEventListener("scroll", schedule, { passive: true });
    // Synchronous first write, so the first painted frame already has the right bands
    // (no flash of the fallback full band on the header).
    write();

    return () => {
        if (frame) cancelAnimationFrame(frame);
        el.removeEventListener("scroll", schedule);
        resizeObserver.disconnect();
        mutationObserver.disconnect();
    };
}

/**
 * Hook form, for a scroller that already has its own `RefObject`. A layout effect,
 * so the first write lands before paint, same as the ref-callback form.
 */
export function useScrollEdgeFade(ref: RefObject<HTMLElement | null>): void {
    useLayoutEffect(() => {
        const el = ref.current;
        return el ? trackScrollEdgeFade(el) : undefined;
    }, [ref]);
}

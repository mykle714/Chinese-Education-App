import { useEffect, useMemo, useRef, type RefObject } from "react";

/**
 * towerScroll — td's scroller and its PLATFORM LINE (docs/DECK_TOWER.md § "Scrolling" and
 * § "The cards page").
 *
 * The scroller holds two stacked sections:
 *
 *   ┌ TOWER SECTION (`TOWER_SECTION_CLASS`) ┐  the scene svg + the spacer under the slab
 *   │   …sky, a tall tower climbing up…     │  footer. At least one screen tall, the scene
 *   │   platform                            │  pinned to its bottom (`marginTop: auto`).
 *   │   footer spacer                       │
 *   ├ CARDS PAGE (TowerCardsPage) ──────────┤  the world's card library, under the platform
 *   │   …                                   │
 *   └───────────────────────────────────────┘
 *
 * The PLATFORM LINE is the scrollTop at which the tower section's bottom meets the screen's
 * bottom — the platform resting on the slab footer, the cards page just out of sight under
 * it. Every piece of scroll maths that used to mean "the bottom" (`scrollHeight`) now means
 * this line, because the scroll no longer ends at the platform.
 *
 * Layer: feature page logic (src/features/deckTower). Pure DOM reads + one hook.
 * Read by: DeckTowerPage (climb, refits, plate tap, resize camera, stack tap, swipe paint),
 * SpaceBackdrop (sky altitude + star parallax), useTowerCardsScroll (below).
 */

/** The scene svg's class — IsoScene puts it on the `<svg>`. */
export const TOWER_SCENE_CLASS = "deck-tower-page__scene";
/** The tower section: scene + footer spacer, the scroller's first block. */
export const TOWER_SECTION_CLASS = "deck-tower-page__tower-section";

/**
 * The scene svg inside the scroller. Found by class rather than position: the svg is no
 * longer the scroller's direct child (it sits in the tower section), and the scroller
 * also holds a `<style>` whose empty rect would read as "not laid out yet".
 */
export const towerSceneOf = (scroller: Element | null): SVGSVGElement | null =>
    scroller?.querySelector<SVGSVGElement>(`svg.${TOWER_SCENE_CLASS}`) ?? null;

/** The scrollTop that rests the platform on the footer (see the file header). */
export const platformScrollTop = (scroller: HTMLElement): number => {
    const section = scroller.querySelector<HTMLElement>(`.${TOWER_SECTION_CLASS}`);
    // No section yet (first paint): fall back to the old meaning, the bottom.
    const sectionH = section ? section.offsetHeight : scroller.scrollHeight;
    return Math.max(0, sectionH - scroller.clientHeight);
};

/**
 * How far above the platform line the view is, px. Positive = up the tower, 0 = on the
 * platform, NEGATIVE = down in the cards page.
 */
export const heightAbovePlatform = (scroller: HTMLElement): number => platformScrollTop(scroller) - scroller.scrollTop;

/** Under 1px from the line counts as on it (scrollTop is fractional on high-dpi screens). */
const ON_LINE_PX = 1;

interface TowerCardsScrollArgs {
    scrollerRef: RefObject<HTMLDivElement | null>;
    /** The page header's layer (header + tester chip rows), pushed off by the cards header. */
    headerLayerRef: RefObject<HTMLElement | null>;
    /** The cards page's root — its top edge is the cards header's natural position. */
    cardsPageRef: RefObject<HTMLElement | null>;
    /**
     * Whether `scrollTop` is one the PAGE wrote (a refit, the resize camera). Those are
     * never caught at the platform: they are aimed, not flung.
     */
    isPlaced: (scrollTop: number) => boolean;
    /** Told the scrollTop the catch wrote, so the page's `climb` ignores its echo. */
    onPlaced: (scrollTop: number) => void;
    /** Off while a study holds the scroller (it is overflow-hidden then anyway). */
    enabled: boolean;
}

/**
 * useTowerCardsScroll — the two scroll behaviours the cards page brings to td:
 *
 * 1. THE PLATFORM STOP. Momentum always stops at the platform line, from above or below:
 *    a fling down the tower lands on the platform rather than sailing into the cards, and a
 *    fling up out of the cards lands on the platform rather than sailing up the tower. A
 *    scroll the learner's FINGER is driving is left alone (dragging across the line is a
 *    deliberate act); only what moves with no touch down is caught — touch momentum, and
 *    wheel / trackpad scrolling, whose every crossing makes the stop.
 *
 *    Caught by watching each scroll event for a CROSSING of the line (the previous and
 *    current scrollTop on opposite sides), then pinning scrollTop to the line. Pinning
 *    alone does not end native momentum on iOS — the fling resumes on the next frame — so
 *    the scroller's overflow is switched to `hidden` for one frame, which drops the fling
 *    on both WebKit and Blink. The catch lands up to one frame's travel past the line and
 *    is pulled back; at fling speeds that reads as a stop, not a jump.
 *    Why not CSS `scroll-snap-stop: always`: the tower above and the grid below are both
 *    far taller than the screen, and free scrolling inside an oversized snap area is not
 *    consistent between iOS and Chrome (decided 2026-11-04).
 *
 * 2. THE HEADER HAND-OFF. As the cards page's top edge rises into the page header, it
 *    pushes the header (title, flame, avatar, tester chips) up with it, px for px, until
 *    the cards header's sticky title row reaches the screen's top and takes over as the
 *    page header. Written straight to the header layer's `transform`, never through state
 *    — it runs every scroll frame. The math assumes the header layer and the scroller both
 *    start at the screen's top (MobileTabScreen's ScreenRoot), which they do on td.
 */
export function useTowerCardsScroll({ scrollerRef, headerLayerRef, cardsPageRef, isPlaced, onPlaced, enabled }: TowerCardsScrollArgs) {
    // Read through refs: the scroll listener is attached once, the callbacks change per render.
    const isPlacedRef = useRef(isPlaced);
    isPlacedRef.current = isPlaced;
    const onPlacedRef = useRef(onPlaced);
    onPlacedRef.current = onPlaced;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    /** The header push last written, so an unchanged frame writes nothing. */
    const lastPush = useRef(-1);
    const pushHeader = () => {
        const el = scrollerRef.current;
        const header = headerLayerRef.current;
        const cards = cardsPageRef.current;
        if (!el || !header || !cards) return;
        const headerH = header.offsetHeight;
        // The cards page's top on screen (offsetTop ignores transforms — the pan's slide is
        // horizontal, and the header's own push must not feed back into its measurement).
        const cardsTop = cards.offsetTop - el.scrollTop;
        const push = Math.round(Math.min(headerH, Math.max(0, headerH - cardsTop)));
        if (push === lastPush.current) return;
        lastPush.current = push;
        header.style.transform = push > 0 ? `translateY(${-push}px)` : "";
    };
    // Also re-run from outside after layout changes (a refit, the header remounting).
    const pushHeaderRef = useRef(pushHeader);
    pushHeaderRef.current = pushHeader;

    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        let touching = false;
        let lastTop = el.scrollTop;
        let restoreFrame = 0;
        const onTouchStart = () => {
            touching = true;
        };
        const onTouchEnd = (e: TouchEvent) => {
            // Still touching while any finger is down.
            touching = e.touches.length > 0;
        };
        const onScroll = () => {
            const top = el.scrollTop;
            const prev = lastTop;
            lastTop = top;
            pushHeaderRef.current();
            if (!enabledRef.current || touching || isPlacedRef.current(top)) return;
            const line = platformScrollTop(el);
            const crossed = (prev < line - ON_LINE_PX && top > line + ON_LINE_PX) || (prev > line + ON_LINE_PX && top < line - ON_LINE_PX);
            if (!crossed) return;
            // Stop the fling: one frame of overflow-hidden ends native momentum, then the
            // stylesheet's own overflow comes back (an inline "" defers to the class).
            el.style.overflowY = "hidden";
            el.scrollTop = line;
            lastTop = el.scrollTop;
            onPlacedRef.current(el.scrollTop);
            cancelAnimationFrame(restoreFrame);
            restoreFrame = requestAnimationFrame(() => {
                el.style.overflowY = "";
            });
            pushHeaderRef.current();
        };
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchend", onTouchEnd, { passive: true });
        el.addEventListener("touchcancel", onTouchEnd, { passive: true });
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            cancelAnimationFrame(restoreFrame);
            el.style.overflowY = "";
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("touchcancel", onTouchEnd);
            el.removeEventListener("scroll", onScroll);
        };
        // The scroller mounts once with the page; refs are stable.
    }, [scrollerRef]);

    // Stable identities (they only read refs): `toPlatform` is a prop of the memoized
    // cards page, which a fresh function every render would re-render each frame.
    return useMemo(
        () => ({
            /** Re-measure the header push (after a refit or the header layer remounting). */
            syncHeader: () => {
                lastPush.current = -1;
                pushHeaderRef.current();
            },
            /** Glide back up (or down) to the platform line — the cards header's up arrow. */
            toPlatform: () => {
                const el = scrollerRef.current;
                if (el) el.scrollTo({ top: platformScrollTop(el), behavior: "smooth" });
            },
        }),
        [scrollerRef]
    );
}

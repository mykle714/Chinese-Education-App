import { useEffect, useMemo, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./iso";

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
 * The CARDS LINE is the scrollTop at which the cards page's top meets the screen's top —
 * its sticky title row standing in as the page header (`cardsTopScrollTop`). Between the
 * two lines lies one screen of SNAP ZONE: a scroll that comes to rest in it glides to
 * whichever line is nearer (`useTowerCardsScroll`, behaviour 3).
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

/**
 * The scrollTop that puts the cards page's top at the screen's top (the CARDS LINE), clamped
 * to the scroll's end — the page is at least a screen tall, so the clamp only bites mid-layout.
 */
export const cardsTopScrollTop = (scroller: HTMLElement, cardsPage: HTMLElement): number =>
    Math.min(cardsPage.offsetTop, scroller.scrollHeight - scroller.clientHeight);

/** Under 1px from the line counts as on it (scrollTop is fractional on high-dpi screens). */
const ON_LINE_PX = 1;
/**
 * The FALLBACK settle: how long the scroll must be quiet (no scroll event, no finger down)
 * before it counts as at rest and the snap zone is checked, ms. Touch releases inside the
 * zone do not wait for it (they snap on lift — `MOMENTUM_PROJECTION_MS`); it covers the
 * wheel, the trackpad, and a fling that was released outside the zone and coasts into it.
 * A timer rather than the `scrollend` event, which older iOS Safari does not fire.
 */
const SETTLE_MS = 140;
/**
 * The finger's release velocity is read over this last stretch of its drag, ms. A finger
 * that held still for longer than this before lifting releases at 0.
 */
const RELEASE_VELOCITY_WINDOW_MS = 80;
/**
 * Where a release's momentum would carry the scroll: release velocity (px/ms) × this, ms.
 * The snap decides on that PROJECTED position at the moment the finger lifts, rather than
 * waiting for the momentum to run out — whose slow tail is most of a second on iOS. A
 * conservative figure (iOS's own deceleration coasts ~0.5 s × velocity), so a flick
 * commits without a gentle push being over-read. Tunable.
 */
const MOMENTUM_PROJECTION_MS = 300;
/** The glide down to the cards page or back up to the platform (the cue, the up arrow), ms. */
const GLIDE_MS = 650;
/** The snap's glide — usually under a screen, so shorter than a full trip, ms. */
const SNAP_MS = 380;
/**
 * How far into the snap zone a scroll must travel, as a share of the zone, before it commits
 * to the line it is heading for. Measured from the line it is moving AWAY from: moving down,
 * a quarter-screen past the platform line goes on to the cards; moving up, a quarter-screen
 * above the cards line goes on to the platform. Short of that it springs back.
 */
const SNAP_COMMIT_SHARE = 0.25;
/**
 * A scroll step smaller than this does not change the remembered direction, px — so the
 * last jitter of a finger lifting (or a decelerating fling's sub-pixel frames) cannot flip
 * a deliberate scroll's direction.
 */
const DIRECTION_MIN_STEP_PX = 2;

/**
 * Where a scroll resting in the snap zone glides to (see `useTowerCardsScroll`, behaviour
 * 3). `direction` is the way it was last moving: +1 down (towards the cards), −1 up
 * (towards the platform), 0 unknown — which falls back to the halfway point.
 * Pure, so the rule is unit-testable apart from the DOM.
 */
export const snapTargetOf = (top: number, platformLine: number, cardsLine: number, direction: -1 | 0 | 1): number => {
    const zone = cardsLine - platformLine;
    const breakpoint =
        direction > 0
            ? platformLine + zone * SNAP_COMMIT_SHARE // heading down: commit early to the cards
            : direction < 0
              ? cardsLine - zone * SNAP_COMMIT_SHARE // heading up: commit early to the platform
              : platformLine + zone / 2;
    return top < breakpoint ? platformLine : cardsLine;
};

/** Ease-in-out cubic: the cue's and the up arrow's glides start from rest and end at rest. */
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
/** Ease-out cubic: the snap starts at speed, carrying on from the scroll it ends. */
const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);

/** One scroll sample of a finger's drag (for its release velocity). */
interface ScrollSample {
    t: number;
    top: number;
}
/**
 * A drag's release velocity, px/ms (+ = scrollTop rising, i.e. heading down): the travel
 * across the samples in the last `RELEASE_VELOCITY_WINDOW_MS` before `now`. 0 when the
 * finger held still before lifting, or there is too little to measure.
 */
export const releaseVelocityOf = (samples: readonly ScrollSample[], now: number): number => {
    const recent = samples.filter((sample) => now - sample.t <= RELEASE_VELOCITY_WINDOW_MS);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? (last.top - first.top) / dt : 0;
};

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
    /**
     * Whether the snap zone may snap. Off while the page moves the scroller itself (a pan,
     * a deck swap, a resize): those place it on purpose, and a snap glide racing them would
     * land on the wrong world's lines.
     */
    snapEnabled: boolean;
}

/**
 * useTowerCardsScroll — the three scroll behaviours the cards page brings to td, and the
 * glide they share:
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
 *
 * 3. THE SNAP ZONE. A scroll that comes to REST between the platform line and the cards
 *    line — finger up and momentum spent, `SETTLE_MS` of quiet — glides to one of the two,
 *    so the view never parks with the cards page half up the screen. The breakpoint
 *    depends on the scroll's LAST DIRECTION of movement (`snapTargetOf`): heading down, it
 *    goes on to the cards once `SNAP_COMMIT_SHARE` of the zone past the platform line;
 *    heading up, it goes on to the platform once that share above the cards line. Short of
 *    it, the scroll springs back to the line it left. A drag down that turns back up counts
 *    as heading up. With no direction known it falls back to the halfway point.
 *    Above the platform (the tower) and below the cards line (the grid) scroll freely.
 *    Applies to every input, wheel included — at a quarter-screen, one or two wheel notches
 *    commit.
 *    WHEN it decides: a touch released inside the zone decides AT ONCE, on the position its
 *    momentum would reach (release velocity × `MOMENTUM_PROJECTION_MS`), and glides there
 *    with the momentum dropped (the scroller's overflow held `hidden` for the glide) —
 *    waiting for an iOS fling to coast to a stop took most of a second. A release whose
 *    momentum would leave the zone is left to coast. Everything else (wheel, trackpad, a
 *    fling released outside the zone that coasts into it) waits for `SETTLE_MS` of quiet.
 *
 * THE GLIDE (`glideTo`) is a rAF tween rather than `scrollTo({ behavior: "smooth" })`: a
 * smooth scroll crosses the platform line with no finger down, which the platform stop
 * would catch. Each frame is reported through `onPlaced`, so the stop and the page's climb
 * record let it through. A finger or a wheel on the scroller cancels it, and so does
 * `cancelGlide` (the page's refits place the scroller themselves).
 */
export function useTowerCardsScroll({ scrollerRef, headerLayerRef, cardsPageRef, isPlaced, onPlaced, enabled, snapEnabled }: TowerCardsScrollArgs) {
    // Read through refs: the scroll listener is attached once, the callbacks change per render.
    const isPlacedRef = useRef(isPlaced);
    isPlacedRef.current = isPlaced;
    const onPlacedRef = useRef(onPlaced);
    onPlacedRef.current = onPlaced;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const snapEnabledRef = useRef(snapEnabled);
    snapEnabledRef.current = snapEnabled;

    // ── The glide ──
    const glideRaf = useRef(0);
    /**
     * Whether a glide is in flight. The snap zone checks it and stands down: a glide is
     * already headed for a line, and its frames pass THROUGH the zone. Without this, a tap
     * on the up arrow from the top of the cards page was undone — the tap's `touchend`
     * arms the settle timer, the glide's own (placed) frames never re-arm or clear it, and
     * 140ms in it found the glide still near the cards line with the last hand-scroll
     * heading down, and snapped back to the cards.
     */
    const gliding = useRef(false);
    /** Whether the glide in flight has the scroller's overflow locked (a release snap). */
    const glideLocked = useRef(false);
    const unlockGlide = () => {
        if (!glideLocked.current) return;
        glideLocked.current = false;
        const el = scrollerRef.current;
        // An inline "" defers back to the stylesheet's own overflow.
        if (el) el.style.overflowY = "";
    };
    const cancelGlide = () => {
        cancelAnimationFrame(glideRaf.current);
        gliding.current = false;
        unlockGlide();
    };
    /**
     * `lock`: hold the scroller's overflow `hidden` for the whole glide. A snap that starts
     * the moment a finger lifts would otherwise be fought by the native momentum that
     * begins on the same frames; overflow-hidden drops it (the platform stop's trick).
     */
    const glideTo = (to: number, ms: number, ease: (u: number) => number = easeInOutCubic, lock = false) => {
        const el = scrollerRef.current;
        if (!el) return;
        const place = (top: number) => {
            el.scrollTop = top;
            onPlacedRef.current(el.scrollTop);
        };
        cancelGlide();
        const from = el.scrollTop;
        if (prefersReducedMotion() || Math.abs(to - from) < 1) {
            place(to);
            return;
        }
        if (lock) {
            glideLocked.current = true;
            el.style.overflowY = "hidden";
        }
        const start = performance.now();
        gliding.current = true;
        const tick = (now: number) => {
            const u = Math.min(1, (now - start) / ms);
            place(from + (to - from) * ease(u));
            if (u < 1) glideRaf.current = requestAnimationFrame(tick);
            else {
                gliding.current = false;
                unlockGlide();
            }
        };
        glideRaf.current = requestAnimationFrame(tick);
    };
    // The scroll listener below is attached once; it reaches the latest closures through refs.
    const glideToRef = useRef(glideTo);
    glideToRef.current = glideTo;
    const cancelGlideRef = useRef(cancelGlide);
    cancelGlideRef.current = cancelGlide;

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
        let settleTimer = 0;
        /** +1 = last moving down (scrollTop rising), −1 = up, 0 = not known yet. */
        let lastDirection: -1 | 0 | 1 = 0;
        /** The current drag's recent scroll samples (for its release velocity). */
        let dragSamples: ScrollSample[] = [];

        // ── The snap zone (behaviour 3) ──
        /** The two lines, or null when the snap may not run now. */
        const snapLines = () => {
            const cards = cardsPageRef.current;
            if (!cards || touching || gliding.current || !enabledRef.current || !snapEnabledRef.current) return null;
            return { platformLine: platformScrollTop(el), cardsLine: cardsTopScrollTop(el, cards) };
        };
        /** Strictly between the lines: resting on either one is already settled. */
        const inZone = (top: number, platformLine: number, cardsLine: number) => top > platformLine + ON_LINE_PX && top < cardsLine - ON_LINE_PX;

        // The fallback: runs once the scroll has been quiet for SETTLE_MS with no finger down.
        const snapIfInZone = () => {
            const lines = snapLines();
            if (!lines) return;
            const top = el.scrollTop;
            if (!inZone(top, lines.platformLine, lines.cardsLine)) return;
            glideToRef.current(snapTargetOf(top, lines.platformLine, lines.cardsLine, lastDirection), SNAP_MS, easeOutCubic);
        };
        /**
         * The fast path: decide the moment the finger lifts, from where the release's
         * momentum would carry it (`MOMENTUM_PROJECTION_MS`), and glide there at once with
         * the momentum dropped. Returns whether it took over. It leaves alone a release
         * outside the zone, and one whose momentum would carry it out of the zone — past
         * the cards line into the grid (free scrolling), or above the platform line (where
         * the platform stop catches it).
         */
        const snapOnRelease = (): boolean => {
            const lines = snapLines();
            if (!lines) return false;
            const { platformLine, cardsLine } = lines;
            const top = el.scrollTop;
            if (!inZone(top, platformLine, cardsLine)) return false;
            const projected = top + releaseVelocityOf(dragSamples, performance.now()) * MOMENTUM_PROJECTION_MS;
            if (projected >= cardsLine || projected <= platformLine) return false;
            cancelAnimationFrame(restoreFrame); // the platform stop's unlock must not undo the snap's lock
            glideToRef.current(snapTargetOf(projected, platformLine, cardsLine, lastDirection), SNAP_MS, easeOutCubic, true);
            return true;
        };
        const armSettle = () => {
            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(snapIfInZone, SETTLE_MS);
        };

        const onTouchStart = () => {
            touching = true;
            dragSamples = [];
            // A finger takes the scroll back: no glide or pending snap fights it (and a
            // release snap's overflow lock comes off, so the finger can scroll).
            window.clearTimeout(settleTimer);
            cancelGlideRef.current();
        };
        const onTouchEnd = (e: TouchEvent) => {
            // Still touching while any finger is down.
            touching = e.touches.length > 0;
            if (touching) return;
            if (snapOnRelease()) {
                window.clearTimeout(settleTimer);
                return;
            }
            // Not snapped on lift: wait for the scroll to settle. A release with no
            // momentum fires no further scroll event, so arm here too.
            armSettle();
        };
        // The wheel takes the scroll back from a glide, as a finger does.
        const onWheel = () => cancelGlideRef.current();
        const onScroll = () => {
            const top = el.scrollTop;
            const prev = lastTop;
            lastTop = top;
            pushHeaderRef.current();
            // The page's own placements (glide frames, refits) are aimed: they neither
            // trip the platform stop, nor count as a scroll coming to rest, nor say which
            // way the learner is heading.
            if (!enabledRef.current || isPlacedRef.current(top)) return;
            // Finger-driven steps count too: a drag's direction is the learner's intent.
            if (Math.abs(top - prev) >= DIRECTION_MIN_STEP_PX) lastDirection = top > prev ? 1 : -1;
            if (touching) {
                // Only the last stretch of the drag is ever read; keep a few frames of it.
                dragSamples.push({ t: performance.now(), top });
                if (dragSamples.length > 8) dragSamples.shift();
            }
            if (!touching) armSettle();
            if (touching) return;
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
        el.addEventListener("wheel", onWheel, { passive: true });
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            cancelAnimationFrame(restoreFrame);
            cancelGlideRef.current();
            window.clearTimeout(settleTimer);
            el.style.overflowY = "";
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("touchcancel", onTouchEnd);
            el.removeEventListener("wheel", onWheel);
            el.removeEventListener("scroll", onScroll);
        };
        // The scroller mounts once with the page; refs are stable.
    }, [scrollerRef, cardsPageRef]);

    // Stable identities (they only read refs): `up` and `toCards` are props of
    // memoized children, which a fresh function every render would re-render each frame.
    return useMemo(
        () => ({
            /** Re-measure the header push (after a refit or the header layer remounting). */
            syncHeader: () => {
                lastPush.current = -1;
                pushHeaderRef.current();
            },
            /** Stop a glide in flight — the page is about to place the scroller itself. */
            cancelGlide: () => cancelGlideRef.current(),
            /** Glide back up (or down) to the platform line — the cards header's up arrow. */
            /**
             * The cards header's up arrow: climbs ONE stop. Down in the grid (below the cards
             * line) it glides back to the top of the cards page; at the top of the cards page
             * (on the line, or anywhere above it) it glides on up to the platform line.
             */
            up: () => {
                const el = scrollerRef.current;
                if (!el) return;
                const cards = cardsPageRef.current;
                const cardsLine = cards ? cardsTopScrollTop(el, cards) : null;
                const inGrid = cardsLine !== null && el.scrollTop > cardsLine + ON_LINE_PX;
                glideToRef.current(inGrid ? cardsLine : platformScrollTop(el), GLIDE_MS);
            },
            /** Glide down to the cards line, the title row at the top — the cards cue. */
            toCards: () => {
                const el = scrollerRef.current;
                const cards = cardsPageRef.current;
                if (el && cards) glideToRef.current(cardsTopScrollTop(el, cards), GLIDE_MS);
            },
        }),
        [scrollerRef, cardsPageRef]
    );
}

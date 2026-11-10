import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigationType } from "react-router-dom";
import type { CSSProperties, RefObject } from "react";
import { CIRCLE_MOTION, circleClip, circleCoverRadius, prefersReducedMotion, type ScreenPoint } from "../utils/pageTransition";

// Shared enter/exit slide transition for LeafPage / NodePage (see
// docs/LEAF_NODE_PAGES.md). Plain CSS `transform` transitions (percentage units),
// not react-spring — the surface translates by 100% of its own size, which a
// string-percentage spring interpolation does not animate.
//
// ENTER (on mount): first paint is off-screen, a rAF flips to in-place so the
// browser transitions transform 100% → 0. Leaf = axis "y" (up), node = axis "x"
// (in from the right).
//
// EXIT (`exit(performNavigate)`): instead of sliding the live page off over a
// blank background and only THEN navigating, we navigate IMMEDIATELY so the
// destination mounts underneath, and slide a detached CLONE of the leaving page
// off the top of the stack. The incoming page is therefore already there beneath
// the departing one — not rendered after it leaves. The clone is appended to the
// phone frame (`.mobile-demo-frame`, position:relative/overflow:hidden) so it
// stays clipped to the phone card and paints above the freshly-mounted route.

const DURATION_MS = 340;
// iOS-ish ease-out so the page decelerates into place.
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// "Skip the next enter animation" latch. When a leaf/node page exits, it mounts
// the destination beneath the departing clone (see `exit` below). If that
// destination is itself a leaf/node page, it must appear ALREADY in place
// (static) rather than playing its own slide-in over the clone — otherwise you
// see two pages animating at once. `exit` arms this latch right before
// navigating; the destination reads it in its render (so it appears static).
//
// Clearing is tied to React's commit cycle (NOT a wall-clock timer — the
// navigation commit can land a frame or two after the click, so a setTimeout(0)
// would clear too early): `clearSkipNextEnter()` is called from `Layout`'s
// pathname effect, which runs AFTER the destination's render on the same
// navigation (parent effects run after child renders), and also resets the latch
// after a forward navigation to a non-sliding destination so it never bleeds.
let skipNextEnter = false;
export function armSkipNextEnter() {
    skipNextEnter = true;
}
export function clearSkipNextEnter() {
    skipNextEnter = false;
}

/**
 * Freeze the departing clone on the frame the live page was showing (animations and canvases).
 *
 * `cloneNode` copies the DOM, not its running animations: every CSS animation inside
 * the clone starts over from 0% the moment it is inserted. Without this, the exit
 * replays the leaving page's entrance (acp's card dock stagger and label fades, the
 * cards' levitate bob from the top of its cycle) inside the shrinking circle / sliding
 * page, so the transition is no longer the only thing moving.
 *
 * Each clone animation is matched to the live element at the same tree position (the
 * clone is structurally identical, so `querySelectorAll("*")` order pairs them) by
 * `animationName` + pseudo-element, jumped to that animation's `currentTime` and
 * paused. A clone animation with no live counterpart had already finished on the page
 * (fill none — no longer listed by `getAnimations`), so it is finished too; an infinite
 * one cannot finish and is just paused. Must run AFTER the clone is in the document
 * (its animations only exist once styles resolve on it).
 *
 * Also copies each live <canvas> bitmap onto its blank copy, and each scrolled box's
 * scroll offset (see below).
 *
 * Used by: `exit` below (the slide and the circle) and src/hooks/pageDash.ts → runPageDash
 * (the dash). Docs: docs/LEAF_NODE_PAGES.md.
 */
export function freezeClone(original: HTMLElement, clone: HTMLElement): void {
    const originals: Element[] = [original, ...Array.from(original.querySelectorAll("*"))];
    const cloneByIndex: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))];
    const cloneIndex = new Map<Element, number>();
    cloneByIndex.forEach((el, i) => cloneIndex.set(el, i));

    // `cloneNode` also copies a <canvas> blank (its bitmap is not part of the DOM), so
    // drawn content (the Writing Notebook's cell editor ink, the writing-grid game) would
    // vanish for the whole exit. Paint each live canvas onto its copy.
    originals.forEach((liveEl, i) => {
        if (!(liveEl instanceof HTMLCanvasElement)) return;
        const copy = cloneByIndex[i];
        if (!(copy instanceof HTMLCanvasElement) || liveEl.width === 0 || liveEl.height === 0) return;
        try {
            copy.getContext("2d")?.drawImage(liveEl, 0, 0);
        } catch {
            // A tainted or lost context: the copy just stays blank.
        }
    });

    // `cloneNode` does not copy scroll offsets either: a scrolled box (the Deck Tower's
    // tower scroller, a long list) would snap back to its top inside the clone. Copy them.
    originals.forEach((liveEl, i) => {
        if (liveEl.scrollTop === 0 && liveEl.scrollLeft === 0) return;
        const copy = cloneByIndex[i];
        if (!copy) return;
        copy.scrollTop = liveEl.scrollTop;
        copy.scrollLeft = liveEl.scrollLeft;
    });

    if (typeof clone.getAnimations !== "function") return;

    // The live page's animations, by element.
    const liveByElement = new Map<Element, Animation[]>();
    for (const a of original.getAnimations({ subtree: true })) {
        const target = (a.effect as KeyframeEffect | null)?.target;
        if (!target) continue;
        const list = liveByElement.get(target) ?? [];
        list.push(a);
        liveByElement.set(target, list);
    }

    const nameOf = (a: Animation) => (a as Partial<CSSAnimation>).animationName;
    const pseudoOf = (a: Animation) => (a.effect as KeyframeEffect | null)?.pseudoElement ?? null;

    for (const a of clone.getAnimations({ subtree: true })) {
        try {
            const target = (a.effect as KeyframeEffect | null)?.target;
            const i = target ? cloneIndex.get(target) : undefined;
            const liveEl = i != null ? originals[i] : undefined;
            const live = liveEl
                ? liveByElement.get(liveEl)?.find((l) => nameOf(l) === nameOf(a) && pseudoOf(l) === pseudoOf(a))
                : undefined;
            if (live && live.currentTime != null) {
                a.currentTime = live.currentTime;
                a.pause();
            } else if (a.effect?.getComputedTiming().iterations === Infinity) {
                a.pause();
            } else {
                a.finish();
            }
        } catch {
            // A single stubborn animation must never break the exit.
            a.pause();
        }
    }
}

interface UsePageSlideOptions {
    axis: "x" | "y";
}

interface UsePageSlideResult {
    // Attach to the absolutely-positioned page surface (leaf-page / node-page).
    surfaceRef: RefObject<HTMLDivElement | null>;
    // Spread onto that surface for the enter transition.
    style: CSSProperties;
    // Call from the back-arrow handler: navigates (via performNavigate, which
    // mounts the destination beneath) while sliding a clone of this page away — or,
    // with `circleTo` (a viewport point), shrinking it into a circle closing onto that
    // point (the circle transition's exit, src/utils/pageTransition.ts → CIRCLE_MOTION).
    // (The dash's exit is not here: NodePage calls src/hooks/pageDash.ts directly.)
    exit: (performNavigate: () => void, circleTo?: ScreenPoint) => void;
}

export function usePageSlide({ axis }: UsePageSlideOptions): UsePageSlideResult {
    const offscreen = axis === "x" ? "translateX(100%)" : "translateY(100%)";
    const onscreen = axis === "x" ? "translateX(0%)" : "translateY(0%)";

    const surfaceRef = useRef<HTMLDivElement | null>(null);

    // false = off-screen (pre-enter), true = in place. If we were reached as the
    // destination of another page's exit, start ALREADY in place (no enter
    // animation) so we sit statically beneath the departing page.
    //
    // Also start in place on a POP (Back, from any source). The arrow's own `exit` arms
    // the latch anyway, but the browser button and iOS's edge swipe do not go through
    // `exit` at all — and a page returned to with Back must not slide in again from the
    // right after the browser has already animated back to it. On iOS that second slide
    // also stops the page from matching Safari's swipe snapshot, which stalls input for
    // seconds. A POP is also the initial load,
    // where no entrance slide is wanted either.
    const navigationType = useNavigationType();
    const [entered, setEntered] = useState(() => skipNextEnter || navigationType === "POP");

    // Flip to in-place on the frame after first paint so the enter transition
    // runs — unless we already started in place (the skip-enter case above).
    useEffect(() => {
        if (entered) return;
        const id = requestAnimationFrame(() => setEntered(true));
        return () => cancelAnimationFrame(id);
        // Run once on mount; `entered`'s initial value decides whether to animate.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const exit = useCallback(
        (performNavigate: () => void, circleTo?: ScreenPoint) => {
            const el = surfaceRef.current;
            if (!el || (circleTo && (prefersReducedMotion() || typeof el.animate !== "function"))) {
                performNavigate();
                return;
            }
            // Anchor the clone to the phone frame so it stays clipped to the card. The
            // clone is `position: absolute`, so the frame MUST stay positioned: parked
            // against a static ancestor it resolves against the initial containing block
            // and slides across the whole browser window on desktop, where the frame is a
            // 402px card. Same trap as the sheet portal — see src/components/overlayHost.ts.
            const frame = (el.closest(".mobile-demo-frame")
                ?? el.parentElement) as HTMLElement | null;
            const clone = el.cloneNode(true) as HTMLElement;
            Object.assign(clone.style, {
                position: "absolute",
                inset: "0",
                margin: "0",
                transform: onscreen,
                transition: circleTo ? "none" : `transform ${DURATION_MS}ms ${EASING}`,
                pointerEvents: "none",
                // Above the freshly-mounted destination route.
                zIndex: "50",
            } satisfies Partial<CSSStyleDeclaration>);
            frame?.appendChild(clone);
            // Hold the clone still: only the exit itself (slide / circle) may move.
            freezeClone(el, clone);

            if (circleTo) {
                // The circle exit: the clone stays put and is clipped to a circle closing
                // onto `circleTo`. The clip is in the clone's own px, so the viewport point
                // is shifted into the frame's box (the phone card on desktop).
                armSkipNextEnter();
                performNavigate();
                const box = (frame ?? clone).getBoundingClientRect();
                const at = { x: circleTo.x - box.left, y: circleTo.y - box.top };
                const r = circleCoverRadius(at, { left: 0, top: 0, width: box.width, height: box.height });
                const shrink = clone.animate([{ clipPath: circleClip(at, r) }, { clipPath: circleClip(at, 0) }], {
                    duration: CIRCLE_MOTION.ms,
                    easing: CIRCLE_MOTION.shrinkEasing,
                    fill: "forwards",
                });
                shrink.finished.catch(() => {}).finally(() => clone.remove());
                return;
            }

            // Mount the destination NOW (underneath the clone). Arm the skip-enter
            // latch first so a leaf/node destination appears static beneath the
            // departing clone instead of animating its own entrance.
            armSkipNextEnter();
            performNavigate();

            // Next frames: slide the clone off-screen to reveal the destination.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    clone.style.transform = offscreen;
                });
            });
            // Drop the clone once it has slid away.
            window.setTimeout(() => clone.remove(), DURATION_MS + 60);
        },
        [offscreen, onscreen]
    );

    const style: CSSProperties = {
        transform: entered ? onscreen : offscreen,
        transition: `transform ${DURATION_MS}ms ${EASING}`,
        willChange: "transform",
    };

    return { surfaceRef, style, exit };
}

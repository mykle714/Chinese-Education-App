import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties, RefObject } from "react";

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

interface UsePageSlideOptions {
    axis: "x" | "y";
}

interface UsePageSlideResult {
    // Attach to the absolutely-positioned page surface (leaf-page / node-page).
    surfaceRef: RefObject<HTMLDivElement | null>;
    // Spread onto that surface for the enter transition.
    style: CSSProperties;
    // Call from the back-arrow handler: navigates (via performNavigate, which
    // mounts the destination beneath) while sliding a clone of this page away.
    exit: (performNavigate: () => void) => void;
}

export function usePageSlide({ axis }: UsePageSlideOptions): UsePageSlideResult {
    const offscreen = axis === "x" ? "translateX(100%)" : "translateY(100%)";
    const onscreen = axis === "x" ? "translateX(0%)" : "translateY(0%)";

    const surfaceRef = useRef<HTMLDivElement | null>(null);

    // false = off-screen (pre-enter), true = in place. If we were reached as the
    // destination of another page's exit, start ALREADY in place (no enter
    // animation) so we sit statically beneath the departing page.
    const [entered, setEntered] = useState(() => skipNextEnter);

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
        (performNavigate: () => void) => {
            const el = surfaceRef.current;
            if (!el) {
                performNavigate();
                return;
            }
            // Anchor the clone to the phone frame so it stays clipped to the card.
            const frame = (el.closest(".mobile-demo-frame") as HTMLElement | null) ?? el.parentElement;
            const clone = el.cloneNode(true) as HTMLElement;
            Object.assign(clone.style, {
                position: "absolute",
                inset: "0",
                margin: "0",
                transform: onscreen,
                transition: `transform ${DURATION_MS}ms ${EASING}`,
                pointerEvents: "none",
                // Above the freshly-mounted destination route.
                zIndex: "50",
            } satisfies Partial<CSSStyleDeclaration>);
            frame?.appendChild(clone);

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

import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { armSkipNextEnter } from "./usePageSlide";
import {
    CIRCLE_MOTION,
    circleClip,
    circleCoverRadius,
    prefersReducedMotion,
    routeSlideDir,
    supportsViewTransitions,
    type ScreenPoint,
} from "../utils/pageTransition";

// Navigate INTO a leaf/node page so the destination slides OVER the current page
// (which the browser holds beneath as a view-transition snapshot). See
// docs/LEAF_NODE_PAGES.md and src/utils/pageTransition.ts for the CSS.
//
// We drive the View Transitions API manually (this app uses the component
// `<BrowserRouter>` + `<Routes>`, so React Router's `<Link viewTransition>` doesn't
// fire one). `startViewTransition` snapshots the old page, runs the callback —
// where `flushSync` forces React to commit the navigation synchronously so the new
// DOM exists before the snapshot is taken — then animates old→new per the
// `data-vt-dir` CSS. The skip-enter latch makes the new page mount in its final
// position so its own usePageSlide enter doesn't double-offset the snapshot.
export function useSlideNavigate() {
    const navigate = useNavigate();
    return useCallback(
        // `replace` swaps the current history entry instead of pushing a new one. Use
        // it when the current page has just been CONSUMED by a one-shot action (sending
        // or accepting a challenge): leaving it on the stack lets Back return to a form
        // whose button would fire the same action a second time.
        //
        // `circleFrom` swaps the slide for the CIRCLE transition (pageTransition.ts →
        // CIRCLE_MOTION): the destination is revealed in a circle growing out of that
        // viewport point, over the held old page. The VT pseudo-elements are animated
        // from JS once the transition is ready, since the point is only known at the tap.
        (to: string, options?: { state?: unknown; replace?: boolean; circleFrom?: ScreenPoint }) => {
            const { circleFrom, ...navOptions } = options ?? {};
            if (circleFrom) {
                if (!supportsViewTransitions() || prefersReducedMotion()) {
                    navigate(to, navOptions);
                    return;
                }
                document.documentElement.dataset.vtDir = "circle";
                armSkipNextEnter();
                const transition = document.startViewTransition(() => {
                    flushSync(() => {
                        navigate(to, navOptions);
                    });
                });
                const viewport = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
                const r = circleCoverRadius(circleFrom, viewport);
                transition.ready
                    .then(() => {
                        document.documentElement.animate(
                            { clipPath: [circleClip(circleFrom, 0), circleClip(circleFrom, r)] },
                            { duration: CIRCLE_MOTION.ms, easing: CIRCLE_MOTION.growEasing, pseudoElement: "::view-transition-new(root)" },
                        );
                    })
                    // A skipped transition (another one started) just navigates — nothing to clip.
                    .catch(() => {});
                return;
            }
            const dir = routeSlideDir(to);
            if (!dir || !supportsViewTransitions()) {
                navigate(to, navOptions);
                return;
            }
            document.documentElement.dataset.vtDir = dir;
            armSkipNextEnter();
            document.startViewTransition(() => {
                flushSync(() => {
                    navigate(to, navOptions);
                });
            });
        },
        [navigate]
    );
}

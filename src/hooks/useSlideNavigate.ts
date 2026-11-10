import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { armSkipNextEnter } from "./usePageSlide";
import { runPageDash } from "./pageDash";
import {
    CIRCLE_MOTION,
    circleClip,
    circleCoverRadius,
    prefersReducedMotion,
    routeSlideDir,
    supportsViewTransitions,
    type DashLaunch,
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
        //
        // `dash` swaps it for the DASH transition (src/hooks/pageDash.ts): the Deck Tower's
        // world-pan camera dash, travelling RIGHT onto the destination. `from` is any
        // element inside the current page. Not a view transition — the leaving page is
        // cloned, so the destination slides in LIVE. The caller also puts the DashLaunch in
        // `state.dash` so the destination's Back can dash back (NodePage `exitDash`).
        (
            to: string,
            options?: { state?: unknown; replace?: boolean; circleFrom?: ScreenPoint; dash?: DashLaunch & { from: Element } },
        ) => {
            const { circleFrom, dash, ...navOptions } = options ?? {};
            if (dash) {
                runPageDash({ leaving: dash.from, direction: 1, lineColor: dash.lineColor, navigate: () => navigate(to, navOptions) });
                return;
            }
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

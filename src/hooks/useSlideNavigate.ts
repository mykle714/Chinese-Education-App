import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { armSkipNextEnter } from "./usePageSlide";
import { routeSlideDir, supportsViewTransitions } from "../utils/pageTransition";

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
        (to: string, options?: { state?: unknown }) => {
            const dir = routeSlideDir(to);
            if (!dir || !supportsViewTransitions()) {
                navigate(to, options);
                return;
            }
            document.documentElement.dataset.vtDir = dir;
            armSkipNextEnter();
            document.startViewTransition(() => {
                flushSync(() => {
                    navigate(to, options);
                });
            });
        },
        [navigate]
    );
}

import { useEffect } from "react";

// Pins html/body to overflow:hidden + overscroll-behavior:none for as long as the
// calling component is mounted, restoring the previous values on unmount. The app
// shell is already non-scrollable by default (src/index.css), but on mobile the
// dynamic URL bar makes body taller than the visible viewport, so a touch-drag
// anywhere can still pan/rubber-band the page unless this is pinned explicitly.
// Used by both Reader surfaces (the document list and an open document) so
// neither one lets a drag escape into a page-level scroll/bounce.
export function useLockBodyScroll(): void {
    useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const prev = {
            htmlOverflow: html.style.overflow,
            htmlOverscroll: html.style.overscrollBehavior,
            bodyOverflow: body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
        };
        html.style.overflow = 'hidden';
        html.style.overscrollBehavior = 'none';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';
        return () => {
            html.style.overflow = prev.htmlOverflow;
            html.style.overscrollBehavior = prev.htmlOverscroll;
            body.style.overflow = prev.bodyOverflow;
            body.style.overscrollBehavior = prev.bodyOverscroll;
        };
    }, []);
}

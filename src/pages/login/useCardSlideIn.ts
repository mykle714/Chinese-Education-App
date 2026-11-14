import { useLayoutEffect, useRef, useState } from "react";
import { useBootCover } from "../../hooks/useBootCover";
import { prefersReducedMotion } from "../../utils/pageTransition";

/** The slide's length. */
const SLIDE_MS = 600;
/** Ease-out quint: quick off the top, a long, soft settle into place. No overshoot. */
const SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Clear space between the top of the screen and the card's bottom edge when the slide starts. */
const SLIDE_START_MARGIN_PX = 16;

/**
 * The login card slides in from the top of the screen (owner, 2026-11-14: "it should just slide
 * in", not fall under gravity; docs/LOGIN_REWORK.md § 3).
 *
 * When: once per mount of the login page, as soon as the boot cover is gone. On a cold start
 * that is after the circle has fully opened onto the pawn (the card is hidden until then, so it
 * is never seen waiting in the hole); off a cold start (a mid-session expiry, a sign-out) there
 * is no cover and it slides in straight away. Step changes inside the card do not replay it.
 *
 * Returns `hidden` (true while the cover is up: keep the card invisible, not unmounted, so its
 * layout is measured), and `ref`, a CALLBACK ref for the element that slides. A callback ref
 * because the element can be replaced: off a cold start the scene's chunk may still be loading,
 * so the form first renders in renderBootScene's Suspense fallback and moves into the real scene
 * when it lands; the new element then slides (the cleanup re-arms `played`). The same re-arming
 * keeps React's dev double-run of effects from eating the slide.
 *
 * Layer: page hook (src/pages/login/). Used by src/pages/LoginPage.tsx.
 */
export function useCardSlideIn(mounted: boolean): { ref: (el: HTMLDivElement | null) => void; hidden: boolean } {
    const { up } = useBootCover();
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const played = useRef(false);

    // A layout effect, so the first painted frame after the cover goes is already the card
    // held above the screen (the animation's backwards fill), never a flash of it at rest.
    useLayoutEffect(() => {
        if (up || !mounted || !el || played.current) return;
        played.current = true;
        if (prefersReducedMotion() || typeof el.animate !== "function") return;
        // From just above the top of the screen (the login page's box) to where it rests.
        const screenTop = (el.closest(".login-page") ?? document.body).getBoundingClientRect().top;
        const fromPx = el.getBoundingClientRect().bottom - screenTop + SLIDE_START_MARGIN_PX;
        const slide = el.animate([{ transform: `translateY(${-fromPx}px)` }, { transform: "none" }], {
            duration: SLIDE_MS,
            easing: SLIDE_EASING,
            fill: "backwards",
        });
        return () => {
            slide.cancel();
            played.current = false;
        };
    }, [up, mounted, el]);

    return { ref: setEl, hidden: up };
}

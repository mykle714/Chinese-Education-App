import { useEffect } from "react";

/**
 * APP HEIGHT — the two different heights the iOS home-screen web app needs.
 *
 * WHY THIS EXISTS: `index.html` ships `apple-mobile-web-app-status-bar-style:
 * black-translucent`, the only tag that lets the page own the band behind the clock
 * (see src/theme/safeArea.ts). iOS honours it by extending the app over the full
 * screen — but it reports a LAYOUT VIEWPORT that is still `screen − status bar` tall.
 * So there are two heights, and the shell needs BOTH:
 *
 *   • `--app-height`   = `window.screen.height` — how tall the shell must be PAINTED.
 *                        This is the number that decides whether the status-bar band
 *                        shows the app's ground or a flat paper strip.
 *   • `--app-viewport` = `window.innerHeight` — how tall the shell's content may
 *                        actually BE. Anything laid out past this is off the visible
 *                        area and simply never seen.
 *
 * ── WHY BOTH, AND NOT ONE ─────────────────────────────────────────────────────────
 * Both single-number attempts shipped on 2026-09-05 and both were half right:
 *
 *   `100dvh` everywhere  → nothing is clipped, but the shell is short by the status
 *                          bar and the band behind the clock stays paper-white on a
 *                          crimson game page (observed on Bubble Match).
 *   `screen.height`      → the band matches the page, but the frame's last ~60pt —
 *     everywhere            the game panel's "drop here to cancel match" row — is
 *                          laid out past the visible area and sliced in half.
 *
 * Splitting them gets both: MobileDemoFrame is `--app-height` tall so its ground
 * reaches the band, and holds an inner viewport box `--app-viewport` tall that every
 * page, and the footer bar, lives inside. The reserved strip between the two is
 * painted frame ground and holds nothing.
 *
 * Note this is NOT the home-indicator inset. `SAFE_BOTTOM` (src/theme/safeArea.ts)
 * describes a strip the page paints and merely keeps content out of; these describe
 * the difference between what the page may paint and what it may fill. They stack.
 *
 * ── SELF-DISABLING BY CONSTRUCTION ────────────────────────────────────────────────
 * Rather than adding the status bar back by hand (a number that differs across every
 * notch/Dynamic-Island generation), the hook MEASURES the gap. Where iOS behaves — a
 * Safari tab, Android, desktop, or a future iOS that reports the full height — the two
 * numbers agree, NEITHER variable is set, and every consumer falls back to the plain
 * `100dvh` / `100%` it used before this hook existed.
 *
 * WHY IT IS SAFE TO PUBLISH A PIXEL HEIGHT: this only ever fires in the STANDALONE
 * app, which has no URL bar, so the dynamic viewport is not actually dynamic there —
 * the whole reason `dvh` exists does not apply. Rotation and any other resize
 * re-measure below.
 *
 * Consumers (keep this list current):
 *   • src/App.css — `#root`, the shell scroll container: `var(--app-height, 100dvh)`.
 *   • src/components/MobileDemoFrame.tsx — `FrameRoot` reads `--app-height` (paint),
 *     `FrameViewport` reads `--app-viewport` (layout). This is the whole point.
 *   • src/components/Layout.tsx — the non-frame shell's `minHeight` (paint only; its
 *     content flows, so it cannot be clipped by a taller box).
 *
 * NOT a consumer: `PHONE_OVERLAY_SX` (src/components/phoneGeometry.ts). Those are
 * `position: fixed` dialogs, which resolve against the layout viewport already — the
 * same box `--app-viewport` describes — so plain `100dvh` is correct there.
 *
 * Layer: presentational (a document-level side effect, like `useThemeColor`).
 * Docs: docs/UX_AND_NAVIGATION.md § Safe areas and the iOS status bar.
 */

/**
 * Largest shortfall we will correct, in CSS px. A real status bar is ~20–62px
 * depending on the device, so anything past this is not the bug this hook models
 * (a split-screen window, a browser reporting a screen from another display, a
 * device-emulation harness) and is left alone — better an unpainted strip than a
 * shell stretched hundreds of pixels, which would move the footer bar off-screen.
 */
const MAX_SHORTFALL_PX = 100;

/** True only in the iOS home-screen ("Add to Home Screen") web app. */
function isIosStandalone(): boolean {
    // `navigator.standalone` is the iOS-specific flag and is the one that matters here:
    // the split is a WebKit home-screen behaviour, not a display-mode behaviour, so
    // widening this to `matchMedia("(display-mode: standalone)")` would let an installed
    // Android PWA — which does not have the bug — into the measurement path.
    return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Publish `--app-height` and `--app-viewport` on the root element whenever iOS hands
 * the standalone app a layout viewport shorter than the screen. Renders nothing; call
 * it once, high in the tree (`App`).
 */
export function useAppHeight(): void {
    useEffect(() => {
        const root = document.documentElement;

        /** Resting state: no variables, every consumer on its plain CSS fallback. */
        const clear = () => {
            root.style.removeProperty("--app-height");
            root.style.removeProperty("--app-viewport");
        };

        const measure = () => {
            if (!isIosStandalone()) {
                clear();
                return;
            }

            const viewport = window.innerHeight;
            const screenHeight = window.screen.height;
            const shortfall = screenHeight - viewport;

            if (shortfall > 0 && shortfall <= MAX_SHORTFALL_PX) {
                root.style.setProperty("--app-height", `${screenHeight}px`);
                root.style.setProperty("--app-viewport", `${viewport}px`);
            } else {
                // iOS is behaving (shortfall 0) or reporting something we do not model
                // (> MAX_SHORTFALL_PX). Either way, hand the shell back to `100dvh`.
                clear();
            }
        };

        measure();

        // Rotation changes both numbers, and iOS fires `resize` late relative to
        // `orientationchange`, so listen to both and let the idempotent measure settle
        // it. Deliberately NOT listening to `visualViewport` resize: that fires when the
        // keyboard opens, and both numbers we read (the LAYOUT viewport and the screen)
        // are unchanged by the keyboard.
        window.addEventListener("resize", measure);
        window.addEventListener("orientationchange", measure);
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("orientationchange", measure);
        };
    }, []);
}

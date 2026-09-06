import { useEffect } from "react";

/**
 * APP HEIGHT — the shell's true full-screen height in the iOS home-screen web app.
 *
 * WHY THIS EXISTS: `index.html` ships `apple-mobile-web-app-status-bar-style:
 * black-translucent`, which is the only way the page can paint the band behind the
 * clock (see src/theme/safeArea.ts). iOS honours it by moving the web view's ORIGIN to
 * y=0 — but on the standalone web app it does NOT grow the web view's HEIGHT to match.
 * The layout viewport stays `screen height − status bar height`, so `100dvh` computes
 * SHORT by exactly the status bar, and a strip that size at the BOTTOM of the screen is
 * never painted by the page at all — it shows through as black on every page, whatever
 * that page's ground is. (Found 2026-09-05, immediately after the status-bar fix
 * landed: the top band started matching and an identically-sized band appeared at the
 * base.)
 *
 * Note this is NOT the home-indicator inset. `SAFE_BOTTOM` (src/theme/safeArea.ts)
 * describes a strip the page DOES paint and merely has to keep content out of; this is
 * a strip the page cannot reach. The two stack: the footer bar still grows by
 * `SAFE_BOTTOM` inside the height this hook restores.
 *
 * ── THE FIX IS MEASURED, NOT ASSUMED ──────────────────────────────────────────────
 * Rather than adding the status-bar height back by hand (a number that differs across
 * every notch/Dynamic-Island generation), the hook compares the layout viewport to the
 * physical screen and publishes the larger as `--app-height`. When iOS behaves — a
 * Safari tab, Android, a desktop browser, or a future iOS that grows the web view — the
 * two agree and the variable is never set at all, so every consumer falls back to plain
 * `100dvh` and nothing changes. It is self-disabling by construction.
 *
 * WHY IT IS SAFE TO PUBLISH A PIXEL HEIGHT: this only ever fires in the STANDALONE app,
 * which has no URL bar, so the dynamic viewport is not actually dynamic there — the
 * whole reason `dvh` exists does not apply. In a browser tab the variable stays unset
 * and `dvh` keeps doing its job. Rotation and any other resize re-measure below.
 *
 * Consumers (keep this list current) — all read `var(--app-height, 100dvh)`:
 *   • src/App.css — `#root`, the shell scroll container.
 *   • src/components/MobileDemoFrame.tsx — `FrameRoot`, the phone surface.
 *   • src/components/phoneGeometry.ts — `PHONE_OVERLAY_SX`, the full-bleed sheet box.
 *   • src/components/Layout.tsx — the non-frame (plain) shell's `minHeight`.
 *
 * Layer: presentational (a document-level side effect, like `useThemeColor`).
 * Docs: docs/UX_AND_NAVIGATION.md § Safe areas and the iOS status bar.
 */

/**
 * Largest shortfall we will correct, in CSS px. A real status bar is ~20–62px
 * depending on the device, so anything past this is not the bug this hook models
 * (a split-screen window, a browser reporting a screen from another display, a
 * device-emulation harness) and is left alone — better a strip of black than a shell
 * stretched hundreds of pixels past the viewport, which would push the footer bar
 * off-screen on every page.
 */
const MAX_SHORTFALL_PX = 100;

/** True only in the iOS home-screen ("Add to Home Screen") web app. */
function isIosStandalone(): boolean {
    // `navigator.standalone` is the iOS-specific flag and is the one that matters here:
    // the shortfall is a WebKit home-screen behaviour, not a display-mode behaviour, so
    // widening this to `matchMedia("(display-mode: standalone)")` would let an installed
    // Android PWA — which does not have the bug — into the measurement path.
    return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Publish `--app-height` on the root element whenever iOS hands the standalone app a
 * layout viewport shorter than the screen. Renders nothing; call it once, high in the
 * tree (`App`).
 */
export function useAppHeight(): void {
    useEffect(() => {
        const root = document.documentElement;

        const measure = () => {
            // Not the standalone app → the shortfall cannot happen. Clear any value a
            // previous measurement left behind rather than leaving a stale px height
            // pinned (this branch is reachable on nothing today, but a cleared variable
            // is the correct resting state and costs one call).
            if (!isIosStandalone()) {
                root.style.removeProperty("--app-height");
                return;
            }

            const viewport = window.innerHeight;
            const screenHeight = window.screen.height;
            const shortfall = screenHeight - viewport;

            if (shortfall > 0 && shortfall <= MAX_SHORTFALL_PX) {
                root.style.setProperty("--app-height", `${screenHeight}px`);
            } else {
                // iOS is behaving (shortfall 0) or reporting something we do not model
                // (> MAX_SHORTFALL_PX). Either way, hand the shell back to `100dvh`.
                root.style.removeProperty("--app-height");
            }
        };

        measure();

        // Rotation changes both numbers, and iOS fires `resize` late relative to
        // `orientationchange`, so listen to both and let the idempotent measure settle
        // it. `visualViewport` resize also fires when the keyboard opens — measuring
        // again there is harmless because we read `window.innerHeight` (the LAYOUT
        // viewport), which the keyboard does not change.
        window.addEventListener("resize", measure);
        window.addEventListener("orientationchange", measure);
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("orientationchange", measure);
        };
    }, []);
}

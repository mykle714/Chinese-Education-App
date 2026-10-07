import { useEffect } from "react";

/**
 * APP HEIGHT — the real height of the iOS home-screen web view, in px.
 *
 * WHY THIS EXISTS: `index.html` ships `apple-mobile-web-app-status-bar-style:
 * black-translucent`, the only tag that lets the page own the band behind the clock
 * (see src/theme/safeArea.ts). iOS honours it by extending the web view over the FULL
 * screen — but it leaves the document's INITIAL CONTAINING BLOCK at the old
 * `screen − statusBar`. So every CSS length that resolves against the viewport comes
 * up short by exactly `safe-area-inset-top`, and the shell stops short of the bottom
 * of the screen.
 *
 * Measured on an iPhone 15 (2026-09-13), standalone, via a device probe:
 *
 *   screen.height ................ 852   ← the web view's true height
 *   documentElement.clientHeight .. 793   ← the ICB: 852 − 59
 *   safe-area-inset-top ........... 59
 *   100vh / 100dvh / 100lvh / 100% . 793 or 852, NOT STABLE (see below)
 *
 * The bottom 59px are genuinely on screen — a probe painted them and they showed,
 * with the home indicator sitting inside them. They were simply never painted,
 * because `index.css` pins `html, body { height: 100%; overflow: hidden }`: body
 * resolved to the 793 ICB and CLIPPED the correctly-sized shell. That is why every
 * earlier attempt moved the problem instead of fixing it — the size was applied to
 * `#root` but the element doing the clipping was `body`.
 *
 * ── WHY A JS PX VALUE AND NOT A CSS UNIT ──────────────────────────────────────────
 * Because no CSS unit can express it. The probe measured every candidate:
 *
 *   100svh, 100%, ICB .......... 793  — always short
 *   100vh, 100dvh, 100lvh ...... 793 in one page load, 852 in the next, SAME CSS
 *   calc(100dvh + safe-top) .... 911  — overshoots when dvh has settled at 852
 *
 * `window.innerHeight` is equally unreliable: it read 852 in two probe rounds and 793
 * in another, with no CSS difference between them. Only `screen.height` (852) and
 * `documentElement.clientHeight` (793) were stable across every round, so the gap is
 * measured from THOSE two and published as a plain px value that no viewport
 * weirdness can re-resolve.
 *
 * ⚠️ DO NOT reintroduce a guard based on `window.innerHeight` (the pre-2026-09-13
 * version used `screen.height - innerHeight`). It reports the correct 852 often
 * enough that the guard computes a 0 gap, clears the variable, and the bug silently
 * comes back on the next load.
 *
 * ── SELF-DISABLING BY CONSTRUCTION ────────────────────────────────────────────────
 * Rather than adding the status bar back by hand (a number that differs across every
 * notch/Dynamic-Island generation), the hook MEASURES the gap. Where there is none —
 * a Safari tab, Android, desktop, a non-notched device, or a future iOS that reports
 * a full-height ICB — the two numbers agree, the variable is NOT set, and every
 * consumer falls back to the plain `100%` / `100dvh` it used before this hook existed.
 *
 * WHY IT IS SAFE TO PUBLISH A PIXEL HEIGHT: this only ever fires in the STANDALONE
 * app, which has no URL bar, so the dynamic viewport is not actually dynamic there —
 * the whole reason `dvh` exists does not apply. Rotation and any other resize
 * re-measure below.
 *
 * Consumers (keep this list current):
 *   • src/index.css — `html, body`: THE IMPORTANT ONE. Without it body clips the
 *     shell at the ICB and nothing else matters.
 *   • src/App.css — `#root`, the shell scroll container.
 *   • src/components/MobileDemoFrame.tsx — `FrameRoot`.
 *   • src/components/Layout.tsx — the non-frame shell's `minHeight`.
 *
 * NOT a consumer: `PHONE_OVERLAY_SX` (src/components/phoneGeometry.ts), which still sizes
 * its full-screen dialog papers in `100dvh`. ⚠️ The reason this note used to give — those
 * dialogs are `position: fixed` against the layout viewport — stopped being true on
 * 2026-10-06: every MUI Dialog now mounts INSIDE the frame with an `absolute` root
 * (ThemeContext → `MuiDialog`), so the root is the frame's `--app-height` tall while the
 * paper is `100dvh`. The BACKDROP still covers the whole frame (it is `inset: 0` on the
 * root); only the paper's chrome could sit short in the iOS standalone app. Unverified
 * on a device.
 *
 * Layer: presentational (a document-level side effect, like `useThemeColor`).
 * Docs: docs/UX_AND_NAVIGATION.md § Safe areas and the iOS status bar.
 */

/**
 * Largest gap we will correct, in CSS px. A real status bar is ~20–62px depending on
 * the device, so anything past this is not the bug this hook models (a landscape
 * orientation where `screen.height` is still the PORTRAIT height, a split-screen
 * window, a browser reporting a screen from another display, a device-emulation
 * harness) and is left alone — better an unpainted strip than a shell stretched
 * hundreds of pixels, which would move the footer bar off-screen.
 */
const MAX_GAP_PX = 100;

/**
 * How far the measured gap may differ from `env(safe-area-inset-top)` and still count as
 * "the gap IS the status bar". On the iPhone 15 the two agreed exactly (59 = 59); the
 * slack only absorbs sub-pixel rounding between the two readings.
 */
const INSET_MATCH_TOLERANCE_PX = 2;

/**
 * Resolve `env(safe-area-inset-top)` to px. `env()` is only resolvable by the browser,
 * so a throwaway element is sized with it and measured. (Reading it back through a
 * custom property is not reliable: WebKit may hand back the unsubstituted `env(...)`
 * string.) Returns 0 wherever the inset is unsupported.
 */
function measureSafeTop(): number {
    const probe = document.createElement("div");
    probe.style.cssText =
        "position:absolute;top:0;left:0;width:0;visibility:hidden;pointer-events:none;" +
        "height:env(safe-area-inset-top, 0px)";
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
}

/** True only in the iOS home-screen ("Add to Home Screen") web app. */
function isIosStandalone(): boolean {
    // `navigator.standalone` is the iOS-specific flag and is the one that matters here:
    // the gap is a WebKit home-screen behaviour, not a display-mode behaviour, so
    // widening this to `matchMedia("(display-mode: standalone)")` would let an installed
    // Android PWA — which does not have the bug — into the measurement path. The probe
    // also confirmed the two disagree here: `navigator.standalone` was true while
    // `(display-mode: standalone)` matched FALSE in the very same web view.
    return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Publish `--app-height` on the root element whenever the iOS standalone web view is
 * taller than the document's initial containing block. Renders nothing; call it once,
 * high in the tree (`App`).
 */
export function useAppHeight(): void {
    useEffect(() => {
        const root = document.documentElement;

        /** Resting state: no variable, every consumer on its plain CSS fallback. */
        const clear = () => {
            root.style.removeProperty("--app-height");
        };

        const measure = () => {
            if (!isIosStandalone()) {
                clear();
                return;
            }

            // Both readings are stable in this mode; `innerHeight` deliberately is not
            // consulted (see the ⚠️ above).
            const webViewHeight = window.screen.height;
            const containingBlock = root.clientHeight;
            const gap = webViewHeight - containingBlock;

            // The gap is only the black-translucent bug when it IS the status bar, i.e.
            // when the web view really extends under the clock. A LETTERBOXED web view
            // (an icon installed while the tag was still `default` — iOS snapshots it at
            // install — or any iOS that ignores black-translucent) shows the same
            // `screen − statusBar` gap, but there the web view genuinely IS the short
            // height, and `env(safe-area-inset-top)` is 0. Stretching the shell to
            // `screen.height` there pushes its bottom ~60pt off screen: the flp More Info
            // pill sliced at the bottom edge, reported on an iPhone 18 Pro 2026-10-06.
            const gapIsStatusBar = Math.abs(gap - measureSafeTop()) <= INSET_MATCH_TOLERANCE_PX;

            if (gap > 0 && gap <= MAX_GAP_PX && gapIsStatusBar) {
                root.style.setProperty("--app-height", `${webViewHeight}px`);
            } else {
                // No gap (iOS behaving), one we do not model (> MAX_GAP_PX, e.g.
                // landscape), or a letterboxed web view (gap ≠ the top inset). In every
                // case, hand the shell back to its CSS fallback.
                clear();
            }
        };

        measure();

        // Rotation changes both numbers, and iOS fires `resize` late relative to
        // `orientationchange`, so listen to both and let the idempotent measure settle
        // it. Deliberately NOT listening to `visualViewport` resize: that fires when the
        // keyboard opens, and neither number we read is changed by the keyboard.
        window.addEventListener("resize", measure);
        window.addEventListener("orientationchange", measure);
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("orientationchange", measure);
        };
    }, []);
}

// SAFE-AREA TOKENS — the strips of screen the OS owns.
//
// WHY THIS EXISTS: `index.html` ships `viewport-fit=cover` AND
// `apple-mobile-web-app-status-bar-style: black-translucent`, so the web view now paints
// EDGE TO EDGE — under the iPhone's status bar (clock/battery) at the top and under the
// home indicator at the bottom. That is the only way the app can control the colour of
// the band behind the clock. It takes BOTH tags: with the status-bar style left at
// `default`, iOS letterboxes the home-screen web app below an opaque OS-painted bar
// whatever `viewport-fit` says, these two `env()` values resolve to 0px, and the band
// is filled from the document background captured at LAUNCH. Nothing the page did
// afterwards — including `<meta name="theme-color">`, see src/hooks/useThemeColor.ts —
// could reach it, which is why a saturated game ground sat under a paper-white strip.
// (2026-09-05: `cover` alone shipped first and did NOT fix it; the style tag was the
// missing half.)
//
// The trade this makes: painting the strip is now the page's job, and so is keeping
// content out from under it. These two constants are that second half. They are CSS
// STRINGS, not numbers, because `env()` is only resolvable by the browser (its value
// depends on the device, the orientation and whether the app is standalone), so any
// geometry that mixes them with our own px must be a `calc()`.
//
// Both carry an explicit `0px` fallback so every non-notched surface — desktop, the
// phone-card frame, Android, a browser too old for `env()` — computes to exactly the
// geometry the design specifies, unchanged.
//
// Consumers (keep this list current):
//   • src/components/PageHeader.tsx — top inset, added to the header's own top padding.
//     Every header in the app funnels through it (hub / node / dense / leaf).
//   • src/components/MobileFooter.tsx — bottom inset: the bar grows by it and pads its
//     labels off the home indicator; the spacers reserve it.
//   • src/components/MobileTabScreen.tsx — the scroll area's bottom reservation and the
//     bottom edge-fade band, both of which are measured off the footer bar.
//   • src/components/FooterPresenter.tsx — the bar's hide travel, which must clear the
//     grown bar or it peeks back above the bottom edge.
//
// ⚠️ THE OTHER THING black-translucent COSTS — NOT THESE INSETS' JOB. It also leaves
// the document's INITIAL CONTAINING BLOCK at the pre-cover height: the web view covers
// the whole screen (852pt on an iPhone 15) while every CSS length that resolves against
// the viewport — `100%`, `100vh`, `100dvh`, `100svh`, `100lvh` — comes back 59pt short,
// i.e. exactly `env(safe-area-inset-top)`. Left uncorrected, the shell stops 59pt above
// the bottom of the screen and that strip is painted by nobody.
//
// The correction is `--app-height` (src/hooks/useAppHeight.ts): the web view's real
// height in px, measured as `screen.height - documentElement.clientHeight`, applied to
// `html, body` (src/index.css), `#root` (src/App.css), `FrameRoot` and `Layout`.
// Applying it to `html, body` is the load-bearing part — body is `overflow: hidden`, so
// it clips everything below it at its own height no matter how correctly those are
// sized. Three earlier rounds sized `#root` and the frame correctly and still shipped
// the strip, because body was still 59pt short and quietly slicing them.
//
// ⛔ A PREVIOUS VERSION OF THIS COMMENT TOLD YOU TO SPLIT THIS INTO TWO NUMBERS — a
// paint height and a shorter layout height, with a reserved strip in between. That was
// wrong and the reserved strip WAS the bug's bottom half. A device probe (2026-09-13)
// painted the region beyond the containing block and it showed on screen, with the home
// indicator inside it: those pixels are fully visible and fully ours. There is one
// height, not two. Details and the full attempt log: docs/IOS_STATUS_BAR_BUG.md.
//
// This is distinct from SAFE_TOP / SAFE_BOTTOM, which describe strips the page DOES
// paint and merely has to keep content out of. They stack.
//
// Docs: docs/UX_AND_NAVIGATION.md § Safe areas and the iOS status bar.

/** Height of the OS strip at the TOP of the screen (status bar / notch), or 0px. */
export const SAFE_TOP = "env(safe-area-inset-top, 0px)";

/** Height of the OS strip at the BOTTOM of the screen (home indicator), or 0px. */
export const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";

// SAFE-AREA TOKENS — the strips of screen the OS owns.
//
// WHY THIS EXISTS: `index.html` ships `viewport-fit=cover`, so the web view now paints
// EDGE TO EDGE — under the iPhone's status bar (clock/battery) at the top and under the
// home indicator at the bottom. That is the only way the app can control the colour of
// the band behind the clock: before `cover`, the web view was letterboxed inside the
// safe area and iOS painted the letterbox itself, from the document background it
// captured when the home-screen web app LAUNCHED. Nothing the page did afterwards —
// including `<meta name="theme-color">`, see src/hooks/useThemeColor.ts — could reach
// it, which is why a saturated game ground sat under a paper-white strip forever.
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
// Docs: docs/UX_AND_NAVIGATION.md § Safe areas and the iOS status bar.

/** Height of the OS strip at the TOP of the screen (status bar / notch), or 0px. */
export const SAFE_TOP = "env(safe-area-inset-top, 0px)";

/** Height of the OS strip at the BOTTOM of the screen (home indicator), or 0px. */
export const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";

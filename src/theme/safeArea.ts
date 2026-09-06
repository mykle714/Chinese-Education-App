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
// ⚠️ THE BOTTOM SHORTFALL — NOT THE ONLY THING black-translucent COSTS, AND NOT
// FIXABLE FROM CSS. It also leaves the standalone WEB VIEW ITSELF short by the status
// bar: the origin moves to y=0 but the height does not grow, so the web view is
// `screen − status bar` tall and a strip that size at the BOTTOM of the screen belongs
// to no one. It renders as the window's flat #FFFFFF backdrop on every page, whatever
// the page's ground.
//
// ⛔ DO NOT try to fix it by growing the shell to `window.screen.height`. That was
// tried on 2026-09-05 (`useAppHeight` / `--app-height`, reverted the same day) and it
// makes things strictly worse: the missing pixels are OUTSIDE the web view, so a taller
// layout cannot paint them — it only pushes the last ~60pt of every page past the web
// view's edge, where it is clipped. Measured off a Bubble Match screenshot on a 393×852
// device: page content ran to 791pt, the white strip was 61pt, and the game panel's
// bottom hint was cut in half. The white strip stayed exactly where it was.
//
// This is distinct from SAFE_BOTTOM, which describes a strip the page DOES paint and
// merely has to keep content out of. They stack.
//
// Docs: docs/UX_AND_NAVIGATION.md § Safe areas and the iOS status bar.

/** Height of the OS strip at the TOP of the screen (status bar / notch), or 0px. */
export const SAFE_TOP = "env(safe-area-inset-top, 0px)";

/** Height of the OS strip at the BOTTOM of the screen (home indicator), or 0px. */
export const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";

import { Suspense, createElement, lazy } from "react";
import { Box } from "@mui/material";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { ConfirmationProvider } from "./contexts/ConfirmationContext";
import { ThemeContextProvider } from "./contexts/ThemeContext";
import { VocabularyUpdateProvider } from "./contexts/VocabularyUpdateContext";
import BeginnerKeyboardProvider from "./features/beginnerKeyboard/BeginnerKeyboardProvider";
import FocusEndedNoticeHost from "./features/focusMode/FocusEndedNoticeHost";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { APP_ROUTES, type AppRoute } from "./routes/registry";
import { useAppHeight } from "./hooks/useAppHeight";
import { useBlockZoom } from "./hooks/useBlockZoom";
import { useChineseFont } from "./hooks/useChineseFont";
import { useWeatherPrefetch } from "./hooks/useWeatherPrefetch";
import { BootCoverProvider, BootRouteMounted } from "./components/bootCover/BootCover";
import type { BootCoverRenderProps, BootSceneRenderProps } from "./hooks/useBootCover";
import { BOOT_COVER_GROUND } from "./components/bootCover/bootCoverGround";

/**
 * Render one registry row as a <Route>.
 *
 * The whole route table used to be written out inline here — 30 hand-written
 * <Route> blocks, 25 of which had to remember to pass `allowPublic`, plus four
 * comment blocks explaining why that flag was present. All of it now derives from
 * src/routes/registry.ts. See docs/ARCHITECTURE_REVIEW.md finding 4.
 */
function renderRoute(route: AppRoute) {
  // EVERY route is code-split (see src/routes/registry.ts), so every route gets a
  // Suspense boundary — unconditionally, rather than from a per-row `lazy` flag
  // that could be forgotten on a new page and would then throw at runtime.
  //
  // The fallback is intentionally null so the parent MobileDemoFrame stays visible
  // during the brief fetch instead of flashing a spinner inside the phone card.
  //
  // BootRouteMounted sits beside the page INSIDE the boundary, so it commits only once the
  // page's chunk has loaded: the boot cover's "the page underneath exists" signal
  // (src/hooks/useBootCover.ts, gate 2). Inside ProtectedRoute too, so a protected page
  // signals only once auth has let it render.
  const page = (
    <Suspense fallback={null}>
      {createElement(route.Component)}
      <BootRouteMounted />
    </Suspense>
  );

  // 'open' routes mount with no auth wrapper at all (login, register, 404).
  const element =
    route.access === "open" ? (
      page
    ) : (
      <ProtectedRoute>{page}</ProtectedRoute>
    );

  return <Route key={route.path} path={route.path} element={element} />;
}

/**
 * App-wide prefetches that need the signed-in user, so they mount INSIDE AuthProvider.
 * Renders nothing. Today: the Deck Tower's weather (useWeatherPrefetch).
 */
function AppPrefetch() {
  useWeatherPrefetch();
  return null;
}

// ── The boot cover's drawing (docs/LOGIN_REWORK.md § 1) ──────────────────────────
// Drawn with the Deck Tower's iso kit, which `src/components/` may not import, so the
// composition root hands it to the shared BootCoverProvider (docs/FRONTEND_LAYERING.md).
// LAZY: imported statically, the iso kit added ~75 kB to the main chunk. The main chunk paints
// only a plain ground in the cover's sky colour, at once, and the pawn scene lands on it.
const BootLaunchScreen = lazy(() => import("./features/deckTower/launch/BootLaunchScreen"));
// The same chunk's still scene, for the login screen (docs/LOGIN_REWORK.md Q12).
const BootSceneStill = lazy(() =>
  import("./features/deckTower/launch/BootLaunchScreen").then((m) => ({ default: m.BootSceneStill })),
);

/** The boot cover, as BootCoverProvider draws it. Module-level so its identity is stable. */
function renderBootCover(props: BootCoverRenderProps) {
  return (
    <Suspense
      fallback={<Box className="boot-cover-ground" sx={{ position: "absolute", inset: 0, backgroundColor: BOOT_COVER_GROUND }} />}
    >
      <BootLaunchScreen {...props} />
    </Suspense>
  );
}

/**
 * The launch scene at rest, as the login screen draws it (useBootScene). While the chunk loads
 * (only off a cold start, e.g. a mid-session expiry, since the cover already pulled it in), the
 * caller's content fills the whole box so the form never waits on the art.
 */
function renderBootScene({ className, children, platformCentreRef }: BootSceneRenderProps) {
  return (
    <Suspense fallback={<div className={className} style={{ position: "absolute", inset: 0 }}>{children}</div>}>
      <BootSceneStill className={className} platformCentreRef={platformCentreRef}>{children}</BootSceneStill>
    </Suspense>
  );
}

function App() {
  // App-wide: disable pinch / double-tap zoom (mobile-first UI, zoom is never
  // wanted). Complements the viewport meta in index.html, which iOS ignores.
  useBlockZoom(true);

  // App-wide: measure the gap between the screen and the document's containing block
  // in the iOS home-screen app, and publish the web view's real height as
  // `--app-height`. Must be here rather than in MobileDemoFrame — html/body and the
  // plain (non-frame) shell in Layout read the same variable, and the frame unmounts
  // on those routes.
  useAppHeight();

  // App-wide: apply the app's Chinese typeface to :root (docs/CJK_TYPEFACE_LAB.md).
  useChineseFont();

  return (
    <ThemeContextProvider>
      <AuthProvider>
        <AppPrefetch />
        <VocabularyUpdateProvider>
          <ConfirmationProvider>
            {/*
              App-wide handwriting IME (docs/BEGINNER_KEYBOARD.md § 7a). Wraps
              Layout rather than sitting beside it so its focus listener sees
              every field in the app — including ones inside portals — without
              any input having to opt in. Fields decline with
              `data-beginner-keyboard="off"`.
            */}
            <BeginnerKeyboardProvider>
              {/* The app-opening cover, played on every cold start before auth resolves
                  (docs/LOGIN_REWORK.md § 1). Layout mounts its slot in both shells. */}
              <BootCoverProvider renderCover={renderBootCover} renderScene={renderBootScene}>
                <Layout>
                  <Routes>{APP_ROUTES.map(renderRoute)}</Routes>
                </Layout>
              </BootCoverProvider>
              {/* Focus mode's "it turned itself off" popup, on whatever page is up
                  (docs/FOCUS_MODE.md § 4). */}
              <FocusEndedNoticeHost />
            </BeginnerKeyboardProvider>
          </ConfirmationProvider>
        </VocabularyUpdateProvider>
      </AuthProvider>
    </ThemeContextProvider>
  );
}

export default App;

import { Suspense, createElement } from "react";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { ConfirmationProvider } from "./contexts/ConfirmationContext";
import { ThemeContextProvider } from "./contexts/ThemeContext";
import { VocabularyUpdateProvider } from "./contexts/VocabularyUpdateContext";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { APP_ROUTES, type AppRoute } from "./routes/registry";
import { useBlockZoom } from "./hooks/useBlockZoom";

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
  const page = <Suspense fallback={null}>{createElement(route.Component)}</Suspense>;

  // 'open' routes mount with no auth wrapper at all (login, register, 404).
  const element =
    route.access === "open" ? (
      page
    ) : (
      <ProtectedRoute requireFullAccount={route.access === "account"}>{page}</ProtectedRoute>
    );

  return <Route key={route.path} path={route.path} element={element} />;
}

function App() {
  // App-wide: disable pinch / double-tap zoom (mobile-first UI, zoom is never
  // wanted). Complements the viewport meta in index.html, which iOS ignores.
  useBlockZoom(true);

  return (
    <ThemeContextProvider>
      <AuthProvider>
        <VocabularyUpdateProvider>
          <ConfirmationProvider>
            <Layout>
              <Routes>{APP_ROUTES.map(renderRoute)}</Routes>
            </Layout>
          </ConfirmationProvider>
        </VocabularyUpdateProvider>
      </AuthProvider>
    </ThemeContextProvider>
  );
}

export default App;

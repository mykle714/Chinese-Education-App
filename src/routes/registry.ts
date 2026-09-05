import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { GAME_REGISTRY } from "../games/registry";
import { ROUTE_META, type RouteMeta } from "./routeMeta";

/**
 * Binds each route in `./routeMeta` to its page component.
 *
 * ── Why this is a separate file from routeMeta.ts ──────────────────────────────
 * The route TABLE (paths, access, shell, chrome, footer tab) is read by three
 * runtime consumers — Layout, FooterPresenter and pageTransition — none of which
 * needs a single page component. Keeping the components here means those three, and
 * the unit tests, can import the table without pulling the ENTIRE page tree
 * (including Pixi, via NightMarketEnginePage) into their module graph. That import
 * weight is what made the old inline-in-App.tsx table untestable.
 *
 * It is still ONE list: `routeMeta.ts` owns every row, and this file only supplies
 * components. Building `APP_ROUTES` below THROWS at boot if a row has no component,
 * and warns in dev if a component has no row, so the two cannot silently diverge.
 *
 * ── Why EVERY route is React.lazy ──────────────────────────────────────────────
 * Games used to be the only code-split routes; the other 31 pages were static
 * imports, so a cold start parsed and executed the whole page tree — every page,
 * every MUI surface — before the first route could paint. That was the single
 * largest contributor to the 2.22 MB main chunk.
 *
 * Laziness is UNIFORM rather than per-route on purpose. A hand-maintained
 * "these ones are eager" list is exactly the kind of table that drifts (see the
 * four-table sync bug documented in routeMeta.ts), and the benefit of keeping any
 * one page eager is a single saved round trip on the entry route only. Uniformity
 * also means `RouteMeta` needs no `lazy` flag at all: `src/App.tsx` wraps every
 * route in <Suspense> unconditionally, so there is no way to mount a lazy
 * component without a boundary.
 *
 * The trade-off, stated plainly: the entry route now costs one extra request
 * after the main chunk (index → route chunk) instead of arriving inside it. If
 * measurement shows that waterfall dominates on the common landing routes, the
 * fix is a `<link rel="modulepreload">` hint or a Vite `manualChunks` grouping —
 * NOT a return to static imports.
 *
 * Only `src/App.tsx` imports this file.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 4 and
 * docs/REACT_NATIVE_MIGRATION.md § Action items, Tier 1 item 2.
 */

/** A route row plus the component that renders it. */
export interface AppRoute extends RouteMeta {
  Component: ComponentType;
}

/** What every entry in the two maps below is: a code-split page. */
type RouteComponent = LazyExoticComponent<ComponentType>;

/**
 * Component for every non-game route, keyed by the exact `path` in routeMeta.ts.
 * Game components come from GAME_REGISTRY instead.
 *
 * Each value is a `React.lazy` wrapper, so importing this module costs nothing but
 * the arrow functions — the page itself is fetched when its route first matches.
 */
const PAGE_COMPONENTS: Record<string, RouteComponent> = {
  "/": lazy(() => import("../pages/HomePage")),
  "/flashcards/decks": lazy(() => import("../features/flashcards/FlashcardsDecksPage")),
  "/discover": lazy(() => import("../features/discover/DiscoverPage")),
  "/account": lazy(() => import("../pages/AccountPage")),
  "/games": lazy(() => import("../games/GamesPage")),
  "/community": lazy(() => import("../features/community/CommunityPage")),
  "/arena": lazy(() => import("../features/arena/ArenaPage")),
  "/friends": lazy(() => import("../features/friends/FriendsPage")),
  "/friends/requests": lazy(() => import("../features/friends/IncomingRequestsPage")),
  "/friends/sent": lazy(() => import("../features/friends/SentRequestsPage")),
  "/friends/remove": lazy(() => import("../features/friends/RemoveFriendsPage")),
  // Study Challenge (docs/STUDY_CHALLENGE.md § 1) — a fourth screen under the friends
  // drill-in. STATIC PATHS FIRST: "history", "new" and "review" would all be legal
  // values for the `:challengeId` segment below. React Router ranks a static segment
  // above a dynamic one regardless of declaration order, but the order here matches the
  // server's route file, where ordering IS the guarantee.
  "/friends/challenges": lazy(() => import("../features/studyChallenge/ChallengesPage")),
  "/friends/challenges/history": lazy(() => import("../features/studyChallenge/ChallengeHistoryPage")),
  "/friends/challenges/:challengeId": lazy(() => import("../features/studyChallenge/ChallengeDetailPage")),
  "/users/:userId": lazy(() => import("../features/profile/UserProfilePage")),
  "/dictionary": lazy(() => import("../features/dictionary/DictionaryPage")),
  "/reader": lazy(() => import("../features/reader/ReaderPage")),
  // Two routes, one component — see the routeMeta.ts note on collection paths.
  "/flashcards/collection/:builtin": lazy(() => import("../features/flashcards/CollectionViewPage")),
  "/flashcards/deck/:id": lazy(() => import("../features/flashcards/CollectionViewPage")),
  "/flashcards/mastered": lazy(() => import("../features/flashcards/MasteredRedirect")),
  // Two routes, one component — the Reading and Writing Centers differ only by the
  // mastery bar the page reads its own path for (features/flashcards/masteryCenters.ts).
  "/flashcards/reading": lazy(() => import("../features/flashcards/MasteryCenterPage")),
  "/flashcards/writing": lazy(() => import("../features/flashcards/MasteryCenterPage")),
  "/reader/:id": lazy(() => import("../features/reader/ReaderDocumentPage")),
  "/flashcards/card/:id": lazy(() => import("../features/flashcards/VocabCardDetailPage")),
  "/dictionary/card/:word": lazy(() => import("../features/dictionary/DictionaryCardDetailPage")),
  "/discover/sort/:language": lazy(() => import("../features/discover/SortCardsPage")),
  "/discover/quick-mark/:language": lazy(() => import("../features/discover/QuickMarkPage")),
  "/discover/skipped/:language": lazy(() => import("../features/discover/SkippedCardsPage")),
  "/night-market": lazy(() => import("../features/nightmarket/NightMarketEnginePage")),
  "/night-market/user/:userId": lazy(() => import("../features/nightmarket/NightMarketVisitPage")),
  "/tester-dashboard": lazy(() => import("../pages/TesterDashboardPage")),
  "/settings": lazy(() => import("../pages/SettingsPage")),
  "/settings/account": lazy(() => import("../pages/AccountSecurityPage")),
  "/flashcards/learn": lazy(() => import("../features/flashcards/FlashcardsLearnPage")),
  "/night-market/template-editor": lazy(() => import("../features/nightmarket/TemplateEditorPage")),
  "/night-market/template-sandbox": lazy(() => import("../features/nightmarket/TemplateSandboxPage")),
  "/font-lab": lazy(() => import("../pages/fontLab/FontLabPage")),
  "/entries": lazy(() => import("../pages/EntriesPage")),
  "/entries/:id": lazy(() => import("../pages/EntryDetailPage")),
  "/edit/:id": lazy(() => import("../pages/EditEntryPage")),
  "/flashcards": lazy(() => import("../features/flashcards/FlashcardsPage")),
  "/profile": lazy(() => import("../pages/ProfilePage")),
  "/login": lazy(() => import("../pages/LoginPage")),
  "/register": lazy(() => import("../pages/RegisterPage")),
  "*": lazy(() => import("../pages/NotFoundPage")),
};

/** Game components, keyed by route, from the game registry. Already lazy there. */
const GAME_COMPONENTS: Record<string, RouteComponent> = Object.fromEntries(
  GAME_REGISTRY.map((g) => [g.route, g.Component])
);

/**
 * Every route, ready to mount.
 *
 * Throws at module load — i.e. at app boot, not on navigation — if a row in
 * routeMeta.ts has no component here. A missing binding would otherwise render a
 * blank page for one route, which is easy to miss.
 */
export const APP_ROUTES: AppRoute[] = ROUTE_META.map((meta) => {
  const Component = PAGE_COMPONENTS[meta.path] ?? GAME_COMPONENTS[meta.path];
  if (!Component) {
    throw new Error(
      `Route "${meta.path}" is declared in routeMeta.ts but has no component in ` +
        `routes/registry.ts. Add it to PAGE_COMPONENTS.`
    );
  }
  // `LazyExoticComponent` is structurally a component but is not assignable to
  // `ComponentType`; React renders it fine inside a Suspense boundary, which
  // App.tsx always provides.
  return { ...meta, Component: Component as unknown as ComponentType };
});

// The other direction of the same mistake: a component bound to a path that no
// longer has a row, which leaves that page unreachable. Warned rather than thrown —
// an orphan is harmless at runtime, and bricking the app over a stale map entry
// would be worse than the bug.
if (import.meta.env.DEV) {
  const orphans = Object.keys(PAGE_COMPONENTS).filter(
    (path) => !ROUTE_META.some((m) => m.path === path)
  );
  if (orphans.length > 0) {
    console.warn(
      `[routes] ${orphans.length} component(s) in routes/registry.ts have no row in ` +
        `routeMeta.ts and are unreachable: ${orphans.join(", ")}`
    );
  }
}

export type { RouteAccess, RouteChrome, RouteMeta, RouteShell } from "./routeMeta";
export { findRoute, routeChrome, routeFooterTab, routeShell, ROUTE_META } from "./routeMeta";

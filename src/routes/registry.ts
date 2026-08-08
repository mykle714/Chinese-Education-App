import type { ComponentType } from "react";
import { GAME_REGISTRY } from "../games/registry";
import { ROUTE_META, type RouteMeta } from "./routeMeta";

// Eagerly-loaded page components. Games are the only lazy ones (see GAME_REGISTRY).
import HomePage from "../pages/HomePage";
import CommunityPage from "../features/community/CommunityPage";
import FriendsPage from "../features/friends/FriendsPage";
import IncomingRequestsPage from "../features/friends/IncomingRequestsPage";
import SentRequestsPage from "../features/friends/SentRequestsPage";
import EntriesPage from "../pages/EntriesPage";
import EntryDetailPage from "../pages/EntryDetailPage";
import EditEntryPage from "../pages/EditEntryPage";
import ProfilePage from "../pages/ProfilePage";
import AccountPage from "../pages/AccountPage";
import SettingsPage from "../pages/SettingsPage";
import NotFoundPage from "../pages/NotFoundPage";
import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";
import FlashcardsPage from "../features/flashcards/FlashcardsPage";
import FlashcardsLearnPage from "../features/flashcards/FlashcardsLearnPage";
import FlashcardsDecksPage from "../features/flashcards/FlashcardsDecksPage";
import CollectionViewPage from "../features/flashcards/CollectionViewPage";
import MasteredRedirect from "../features/flashcards/MasteredRedirect";
import VocabCardDetailPage from "../features/flashcards/VocabCardDetailPage";
import ReaderPage from "../features/reader/ReaderPage";
import ReaderDocumentPage from "../features/reader/ReaderDocumentPage";
import NightMarketEnginePage from "../features/nightmarket/NightMarketEnginePage";
import TemplateEditorPage from "../features/nightmarket/TemplateEditorPage";
import TemplateSandboxPage from "../features/nightmarket/TemplateSandboxPage";
import DictionaryPage from "../features/dictionary/DictionaryPage";
import ComparePage from "../features/dictionary/ComparePage";
import DictionaryCardDetailPage from "../features/dictionary/DictionaryCardDetailPage";
import DiscoverPage from "../features/discover/DiscoverPage";
import TesterDashboardPage from "../pages/TesterDashboardPage";
import SortCardsPage from "../features/discover/SortCardsPage";
import QuickMarkPage from "../features/discover/QuickMarkPage";
import SkippedCardsPage from "../features/discover/SkippedCardsPage";
import GamesPage from "../games/GamesPage";

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
 * Only `src/App.tsx` imports this file.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 4.
 */

/** A route row plus the component that renders it. */
export interface AppRoute extends RouteMeta {
  Component: ComponentType;
}

/**
 * Component for every non-game route, keyed by the exact `path` in routeMeta.ts.
 * Game components come from GAME_REGISTRY instead.
 */
const PAGE_COMPONENTS: Record<string, ComponentType> = {
  "/": HomePage,
  "/flashcards/decks": FlashcardsDecksPage,
  "/discover": DiscoverPage,
  "/account": AccountPage,
  "/games": GamesPage,
  "/community": CommunityPage,
  "/friends": FriendsPage,
  "/friends/requests": IncomingRequestsPage,
  "/friends/sent": SentRequestsPage,
  "/dictionary": DictionaryPage,
  "/compare": ComparePage,
  "/reader": ReaderPage,
  "/flashcards/collection/:builtin": CollectionViewPage,
  "/flashcards/deck/:id": CollectionViewPage,
  "/flashcards/mastered": MasteredRedirect,
  "/reader/:id": ReaderDocumentPage,
  "/flashcards/card/:id": VocabCardDetailPage,
  "/dictionary/card/:word": DictionaryCardDetailPage,
  "/discover/sort/:language": SortCardsPage,
  "/discover/quick-mark/:language": QuickMarkPage,
  "/discover/skipped/:language": SkippedCardsPage,
  "/night-market": NightMarketEnginePage,
  "/tester-dashboard": TesterDashboardPage,
  "/settings": SettingsPage,
  "/flashcards/learn": FlashcardsLearnPage,
  "/night-market/template-editor": TemplateEditorPage,
  "/night-market/template-sandbox": TemplateSandboxPage,
  "/entries": EntriesPage,
  "/entries/:id": EntryDetailPage,
  "/edit/:id": EditEntryPage,
  "/flashcards": FlashcardsPage,
  "/profile": ProfilePage,
  "/login": LoginPage,
  "/register": RegisterPage,
  "*": NotFoundPage,
};

/** Game components, keyed by route, from the game registry. */
const GAME_COMPONENTS: Record<string, ComponentType> = Object.fromEntries(
  GAME_REGISTRY.map((g) => [g.route, g.Component as ComponentType])
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
  return { ...meta, Component };
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

import { matchPath } from "react-router-dom";
import type { FooterTab } from "../components/MobileFooter";
import { GAME_REGISTRY } from "../games/registry";

/**
 * THE route table — one row per route, and the single source of truth for every
 * question the app asks about a route EXCEPT which component renders it (that join
 * lives in ./registry.ts, so this file stays free of page imports and can be read by
 * Layout, FooterPresenter, pageTransition and the tests without dragging the whole
 * page tree — Pixi included — into their module graph).
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 * Adding one page used to require edits to FOUR files that each independently
 * classified routes:
 *
 *   src/App.tsx                      path → component, allowPublic
 *   src/components/Layout.tsx        MOBILE_DEMO_PATHS + 6 hand-written startsWith
 *   src/components/FooterPresenter   FOOTER_ROUTES + FOOTER_ROUTE_PREFIXES
 *   src/utils/pageTransition.ts      NODE_ROUTES + NODE_PREFIXES + LEAF_EXACT
 *
 * Two of them carried explicit "Keep in sync with…" comments, and the sync had
 * already failed: `/games/word-search` was missing from `LEAF_EXACT` even though
 * `WordSearchPage` renders `<LeafPage>`, so it silently lost the slide-up view
 * transition that Bubble Match got. That class of bug is now structurally
 * impossible — there is one row, and all four consumers read it.
 *
 * This generalises the pattern `src/games/registry.ts` already uses, which its own
 * header describes: *"The hub, the router, and the mobile-demo frame allowlist all
 * derive from this array — adding a game requires no edits to those files."*
 *
 * ── Adding a route ─────────────────────────────────────────────────────────────
 * Add ONE entry below, and its component to `PAGE_COMPONENTS` in ./registry.ts —
 * which throws at boot if you forget. Nothing else needs touching. Games are the
 * exception: add those to `GAME_REGISTRY`, which is spread in at the bottom of this
 * file, and they need no entry here at all.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 4 and docs/UX_AND_NAVIGATION.md.
 */

/**
 * Who may open the route.
 *
 * Replaces the bare `allowPublic` boolean that 25 of 30 routes had to remember to
 * pass. A FORGOTTEN flag did not error — it silently `<Navigate to="/">`d, which
 * presents as a dead button rather than a crash, and on this machine every local
 * user is `isPublic`, so it reproduced for everyone. Naming the three cases means
 * there is no default to forget.
 *
 *   'open'    — no auth wrapper at all (login, register, 404).
 *   'any'     — any signed-in account, including public/demo ones. The common case.
 *   'account' — a full (non-public) account. Public accounts are bounced to "/".
 *
 * Feature-level gates (isValidator, isTemplateAuthor) are NOT expressed here: those
 * pages use 'any' and enforce their own gate inside the page, with the server
 * enforcing it too. Putting them here would let the generic isPublic redirect
 * pre-empt the specific gate.
 */
export type RouteAccess = "open" | "any" | "account";

/**
 * Which shell the page renders inside.
 *
 *   'frame' — the shared phone-frame surface (MobileDemoFrame): full-bleed on
 *             mobile, a centred phone card on desktop.
 *   'plain' — full-height, no chrome (auth pages, the desktop-only Night Market
 *             authoring tools, 404).
 */
export type RouteShell = "frame" | "plain";

/**
 * The page archetype, which decides the forward-navigation view transition
 * (docs/UX_AND_NAVIGATION.md).
 *
 *   'leaf' — slides UP over the page beneath (a drill-in that hides the footer).
 *   'node' — slides in from the RIGHT (a drill-in that usually keeps the footer).
 *   'tab'  — a footer-tab destination; no slide (the footer switches instead).
 *   'none' — no transition (auth pages, plain-shell pages, 404).
 *
 * `chrome` and `footerTab` are independent on purpose: /reader/:id is a node page
 * with NO footer, and /tester-dashboard is a leaf page with no footer.
 */
export type RouteChrome = "leaf" | "node" | "tab" | "none";

export interface RouteMeta {
  /** React Router path pattern, e.g. "/discover/sort/:language". */
  path: string;
  /** Who may open it. */
  access: RouteAccess;
  /** Which shell it renders inside. */
  shell: RouteShell;
  /** Page archetype → view-transition direction. */
  chrome: RouteChrome;
  /** Which footer tab is active here. Omit for footerless routes. */
  footerTab?: FooterTab;
  // NOTE: there is deliberately no `lazy` flag. Every route is code-split (see
  // routes/registry.ts) and App.tsx wraps them all in <Suspense>, so a per-row
  // flag would be always-true and could only ever drift.
  /** Why this route is classified the way it is, when that isn't obvious. */
  note?: string;
}

/** Every non-game route. Order is irrelevant — React Router ranks by specificity. */
const PAGE_ROUTES: RouteMeta[] = [
  // ── Footer-tab destinations ──
  { path: "/", access: "any", shell: "frame", chrome: "tab", footerTab: "home" },
  { path: "/flashcards/decks", access: "any", shell: "frame", chrome: "tab", footerTab: "flashcards" },
  { path: "/discover", access: "any", shell: "frame", chrome: "tab", footerTab: "discover" },
  { path: "/account", access: "any", shell: "frame", chrome: "tab", footerTab: "account" },

  // ── Node pages (slide from the right) ──
  // Dictionary, Reader, Compare and Games are reached from the Home menu, so they
  // keep the Home tab lit.
  { path: "/games", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  // Was `chrome: "tab"`, which contradicted both this comment block and the page:
  // CommunityPage renders <NodePage>, so it drew a back arrow and slid OUT to the
  // right on back, but got no slide on the way IN (routeSlideDir returns null for
  // "tab"). Asymmetric by accident, not by design — see docs/LEAF_NODE_PAGES.md.
  { path: "/community", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  // Friends leaderboard + its three action screens (Send / Accept / Remove). All
  // four keep the Home tab lit — they are reached from the Home menu, and the three
  // action pages drill in one level further (their back arrows return to /friends,
  // not to Home). /friends itself is read-only; every mutation lives on a screen.
  // Arena is a Home-hub drill-in, the same Node archetype as /friends.
  { path: "/arena", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/friends", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/friends/requests", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/friends/sent", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/friends/remove", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  // Study Challenge — four more Node drill-ins under /friends, all with back arrows
  // that return to /friends/challenges rather than to Home (docs/STUDY_CHALLENGE.md § 1).
  { path: "/friends/challenges", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/friends/challenges/history", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/friends/challenges/new/:friendUserId", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/friends/challenges/review/:challengeId", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/friends/challenges/:challengeId", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  // User profile — the one screen for looking at somebody who is not you. A Node drill-in
  // reachable from the friends list, the leaderboard and the challenges page, so its back
  // arrow goes to actual history rather than a fixed parent (docs/USER_PROFILE_PAGE.md).
  { path: "/users/:userId", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/dictionary", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/compare", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  { path: "/reader", access: "any", shell: "frame", chrome: "node", footerTab: "home" },
  // Collection pages (docs/DECKS_FEATURE.md). Two routes, one component: a deck is
  // addressed by NUMERIC id under its own segment, so a deck named "mastered" can
  // never shadow the built-in collection route.
  { path: "/flashcards/collection/:builtin", access: "any", shell: "frame", chrome: "node", footerTab: "flashcards" },
  { path: "/flashcards/deck/:id", access: "any", shell: "frame", chrome: "node", footerTab: "flashcards" },
  // Mastery Centers (docs/DECKS_FEATURE.md § "Mastery Centers") — the fdp's decks
  // panel read through the reading / writing bar. Node drill-ins from /decks, so the
  // Flashcards tab stays lit and the back arrow returns there.
  { path: "/flashcards/reading", access: "any", shell: "frame", chrome: "node", footerTab: "flashcards" },
  { path: "/flashcards/writing", access: "any", shell: "frame", chrome: "node", footerTab: "flashcards" },
  {
    path: "/flashcards/mastered",
    access: "any",
    shell: "frame",
    chrome: "node",
    footerTab: "flashcards",
    note: "Legacy path for the Mastered collection — redirects to /flashcards/collection/mastered so older links and bookmarks keep working.",
  },

  {
    path: "/reader/:id",
    access: "any",
    shell: "frame",
    chrome: "node",
    note: "The one FOOTERLESS node page (docs/UX_AND_NAVIGATION.md § Reader) — it still slides in from the right.",
  },

  // Card-detail pages keep the tab of wherever they were reached from.
  { path: "/flashcards/card/:id", access: "any", shell: "frame", chrome: "node", footerTab: "flashcards" },
  { path: "/dictionary/card/:word", access: "any", shell: "frame", chrome: "node", footerTab: "home" },

  // Discover drill-ins.
  { path: "/discover/sort/:language", access: "any", shell: "frame", chrome: "node", footerTab: "discover" },
  { path: "/discover/quick-mark/:language", access: "any", shell: "frame", chrome: "node", footerTab: "discover" },
  { path: "/discover/skipped/:language", access: "any", shell: "frame", chrome: "node", footerTab: "discover" },

  // ── Leaf pages (slide up, no footer) ──
  { path: "/night-market", access: "any", shell: "frame", chrome: "leaf" },
  // Read-only visit to another user's market, from their profile page. A LEAF like the
  // owner's page (docs/USER_PROFILE_PAGE.md § Night market visit).
  { path: "/night-market/user/:userId", access: "any", shell: "frame", chrome: "leaf" },
  {
    path: "/tester-dashboard",
    access: "any",
    shell: "frame",
    chrome: "leaf",
    note: "Validator-only; the page bounces non-validators and the Home hub hides its row. 'any' so the generic isPublic redirect can't pre-empt the validator gate.",
  },
  {
    path: "/settings",
    access: "open",
    shell: "frame",
    chrome: "leaf",
    note: "Opens from the Account header gear as a slide-up sheet. Has never had an auth wrapper.",
  },
  {
    path: "/settings/account",
    access: "open",
    shell: "frame",
    chrome: "leaf",
    note: "Artboard 11b — the write-heavy half of settings (password + delete). Reached only from the chevron row at the foot of /settings, so it matches its parent's access: the password form and the delete flow both authenticate on their own request.",
  },

  // ── Footerless drill-in that does not slide ──
  {
    path: "/flashcards/learn",
    access: "any",
    shell: "frame",
    chrome: "none",
    note: "flp owns its own card animation; a page-level slide would fight it.",
  },

  // ── Desktop-only Night Market authoring tools (plain shell) ──
  {
    path: "/night-market/template-editor",
    access: "any",
    shell: "plain",
    chrome: "none",
    note: "Template-author-only (migration 115); the page and the backend both enforce it. Desktop-only and outside the phone frame, so no page transition.",
  },
  {
    path: "/night-market/template-sandbox",
    access: "any",
    shell: "plain",
    chrome: "none",
    note: "Same gate as the editor above.",
  },

  // ── Full-account-only pages ──
  { path: "/entries", access: "account", shell: "plain", chrome: "none" },
  { path: "/entries/:id", access: "account", shell: "plain", chrome: "none" },
  { path: "/edit/:id", access: "account", shell: "plain", chrome: "none" },
  { path: "/flashcards", access: "account", shell: "plain", chrome: "none" },
  { path: "/profile", access: "account", shell: "plain", chrome: "none" },

  // ── Unauthenticated ──
  { path: "/login", access: "open", shell: "plain", chrome: "none" },
  { path: "/register", access: "open", shell: "plain", chrome: "none" },
  { path: "*", access: "open", shell: "plain", chrome: "none" },
];

/**
 * Game route metadata, derived from GAME_REGISTRY so adding a game still requires no
 * edits outside that file.
 *
 * Every shipped game page renders `<LeafPage>` (a full-screen drill-in with no
 * footer), so games are classified 'leaf' here rather than per-game. A future game
 * that is NOT a leaf page needs a `chrome` field on `GameDef`; until one exists,
 * encoding it here keeps `GameDef` about the game rather than about navigation.
 *
 * This is also where the `/games/word-search` transition bug was: the old
 * `LEAF_EXACT` set listed bubble-match by hand and simply omitted word-search.
 */
const GAME_ROUTE_META: RouteMeta[] = GAME_REGISTRY.map((g) => ({
  path: g.route,
  access: g.requiresAuth ? ("account" as const) : ("any" as const),
  shell: "frame" as const,
  chrome: "leaf" as const,
}));

/** Every route in the app, metadata only. */
export const ROUTE_META: RouteMeta[] = [...PAGE_ROUTES, ...GAME_ROUTE_META];

// ─────────────────────────────────────────────────────────────────────────────
// Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The route matching a concrete pathname, or undefined.
 *
 * Uses React Router's own `matchPath` so a parameterized pattern
 * (`/discover/sort/:language`) is matched the SAME way the router matches it. The
 * files this replaces used hand-written `startsWith` prefixes, which is where the
 * prefix lists came from — and where they drifted.
 *
 * The catch-all "*" is skipped: it matches everything, and no consumer wants
 * "unknown route" to inherit the 404 page's classification by accident.
 */
export function findRoute(pathname: string): RouteMeta | undefined {
  // Strip any query/hash the caller passed through (routeSlideDir is called with
  // raw `to` values from navigate()).
  const path = pathname.split(/[?#]/)[0];
  return ROUTE_META.find((r) => r.path !== "*" && matchPath(r.path, path) !== null);
}

/** Which shell a pathname renders inside. Unknown paths get the plain shell (404). */
export function routeShell(pathname: string): RouteShell {
  return findRoute(pathname)?.shell ?? "plain";
}

/** The active footer tab for a pathname, or undefined when the footer is hidden. */
export function routeFooterTab(pathname: string): FooterTab | undefined {
  return findRoute(pathname)?.footerTab;
}

/** The page archetype for a pathname. */
export function routeChrome(pathname: string): RouteChrome {
  return findRoute(pathname)?.chrome ?? "none";
}

import { matchPath } from "react-router-dom";
import type { FooterStyle, FooterTab } from "../components/MobileFooter";
import { ROUTED_GAMES } from "../games/registry";
import { isFeatureEnabled } from "../../server/contracts/featureFlags";

/**
 * THE route table — one row per route, and the single source of truth for every
 * question the app asks about a route EXCEPT which component renders it (that join
 * lives in ./registry.ts, so this file stays free of page imports and can be read by
 * Layout, FooterPresenter, pageTransition and the tests without dragging the whole
 * page tree into their module graph).
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
 *   'open' — no auth wrapper at all (login, register, 404).
 *   'any'  — any signed-in account. The common case.
 *
 * There used to be a third level, 'account' (a "full, non-public" account), backed by
 * `users.isPublic`. It was removed with `isPublic` itself on 2026-11-14
 * (docs/LOGIN_REWORK.md Q7): no route used it, every account is now public, and its
 * redirect read a visible account as a restricted one.
 *
 * Feature-level gates (isValidator, isFeatureTester, isAdmin) are NOT expressed here: those
 * pages use 'any' and enforce their own gate inside the page, with the server
 * enforcing it too.
 */
export type RouteAccess = "open" | "any";

/**
 * Which shell the page renders inside.
 *
 *   'frame' — the shared phone-frame surface (MobileDemoFrame): full-bleed on
 *             mobile, a centred phone card on desktop.
 *   'plain' — full-height, no chrome (the font lab, 404).
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
  /**
   * How the footer bar is drawn here. Omit for the app-wide flat `bar`; `slab` is the
   * floating flashcard slab (Tower Style design), worn by the Deck Tower (`/`), the Dictionary tab, both
   * card detail pages and acp.
   * Meaningless without `footerTab`. See MobileFooter / docs/DECK_TOWER.md § Footer.
   */
  footerStyle?: FooterStyle;
  // NOTE: there is deliberately no `lazy` flag. Every route is code-split (see
  // routes/registry.ts) and App.tsx wraps them all in <Suspense>, so a per-row
  // flag would be always-true and could only ever drift.
  /** Why this route is classified the way it is, when that isn't obvious. */
  note?: string;
}

// Feature flags decide which of the rows below actually become routes; see
// FLAGGED_OFF_PATHS at the bottom of this file.

/** Every non-game route. Order is irrelevant — React Router ranks by specificity. */
const PAGE_ROUTES: RouteMeta[] = [
  // ── Footer-tab destinations ── (left to right: Flashcards · Lessons · Dictionary · Menu)
  {
    path: "/",
    access: "any",
    shell: "frame",
    chrome: "tab",
    footerTab: "deck",
    footerStyle: "slab",
    note: "The Deck Tower (docs/DECK_TOWER.md) — the app's landing page and first footer tab. It took `/` on 2026-11-04, when the old Home (the fdp), the Reading/Writing Centers, Decks and the collection pages were deleted; `/deck-tower`, its address until then, is gone.",
  },
  {
    path: "/lessons",
    access: "any",
    shell: "frame",
    chrome: "tab",
    footerTab: "lessons",
    footerStyle: "slab",
    note: "Took Arena's footer slot on 2026-11-10. A \"coming soon\" placeholder (src/features/lessons/LessonsPage.tsx) until the lessons feature is designed. Styled as a td Tier-2 page (useTier2Look ground) and wears the slab footer, like the Dictionary.",
  },
  {
    path: "/dictionary",
    access: "any",
    shell: "frame",
    chrome: "tab",
    footerTab: "dictionary",
    footerStyle: "slab",
    note: "Wears the Deck Tower's slab footer since the 2026-10-29 Tier-2 redesign (docs/SHELF_REDESIGN.md § 7b).",
  },

  // ── Node pages (slide from the right) ──
  // Reader, Arena, Friends and Community are reached from Menu, so they keep
  // the Menu tab lit.
  {
    path: "/arena",
    access: "any",
    shell: "frame",
    chrome: "node",
    footerTab: "menu",
    note: "A Menu drill-in again since 2026-11-10 (a footer tab 2026-11-04 → 11-10, when Lessons took the slot). Hidden with its Menu row when the `arena` flag is off — see FLAGGED_OFF_PATHS and menuDestinations.ts.",
  },
  // Was `chrome: "tab"`, which contradicted both this comment block and the page:
  // CommunityPage renders <NodePage>, so it drew a back arrow and slid OUT to the
  // right on back, but got no slide on the way IN (routeSlideDir returns null for
  // "tab"). Asymmetric by accident, not by design — see docs/LEAF_NODE_PAGES.md.
  { path: "/community", access: "any", shell: "frame", chrome: "node", footerTab: "menu" },
  // Study Challenge — four more Node drill-ins under /friends, all with back arrows
  // that return to /friends/challenges (docs/STUDY_CHALLENGE.md § 1).
  { path: "/friends/challenges", access: "any", shell: "frame", chrome: "node", footerTab: "menu" },
  { path: "/friends/challenges/history", access: "any", shell: "frame", chrome: "node", footerTab: "menu" },
  { path: "/friends/challenges/:challengeId", access: "any", shell: "frame", chrome: "node", footerTab: "menu" },
  { path: "/reader", access: "any", shell: "frame", chrome: "node", footerTab: "menu" },
  {
    path: "/flashcards/writing/notebook",
    access: "any",
    shell: "frame",
    chrome: "leaf",
    note: "Writing Notebook (docs/WRITING_NOTEBOOK.md) — an endless handwriting sheet launched from the notebook stack on the Deck Tower's writing world. A leaf: footerless, slides up, Back returns to the tower's writing world.",
  },

  {
    path: "/reader/:id",
    access: "any",
    shell: "frame",
    chrome: "node",
    note: "The one FOOTERLESS node page (docs/UX_AND_NAVIGATION.md § Reader) — it still slides in from the right.",
  },

  // The card detail page is a drill-in from the Deck Tower's cards page, so it keeps the
  // Flashcards tab. (The Dictionary's read-only `/dictionary/card/:word` was deleted
  // 2026-11-10 — a dictionary word is shown only in the eip sheet.)
  { path: "/flashcards/card/:id", access: "any", shell: "frame", chrome: "node", footerTab: "deck", footerStyle: "slab" },

  // Add Cards — the Discover hub (`/discover`) was deleted 2026-10-17, so acp is a
  // drill-in from the Deck Tower (the main world's sort platform) and lights the Flashcards tab. The
  // `/discover/` URL prefix is kept so existing links (?set=provisional offers) work.
  // Wears the floating `slab` footer since its Tower Tier 2 re-skin (2026-10-29): the page
  // is a tier-2 ground under the Deck Tower, and the slab casts its shadow on that ground
  // (docs/SORT_CARDS_REQUIREMENTS.md § 4.9).
  { path: "/discover/sort/:language", access: "any", shell: "frame", chrome: "node", footerTab: "deck", footerStyle: "slab" },

  // ── Leaf pages (slide up, no footer) ──
  {
    path: "/tester-dashboard",
    access: "any",
    shell: "frame",
    chrome: "leaf",
    note: "Validator- or admin-only; the page bounces everyone else and Menu hides its tile.",
  },
  {
    path: "/settings",
    access: "open",
    shell: "frame",
    chrome: "leaf",
    note: "The standalone Settings page. Settings is normally read as a tab of AccountSheet; this route is where /settings/account's Back lands. Has never had an auth wrapper.",
  },
  {
    path: "/settings/account",
    access: "open",
    shell: "frame",
    chrome: "leaf",
    note: "Artboard 11b — the write-heavy half of settings (password + delete). Reached only from the chevron row at the foot of /settings, so it matches its parent's access: the password form and the delete flow both authenticate on their own request.",
  },


  {
    path: "/font-lab",
    access: "any",
    shell: "plain",
    chrome: "none",
    note: "Dev-only type labs (src/pages/fontLab/FontLabPage.tsx) — a shell over two modes: Chinese (FONTS.cjk) and Info type (FONTS.label, the overline voice). Not linked from any menu; reachable by typing the URL. Plain shell because each lab owns its own scroll container and needs the width for the compare grid.",
  },

  // ── Unauthenticated ──
  // Auth pages sit in the FRAME (since 2026-11-14): the boot cover opens onto `/login` on a
  // signed-out launch, and a shell switch under the cover would remount it and restart its
  // drop (docs/LOGIN_REWORK.md § 1). No footerTab, so no footer.
  { path: "/login", access: "open", shell: "frame", chrome: "none" },
  { path: "/register", access: "open", shell: "frame", chrome: "none" },
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
const GAME_ROUTE_META: RouteMeta[] = ROUTED_GAMES.map((g) => ({
  path: g.route,
  access: "any" as const,
  shell: "frame" as const,
  chrome: "leaf" as const,
}));

/**
 * Routes belonging to a feature that is switched OFF
 * (server/contracts/featureFlags.ts).
 *
 * Filtering them out of `ROUTE_META` is the whole client-side gate: a path with no row
 * is not a route at all, so it falls through to `"*"` → NotFoundPage, and every
 * consumer that derives from this table (Layout's shell, the footer, the page
 * transitions) stops knowing about it for free.
 *
 * The components stay bound in routes/registry.ts — see the note there on why the
 * binding survives while the row does not.
 *
 * GAME routes are absent here on purpose: a per-game flag (`GAME_FLAGS`) is applied at
 * `GAME_REGISTRY` itself, and `GAME_ROUTE_META` below derives from that already-filtered
 * array, so a disabled game never produces a row to remove.
 */
export const FLAGGED_OFF_PATHS: ReadonlySet<string> = new Set<string>([
  ...(isFeatureEnabled("community") ? [] : ["/community"]),
  ...(isFeatureEnabled("arena") ? [] : ["/arena"]),
  ...(isFeatureEnabled("writingNotebook") ? [] : ["/flashcards/writing/notebook"]),
  ...(isFeatureEnabled("studyChallenge")
    ? []
    : ["/friends/challenges", "/friends/challenges/history", "/friends/challenges/:challengeId"]),
]);

/** Every route in the app, metadata only, minus anything behind an off flag. */
export const ROUTE_META: RouteMeta[] = [...PAGE_ROUTES, ...GAME_ROUTE_META].filter(
  (r) => !FLAGGED_OFF_PATHS.has(r.path)
);

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

/** How the footer bar is drawn on a pathname (the flat `bar` unless the row says otherwise). */
export function routeFooterStyle(pathname: string): FooterStyle {
  return findRoute(pathname)?.footerStyle ?? "bar";
}

/** The page archetype for a pathname. */
export function routeChrome(pathname: string): RouteChrome {
  return findRoute(pathname)?.chrome ?? "none";
}

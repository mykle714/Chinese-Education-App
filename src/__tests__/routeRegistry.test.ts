import { describe, expect, it } from "vitest";
import { ROUTE_META, findRoute, routeChrome, routeFooterTab, routeShell } from "../routes/routeMeta";
import { APP_ROUTES } from "../routes/registry";
import { routeSlideDir } from "../utils/pageTransition";
import { GAME_REGISTRY } from "../games/registry";

/**
 * Pins the route table (src/routes/routeMeta.ts) — the single table that the
 * router, the shell, the footer and the page transitions all derive from.
 *
 * These assertions are transcribed from the FOUR hand-synced tables this registry
 * replaced (App.tsx's inline <Route> list, Layout's MOBILE_DEMO_PATHS,
 * FooterPresenter's FOOTER_ROUTES/_PREFIXES, pageTransition's
 * NODE_ROUTES/NODE_PREFIXES/LEAF_EXACT), so they double as a behavioural diff: any
 * route whose classification changed unintentionally fails here.
 *
 * The one DELIBERATE behaviour change is called out in its own test below.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 4.
 */

describe("route registry integrity", () => {
  it("has no duplicate paths", () => {
    const paths = ROUTE_META.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("gives every footer-bearing route a real tab, and every tab route a footer", () => {
    for (const route of ROUTE_META) {
      // A 'tab' route IS a footer destination, so it must name its tab.
      if (route.chrome === "tab") expect(route.footerTab).toBeDefined();
      // Nothing outside the phone frame can show the in-frame footer.
      if (route.footerTab) expect(route.shell).toBe("frame");
    }
  });

  it("never marks a plain-shell route as sliding", () => {
    // The view transition is a phone-frame affordance; a plain page has nothing to
    // slide over.
    for (const route of ROUTE_META.filter((r) => r.shell === "plain")) {
      expect(route.chrome).toBe("none");
    }
  });

  it("code-splits EVERY route", () => {
    // Tier 1 item 2 of docs/REACT_NATIVE_MIGRATION.md: 31 of the 37 routes used to
    // be static imports, so a cold start parsed the entire page tree before it
    // could paint. Pinned here because the regression is invisible — adding a page
    // with a plain `import` still works perfectly, it just quietly moves that page
    // (and everything it pulls in) back into the main chunk.
    //
    // React tags lazy components with this symbol; there is no public predicate.
    const LAZY = Symbol.for("react.lazy");
    const eager = APP_ROUTES.filter(
      (r) => (r.Component as unknown as { $$typeof?: symbol }).$$typeof !== LAZY
    ).map((r) => r.path);
    expect(eager).toEqual([]);
  });

  it("binds a component to every row, and no orphans", () => {
    // APP_ROUTES throws at import if a row has no component, so reaching this
    // assertion already proves that direction; this pins the count both ways.
    expect(APP_ROUTES).toHaveLength(ROUTE_META.length);
  });
});

describe("findRoute", () => {
  it("matches parameterized patterns the way the router does", () => {
    expect(findRoute("/discover/sort/zh")?.path).toBe("/discover/sort/:language");
    expect(findRoute("/dictionary/card/中国")?.path).toBe("/dictionary/card/:word");
    expect(findRoute("/flashcards/card/42")?.path).toBe("/flashcards/card/:id");
  });

  it("does not let a parent path swallow its children", () => {
    expect(findRoute("/flashcards/decks")?.path).toBe("/flashcards/decks");
    expect(findRoute("/flashcards")?.path).toBe("/flashcards");
    expect(findRoute("/dictionary")?.path).toBe("/dictionary");
  });

  it("strips a querystring or hash before matching", () => {
    expect(findRoute("/discover/sort/zh?level=3")?.path).toBe("/discover/sort/:language");
    expect(findRoute("/dictionary#top")?.path).toBe("/dictionary");
  });

  it("returns undefined for an unknown path rather than the catch-all", () => {
    // "*" would match everything; consumers must not inherit the 404's shell.
    expect(findRoute("/no/such/page")).toBeUndefined();
  });
});

describe("shell classification matches the old MOBILE_DEMO_PATHS behaviour", () => {
  const FRAME = [
    "/", "/flashcards/decks", "/flashcards/mastered", "/account", "/flashcards/learn",
    "/discover", "/games", "/community", "/night-market", "/reader", "/dictionary",
    "/compare", "/tester-dashboard", "/settings",
    "/discover/sort/zh", "/discover/quick-mark/es", "/discover/skipped/zh",
    "/flashcards/card/7", "/dictionary/card/好", "/reader/abc-123",
    ...GAME_REGISTRY.map((g) => g.route),
  ];
  const PLAIN = [
    "/login", "/register", "/entries", "/entries/1", "/edit/1", "/flashcards",
    "/profile", "/night-market/template-editor", "/night-market/template-sandbox",
  ];

  it.each(FRAME)("%s renders in the phone frame", (path) => {
    expect(routeShell(path)).toBe("frame");
  });

  it.each(PLAIN)("%s renders plain", (path) => {
    expect(routeShell(path)).toBe("plain");
  });

  it("falls back to the plain shell for an unknown path", () => {
    expect(routeShell("/no/such/page")).toBe("plain");
  });
});

describe("footer tab matches the old FOOTER_ROUTES behaviour", () => {
  const EXPECTED: Array<[string, string | undefined]> = [
    ["/", "home"],
    ["/flashcards/decks", "flashcards"],
    ["/discover", "discover"],
    ["/account", "account"],
    ["/games", "home"],
    ["/community", "home"],
    ["/flashcards/mastered", "flashcards"],
    ["/dictionary", "home"],
    ["/reader", "home"],
    ["/compare", "home"],
    // Prefix-matched node pages.
    ["/discover/sort/zh", "discover"],
    ["/discover/quick-mark/zh", "discover"],
    ["/discover/skipped/zh", "discover"],
    ["/flashcards/card/7", "flashcards"],
    ["/dictionary/card/好", "home"],
    // Footerless.
    ["/reader/abc", undefined],
    ["/flashcards/learn", undefined],
    ["/night-market", undefined],
    ["/tester-dashboard", undefined],
    ["/settings", undefined],
    ["/login", undefined],
  ];

  it.each(EXPECTED)("%s → %s", (path, tab) => {
    expect(routeFooterTab(path)).toBe(tab);
  });
});

describe("page transitions match the old NODE/LEAF tables", () => {
  const NODE = [
    "/games", "/flashcards/mastered", "/dictionary", "/reader", "/compare",
    "/discover/skipped/zh", "/discover/sort/zh", "/discover/quick-mark/zh",
    "/flashcards/card/7", "/dictionary/card/好", "/reader/abc",
  ];
  const LEAF = ["/tester-dashboard", "/settings", "/night-market"];
  const NO_SLIDE = ["/", "/discover", "/account", "/flashcards/decks", "/login", "/flashcards/learn"];

  it.each(NODE)("%s slides in from the right", (path) => {
    expect(routeSlideDir(path)).toBe("right");
  });

  it.each(LEAF)("%s slides up", (path) => {
    expect(routeSlideDir(path)).toBe("up");
  });

  it.each(NO_SLIDE)("%s does not slide", (path) => {
    expect(routeSlideDir(path)).toBeNull();
  });

  it("strips a querystring, as the old implementation did", () => {
    expect(routeSlideDir("/discover/sort/zh?level=3")).toBe("right");
  });
});

describe("FIXED: every game page slides up", () => {
  /**
   * The bug this registry was built to make impossible.
   *
   * `LEAF_EXACT` in the old pageTransition.ts listed "/games/bubble-match" by hand
   * and simply omitted "/games/word-search" — so Word Search returned null and
   * silently lost the slide-up view transition, even though WordSearchPage renders
   * <LeafPage> exactly like Bubble Match does. Game routes are now derived from
   * GAME_REGISTRY, so a new game cannot be forgotten.
   */
  it.each(GAME_REGISTRY.map((g) => g.route))("%s slides up", (route) => {
    expect(routeSlideDir(route)).toBe("up");
    expect(routeChrome(route)).toBe("leaf");
  });

  it("covers word-search specifically — this was the regression", () => {
    expect(routeSlideDir("/games/word-search")).toBe("up");
  });
});

describe("access classification", () => {
  it("requires a full account only for the legacy entry-management pages", () => {
    const accountOnly = ROUTE_META.filter((r) => r.access === "account").map((r) => r.path).sort();
    expect(accountOnly).toEqual(
      ["/edit/:id", "/entries", "/entries/:id", "/flashcards", "/profile"].sort()
    );
  });

  it("mounts login, register, settings and the 404 with no auth wrapper", () => {
    const open = ROUTE_META.filter((r) => r.access === "open").map((r) => r.path).sort();
    expect(open).toEqual(["*", "/login", "/register", "/settings"].sort());
  });
});

/**
 * Feature flags — the app's one on/off switch registry.
 *
 * ── Why this file lives in `server/contracts/` ────────────────────────────────
 * A feature flag has to be read by BOTH halves of the app: the server refuses to
 * mount the feature's routes, and the client refuses to render its routes and
 * entry points. `server/contracts/` is already the home for things both halves
 * must agree on — `src/types.ts` documents the one-directional reach in detail
 * (the backend Docker build context is `./server`, so a shared module cannot live
 * at the repo root without changing the deployment; the frontend image copies the
 * whole repo, so `src/** → server/contracts/**` works). A flag is exactly that
 * shape of agreement, so it follows `wire.ts` rather than inventing a new home.
 *
 * It is a SEPARATE file from `wire.ts` on purpose: `wire.ts` is ~105 KB of
 * cross-the-wire type contract, and "which features are switched on" is an
 * unrelated concern that should not have to be found inside it.
 *
 * ── What a flag is, and what it is not ───────────────────────────────────────
 * These are BUILD-TIME constants, not runtime configuration. Flipping one is a
 * code change and needs a redeploy (both containers — the client inlines its copy
 * at bundle time). That is deliberate: this repo has no config service, and a flag
 * that could only be flipped by a deploy is honest about what it costs, whereas an
 * env-var pair (server + `VITE_`) reads like it can be flipped live when the client
 * half still requires a rebuild.
 *
 * A flag is for a feature that is BUILT but should not be reachable yet. It is not
 * a permission check — per-user gating is `users.isValidator` / `users.isTemplateAuthor`
 * — and it is not a rollback mechanism for data (see CLAUDE.md, which records that
 * gloss-confusability rolls back by `TRUNCATE`, not by a flag).
 *
 * ── Adding a flag ────────────────────────────────────────────────────────────
 * Add one boolean below with a comment saying what it gates, then guard every
 * chokepoint the feature reaches:
 *
 *   1. `server/server.ts`      — the feature's `app.use(...)` mount
 *   2. any endpoint OUTSIDE that router that serves the same feature — the part
 *      most easily missed; two of the five feature flags here have one
 *   3. `src/routes/routeMeta.ts` — the route rows, which `ROUTE_META` filters out
 *   4. every client entry point (tiles, shelves, buttons, badge fetches, tips)
 *
 * DI wiring in `server/dal/setup.ts` is deliberately NOT gated. Services are
 * injected into other services (`StudyChallengeService` into `FriendsService` as
 * the unfriend resolver, `CommunityLayoutDAL` into `UserProfileService`,
 * `NightMarketPlacementService` and `ArenaService` into `UserMinutePointsService`), so
 * skipping construction would mean teaching those call sites to tolerate an absent
 * dependency — a much larger change than not answering HTTP requests, and one that
 * would have to be undone to turn the flag back on.
 *
 * Referenced by: docs/FEATURE_FLAGS.md.
 */

// Type-only import: erased at build, so the client bundle does NOT pull
// `server/constants.ts` in. It exists purely to make GAME_FLAGS exhaustive — see
// the note there. `server/contracts/cooldown.ts` imports from `./wire.js` the same
// way, so the `.js` specifier is the established style in this directory.
import type { KNOWN_GAME_IDS } from '../constants.js';

/**
 * Every feature flag in the app. `false` means the feature is fully unreachable:
 * its endpoints 404 and its pages are not registered as routes.
 *
 * Per-GAME switches are separate — see `GAME_FLAGS` below.
 */
export const FEATURE_FLAGS = {
  /**
   * Study Challenge — the weekly head-to-head between friends
   * (docs/STUDY_CHALLENGE.md). Gates `/api/studyChallenges/*`, the `?challengeId=`
   * challenge-board branch on `/api/onDeck/gamePool` + `/wordSearchGrid`, the three
   * `/friends/challenges*` routes, the Challenges tile + badge on /friends, the
   * Challenges shelf on /decks, and the per-pair block toggle on a user profile.
   *
   * NOT gated: the hourly `database/cron/expire-study-challenges.sql` maintenance
   * pass. It keeps running so that any challenge already live when the flag went
   * off still resolves or expires on schedule, instead of hanging mid-week and
   * reappearing as a stale row if the flag is turned back on.
   *
   * ⚠️ THE ONLY FLAG CURRENTLY OFF.
   */
  studyChallenge: false,

  /**
   * Community — SHARING card designs with other learners (docs/COMMUNITY_PAGE.md).
   * Gates `/api/community/*` (the feeds, vote/unvote, and applyDesign — copying
   * someone else's design onto your own card), the `/community` page and its Home
   * tile, and the designs grid on another person's profile along with the endpoint
   * that feeds it (`GET /api/users/:userId/designs`, which lives in `userRoutes.ts`
   * rather than `communityRoutes.ts`).
   *
   * NOT gated: designing your OWN cards. Advanced icon layouts, the card icon
   * editor, `CardIconLayer`/`cardIconLayout.ts`, `VocabEntryService.updateIconLayout`
   * and the `author` column (docs/CARD_ICON_LAYOUT.md) all stay live. This flag
   * switches off SHARING, not authoring.
   */
  community: true,

  /**
   * Arena — the weekly global division leaderboard (docs/ARENA_FEATURE.md).
   * Gates `/api/arena/*`, the `/arena` route and the Arena tile on the Home hub.
   *
   * NOT gated: the hourly `cow-arena` systemd timer, for the same reason the
   * challenge expiry pass is left running — an arena week that is already live
   * should finish its cycle rather than freeze mid-week. Nor does the flag touch
   * the division columns on `user_languages` or `users."geoCell"`; no row is read
   * or written differently because of it.
   */
  arena: true,

  /**
   * Night Market — the vocabulary market the learner builds out as they earn minute
   * points (docs/NIGHT_MARKET_FEATURE.md). Gates all THREE of the feature's server
   * namespaces (`/api/nightMarket/*`, `/api/nightMarketTemplates/*`,
   * `/api/nightMarketSandbox/*`), its four routes — the market itself, the read-only
   * visit to someone else's market, and the two desktop authoring tools — the hp hero
   * tile, the two template-author tiles, and the "Visit their night market" button on
   * a user profile.
   *
   * The two authoring tools are covered because they author THIS feature's content:
   * `users.isTemplateAuthor` answers "may you author?", which is a different question
   * from "does the feature exist?" and is not a substitute for it.
   *
   * NOT gated: unlock accrual. `UserMinutePointsService` keeps calling
   * `NightMarketPlacementService.grantUnlocks` / `reconcileUnlocks` as minutes are
   * credited (the no-gating-DI rule below), so a learner who studies while the flag is
   * off still arrives at a market that matches their balance rather than an empty lot.
   * Unlike arena's injected service this one WRITES rows — deliberately, for that
   * reason. Nor is the origin-hub seeding on registration gated
   * (`UserController.seedNightMarketHub`), for the same "no cliff on re-enable" reason.
   */
  nightMarket: true,

  /**
   * Immersive World — the once-a-day conversation with an NPC in a scene
   * (docs/IMMERSIVE_WORLD.md). Gates `/api/immersiveWorld/*` — BOTH halves of that
   * router, the phase-1 authoring endpoints and the phase-2 learner runtime, which
   * share a URL prefix but not a service — plus the three `/immersive-world*` routes
   * (scene list, one running scene, scene editor), the hp tile and the Scene Editor
   * tile.
   *
   * NOT gated: the TTS voice plumbing. `useTTS`'s per-call `voice` parameter exists for
   * iw alone (docs/IMMERSIVE_WORLD.md § 6.4a) but is an ordinary optional argument that
   * every other caller already omits, so there is nothing to switch off.
   */
  immersiveWorld: true,
} as const;

/** The name of any feature flag above. */
export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/**
 * Whether a feature is switched on.
 *
 * Prefer this over reading `FEATURE_FLAGS.x` directly: it keeps every call site
 * reading the same way, and the `FeatureFlag` parameter makes a typo'd flag name a
 * compile error rather than a silent `undefined` (which is falsy, so a typo would
 * otherwise turn a feature OFF and look like it worked).
 */
export const isFeatureEnabled = (flag: FeatureFlag): boolean => FEATURE_FLAGS[flag];

// ─────────────────────────────────────────────────────────────────────────────
// Per-game flags
// ─────────────────────────────────────────────────────────────────────────────

/** A game's stable slug, as enumerated by `KNOWN_GAME_IDS` in server/constants.ts. */
export type GameFlagId = (typeof KNOWN_GAME_IDS)[number];

/**
 * One switch per game. Each is independent: turning one off leaves the Games hub
 * and every other game untouched.
 *
 * ── Why a separate record instead of more `FEATURE_FLAGS` keys ───────────────
 * Games are keyed by a slug that ALREADY exists (`GameDef.gameId`, and the
 * `gameassets.gameId` column), so a `gameBubbleMatch`-style key would be a second
 * spelling of an id the app already has, and the two could drift. Keying by the
 * real slug means the gate can be applied by id wherever a game is identified.
 *
 * ── Exhaustiveness ───────────────────────────────────────────────────────────
 * Typed as `Record<GameFlagId, boolean>` against `KNOWN_GAME_IDS`, so ADDING A GAME
 * IS A COMPILE ERROR UNTIL IT IS GIVEN A FLAG. That is the point: the alternative
 * (a loose `Record<string, boolean>`) would let a new game default to whatever
 * `isGameEnabled` falls back to, and a game silently missing from the hub is
 * exactly the kind of bug `src/__tests__/routeRegistry.test.ts` was written to
 * prevent for routes.
 */
export const GAME_FLAGS: Record<GameFlagId, boolean> = {
  'bubble-match': true,
  'word-search': true,
  'match-speed': true,
  'speed-reading': true,
  'hydra-bubbles': true,
  'memory-map': true,
};

/**
 * Whether a game is switched on.
 *
 * Takes a plain `string` because callers hold a raw `:gameId` path segment or a
 * registry slug, not a narrowed union. An UNRECOGNISED id returns false — the
 * fail-closed direction. On the server that is only ever reached alongside
 * `isKnownGameId`, which rejects unknown slugs first with a clearer 404; the
 * fallback here is the backstop, not the gate.
 */
export const isGameEnabled = (gameId: string): boolean =>
  (GAME_FLAGS as Record<string, boolean>)[gameId] ?? false;

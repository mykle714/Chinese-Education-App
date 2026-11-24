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
 * a permission check — per-user gating is `users.isValidator` / `users.isFeatureTester`
 * / `users.isAdmin` — and it is not a rollback mechanism
 * for data (see CLAUDE.md, which records that gloss-confusability rolls back by
 * `TRUNCATE`, not by a flag).
 *
 * ── Adding a flag ────────────────────────────────────────────────────────────
 * Add one boolean below with a comment saying what it gates, then guard every
 * chokepoint the feature reaches:
 *
 *   1. `server/server.ts`      — the feature's `app.use(...)` mount
 *   2. any endpoint OUTSIDE that router that serves the same feature — the part
 *      most easily missed; two of the six feature flags here have one
 *   3. `src/routes/routeMeta.ts` — the route rows, which `ROUTE_META` filters out
 *   4. every client entry point (tiles, shelves, buttons, badge fetches, tips)
 *
 * DI wiring in `server/dal/setup.ts` is deliberately NOT gated. Services are
 * injected into other services (`StudyChallengeService` into `FriendsService` as
 * the unfriend resolver, `CommunityLayoutDAL` into `UserProfileService`,
 * `ArenaService` into `UserMinutePointsService`), so
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
   * `/friends/challenges*` routes, the Challenges tile + badge on /friends, and
   * the per-pair block toggle on a user profile.
   *
   * NOT gated: the hourly `database/cron/expire-study-challenges.sql` maintenance
   * pass. It keeps running so that any challenge already live when the flag went
   * off still resolves or expires on schedule, instead of hanging mid-week and
   * reappearing as a stale row if the flag is turned back on.
   *
   * ⚠️ CURRENTLY OFF.
   */
  studyChallenge: false,

  /**
   * Community — SHARING card designs with other learners (docs/COMMUNITY_PAGE.md).
   * Gates `/api/community/*` (the feeds, vote/unvote, and applyDesign — copying
   * someone else's design onto your own card), the `/community` page and its Menu
   * tile, and the designs grid on another person's profile along with the endpoint
   * that feeds it (`GET /api/users/:userId/designs`, which lives in `userRoutes.ts`
   * rather than `communityRoutes.ts`).
   *
   * NOT gated: designing your OWN cards. Advanced icon layouts, the card icon
   * editor, `CardIconLayer`/`cardIconLayout.ts`, `VocabEntryService.updateIconLayout`
   * and the `author` column (docs/CARD_ICON_LAYOUT.md) all stay live. This flag
   * switches off SHARING, not authoring.
   *
   * ⚠️ CURRENTLY OFF (switched off 2026-10-30).
   */
  community: false,

  /**
   * Arena — the weekly global division leaderboard (docs/ARENA_FEATURE.md).
   * Gates `/api/arena/*`, the `/arena` route and the Arena footer tab (MobileFooter →
   * `ARENA_TAB_ON`).
   *
   * NOT gated: the hourly `cow-arena` systemd timer, for the same reason the
   * challenge expiry pass is left running — an arena week that is already live
   * should finish its cycle rather than freeze mid-week. Nor does the flag touch
   * the division columns on `user_languages` or `users."geoCell"`; no row is read
   * or written differently because of it.
   */
  arena: true,

  /**
   * Writing Notebook — endless per-word handwriting practice sheets
   * (docs/WRITING_NOTEBOOK.md). Gates `/api/writingNotebook/*`, the
   * `/flashcards/writing/notebook` route, and its paper stack on the Deck Tower's
   * writing world (DeckTowerPage → `NOTEBOOK_EXIT`). There is no second entry point.
   */
  writingNotebook: true,

  /**
   * Superposition stored groups — read each character's tile groups from
   * `dictionaryentries_zh."superpositionGroups"` (migration 180) instead of computing them
   * on the device (docs/SUPERPOSITION_GAME.md § Stored groups). A DATA-PATH flag, not a
   * route gate: no router, page or entry point changes. It gates one site:
   * `server/services/SuperpositionService.ts` → `deal` attaches `strokeGroups` to each
   * character only when on (the column is not even read when off).
   *
   * The column is AI-authored by `server/scripts/backfill/chinese/backfill-superposition-groups.js`
   * (a /mark-discoverable pipeline step). A character it has not reached yet has NULL, and
   * the client groups it with the shared algorithm, so ON is safe while the backfill fills in.
   * Off sends no stored groups at all: every character is computed on the device.
   */
  superpositionStoredGroups: true,

  /**
   * Standalone game pages: the ROUTED games' own pages (`/games/word-search`,
   * `/games/match-speed`). A CLIENT-ONLY route gate. Off, `ROUTED_GAMES`
   * (src/games/registry.ts) is empty, so no game route is mounted and nothing in the
   * route table, `originLabelFor` or the route tests enumerates one. The Games hub that
   * launched them (`/games`, GamesPage) was deleted 2026-11-06 along with its Menu row,
   * so with this flag on the pages would be reachable only by typed URL (and by Study
   * Challenge's `challengeLaunch`, itself flagged off).
   *
   * NOT gated: the games themselves as flp BREAKS (src/games/flpBreak, played inside the
   * Deck Tower's study session). Match Speed and Word Search stay playable there. (Bubble
   * Match, Hydra Bubbles and Bucket Drop, which had no live break, were archived
   * 2026-11-23 — docs/ARCHIVED_FEATURES.md.) Also not gated: the server's
   * `/api/games/speedReading/*` endpoint, which the Speed Reading break uses.
   * This is why it is a feature flag and not per-game `GAME_FLAGS` entries: a game flag
   * would also remove the game's break.
   *
   * ⚠️ CURRENTLY OFF.
   */
  standaloneGames: false,

  /**
   * Adventures (cyoa) — branching stories read in the Reader's engine, with an editor
   * for author accounts (docs/CYOA_FEATURE.md). Gates `/api/stories/*`
   * (server/routes/storyRoutes.ts), the `/adventures` routes and the Menu popover row.
   * No second server entry point: every story read and write goes through that one router.
   *
   * ON since 2026-11-20 (owner's call) while the learner page is still being finished:
   * the passage is plain text until the reading engine moves (docs/CYOA_FEATURE.md § 9).
   * Requires migration 196 on the target database.
   */
  cyoa: true,

  /**
   * Voice Assistant — the spoken Mandarin tutor (docs/VOICE_ASSISTANT.md). Gates
   * `/api/voice/*` (server/routes/voiceRoutes.ts), the voice WebSocket on
   * `/api/voice/session` (attachVoiceSocket in server/server.ts — the second chokepoint, and
   * the app's only WebSocket), the `/voice` + `/voice/:sessionId` routes and the Menu popover
   * row (the only entry point, Q2).
   *
   * Requires migration 202, `VOICE_AI_API_KEY` and `GOOGLE_APPLICATION_CREDENTIALS` with the
   * Speech-to-Text API enabled. Without the key or credentials the routes still mount but
   * report the tutor unavailable instead of crashing.
   *
   * ⚠️ CURRENTLY OFF (default per docs/VOICE_ASSISTANT.md § 10).
   */
  voiceAssistant: false,

  /**
   * Sentence Tiles — the two-player correspondence word-tile game judged by AI
   * (docs/SENTENCE_TILES_GAME.md). Gates `/api/sentenceTiles/*` (server/routes/sentenceTilesRoutes.ts,
   * the only server entry), the `/sentence-tiles` + `/sentence-tiles/:gameId` routes and the
   * Menu popover row (the only client entry).
   *
   * ON, but TESTING-ONLY: the service refuses any account without `users.isFeatureTester`, and the
   * Menu row shows only with testing features switched on (useTestingFeatures). Requires migration
   * 204 and `SENTENCE_TILES_AI_API_KEY`; without the key, cached lines still play and new lines
   * answer "judging is unavailable".
   */
  sentenceTiles: true,
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
 * Games are keyed by a slug that ALREADY exists (`GameDef.gameId`), so a
 * `gameWordSearch`-style key would be a second
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
  'word-search': true,
  'match-speed': true,
  'speed-reading': true,
  'memory-map': true,
  'writing-grid': true,
  superposition: true,
};

/**
 * Whether a game is switched on.
 *
 * Takes a plain `string` because callers hold a raw `:gameId` path segment or a
 * registry slug, not a narrowed union. An UNRECOGNISED id returns false — the
 * fail-closed direction. Server callers: server.ts, which mounts a game's own
 * router only when its flag is on (writing-grid, superposition).
 */
export const isGameEnabled = (gameId: string): boolean =>
  (GAME_FLAGS as Record<string, boolean>)[gameId] ?? false;

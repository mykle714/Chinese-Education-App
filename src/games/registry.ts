import { lazy } from "react";
import type { GameDef, RoutedGameDef } from "./types";
// Each game's own mark-type constant, re-stated here as `GameDef.markType` — the
// mastery track it feeds, which challenge eligibility is derived from
// (src/games/__tests__/challengePool.test.ts). Importing the games' `constants`
// modules (not their pages) keeps this cycle-free — a constants file never imports
// the registry. Word Search is absent on purpose: its mark type is per-mode, on
// MODE_CONFIGS instead.
import { GAME_HUE as BUBBLE_MATCH_HUE, MARK_TYPE as BUBBLE_MATCH_MARK_TYPE } from "./bubble-match/constants";
import { GAME_HUE as MATCH_SPEED_HUE, MARK_TYPE as MATCH_SPEED_MARK_TYPE } from "./match-speed/constants";
import { GAME_HUE as SPEED_READING_HUE, MARK_TYPE as SPEED_READING_MARK_TYPE } from "./speed-reading/constants";
import { GAME_HUE as MEMORY_MAP_HUE, MARK_TYPE as MEMORY_MAP_MARK_TYPE } from "./memory-map/constants";
import { GAME_HUE as HYDRA_HUE, MARK_TYPE as HYDRA_MARK_TYPE } from "./hydra-bubbles/constants";
// Word Search has no shared mark type (it is per-mode), but it does have a hue.
import { GAME_HUE as WORD_SEARCH_HUE, MODE_CONFIGS as WORD_SEARCH_MODES } from "./word-search/constants";
import {
    GAME_HUE as BUCKET_DROP_HUE,
    GAME_ID as BUCKET_DROP_GAME_ID,
    MODE_CONFIGS as BUCKET_DROP_MODES,
} from "./bucket-drop/constants";
// The challenge-eligible pool and its scoring numbers (docs/STUDY_CHALLENGE.md § 5.4).
// They live in the shared wire contract rather than here because THE SERVER draws each
// challenge's game sequence and cannot load this module (it imports lazy React
// components), and because live mode must score the same events server-side. This
// registry is still what makes a game ELIGIBLE — see `challengeScoringFor` below and the
// test that pins the two together.
import { CHALLENGE_GAMES } from "../types";
import type { ChallengeScoringSpec, Language } from "../types";
import { GAME_ID as WRITING_GRID_GAME_ID, GAME_HUE as WRITING_GRID_HUE } from "./writing-grid/constants";
import { GAME_ID as SUPERPOSITION_GAME_ID, GAME_HUE as SUPERPOSITION_HUE } from "./superposition/constants";
import { isFeatureEnabled, isGameEnabled } from "../../server/contracts/featureFlags";

/**
 * The scoring spec for a game (or a game MODE), or undefined when it is not
 * challenge-eligible.
 *
 * Looked up rather than restated, so there is exactly one copy of every number. A game
 * whose `markType` is recognition or production and which has NO entry is a build error
 * waiting to happen, which is what `src/games/__tests__/challengePool.test.ts` exists to
 * catch — that test is what keeps eligibility "derived from the registry, never
 * hand-listed" even though the numbers live in the contract.
 */
export function challengeScoringFor(gameId: string, mode: string | null = null): ChallengeScoringSpec | undefined {
    return CHALLENGE_GAMES.find((game) => game.gameId === gameId && game.mode === mode)?.scoring;
}

/**
 * Central registry of all games available in the Games hub.
 *
 * To add a new game:
 *   1. Create the page component under `src/games/<gameId>/<GameId>Page.tsx`.
 *   2. Add one `GameDef` entry here with a `React.lazy(...)` import.
 *
 * The route registry + metadata
 * (`src/routes/registry.ts`, `src/routes/routeMeta.ts` — where `GAME_ROUTE_META`
 * derives one `chrome: "leaf"` row per entry), and the mobile-demo frame
 * allowlist (`src/components/Layout.tsx`) all derive from this array — adding a
 * game requires no edits to those files.
 */
const ALL_GAMES: GameDef[] = [
    {
        gameId: "bubble-match",
        glyph: "bubble_chart",
        title: "Bubble Match",
        route: "/games/bubble-match",
        // Always shown in the hub. The game page itself handles the
        // unauthenticated case ("Sign in to play") and the not-enough-cards case
        // (shortfall message).
        Component: lazy(() => import("./bubble-match/BubbleMatchPage")),
        hue: BUBBLE_MATCH_HUE,
        markType: BUBBLE_MATCH_MARK_TYPE,
        // Pinyin hidden on a zh board marks READING (constants.ts → MARK_TYPE; the run's
        // `runTrack`). Stated here so the flp game-break picker can offer Bubble Match on
        // the reading flp (docs/FLP_GAME_BREAKS.md § 3).
        noPinyinMarkType: "reading",
        challengeScoring: challengeScoringFor("bubble-match"),
    },
    {
        gameId: "word-search",
        glyph: "grid_on",
        title: "Word Search",
        route: "/games/word-search",
        Component: lazy(() => import("./word-search/WordSearchPage")),
        hue: WORD_SEARCH_HUE,
        modes: WORD_SEARCH_MODES.map(({ mode, markType }) => ({ mode, markType })),
        // No `markType`: Pinyin marks production, No Pinyin marks reading, so the
        // type lives on each mode config (see WordSearchModeConfig.markType).
        //
        // No `challengeScoring` either, for the same reason: eligibility is PER MODE here.
        // Word Search qualifies as Pinyin (production) and not as No Pinyin (reading), so
        // a spec on the game would claim both. Its mode's spec is read with
        // `challengeScoringFor("word-search", "pinyin")`, and a challenge's stored game
        // sequence carries the (gameId, mode) pair rather than a bare id.
    },
    {
        gameId: "match-speed",
        glyph: "timer",
        title: "Match Speed",
        route: "/games/match-speed",
        Component: lazy(() => import("./match-speed/MatchSpeedPage")),
        hue: MATCH_SPEED_HUE,
        markType: MATCH_SPEED_MARK_TYPE,
        // Pinyin hidden ⇒ READING — but ONLY as an flp break (the reading flp hides pinyin,
        // docs/FLP_GAME_BREAKS.md § 3). The standalone page's pinyin chip is display-only
        // and always marks recognition; nothing launches the route with
        // `state.showPinyin: false`, so FocusGameGuard never reads this for Match Speed.
        noPinyinMarkType: "reading",
        challengeScoring: challengeScoringFor("match-speed"),
    },
    {
        gameId: "speed-reading",
        glyph: "bolt",
        title: "Speed Reading",
        // BREAK-ONLY (no route): a reading drill played as an flp game break.
        hue: SPEED_READING_HUE,
        markType: SPEED_READING_MARK_TYPE,
        // zh-only: a round is built by substituting ONE character of the
        // headword, which presupposes a character-based script. See
        // GameDef.languages.
        languages: ["zh"],
    },
    {
        gameId: "hydra-bubbles",
        glyph: "water_drop",
        title: "Hydra Bubbles",
        route: "/games/hydra-bubbles",
        Component: lazy(() => import("./hydra-bubbles/HydraBubblesPage")),
        hue: HYDRA_HUE,
        markType: HYDRA_MARK_TYPE,
        challengeScoring: challengeScoringFor("hydra-bubbles"),
        // No `languages` gate: levels 1..6 exist for every language and nothing in
        // the payout or spawn logic is zh-specific (docs/HYDRA_BUBBLES.md § 9).
        //
        // No `unlock` and NO LEVELS: Hydra has one mode — board size is its difficulty
        // curve — so it takes a single hub tile rather than a level card (`GameCard`).
        // It also declares no card baseline at all (it is absent from CARD_BASELINES,
        // following Memory Map's precedent), so there is nothing to gate on: a run may
        // lend from the very first bubble (§ 6.5).
    },
    {
        gameId: "memory-map",
        glyph: "map",
        title: "Memory Map",
        // BREAK-ONLY (no route): played as an flp game break.
        hue: MEMORY_MAP_HUE,
        markType: MEMORY_MAP_MARK_TYPE,
        // Chinese only (owner, 2026-11-04): hidden from other learners on every launch
        // surface (`isGameAvailable`) and never offered as their flp break
        // (`flpBreakCandidates`). No `challengeScoring` — a challenge round is recognition
        // or production only, and this game marks READING (docs/STUDY_CHALLENGE.md
        // § 5.4). No `unlock`: it declares no card baseline at all, and a learner with
        // no cards gets an empty-state pointing at Discover rather than a locked row
        // (docs/MEMORY_MAP_GAME.md § 10).
        languages: ["zh"],
    },
    {
        gameId: WRITING_GRID_GAME_ID,
        glyph: "draw",
        title: "Writing Grid",
        // BREAK-ONLY (no route): a writing drill played as an flp game break.
        hue: WRITING_GRID_HUE,
        markType: "writing",
        // zh-only: the recognizer is zh_CN and the board is hanzi.
        languages: ["zh"],
    },
    {
        gameId: BUCKET_DROP_GAME_ID,
        glyph: "move_to_inbox",
        title: "Bucket Drop",
        route: "/games/bucket-drop",
        Component: lazy(() => import("./bucket-drop/BucketDropPage")),
        hue: BUCKET_DROP_HUE,
        // MODED, like Word Search: the hub tile launches Pinyin (production — the
        // challenge-eligible mode, `challengeScoringFor("bucket-drop", "pinyin")`). No
        // Pinyin (reading) has a break adapter (`BUCKET_DROP_BREAK`) but is NOT in the
        // flp break rotation (`FLP_BREAK_GAMES`), so it is currently unreachable. So no
        // `markType` and no `challengeScoring` on the game itself (docs/BUCKET_DROP_GAME.md § 1).
        modes: BUCKET_DROP_MODES.map(({ mode, markType }) => ({ mode, markType })),
        // No `languages` gate: es plays the hub's Pinyin mode as plain words.
    },
    {
        gameId: SUPERPOSITION_GAME_ID,
        glyph: "layers",
        title: "Superposition",
        // BREAK-ONLY (no route): an flp break in the writing world (docs/SUPERPOSITION_GAME.md).
        hue: SUPERPOSITION_HUE,
        markType: "writing",
        // zh-only: the tiles are cut from the hanzi stroke corpus.
        languages: ["zh"],
    },
];

/**
 * Every game that is switched ON (`GAME_FLAGS`, server/contracts/featureFlags.ts).
 *
 * Filtering HERE is the single client-side chokepoint for a per-game flag, and it is
 * what the block comment above promises: the route metadata
 * (`GAME_ROUTE_META` in routes/routeMeta.ts), the component bindings
 * (`GAME_COMPONENTS` in routes/registry.ts), `GAME_ROUTES`, `originLabelFor` and the
 * route tests ALL derive from this array, so one filter removes a game from the hub,
 * from the router and from every test that enumerates games, with no other edit.
 *
 * A disabled game's route therefore stops existing rather than 404-ing from a live
 * row — and because `GAME_COMPONENTS` derives from the same filtered array, the
 * registry's boot-time "row with no component" check cannot fire, and its dev-only
 * orphan warning has nothing to report either.
 *
 * The server half is `isGameEnabled` in `GamesController` — a hidden tile does not
 * stop a saved bookmark from POSTing progress.
 */
export const GAME_REGISTRY: GameDef[] = ALL_GAMES.filter((g) => isGameEnabled(g.gameId));

/** True for a ROUTED game (a hub tile with a standalone page); false for a break-only one. */
export function isRoutedGame(game: GameDef): game is RoutedGameDef {
    return game.route !== undefined && game.Component !== undefined;
}

/**
 * The enabled games whose own route is MOUNTED — what the route table
 * (`GAME_ROUTE_META`, `GAME_COMPONENTS`), `originLabelFor` and the route tests read.
 * Break-only games are absent: they have no page to mount.
 *
 * EMPTY while the `standaloneGames` feature flag is off (server/contracts/featureFlags.ts):
 * the Games hub was deleted 2026-11-06, and the routed games' pages are switched off
 * with it. Their `route` + `Component` stay on the registry rows (`isRoutedGame` still
 * tells them apart), so turning the flag back on restores every route with no other edit.
 * Their flp breaks (src/games/flpBreak) are unaffected.
 */
export const ROUTED_GAMES: RoutedGameDef[] = isFeatureEnabled("standaloneGames")
    ? GAME_REGISTRY.filter(isRoutedGame)
    : [];

/** Routes for every routed game; consumed by `MOBILE_DEMO_PATHS`. */
export const GAME_ROUTES: string[] = ROUTED_GAMES.map((g) => g.route);

/** The slice of the signed-in user `isGameAvailable` reads. */
interface GameViewer {
    selectedLanguage?: Language;
}

/**
 * Whether `game` may be shown to this viewer at all — the gating EVERY launch surface
 * applies (the Games hub's `visibleGames`, the flp break picker's `flpBreakCandidates`):
 *   - `languages` HIDES a game from learners of any other language, rather than
 *     showing it and blocking on entry (a visible row that dead-ends reads as a bug).
 * Surface-specific gates (the hub shows ROUTED games only) are layered on top by the
 * surface, not here.
 *
 * Docs: docs/GAMES_FEATURE.md § "Games hub".
 */
export function isGameAvailable(game: GameDef, viewer: GameViewer | null | undefined): boolean {
    if (game.languages && viewer?.selectedLanguage && !game.languages.includes(viewer.selectedLanguage)) return false;
    return true;
}

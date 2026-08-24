import { lazy } from "react";
import type { GameDef } from "./types";
// Each game's own mark-type constant, re-stated here as `GameDef.markType` so the
// hub can label its cards with the mastery track it feeds. Importing the games'
// `constants` modules (not their pages) keeps this cycle-free — a constants file
// never imports the registry. Word Search is absent on purpose: its mark type is
// per-mode, so its hub strip reads it from MODE_CONFIGS instead.
import { GAME_HUE as BUBBLE_MATCH_HUE, MARK_TYPE as BUBBLE_MATCH_MARK_TYPE } from "./bubble-match/constants";
import { GAME_HUE as MATCH_SPEED_HUE, MARK_TYPE as MATCH_SPEED_MARK_TYPE } from "./match-speed/constants";
import { GAME_HUE as SPEED_READING_HUE, MARK_TYPE as SPEED_READING_MARK_TYPE } from "./speed-reading/constants";
import { GAME_HUE as MEMORY_MAP_HUE, MARK_TYPE as MEMORY_MAP_MARK_TYPE } from "./memory-map/constants";
import { GAME_HUE as HYDRA_HUE, MARK_TYPE as HYDRA_MARK_TYPE } from "./hydra-bubbles/constants";
// Word Search has no shared mark type (it is per-mode), but it does have a hue.
import { GAME_HUE as WORD_SEARCH_HUE } from "./word-search/constants";
// The challenge-eligible pool and its scoring numbers (docs/STUDY_CHALLENGE.md § 5.4).
// They live in the shared wire contract rather than here because THE SERVER draws each
// challenge's game sequence and cannot load this module (it imports lazy React
// components), and because live mode must score the same events server-side. This
// registry is still what makes a game ELIGIBLE — see `challengeScoringFor` below and the
// test that pins the two together.
import { CHALLENGE_GAMES } from "../types";
import type { ChallengeScoringSpec } from "../types";

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
 * The hub (`src/games/GamesPage.tsx`), the route registry + metadata
 * (`src/routes/registry.ts`, `src/routes/routeMeta.ts` — where `GAME_ROUTE_META`
 * derives one `chrome: "leaf"` row per entry), and the mobile-demo frame
 * allowlist (`src/components/Layout.tsx`) all derive from this array — adding a
 * game requires no edits to those files.
 */
export const GAME_REGISTRY: GameDef[] = [
    {
        gameId: "bubble-match",
        glyph: "bubble_chart",
        title: "Bubble Match",
        subtitle: "Pop matching pairs",
        route: "/games/bubble-match",
        // Always shown in the hub. The game page itself handles the
        // unauthenticated case ("Sign in to play") and the not-enough-cards case
        // (shortfall message), so we don't gate it out of the menu with
        // requiresAuth — that just made the row invisible while debugging.
        Component: lazy(() => import("./bubble-match/BubbleMatchPage")),
        hue: BUBBLE_MATCH_HUE,
        markType: BUBBLE_MATCH_MARK_TYPE,
        challengeScoring: challengeScoringFor("bubble-match"),
    },
    {
        gameId: "word-search",
        glyph: "grid_on",
        title: "Word Search",
        subtitle: "Hunt words in a grid",
        route: "/games/word-search",
        Component: lazy(() => import("./word-search/WordSearchPage")),
        hue: WORD_SEARCH_HUE,
        // No `markType`: Pinyin marks production, No Pinyin marks reading, so the
        // label belongs on each mode sub-card (see WordSearchModeConfig.markType).
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
        subtitle: "30-second clock",
        route: "/games/match-speed",
        Component: lazy(() => import("./match-speed/MatchSpeedPage")),
        hue: MATCH_SPEED_HUE,
        markType: MATCH_SPEED_MARK_TYPE,
        challengeScoring: challengeScoringFor("match-speed"),
    },
    {
        gameId: "speed-reading",
        glyph: "bolt",
        title: "Speed Reading",
        subtitle: "20 rounds",
        route: "/games/speed-reading",
        Component: lazy(() => import("./speed-reading/SpeedReadingPage")),
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
        subtitle: "Heads grow back",
        route: "/games/hydra-bubbles",
        Component: lazy(() => import("./hydra-bubbles/HydraBubblesPage")),
        hue: HYDRA_HUE,
        markType: HYDRA_MARK_TYPE,
        challengeScoring: challengeScoringFor("hydra-bubbles"),
        // No `languages` gate: levels 1..6 exist for every language and nothing in
        // the payout or spawn logic is zh-specific (docs/HYDRA_BUBBLES.md § 9).
        //
        // No `unlock` and NO LEVELS: Hydra has one mode — board size is its difficulty
        // curve — so it takes a single hub row rather than a HubMenuArrayItem strip.
        // It also declares no card baseline at all (it is absent from CARD_BASELINES,
        // following Memory Map's precedent), so there is nothing to gate on: a run may
        // lend from the very first bubble (§ 6.5).
    },
    {
        gameId: "memory-map",
        glyph: "map",
        title: "Memory Map",
        subtitle: "All Cards only",
        route: "/games/memory-map",
        Component: lazy(() => import("./memory-map/MemoryMapPage")),
        hue: MEMORY_MAP_HUE,
        markType: MEMORY_MAP_MARK_TYPE,
        // No `languages` gate: the map renders through ForeignText, so Spanish works
        // unchanged. No `challengeScoring` either — a challenge round is recognition
        // or production only, and this game marks READING (docs/STUDY_CHALLENGE.md
        // § 5.4). No `unlock`: it declares no card baseline at all, and a learner with
        // no cards gets an empty-state pointing at Discover rather than a locked row
        // (docs/MEMORY_MAP_GAME.md § 10).
        //
        // NOT VISIBLE UNDER A COLLECTION FILTER: GamesPage hides this row whenever the
        // selected collection is anything but All Cards. The map IS your library and
        // cannot be scoped to a deck, and a visible row that ignored the selector would
        // read as a bug (Q21).
    },
];

/** Routes for every registered game; consumed by `MOBILE_DEMO_PATHS`. */
export const GAME_ROUTES: string[] = GAME_REGISTRY.map((g) => g.route);

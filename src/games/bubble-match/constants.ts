import type { MarkType } from "../../types";
import type { LevelConfig } from "./types";

/**
 * Bubble Match — the tunable constants specific to THIS game.
 *
 * The field constants every bubble game shares (sizing bands, drift/collision
 * physics, spawn placement, fill/loss ratios, the cancel strip, match-feedback
 * timing, the status feedback palette) live in src/games/bubbles/constants.ts.
 * What is left here is Bubble Match's own: which cards it asks for, its level
 * table, its descending ceiling, and its kind-keyed bubble palette.
 *
 * Referenced by: BubbleMatchPage, BubbleStage, GamesPage (level sub-cards),
 * games/registry.ts (mark type), games/word-search/constants.ts (distribution).
 * Docs: docs/GAMES_FEATURE.md.
 */

/**
 * The mastery track this game feeds (docs/MASTERY_REWORK.md). Bubble Match is a
 * recognition drill (foreign → meaning), so every mark it writes is a RECOGNITION
 * mark and its card pool must be bucketed/cooled by that same track.
 *
 * Single source of truth for all three places that need it: the `?markType=`
 * pool query and the /api/flashcards/mark call (BubbleMatchPage), and the Games
 * hub's mark-type chip (via GAME_REGISTRY's `markType`).
 */
export const MARK_TYPE: MarkType = "recognition";

/** Game key under which Bubble Match wins are logged in the shared `wins` table
 *  ({ game, level }), read via useGameWins (src/hooks/useGameWins.ts). Shared
 *  by BubbleMatchPage (in-run badges) and the Games hub (level sub-card
 *  badges) so both read the same win data under the same key. */
export const GAME_KEY = "bubbleMatch";

// Launch config: how many cards the "Play" button targets from each bucket.
// 2 Unfamiliar + 10 Target + 6 Comfortable + 2 Mastered = 20 pairs total.
// This is the *preferred* mix — the server tops the pool up to 20 from fallback
// buckets (Target → Comfortable → Unfamiliar → Mastered) when a bucket can't
// fill its quota, so a run always uses 20 cards as long as the user has 20
// library cards total.
export const GAME_DISTRIBUTION: Record<string, number> = {
    Unfamiliar: 2,
    Target: 10,
    Comfortable: 6,
    Mastered: 2,
};

// Total pairs in a full run (sum of GAME_DISTRIBUTION). Every game uses them all
// — 20 pairs → 40 bubbles. The level only changes launch cadence + ceiling-shrink
// speed; there is no per-level pair count and no clock (see LEVEL_CONFIGS).
export const TOTAL_PAIRS = Object.values(GAME_DISTRIBUTION).reduce((a, b) => a + b, 0);

// Floor for a "Play Again" board. That replay keeps the pairs the player failed
// to match and refills only the matched ones, so a library that shrank mid-session
// can hand back fewer than TOTAL_PAIRS. A slightly short board still plays fine
// (BubbleStage sizes itself off the pool length), but below this there's no game
// worth starting and the page blocks instead.
export const MIN_REPLAY_PAIRS = 4;

// Cap on the "recently cleared" id list a Play Again refill sends as `avoid`. The
// set grows by up to TOTAL_PAIRS per round and rides in the query string, so a long
// session would otherwise build an unbounded URL. Only the most recently cleared
// ids are sent (insertion order); older ones age out of the soft cooldown, which is
// the intended behavior anyway.
export const MAX_AVOID_IDS = 200;

// Three independently-playable difficulty levels. Higher levels launch the
// 40 bubbles faster AND drop the ceiling faster once they're all out, so the
// field jams quicker. There is no clock — the only loss is the field over-packing
// under the descending ceiling. Levels do NOT chain — the player picks one on the
// GAMES HUB (one HubMenuArrayItem sub-card per entry below; there is no in-game
// picker) and plays it on its own; clearing a harder level also banks every easier
// level's weekly badge. The old second tier (interval ≈ 1425 ms)
// was dropped, leaving Chill / Hustle / Torture.
export const LEVEL_CONFIGS: LevelConfig[] = [
    { level: 1, label: "Chill", launchIntervalMs: 1800, shrinkSpeedPxPerSec: 9 },
    { level: 2, label: "Hustle", launchIntervalMs: 1000, shrinkSpeedPxPerSec: 26 },
    { level: 3, label: "Torture", launchIntervalMs: 800, shrinkSpeedPxPerSec: 42 },
];

// ---- Descending ceiling ---------------------------------------------------
// Once the whole pool has launched, the play area's TOP wall starts moving down
// at the level's shrinkSpeedPxPerSec, compressing the field until the area-packing
// / residual signals trip the overfill loss (this is what replaced the old clock).
// The ceiling descends ALL the way to the floor (0 play height): if even a single
// pair is still unmatched, the shrinking area eventually pushes fillRatio past the
// loss line, and at exactly 0 height fillRatio returns 1 (its stageArea<=0 guard),
// guaranteeing the loss. (A nonzero floor used to leave 1–2 leftover bubbles in a
// no-win/no-lose limbo — too few to ever cover 85% of an 80px-tall strip.)
//
// Bubble Match ONLY. The ceiling is this game's clock substitute; Hydra Bubbles
// is endless and squeezes the field by spawning instead, so it never raises
// bounds.top and the shared physics has no ceiling concept of its own.
export const MIN_PLAY_HEIGHT = 0; // px — the ceiling closes the play area completely

// ---- Base bubble palette (kind-keyed) ------------------------------------
// Bubble Match colors a bubble by its KIND — pale blue for the foreign word,
// cream for the English definition — so the two sides of a match are legible at
// a glance. (Hydra Bubbles instead colors by the card's lend/mastery tier, which
// is why this palette is per-game and the shared Bubble takes a `fill` prop.)
// The status feedback colors (correct/wrong/revealed/nomatch) are shared and
// live in src/games/bubbles/constants.ts.
export const WORD_BUBBLE_BG = "#EAF1FF";
export const WORD_BUBBLE_BORDER = "#B9CDF5";
export const DEFINITION_BUBBLE_BG = "#FFF3E6";
export const DEFINITION_BUBBLE_BORDER = "#F2D2A8";

import { COLORS, type RampHue } from "../../theme/colors";
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
 * The mastery track this game feeds WITH PINYIN ON (docs/MASTERY_REWORK.md § 1a) —
 * and the track it declares to the registry.
 *
 * Bubble Match is a foreign → meaning drill, so its track follows the same rule the
 * flp's Chinese-side-one face does: pinyin shown ⇒ RECOGNITION, pinyin hidden on a zh
 * board ⇒ READING (the learner reaches the meaning from the characters alone). The
 * per-run answer comes from `foreignPromptTrack` (server/contracts/wire.ts), read ONCE
 * when the board is dealt and held for the whole run — BubbleMatchPage's `runTrack` —
 * because the pool is bucketed and cooled on that same track when it is requested.
 *
 * This constant is what the run defaults to and what `GAME_REGISTRY` declares as the
 * game's track for STUDY CHALLENGE eligibility (`challengeEligibleGames()`), which is
 * a property of the game rather than of one run's display setting.
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
// TWO COLOURS, AND THE RULE IS EXACTLY ONE BIT WIDE (docs/SHELF_REDESIGN.md § 12):
// the game's red accent means "this bubble is a foreign word", inert grey means "this
// bubble is a meaning". Nothing else is encoded — not difficulty, not mastery, not
// how long a bubble has been on the field.
//
// That restraint is what makes the STATUS colours (correct / wrong / nomatch, in
// src/games/bubbles/constants.ts) readable: they are the only other fills a Bubble
// Match bubble can ever take, so a green or a red bubble is unambiguously feedback.
// Hydra Bubbles spends its colour budget differently — on the drain/bloom payout
// ladder — which is why this palette is per-game and the shared `Bubble` takes a
// `fill` prop rather than knowing either scheme.
//
// The borders match their fills: the design's `.bub` has no ring at all, its edge
// comes from the inset gloss (see Bubble.tsx). A same-colour border keeps the
// element's geometry identical to a bubble that DOES want a ring (Hydra's tier
// weights) instead of making the two games' bubbles different sizes.
export const WORD_BUBBLE_BG = COLORS.red;
export const WORD_BUBBLE_BORDER = COLORS.red;
export const DEFINITION_BUBBLE_BG = COLORS.grey;
export const DEFINITION_BUBBLE_BORDER = COLORS.grey;

/**
 * THE GAME'S HUE — its hub row's colour AND the accent ground its own screen is
 * flooded with (docs/SHELF_REDESIGN.md § A6b).
 *
 * It lives here rather than as a literal in `GAME_REGISTRY` so the two cannot drift:
 * the registry reads this, and the page passes it to `gameSurfaceSx` /
 * `GameSurfaceProvider`. Tapping a red row must open a red screen.
 */
export const GAME_HUE: RampHue = "red";

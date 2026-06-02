import type { LevelConfig } from "./types";

/**
 * Bubble Match — tunable constants.
 *
 * Everything here is meant to be adjusted while balancing the game. The level
 * table is the main lever: pair counts sum to GAME_DISTRIBUTION's total so a
 * single shuffled pool is split across levels with no repeats.
 */

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
// — 20 pairs → 40 bubbles. The level only changes launch cadence + duration.
export const TOTAL_PAIRS = Object.values(GAME_DISTRIBUTION).reduce((a, b) => a + b, 0);

// Three difficulty levels (picked before play; they do NOT chain). Higher levels
// launch the 40 bubbles faster, so the field fills quicker — tune freely.
export const LEVEL_CONFIGS: LevelConfig[] = [
    { level: 1, label: "Relaxed", launchIntervalMs: 2150, durationSec: 120 },
    { level: 2, label: "Brisk", launchIntervalMs: 1500, durationSec: 90 },
    { level: 3, label: "Frantic", launchIntervalMs: 700, durationSec: 60 },
];

// ---- Bubble sizing (px radius) -------------------------------------------
// Word bubbles hold cpcd (char + pinyin); definition bubbles hold wrapped text
// and run a little larger so the definition stays legible.
export const WORD_RADIUS_MIN = 38;
export const WORD_RADIUS_MAX = 52;
export const DEFINITION_RADIUS_MIN = 46;
export const DEFINITION_RADIUS_MAX = 62;
// Word bubbles size up with their Chinese length: a 1-character word sits at the
// small end of the band, this many characters or more at the big end, with
// everything in between interpolated (mirrors the definition length mapping).
export const WORD_LEN_MIN = 1;
export const WORD_LEN_MAX = 4;
// Random wobble (px, ±) added on top of the length-derived word radius so two
// words of the same character count don't render as identical circles. Kept
// small so the size still reads as "proportional to the text".
export const WORD_RADIUS_JITTER = 4;
// Definition bubbles size up with their text: a definition this short (chars,
// post stripParentheses) sits at the small end of the band, this long at the big
// end, with everything in between interpolated. Anything outside clamps to an end.
export const DEFINITION_LEN_MIN = 8;
export const DEFINITION_LEN_MAX = 50;
// Random wobble (px, ±) added on top of the length-derived radius so two defs of
// the same length don't come out as identical circles. Kept small so the size
// still reads as "proportional to the text".
export const DEFINITION_RADIUS_JITTER = 4;

// ---- Physics --------------------------------------------------------------
export const IDLE_SPEED = 26; // px/sec target drift speed for floating bubbles
export const RESTITUTION = 0.92; // bounciness on wall/bubble collisions (0..1)
export const WANDER_ACCEL = 8; // px/sec^2 random wander to keep motion lively
export const MAX_SPEED = 140; // px/sec clamp so thrown bubbles stay controllable
export const MAX_DT = 1 / 30; // clamp frame delta (sec) to avoid tunneling on lag
export const ENTER_SPEED = 320; // px/sec a newly launched bubble flies in from off-screen
export const ENTER_MARGIN = 24; // px a bubble starts beyond the edge before flying in

// Scale targets for interaction feedback.
export const SCALE_IDLE = 1;
export const SCALE_HELD = 1.12;
export const SCALE_HOVER = 1.18; // the drop-target grows a touch more than the held bubble
export const SCALE_LERP = 0.25; // per-frame approach factor toward targetScale

// ---- Fill / loss ----------------------------------------------------------
// Loss is governed by how densely bubbles pack the stage, NOT by failing to find
// a free spawn spot (launched bubbles always enter near a wall and shove floaters
// inward). Two complementary signals decide "overfilled → game over":
//
//   1. Area packing (primary, deterministic). The max packing density for circles
//      is π/√12 ≈ 0.9069 (perfect hex lattice); a jiggling, wall-bounded soft sim
//      with mixed radii jams well below that. Past LOSE_FILL_RATIO the separation
//      solver can no longer keep everyone apart, so we call it.
//   2. Sustained residual overlap (safety net). If total unresolved penetration
//      (px summed over all colliding pairs) stays above OVERFILL_RESIDUAL_PX for
//      OVERFILL_SUSTAIN_MS, the solver is provably stuck even if area is borderline.
//
// DANGER_FILL_RATIO is a *warning* glow and must sit below LOSE_FILL_RATIO.
export const DANGER_FILL_RATIO = 0.72; // border glows red — "you're getting full"
export const LOSE_FILL_RATIO = 0.85; // area coverage at which the field is unwinnable
export const OVERFILL_RESIDUAL_PX = 220; // total pairwise penetration (px) that counts as "stuck"
export const OVERFILL_SUSTAIN_MS = 600; // residual must persist this long before we lose

// How far inside the entry wall a launched bubble aims. It flies to this point
// (infinite-mass) shoving floaters inward, then becomes a normal idle bubble.
export const ENTRY_INSET = 12; // px gap between the bubble's edge and the wall it entered from

// ---- Match feedback timing (ms) ------------------------------------------
export const POP_DURATION_MS = 280; // green pop before a correct pair is removed
export const WRONG_FEEDBACK_MS = 420; // red shake before a wrong pair is released

// Bubble palette (kept local; harmonizes with the flashcard surface tokens).
export const WORD_BUBBLE_BG = "#EAF1FF";
export const WORD_BUBBLE_BORDER = "#B9CDF5";
export const DEFINITION_BUBBLE_BG = "#FFF3E6";
export const DEFINITION_BUBBLE_BORDER = "#F2D2A8";
export const CORRECT_BUBBLE_BG = "#4CAF50";
export const WRONG_BUBBLE_BG = "#F44336";

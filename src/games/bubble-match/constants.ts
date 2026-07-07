import type { LevelConfig } from "./types";

/** Game key under which Bubble Match wins are logged in the shared `wins` table
 *  ({ game, level }), read via useGameWins (src/hooks/useGameWins.ts). Shared
 *  by BubbleMatchPage (in-run badges) and the Games hub (level sub-card
 *  badges) so both read the same win data under the same key. */
export const GAME_KEY = "bubbleMatch";

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

// Three independently-playable difficulty levels. Higher levels launch the
// 40 bubbles faster AND drop the ceiling faster once they're all out, so the
// field jams quicker. There is no clock — the only loss is the field over-packing
// under the descending ceiling. Levels do NOT chain — the player picks one from
// the start screen and plays it on its own; clearing a harder level also banks
// every easier level's weekly badge. The old second tier (interval ≈ 1425 ms)
// was dropped, leaving Chill / Hustle / Torture.
export const LEVEL_CONFIGS: LevelConfig[] = [
    { level: 1, label: "Chill", launchIntervalMs: 1800, shrinkSpeedPxPerSec: 9 },
    { level: 2, label: "Hustle", launchIntervalMs: 1100, shrinkSpeedPxPerSec: 26 },
    { level: 3, label: "Torture", launchIntervalMs: 700, shrinkSpeedPxPerSec: 42 },
];

// ---- Bubble sizing (px radius) -------------------------------------------
// Word bubbles hold cpcd (char + pinyin); definition bubbles hold wrapped text
// and run a little larger so the definition stays legible.
export const WORD_RADIUS_MIN = 46; // ~38 × 1.2
export const WORD_RADIUS_MAX = 62; // ~52 × 1.2
export const DEFINITION_RADIUS_MIN = 55; // ~46 × 1.2
export const DEFINITION_RADIUS_MAX = 74; // ~62 × 1.2
// Word bubbles size up with their Chinese length: a 1-character word sits at the
// small end of the band, this many characters or more at the big end, with
// everything in between interpolated (mirrors the definition length mapping).
export const WORD_LEN_MIN = 1;
export const WORD_LEN_MAX = 4;
// Random wobble (px, ±) added on top of the length-derived word radius so two
// words of the same character count don't render as identical circles. Kept
// small so the size still reads as "proportional to the text".
export const WORD_RADIUS_JITTER = 5; // ~4 × 1.2
// Definition bubbles size up with their text: a definition this short (chars,
// post stripParentheses) sits at the small end of the band, this long at the big
// end, with everything in between interpolated. Anything outside clamps to an end.
export const DEFINITION_LEN_MIN = 8;
export const DEFINITION_LEN_MAX = 50;
// Random wobble (px, ±) added on top of the length-derived radius so two defs of
// the same length don't come out as identical circles. Kept small so the size
// still reads as "proportional to the text".
export const DEFINITION_RADIUS_JITTER = 5; // ~4 × 1.2

// ---- Physics --------------------------------------------------------------
// Bubbles do NOT drift: once a bubble finishes growing it sits still. The only
// motion is (a) a freshly spawned bubble growing in place, (b) the positional
// shove a growing bubble gives the neighbors it overlaps, and (c) the player's
// own drag. No velocity model, no wander, no wall bounce, no throw-on-release.
export const MAX_DT = 1 / 30; // clamp frame delta (sec) to avoid tunneling on lag

// ---- Spawn / grow-in ------------------------------------------------------
// A new bubble appears at a chosen spot at SPAWN_SEED_RADIUS and inflates toward
// its targetRadius. planSpawn (physics.ts) picks the spot: it tries up to
// SPAWN_MAX_ATTEMPTS random locations and rejects any where the new bubble (at
// full size) would penetrate an existing bubble by more than SPAWN_OVERLAP_FRACTION
// of that bubble's *diameter* (the "20% rule"). If the board is too full for any
// spot to clear the rule, it places at the least-bad spot anyway so the field can
// still over-pack and trip the overfill loss.
export const GROW_LERP = 0.09; // per-frame approach factor of radius → targetRadius (halved for a gentler inflate)
// Max speed (px/sec) a bubble may be shoved aside by a growing neighbor. The
// separation solver moves a pushed bubble at most MAX_PUSH_SPEED*dt per frame so
// it glides to its separated spot instead of snapping there instantly.
export const MAX_PUSH_SPEED = 260; // tunable feel parameter
export const SPAWN_SEED_RADIUS = 4; // px radius a bubble starts at before growing
export const SPAWN_MAX_ATTEMPTS = 60; // random candidate spots tried per spawn
export const SPAWN_OVERLAP_FRACTION = 0.2; // max penetration as a fraction of the other bubble's diameter

// Scale targets for interaction feedback.
export const SCALE_IDLE = 1;
export const SCALE_HELD = 1.12;
export const SCALE_HOVER = 1.18; // the drop-target grows a touch more than the held bubble
export const SCALE_LERP = 0.25; // per-frame approach factor toward targetScale

// ---- Fill / loss ----------------------------------------------------------
// Loss is governed by how densely bubbles pack the stage. Each freshly spawned
// bubble grows in place as an infinite-mass body, shoving the bubbles it overlaps
// outward to make room. When the field gets crowded those shoves can no longer
// fully separate everyone, which the two complementary signals below detect:
//
//   1. Area packing (primary, deterministic). The max packing density for circles
//      is π/√12 ≈ 0.9069 (perfect hex lattice); a wall-bounded soft sim with mixed
//      radii jams well below that. Past LOSE_FILL_RATIO the separation solver can
//      no longer keep everyone apart, so we call it.
//   2. Sustained residual overlap (safety net). If total unresolved penetration
//      (px summed over all colliding pairs) stays above OVERFILL_RESIDUAL_PX for
//      OVERFILL_SUSTAIN_MS, the solver is provably stuck even if area is borderline.
//
// DANGER_FILL_RATIO is a *warning* glow and must sit below LOSE_FILL_RATIO.
export const DANGER_FILL_RATIO = 0.72; // border glows red — "you're getting full"
export const LOSE_FILL_RATIO = 0.85; // area coverage at which the field is unwinnable
export const OVERFILL_RESIDUAL_PX = 220; // total pairwise penetration (px) that counts as "stuck"
export const OVERFILL_SUSTAIN_MS = 600; // residual must persist this long before we lose

// ---- Descending ceiling ---------------------------------------------------
// Once the whole pool has launched, the play area's TOP wall starts moving down
// at the level's shrinkSpeedPxPerSec, compressing the field until the area-packing
// / residual signals trip the overfill loss (this is what replaced the old clock).
// The ceiling descends ALL the way to the floor (0 play height): if even a single
// pair is still unmatched, the shrinking area eventually pushes fillRatio past the
// loss line, and at exactly 0 height fillRatio returns 1 (its stageArea<=0 guard),
// guaranteeing the loss. (A nonzero floor used to leave 1–2 leftover bubbles in a
// no-win/no-lose limbo — too few to ever cover 85% of an 80px-tall strip.)
export const MIN_PLAY_HEIGHT = 0; // px — the ceiling closes the play area completely

// ---- Cancel zone ----------------------------------------------------------
/** Height (px) of the bottom "drop here to cancel match" strip. Carved out of the
    stage: it's outside the play area (no spawns, no pushes, excluded from the
    overfill fill-ratio). The strip's top edge is the play-area bottom wall, so a
    bubble dragged into it is clamped back out on release. Matches the app footer
    height (MobileFooter). */
export const CANCEL_ZONE_HEIGHT = 96;

// ---- Match feedback timing (ms) ------------------------------------------
export const POP_DURATION_MS = 280; // green pop before a correct pair is removed
export const WRONG_FEEDBACK_MS = 420; // red shake before a wrong pair is released

// ---- Post-run loop shutdown ----------------------------------------------
// After a run ends (won/lost) the stage stays mounted behind the popup, but
// once the field stops moving there's nothing left to animate, so the rAF loop
// stops rescheduling itself (it otherwise keeps writing transforms to ~40 nodes
// every frame, competing with the popup's buttons for the main thread). The
// loop halts as soon as every bubble's scale has settled; this is the hard cap
// for the over-packed loss case, where bubbles stay mutually overlapping and the
// separation solver never fully settles — we let it nudge for this long, then
// freeze the field (the run is already over).
export const POST_DONE_SETTLE_MS = 900;

// Bubble palette (kept local; harmonizes with the flashcard surface tokens).
export const WORD_BUBBLE_BG = "#EAF1FF";
export const WORD_BUBBLE_BORDER = "#B9CDF5";
export const DEFINITION_BUBBLE_BG = "#FFF3E6";
export const DEFINITION_BUBBLE_BORDER = "#F2D2A8";
// Light green: a correct match pop AND the cleanup-mode "here's your partner"
// drop hint (the `revealed` status). Deliberately soft so it reads as friendly,
// not alarming — paired with dark text (see Bubble.tsx) for contrast.
export const CORRECT_BUBBLE_BG = "#A5D6A7";
export const CORRECT_BUBBLE_BORDER = "#7BB97F";
// Strong red: a wrong drag-drop error flash (with the shake).
export const WRONG_BUBBLE_BG = "#F44336";
// Light red: a cleanup-mode bubble whose partner isn't on the field, so it can
// never be matched/cleared. Distinct (softer) from the wrong-drop red — it marks
// "unavailable", not "error".
export const NOMATCH_BUBBLE_BG = "#EF9A9A";
export const NOMATCH_BUBBLE_BORDER = "#E07B7B";

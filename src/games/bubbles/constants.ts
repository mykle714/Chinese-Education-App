/**
 * Bubbles — the tunable constants shared by every game on the bubble field.
 *
 * SCOPE RULE FOR THIS FILE: a constant belongs here when it describes the FIELD
 * (how bubbles are sized, how they move, when the field counts as over-packed,
 * how a match animates). A constant belongs in the owning game's own
 * constants.ts when it describes that GAME (its card distribution, its level
 * table, its mark type, its base palette). Bubble Match's descending ceiling,
 * for instance, stays in bubble-match/constants.ts because Hydra has no ceiling.
 *
 * Referenced by: src/games/bubbles/{physics,bodyFactory,Bubble}, every game
 * stage, and src/__tests__/bubbleMatchSpawn.test.ts.
 * Docs: docs/GAMES_FEATURE.md, docs/HYDRA_BUBBLES.md § 3 (the fill-ratio spawn
 * table reads the same LOSE_FILL_RATIO the overflow loss reads).
 */

// ---- Bubble sizing (px radius) -------------------------------------------
// Word bubbles hold the foreign headword (char + pinyin); definition bubbles
// hold wrapped English text and run a little larger so the gloss stays legible.
export const WORD_RADIUS_MIN = 46; // ~38 × 1.2
export const WORD_RADIUS_MAX = 62; // ~52 × 1.2
export const DEFINITION_RADIUS_MIN = 55; // ~46 × 1.2
export const DEFINITION_RADIUS_MAX = 74; // ~62 × 1.2
// Word bubbles size up with their character length: a 1-character word sits at
// the small end of the band, this many characters or more at the big end, with
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
// Settled bubbles DRIFT: once a bubble finishes growing it floats like a
// lava-lamp bubble — a small random wander accelerates it, its speed is eased
// back toward IDLE_SPEED, and it reflects off the walls and off its neighbors.
// (The drift model was removed in the grow-in-place rework and reinstated here
// at 20% of its original magnitude — an 80% reduction, see DRIFT_SCALE.) On top
// of drift there is still (a) a freshly spawned bubble growing in place, (b) the
// positional shove a growing bubble gives the neighbors it overlaps, and (c) the
// player's own drag. There is no throw-on-release: a dropped bubble simply
// resumes drifting with the velocity it had when it was picked up.
export const MAX_DT = 1 / 30; // clamp frame delta (sec) to avoid tunneling on lag

// Single knob scaling every drift *magnitude* (speeds and accelerations) against
// the original tuning. 1 = the original lively float; 0.3 = the current 70%-
// reduced gentle shimmer; 0 = a fully static field (the pre-reinstatement
// behavior). Ratios like RESTITUTION are deliberately NOT scaled by it.
export const DRIFT_SCALE = 0.3;
export const IDLE_SPEED = 26 * DRIFT_SCALE; // px/sec target drift speed for floating bubbles
export const WANDER_ACCEL = 8 * DRIFT_SCALE; // px/sec^2 random wander to keep motion lively
export const MAX_SPEED = 140 * DRIFT_SCALE; // px/sec clamp so a bubble can never run away
export const RESTITUTION = 0.92; // bounciness on wall/bubble collisions (0..1) — a ratio, unscaled
// Per-frame factor easing a bubble's speed back toward IDLE_SPEED, so collisions
// can briefly spike velocity without the field ever speeding up permanently and
// bubbles never fully stop.
export const IDLE_SPEED_LERP = 0.02;

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
// Loss line. Deliberately LENIENT: soft bodies with mixed radii can be squeezed
// well past a "comfortable" pack before the field is genuinely unplayable, and
// ending the run at 0.85 cut players off while they could still see matches. At
// 0.94 the board is visibly wall-to-wall before we call it, which also stretches
// the red-glow danger band (0.72 → 0.94) into a long, readable warning.
//
// ⚠️ Hydra Bubbles keys its ENTIRE spawn table on this same fill ratio
// (docs/HYDRA_BUBBLES.md § 3.1), precisely so the number that decides "how many
// bubbles do I pay out" is the number that decides "have I lost". Moving this
// constant re-tunes Hydra's economy as well as Bubble Match's loss line.
export const LOSE_FILL_RATIO = 0.94; // area coverage at which the field is unwinnable
// Safety net for the case where area is borderline but the separation solver is
// provably stuck. Both knobs are generous so a transient jam (a wrong drop, a
// burst of spawns, the ceiling stepping down) never ends the run on its own —
// the overlap has to be both deep AND persistent.
export const OVERFILL_RESIDUAL_PX = 520; // total pairwise penetration (px) that counts as "stuck"
export const OVERFILL_SUSTAIN_MS = 1600; // residual must persist this long before we lose

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
// After a run ends the stage stays mounted behind the popup, but once the field
// stops moving there's nothing left to animate, so the rAF loop stops
// rescheduling itself (it otherwise keeps writing transforms to ~40 nodes every
// frame, competing with the popup's buttons for the main thread). The loop halts
// as soon as every bubble's scale has settled; this is the hard cap for the
// over-packed loss case, where bubbles stay mutually overlapping and the
// separation solver never fully settles — we let it nudge for this long, then
// freeze the field (the run is already over).
export const POST_DONE_SETTLE_MS = 900;

// ---- Shared status feedback palette --------------------------------------
// These are keyed on BubbleStatus, not on game or card, so every bubble game
// speaks the same visual language for "right", "wrong" and "unmatchable". A
// game's BASE colors (what an idle bubble looks like) are its own: Bubble Match
// keys them on kind, Hydra on the card's tier. See BubbleFill in types.ts.

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

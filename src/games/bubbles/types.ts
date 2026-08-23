import type { VocabEntry } from "../../types";

/**
 * Bubbles — the domain types shared by every game built on the bubble field
 * (Bubble Match, Hydra Bubbles). Extracted from bubble-match so a second game
 * can reuse the physics/rendering substrate without importing the first game.
 *
 * A "pair" is one vocab word and its definition. Each pair yields two bubbles
 * that share a `pairId`: one `word` bubble (the foreign headword, via
 * ForeignText) and one `definition` bubble (the flashcard's English dd).
 * Matching a pair = dragging either bubble onto its partner (same `pairId`).
 *
 * Referenced by: src/games/bubbles/{physics,bodyFactory,Bubble}, and every
 * game's stage (src/games/bubble-match/BubbleStage.tsx).
 * Docs: docs/GAMES_FEATURE.md, docs/HYDRA_BUBBLES.md.
 */

export type BubbleKind = "word" | "definition";

/**
 * Interaction/animation status of a bubble. Drives its visual treatment:
 * - `growing`   — spawned in place and inflating from a tiny seed to its target
 *                 size, shoving any bubbles it overlaps aside (infinite-mass
 *                 while it grows so it holds its chosen spot).
 * - `idle`      — settled at full size and drifting: a gentle random wander plus
 *                 wall/neighbor bounces keep it slowly floating (see DRIFT_SCALE).
 * - `held`      — picked up by the pointer (enlarged, plus a grey wash — one cue
 *                 for every bubble game; see Bubble's `.bubble__dim` overlay).
 * - `hovered`   — the current drop target under a held bubble (same treatment).
 * - `correct`   — a valid match just landed (light-green + pop, then removed).
 * - `wrong`     — an invalid match just landed (red flash + shake, then released).
 * - `revealed`  — cleanup mode (post-loss, game-over popup minimized): the held
 *                 bubble's matching partner, highlighted light-green as a drop
 *                 hint while it's being dragged. Persistent (no pop/removal) until
 *                 the drag ends or a different bubble is picked up.
 * - `nomatch`   — cleanup mode: the currently-grabbed bubble has no partner on the
 *                 field (it was still queued when the run was lost), so it can
 *                 never be matched. Rendered light-red (instead of the held dim)
 *                 for as long as it's grabbed; released back to idle on drop.
 */
export type BubbleStatus = "growing" | "idle" | "held" | "hovered" | "correct" | "wrong" | "revealed" | "nomatch";

/**
 * Physics + interaction state for a single bubble. This is the mutable source of
 * truth held in a ref and advanced by the rAF loop; the React layer only reads
 * it (via a version bump) for structural/status renders, never per-frame.
 */
export interface BubbleBody {
    id: string;
    pairId: string;
    kind: BubbleKind;
    /** The vocab entry behind this bubble (both members of a pair share it). */
    entry: VocabEntry;
    /** Center position (px) within the stage. */
    x: number;
    y: number;
    /** Drift velocity (px/sec). Integrated every frame while the bubble is idle
        (i.e. neither held nor still growing); nudged by the random wander, eased
        back toward IDLE_SPEED, and reflected by wall/neighbor bounces. */
    vx: number;
    vy: number;
    /** Current, animating collision radius. While `status === "growing"` it lerps
        from a tiny seed up to `targetRadius`; once settled it equals `targetRadius`. */
    radius: number;
    /** Final radius: the fixed layout size, the collision size once grown, and
        the denominator for the grow-in scale (rendered scale = radius / targetRadius). */
    targetRadius: number;
    /** Collision mass (∝ targetRadius² area) so big bubbles shove small ones. */
    mass: number;
    /** Current rendered scale; lerps toward `targetScale` each frame. */
    scale: number;
    targetScale: number;
    status: BubbleStatus;
}

/**
 * The base (non-feedback) colors of one bubble. Supplied per body BY THE GAME,
 * because the two games key it on different things: Bubble Match colors by
 * `kind` (red word / grey definition), Hydra Bubbles colors by the card's
 * PAYOUT TIER — `drain` / `bloom`, which is its lend tier or its mastery band
 * depending on where the card came from (docs/HYDRA_BUBBLES.md § 5). The status-driven feedback colors
 * — correct/wrong/revealed/nomatch — are shared and live in constants.ts, so
 * they are NOT part of this.
 *
 * COLOR IS THE ONLY THING A GAME MAY VARY. Every other property of a bubble —
 * the 40% squircle, the 2px ring, the three-shadow gloss, the grey held wash —
 * is fixed in `Bubble` with Bubble Match as the reference, so the two games
 * render one object in two palettes rather than two objects. There used to be a
 * `ringWidth` knob here (Hydra wore a 3px ring so ring WEIGHT could separate its
 * payout bubbles from inert English ones); it was removed 2026-08-22 when the
 * styles were unified, and that separation now rests on body value and hue
 * alone (docs/HYDRA_BUBBLES.md § 5).
 */
export interface BubbleFill {
    bg: string;
    border: string;
}

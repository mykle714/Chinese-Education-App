import type { VocabEntry } from "../../features/flashcards/FlashcardsLearnPage/types";

/**
 * Bubble Match — domain types.
 *
 * A "pair" is one vocab word and its definition. Each pair yields two bubbles
 * that share a `pairId`: one `word` bubble (Chinese + colored pinyin via cpcd)
 * and one `definition` bubble (the flashcard's English definition). Matching a
 * pair = dragging either bubble onto its partner (same `pairId`).
 */

export type BubbleKind = "word" | "definition";

/**
 * Interaction/animation status of a bubble. Drives its visual treatment:
 * - `growing`   — spawned in place and inflating from a tiny seed to its target
 *                 size, shoving any bubbles it overlaps aside (infinite-mass
 *                 while it grows so it holds its chosen spot).
 * - `idle`      — settled at full size, sitting still (no autonomous drift).
 * - `held`      — picked up by the pointer (enlarged + greyed).
 * - `hovered`   — the current drop target under a held bubble (enlarged + greyed).
 * - `correct`   — a valid match just landed (green + pop, then removed).
 * - `wrong`     — an invalid match just landed (red flash + shake, then released).
 * - `nomatch`   — study mode: a tapped bubble whose partner isn't on screen. Same
 *                 red flash as `wrong` but WITHOUT the shake (no drag happened —
 *                 the tap was valid, there was just nothing to pair with).
 * - `revealed`  — study mode (game-over popup minimized): this bubble and its
 *                 partner are highlighted green for reference. Persistent — no
 *                 pop/removal; cleared when the selection changes or study ends.
 */
export type BubbleStatus = "growing" | "idle" | "held" | "hovered" | "correct" | "wrong" | "nomatch" | "revealed";

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
 * A difficulty level. A single game always uses the full pool (all pairs from
 * the launch config); the chosen level only changes how fast bubbles launch and
 * how fast the ceiling closes in once they're all out. Levels do NOT chain —
 * one level per session. There is no clock: the run ends when the player clears
 * every pair (win) or the descending ceiling jams the field (lose).
 */
export interface LevelConfig {
    /** 1-based level number shown in the picker / HUD. */
    level: number;
    /** Short label for the picker (e.g. "Chill", "Hustle", "Torture"). */
    label: string;
    /** Delay between successive bubble launches (ms). Lower = faster/harder. */
    launchIntervalMs: number;
    /** Speed (px/sec) the top boundary descends once the whole pool has launched.
        Higher = the field compresses (and the player loses) faster. */
    shrinkSpeedPxPerSec: number;
}

/** High-level game phase the page renders against. */
export type GamePhase = "playing" | "won" | "lost";

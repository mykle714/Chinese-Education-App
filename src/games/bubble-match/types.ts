import type { VocabEntry } from "../../pages/FlashcardsLearnPage/types";

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
 * - `entering`  — flying in from off-screen to its target spot, shoving any
 *                 bubbles in its path aside (infinite-mass while it travels).
 * - `idle`      — floating freely.
 * - `held`      — picked up by the pointer (enlarged + greyed).
 * - `hovered`   — the current drop target under a held bubble (enlarged + greyed).
 * - `correct`   — a valid match just landed (green + pop, then removed).
 * - `wrong`     — an invalid match just landed (red flash + shake, then released).
 * - `revealed`  — study mode (game-over popup minimized): this bubble and its
 *                 partner are highlighted green for reference. Persistent — no
 *                 pop/removal; cleared when the selection changes or study ends.
 */
export type BubbleStatus = "entering" | "idle" | "held" | "hovered" | "correct" | "wrong" | "revealed";

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
    /** Velocity (px/sec). */
    vx: number;
    vy: number;
    radius: number;
    /** Collision mass (∝ area) so big bubbles shove small ones. */
    mass: number;
    /** While `status === "entering"`, the spot inside the stage this bubble is
        flying toward. Cleared (null) once it arrives and starts floating. */
    targetX: number | null;
    targetY: number | null;
    /** Current rendered scale; lerps toward `targetScale` each frame. */
    scale: number;
    targetScale: number;
    status: BubbleStatus;
}

/**
 * A difficulty level. A single game always uses the full pool (all pairs from
 * the launch config); the chosen level only changes how fast bubbles launch and
 * how long the player has. Levels do NOT chain — one level per session.
 */
export interface LevelConfig {
    /** 1-based level number shown in the picker / HUD. */
    level: number;
    /** Short label for the picker (e.g. "Relaxed", "Brisk", "Frantic"). */
    label: string;
    /** Delay between successive bubble launches (ms). Lower = faster/harder. */
    launchIntervalMs: number;
    /** Time the player has to clear the whole pool (seconds). */
    durationSec: number;
}

/** High-level game phase the page renders against. */
export type GamePhase = "playing" | "won" | "lost";

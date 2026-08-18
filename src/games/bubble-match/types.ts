/**
 * Bubble Match — the types specific to THIS game.
 *
 * The field types every bubble game shares (BubbleKind, BubbleStatus,
 * BubbleBody, BubbleFill) live in src/games/bubbles/types.ts. What is left here
 * describes Bubble Match's own structure: a fixed pool of pairs played at one of
 * three difficulty levels, where difficulty means launch cadence + how fast the
 * descending ceiling closes in. Hydra Bubbles has neither, which is why neither
 * of these moved to the shared module.
 *
 * Referenced by: BubbleMatchPage, BubbleStage, constants.ts (LEVEL_CONFIGS).
 * Docs: docs/GAMES_FEATURE.md.
 */

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

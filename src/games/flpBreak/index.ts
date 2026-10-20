import { GAME_REGISTRY } from "../registry";
import type { Language } from "../../types";
import type { FlpWorld } from "../../../server/contracts/studyMode";
import { flpBreakCandidates } from "./candidates";
import { MATCH_SPEED_BREAK } from "./matchSpeedBreak";
import type { FlpBreakCandidate, FlpBreakGame } from "./types";

export { pickBreakCandidate, breakShowsPinyin } from "./candidates";
export type { FlpBreakCandidate, FlpBreakContext, FlpBreakGame, FlpBreakStageProps } from "./types";

/**
 * Every game that can run as an flp break, by gameId (docs/FLP_GAME_BREAKS.md § 6).
 * A game joins the rotation by getting an entry here — once its Stage is extracted.
 * Extraction order: Match Speed ✓, Bucket Drop, Bubble Match, Speed Reading, Word
 * Search, Hydra Bubbles, Writing Grid, Memory Map.
 */
// `any`: the map holds each game's own prefetch payload type; the host only threads
// an adapter's `prefetch` result back into that SAME adapter's Stage.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FLP_BREAK_GAMES: Record<string, FlpBreakGame<any>> = {
    [MATCH_SPEED_BREAK.gameId]: MATCH_SPEED_BREAK,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flpBreakGameFor(gameId: string): FlpBreakGame<any> | null {
    return FLP_BREAK_GAMES[gameId] ?? null;
}

/** The live candidate set for an flp session — enabled games only (`GAME_REGISTRY`). */
export function flpBreakCandidatesFor(world: FlpWorld, language: Language): FlpBreakCandidate[] {
    return flpBreakCandidates(GAME_REGISTRY, (id) => id in FLP_BREAK_GAMES, world, language);
}

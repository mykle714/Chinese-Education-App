import { GAME_REGISTRY } from "../registry";
import type { Language } from "../../types";
import type { FlpWorld } from "../../../server/contracts/studyMode";
import { flpBreakCandidates } from "./candidates";
import { MATCH_SPEED_BREAK } from "./matchSpeedBreak";
import { WORD_SEARCH_BREAK } from "./wordSearchBreak";
import { WRITING_GRID_BREAK } from "./writingGridBreak";
import { SUPERPOSITION_BREAK } from "./superpositionBreak";
import type { FlpBreakCandidate, FlpBreakGame } from "./types";

export { pickBreakCandidate, breakShowsPinyin } from "./candidates";
export type { FlpBreakCandidate, FlpBreakContext, FlpBreakGame, FlpBreakPersonalBest, FlpBreakResults, FlpBreakStageProps } from "./types";

/**
 * Every game that can run as an flp break, by gameId (docs/FLP_GAME_BREAKS.md § 6).
 * A game joins the rotation by getting an entry here — once its Stage is extracted.
 * Extraction order: Match Speed ✓, Word Search ✓, Writing Grid ✓, Superposition ✓ (built as a
 * Stage), Bucket Drop (adapter
 * built, deliberately left out of this map), Bubble Match, Speed Reading, Hydra Bubbles,
 * Memory Map.
 */
// `any`: the map holds each game's own prefetch payload type; the host only threads
// an adapter's `prefetch` result back into that SAME adapter's Stage.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FLP_BREAK_GAMES: Record<string, FlpBreakGame<any>> = {
    [MATCH_SPEED_BREAK.gameId]: MATCH_SPEED_BREAK,
    [WORD_SEARCH_BREAK.gameId]: WORD_SEARCH_BREAK,
    [WRITING_GRID_BREAK.gameId]: WRITING_GRID_BREAK,
    [SUPERPOSITION_BREAK.gameId]: SUPERPOSITION_BREAK,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flpBreakGameFor(gameId: string): FlpBreakGame<any> | null {
    return FLP_BREAK_GAMES[gameId] ?? null;
}

/** The live candidate set for an flp session — enabled games only (`GAME_REGISTRY`). */
export function flpBreakCandidatesFor(world: FlpWorld, language: Language): FlpBreakCandidate[] {
    return flpBreakCandidates(GAME_REGISTRY, (id) => id in FLP_BREAK_GAMES, world, language);
}

/**
 * The world's whole game suite, adapted or not: `playable` is false for a game whose Stage
 * has not been extracted yet. For the Deck Tower's tester picker (ForcedBreakPicker), which
 * lists every game of the world.
 */
export function flpBreakSuiteFor(world: FlpWorld, language: Language): { candidate: FlpBreakCandidate; playable: boolean }[] {
    return flpBreakCandidates(GAME_REGISTRY, () => true, world, language).map((candidate) => ({
        candidate,
        playable: candidate.game.gameId in FLP_BREAK_GAMES,
    }));
}

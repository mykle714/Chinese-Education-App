import { lazyWithPreload } from "../runtime/lazyWithPreload";
import { fetchMemoryMap, type MemoryMapResponse } from "../../api/memoryMap";
import { BREAK_PROMPTS } from "../memory-map/constants";
import { estimateBreakViewportAspect } from "../memory-map/frameCheck";
import { GAME_FRAME_EXIT_CLEARANCE_PX } from "../shared/gameFrameExit";
import type { FlpBreakGame } from "./types";

/**
 * Memory Map as an flp game break (docs/FLP_GAME_BREAKS.md § 6), on the reading flp.
 *
 * ── THE LEARNER'S OWN MAP, NOT A SEEDED BOARD ────────────────────────────────
 * Unlike every other break game, this one ignores `seedIds`, the study mode and the
 * collection, and it sits out focus mode entirely (`focusMinimum`): the map is a durable per-user slot tree with a saved run, and a break opens
 * THAT run, in whatever state it was left (owner, 2026-11-04). The break asks for
 * `BREAK_PROMPTS` words and closes; with fewer left uncoloured it finishes the map, and
 * the next break reshuffles it (MEMORY_MAP_GAME.md § 4a).
 *
 * The prefetch is the map itself (`GET /api/memoryMap`, which also fills empty slots), so
 * Play opens straight onto it. The Stage then doesn't fetch it again. The break fits the
 * whole map to the screen, with the word finder. There is no frame-mismatch offer (§ 6a):
 * it lived on the deleted standalone route.
 */
export const MEMORY_MAP_BREAK: FlpBreakGame<MemoryMapResponse> = {
    gameId: "memory-map",
    rulesLine: `Find ${BREAK_PROMPTS} words on your map from their meanings.`,
    // The estimated break viewport rides along so a learner whose first framed load is
    // a break still gets a map packed for this screen (MEMORY_MAP_GAME.md § 2.4b).
    prefetch: () => fetchMemoryMap(estimateBreakViewportAspect(GAME_FRAME_EXIT_CLEARANCE_PX)),
    // An empty map would open on "Your map is empty"; pick another game instead.
    isPlayable: (map) => map.words.length > 0,
    // Never on a focused break (owner, 2026-11-04). A focused break plays cards from
    // outside today's set (FOCUS_MODE.md § 4a), and the map cannot honour that: it is the
    // learner's own map, today's set included. An unreachable minimum drops it from the
    // focused candidate pool (`useGameBreak`); unfocused sessions never read this.
    focusMinimum: () => Number.POSITIVE_INFINITY,
    Stage: lazyWithPreload(() => import("./MemoryMapBreakStage")),
};

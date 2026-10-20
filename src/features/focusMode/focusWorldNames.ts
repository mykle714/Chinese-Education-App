import type { MasteryWorldId } from "../../../server/contracts/wire";

/** How a world is named in focus-mode copy — the Deck Tower's own world names (docs/DECK_TOWER.md § Worlds). */
export const FOCUS_WORLD_NAMES: Record<MasteryWorldId, string> = {
    core: "Main",
    reading: "Reading",
    writing: "Writing",
};

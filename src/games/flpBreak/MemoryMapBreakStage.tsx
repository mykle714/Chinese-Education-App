import React from "react";
import MemoryMapStage from "../memory-map/MemoryMapStage";
import type { MemoryMapResponse } from "../../api/memoryMap";
import type { FlpBreakStageProps } from "./types";

/**
 * The lazy entry point the flp loads for a Memory Map break: maps the break host's props
 * onto `MemoryMapStage` (docs/FLP_GAME_BREAKS.md § 6). The candidate and context need no
 * mapping: the map has one mode, always marks `reading`, and is the learner's own map
 * rather than a board dealt from the session (memoryMapBreak.ts).
 */
const MemoryMapBreakStage: React.FC<FlpBreakStageProps<MemoryMapResponse>> = ({
    prefetched,
    Frame,
    onDone,
    onRunEnded,
    onCardCleared,
}) => (
    <MemoryMapStage
        Frame={Frame}
        prefetched={prefetched}
        onDone={onDone}
        onRunEnded={onRunEnded}
        onCardCleared={onCardCleared}
    />
);

export default MemoryMapBreakStage;

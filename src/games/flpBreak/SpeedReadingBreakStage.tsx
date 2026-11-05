import React from "react";
import SpeedReadingStage from "../speed-reading/SpeedReadingStage";
import type { SpeedReadingOpening } from "../speed-reading/useSpeedReadingQueue";
import type { FlpBreakStageProps } from "./types";

/**
 * The lazy entry point the flp loads for a Speed Reading break: maps the break host's
 * props onto `SpeedReadingStage` (docs/FLP_GAME_BREAKS.md § 6). The candidate needs no
 * mapping: Speed Reading has one mode and always marks `reading`.
 */
const SpeedReadingBreakStage: React.FC<FlpBreakStageProps<SpeedReadingOpening>> = ({
    context,
    prefetched,
    Frame,
    onDone,
    onRunEnded,
    onCardCleared,
}) => (
    <SpeedReadingStage
        Frame={Frame}
        seedIds={context.seedIds}
        prefetched={prefetched}
        onDone={onDone}
        doneLabel="cards"
        onRunEnded={onRunEnded}
        onCardCleared={onCardCleared}
    />
);

export default SpeedReadingBreakStage;

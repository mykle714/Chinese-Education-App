import React from "react";
import WritingGridStage from "../writing-grid/WritingGridStage";
import type { WritingGridCharacter } from "../../api/writingGrid";
import type { FlpBreakStageProps } from "./types";
import { writingGridBreakRequest } from "./writingGridBreak";

/**
 * The lazy entry point the flp loads for a Writing Grid break: maps the break host's props
 * onto `WritingGridStage` (docs/FLP_GAME_BREAKS.md § 6).
 */
const WritingGridBreakStage: React.FC<FlpBreakStageProps<WritingGridCharacter[]>> = ({
    context,
    prefetched,
    Frame,
    onDone,
    onRunEnded,
    onCardCleared,
}) => (
    <WritingGridStage
        Frame={Frame}
        dealRequest={writingGridBreakRequest(context)}
        prefetchedCells={prefetched}
        onDone={onDone}
        doneLabel="cards"
        onRunEnded={onRunEnded}
        onCardCleared={onCardCleared}
    />
);

export default WritingGridBreakStage;

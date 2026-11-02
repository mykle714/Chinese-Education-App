import React from "react";
import SuperpositionStage from "../superposition/SuperpositionStage";
import type { SuperpositionWord } from "../../api/superposition";
import type { FlpBreakStageProps } from "./types";
import { superpositionBreakRequest } from "./superpositionBreak";

/**
 * The lazy entry point the flp loads for a Superposition break: maps the break host's props
 * onto `SuperpositionStage` (docs/SUPERPOSITION_GAME.md).
 */
const SuperpositionBreakStage: React.FC<FlpBreakStageProps<SuperpositionWord[]>> = ({
    context,
    prefetched,
    Frame,
    onDone,
    onRunEnded,
    onCardCleared,
}) => (
    <SuperpositionStage
        host="flpBreak"
        Frame={Frame}
        dealRequest={superpositionBreakRequest(context)}
        prefetchedWords={prefetched}
        onDone={onDone}
        doneLabel="cards"
        onRunEnded={onRunEnded}
        onCardCleared={onCardCleared}
    />
);

export default SuperpositionBreakStage;

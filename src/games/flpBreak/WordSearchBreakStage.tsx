import React from "react";
import { MODE_CONFIGS, modeConfigFor } from "../word-search/constants";
import WordSearchStage from "../word-search/WordSearchStage";
import type { WordSearchResponse } from "../word-search/types";
import type { FlpBreakStageProps } from "./types";
import { WORD_SEARCH_BREAK_BOARD } from "./wordSearchBreak";

/**
 * The lazy entry point the flp loads for a Word Search break: maps the break host's props
 * onto `WordSearchStage` (docs/FLP_GAME_BREAKS.md § 6). `candidate.mode` is always one of
 * the registry's modes, read off MODE_CONFIGS; the fallback only satisfies the type.
 */
const WordSearchBreakStage: React.FC<FlpBreakStageProps<WordSearchResponse>> = ({
    candidate,
    context,
    prefetched,
    Frame,
    onDone,
    onRunEnded,
    onCardCleared,
}) => (
    <WordSearchStage
        host="flpBreak"
        Frame={Frame}
        modeConfig={modeConfigFor(candidate.mode) ?? MODE_CONFIGS[0]}
        board={WORD_SEARCH_BREAK_BOARD}
        seedIds={context.seedIds}
        prefetchedBoard={prefetched}
        onDone={onDone}
        doneLabel="cards"
        onRunEnded={onRunEnded}
        onCardCleared={onCardCleared}
    />
);

export default WordSearchBreakStage;

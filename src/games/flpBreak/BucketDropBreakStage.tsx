import React from "react";
import type { GamePoolResponse } from "../../api/gamePool";
import { modeConfigFor } from "../bucket-drop/constants";
import BucketDropStage from "../bucket-drop/BucketDropStage";
import type { FlpBreakStageProps } from "./types";

/**
 * The lazy entry point the flp loads for a Bucket Drop break: maps the break host's props
 * onto `BucketDropStage` (docs/FLP_GAME_BREAKS.md § 6). `track` is the candidate's so the
 * marks land on the session's bar: the route's `runTrackFor` would mark production on a
 * Spanish reading flp.
 */
const BucketDropBreakStage: React.FC<FlpBreakStageProps<GamePoolResponse>> = ({
    candidate,
    context,
    prefetched,
    Frame,
    onDone,
    onRunEnded,
    onCardCleared,
}) => (
    <BucketDropStage
        host="flpBreak"
        Frame={Frame}
        modeConfig={modeConfigFor(candidate.mode)}
        track={candidate.markType}
        collection={context.collection}
        seedIds={context.seedIds}
        prefetchedPool={prefetched}
        onDone={onDone}
        doneLabel="cards"
        onRunEnded={onRunEnded}
        onCardCleared={onCardCleared}
    />
);

export default BucketDropBreakStage;

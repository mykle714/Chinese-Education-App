import React from "react";
import type { GamePoolResponse } from "../../api/gamePool";
import { modeConfigFor } from "../match-speed/constants";
import MatchSpeedStage from "../match-speed/MatchSpeedStage";
import type { FlpBreakStageProps } from "./types";

/**
 * The lazy entry point the flp loads for a Match Speed break: maps the break host's
 * props onto `MatchSpeedStage` (docs/FLP_GAME_BREAKS.md § 6). No header controls — the
 * break's pinyin is the flp bar's answer, not a chip (§ 5a).
 */
const MatchSpeedBreakStage: React.FC<FlpBreakStageProps<GamePoolResponse>> = ({
    candidate,
    context,
    prefetched,
    Frame,
    onDone,
}) => (
    <MatchSpeedStage
        host="flpBreak"
        Frame={Frame}
        baseModeConfig={modeConfigFor(context.studyMode)}
        showPinyin={candidate.showPinyin}
        collection={context.collection}
        seedIds={context.seedIds}
        prefetchedPool={prefetched}
        onDone={onDone}
    />
);

export default MatchSpeedBreakStage;

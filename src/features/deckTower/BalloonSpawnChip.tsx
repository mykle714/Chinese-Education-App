import React from "react";
import { Box, ButtonBase } from "@mui/material";
import { TESTER_GROUP_SX, TESTER_ROW_SX, testerChipSx } from "./testerChipStyle";
import { useTesterInline } from "./TesterSharedRow";

/**
 * BalloonSpawnChip — the FEATURE-TESTER action chip "🎈 Balloon" (docs/DECK_TOWER.md
 * § "Feature-tester rows"; the balloon: docs/ISO_ART_FRAMEWORK.md § "IsoBalloon"). By chance
 * only 1 cloud drift in 100 is a red balloon, and only under cloudy weather; the chip sends
 * one across now, whatever the weather, at a height on screen even over a short tower
 * (useCloudDrifts → `balloonRequest`, `CloudSky.visibleBalloonBand`).
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It reports the
 * tap; DeckTowerPage → `spawnBalloon` bumps the request SkyTrafficSource passes on. Mounted
 * only for feature testers, in the "actions" TesterSharedRow. A button, not a toggle:
 * nothing stays selected, and each tap sends another balloon.
 *
 * Depends on: testerChipStyle.ts, TesterSharedRow.tsx. Depended on by: DeckTowerPage.tsx.
 */
const BalloonSpawnChip: React.FC<{ onSpawn: () => void }> = ({ onSpawn }) => {
    const inline = useTesterInline();
    return (
        <Box className="deck-tower-page__balloon-actions" role="group" aria-label="Red balloon (feature testing)" sx={inline ? TESTER_GROUP_SX : TESTER_ROW_SX}>
            <ButtonBase className="deck-tower-page__balloon-chip deck-tower-page__balloon-chip--spawn" onClick={onSpawn} sx={testerChipSx(false)}>
                🎈 Balloon
            </ButtonBase>
        </Box>
    );
};

export default BalloonSpawnChip;

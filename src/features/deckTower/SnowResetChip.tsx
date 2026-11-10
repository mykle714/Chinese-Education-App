import React from "react";
import { Box, ButtonBase } from "@mui/material";
import { TESTER_GROUP_SX, TESTER_ROW_SX, testerChipSx } from "./testerChipStyle";
import { useTesterInline } from "./TesterSharedRow";

/**
 * SnowResetChip — the FEATURE-TESTER action chip "❄ Reset" (docs/TOWER_SNOW.md § "Tester
 * reset"). Snow settles only on page entry and only on components cleared 6 h ago or more,
 * so a tester who has cleared everything could not see snow again for hours. The chip
 * forgets every clock and settles every world again on the spot, as if newly arrived — so
 * with the weather pinned to Snow (WeatherToggle) the whole platform snows over at once.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It reports the
 * tap; DeckTowerPage → `towerSnow.reset` (useTowerSnow.ts) does the reset. Mounted only for
 * feature testers, in the "actions" TesterSharedRow.
 *
 * Depends on: testerChipStyle.ts, TesterSharedRow.tsx. Depended on by: DeckTowerPage.tsx.
 */
const SnowResetChip: React.FC<{ onReset: () => void }> = ({ onReset }) => {
    const inline = useTesterInline();
    return (
        <Box className="deck-tower-page__snow-actions" role="group" aria-label="Snow (feature testing)" sx={inline ? TESTER_GROUP_SX : TESTER_ROW_SX}>
            <ButtonBase className="deck-tower-page__snow-chip deck-tower-page__snow-chip--reset" onClick={onReset} sx={testerChipSx(false)}>
                ❄ Reset
            </ButtonBase>
        </Box>
    );
};

export default SnowResetChip;

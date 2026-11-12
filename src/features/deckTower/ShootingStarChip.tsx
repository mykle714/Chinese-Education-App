import React from "react";
import { Box, ButtonBase } from "@mui/material";
import { TESTER_GROUP_SX, TESTER_ROW_SX, testerChipSx } from "./testerChipStyle";
import { useTesterInline } from "./TesterSharedRow";

/**
 * ShootingStarChip — the FEATURE-TESTER action chip "☄️ Meteor" (docs/DECK_TOWER.md
 * § "Feature-tester rows"; the meteors: § "Time of day" → "Shooting stars"). By chance a
 * burst fires on only 1 roll in 100 (one roll every 5 s, at night); the chip fires one
 * burst of 1–3 meteors now, whatever the time of day. Pair it with the time-of-day row's
 * Night to see the streaks against the dark sky they are drawn for.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It reports the
 * tap; DeckTowerPage → `fireShootingStars` bumps the counter SpaceBackdrop passes to
 * ShootingStars (`burstRequest`). Mounted only for feature testers, in the "actions"
 * TesterSharedRow. A button, not a toggle: nothing stays selected, and each tap fires
 * another burst.
 *
 * Depends on: testerChipStyle.ts, TesterSharedRow.tsx. Depended on by: DeckTowerPage.tsx.
 */
const ShootingStarChip: React.FC<{ onFire: () => void }> = ({ onFire }) => {
    const inline = useTesterInline();
    return (
        <Box className="deck-tower-page__shooting-star-actions" role="group" aria-label="Shooting stars (feature testing)" sx={inline ? TESTER_GROUP_SX : TESTER_ROW_SX}>
            <ButtonBase className="deck-tower-page__shooting-star-chip deck-tower-page__shooting-star-chip--fire" onClick={onFire} sx={testerChipSx(false)}>
                ☄️ Meteor
            </ButtonBase>
        </Box>
    );
};

export default ShootingStarChip;

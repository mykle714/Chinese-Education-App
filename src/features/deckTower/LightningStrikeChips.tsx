import React from "react";
import { Box, ButtonBase } from "@mui/material";
import { TESTER_ROW_SX, testerChipSx } from "./testerChipStyle";

/**
 * LightningStrikeChips — the FEATURE-TESTER row of two ACTION chips under the weather row
 * that force a lightning strike on the platform now (docs/DECK_TOWER.md § "Weather" →
 * "Lightning strikes"): "⚡ Strike" hits a random visible spot of the floor, "⚡ Strike pawn"
 * aims at the pawn (falling back to a random spot while it is not on the floor). By chance
 * a storm strikes only 1 flash in 100, and the pawn only when the spot happens to be his.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It reports taps;
 * DeckTowerPage → `strikePlatform` does the strike. Mounted only for `users.isFeatureTester`.
 * Buttons, not a radio group: nothing stays selected.
 *
 * Depends on: testerChipStyle.ts (`testerChipSx`, `TESTER_ROW_SX`). Depended on by: DeckTowerPage.tsx.
 */

interface LightningStrikeChipsProps {
    onStrike: () => void;
    onStrikePawn: () => void;
}

const LightningStrikeChips: React.FC<LightningStrikeChipsProps> = ({ onStrike, onStrikePawn }) => (
    <Box className="deck-tower-page__lightning-actions" role="group" aria-label="Lightning strikes (feature testing)" sx={TESTER_ROW_SX}>
        <ButtonBase className="deck-tower-page__lightning-chip deck-tower-page__lightning-chip--floor" onClick={onStrike} sx={testerChipSx(false)}>
            ⚡ Strike
        </ButtonBase>
        <ButtonBase className="deck-tower-page__lightning-chip deck-tower-page__lightning-chip--pawn" onClick={onStrikePawn} sx={testerChipSx(false)}>
            ⚡ Strike pawn
        </ButtonBase>
    </Box>
);

export default LightningStrikeChips;

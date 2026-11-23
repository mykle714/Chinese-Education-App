import React from "react";
import { Box, ButtonBase } from "@mui/material";
import { TESTER_GROUP_SX, TESTER_ROW_SX, testerChipSx } from "./testerChipStyle";
import { useTesterInline } from "./TesterSharedRow";

/**
 * LoaderPreviewChip — the FEATURE-TESTER toggle chip "⏳ Loader" (docs/DECK_TOWER.md
 * § "Feature-tester rows", § "Loading feedback"). The real loads PawnLoader is meant for are
 * hard to catch by hand (most finish in well under a second on a good connection), so this
 * chip holds the loader up on demand: tap to show it, tap again to hide it.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It reports the
 * tap; DeckTowerPage owns `loaderPreview` and mounts PawnLoader with no delay (tester
 * controls are instant). Mounted only for feature testers, in the "actions" TesterSharedRow.
 * PawnLoader is `pointer-events: none`, so the chip stays tappable under it.
 *
 * Depends on: testerChipStyle.ts, TesterSharedRow.tsx. Depended on by: DeckTowerPage.tsx.
 */
const LoaderPreviewChip: React.FC<{ shown: boolean; onToggle: () => void }> = ({ shown, onToggle }) => {
    const inline = useTesterInline();
    return (
        <Box className="deck-tower-page__loader-preview-actions" role="group" aria-label="Loading indicator preview (feature testing)" sx={inline ? TESTER_GROUP_SX : TESTER_ROW_SX}>
            <ButtonBase
                className="deck-tower-page__loader-preview-chip"
                onClick={onToggle}
                aria-pressed={shown}
                sx={testerChipSx(shown)}
            >
                ⏳ Loader
            </ButtonBase>
        </Box>
    );
};

export default LoaderPreviewChip;

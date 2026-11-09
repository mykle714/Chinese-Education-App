import React from "react";
import TesterChipRow from "./TesterChipRow";
import type { AuroraOverride } from "./towerAurora";

/**
 * AuroraToggle — the FEATURE-TESTER row of chips that forces the reading world's rare
 * aurora: Auto (the real 1% roll) · On · Off (docs/DECK_TOWER.md § "Time of day" → "Aurora").
 * It shows only at night, so pair On with the time-of-day row's Night.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It draws and
 * reports taps; useTowerAurora (towerAurora.ts) owns the override, as page state — it
 * resets when the page is left, like the aurora itself.
 *
 * Depends on: TesterChipRow.tsx. Depended on by: DeckTowerPage.tsx.
 */

const OPTIONS: readonly { value: AuroraOverride; label: string }[] = [
    { value: "auto", label: "Aurora: Auto" },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
];

interface AuroraToggleProps {
    value: AuroraOverride;
    onChange: (v: AuroraOverride) => void;
}

const AuroraToggle: React.FC<AuroraToggleProps> = ({ value, onChange }) => (
    <TesterChipRow classBase="deck-tower-page__aurora-tester" ariaLabel="Aurora (feature testing)" options={OPTIONS} value={value} onChange={onChange} />
);

export default AuroraToggle;

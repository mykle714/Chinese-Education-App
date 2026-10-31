import React from "react";
import TesterChipRow from "./TesterChipRow";
import type { TimeOfDayOverride } from "./useTimeOfDay";

/**
 * TimeOfDayToggle — the FEATURE-TESTER row of chips under the Deck Tower's header that
 * pins the sky to one time of day: Auto · Dawn · Day · Sunset · Night
 * (docs/DECK_TOWER.md § "Time of day" → "Tester toggle").
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It draws and
 * reports taps; useTimeOfDay owns the override and its per-device storage. The page
 * mounts it only for `users.isFeatureTester` accounts (migration 178).
 *
 * Depends on: TesterChipRow.tsx. Depended on by: DeckTowerPage.tsx.
 */

const OPTIONS: readonly { value: TimeOfDayOverride; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "dawn", label: "Dawn" },
    { value: "day", label: "Day" },
    { value: "sunset", label: "Sunset" },
    { value: "night", label: "Night" },
];

interface TimeOfDayToggleProps {
    value: TimeOfDayOverride;
    onChange: (v: TimeOfDayOverride) => void;
}

const TimeOfDayToggle: React.FC<TimeOfDayToggleProps> = ({ value, onChange }) => (
    <TesterChipRow
        classBase="deck-tower-page__time-of-day"
        ariaLabel="Time of day (feature testing)"
        options={OPTIONS}
        value={value}
        onChange={onChange}
    />
);

export default TimeOfDayToggle;

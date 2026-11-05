import React from "react";
import TesterChipRow from "./TesterChipRow";
import type { WeatherOverride } from "./towerWeather";

/**
 * WeatherToggle — the FEATURE-TESTER row of chips under the Deck Tower's time-of-day row
 * that pins the sky's weather: Auto · Clear · Cloudy · Fog · Drizzle · Rain · Snow · Storm
 * (docs/DECK_TOWER.md § "Weather" → "Tester toggle").
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It draws and
 * reports taps; useTowerWeather owns the override and its per-device storage. The page
 * mounts it only for `users.isFeatureTester` accounts.
 *
 * Depends on: TesterChipRow.tsx. Depended on by: DeckTowerPage.tsx.
 */

const OPTIONS: readonly { value: WeatherOverride; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "clear", label: "Clear" },
    { value: "cloudy", label: "Cloudy" },
    { value: "fog", label: "Fog" },
    { value: "drizzle", label: "Drizzle" },
    { value: "rain", label: "Rain" },
    { value: "snow", label: "Snow" },
    { value: "storm", label: "Storm" },
];

interface WeatherToggleProps {
    value: WeatherOverride;
    onChange: (v: WeatherOverride) => void;
}

const WeatherToggle: React.FC<WeatherToggleProps> = ({ value, onChange }) => (
    <TesterChipRow
        classBase="deck-tower-page__weather"
        ariaLabel="Weather (feature testing)"
        options={OPTIONS}
        value={value}
        onChange={onChange}
    />
);

export default WeatherToggle;

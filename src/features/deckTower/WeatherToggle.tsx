import React from "react";
import TesterChipRow from "./TesterChipRow";
import type { WeatherKind } from "../../api/weather";
import {
    WEATHER_FAMILY_DEFAULT_PIN,
    weatherPin,
    weatherPinsOf,
    type WeatherOverride,
    type WeatherPinId,
} from "./towerWeather";

/**
 * WeatherToggle — the FEATURE-TESTER rows of chips under the Deck Tower's time-of-day row
 * that pin the sky's weather to one WMO look (docs/DECK_TOWER.md § "Weather" → "Tester toggle").
 *
 *   - FAMILY row: Auto · Clear · Cloudy · Fog · Drizzle · Rain · Snow · Storm. Tapping a
 *     family pins its default look (towerWeather.ts → `WEATHER_FAMILY_DEFAULT_PIN`, the
 *     heaviest non-freezing one).
 *   - VARIANT row, shown only when the pinned family has more than one look: every
 *     distinct look in that family (towerWeather.ts → `WEATHER_PINS`), e.g. Rain →
 *     Slight · Moderate · Heavy · Freezing light · Freezing heavy.
 * Two rows rather than ~20 chips in one, so the row stays phone-width and the variants
 * read as belonging to their family.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It draws and
 * reports taps; useTowerWeather owns the override and its per-device storage. The page
 * mounts it only for `users.isFeatureTester` accounts.
 *
 * Depends on: TesterChipRow.tsx, towerWeather.ts. Depended on by: DeckTowerPage.tsx.
 */

type FamilyValue = "auto" | WeatherKind;

const FAMILY_OPTIONS: readonly { value: FamilyValue; label: string }[] = [
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

const WeatherToggle: React.FC<WeatherToggleProps> = ({ value, onChange }) => {
    const family: FamilyValue = value === "auto" ? "auto" : weatherPin(value).family;
    const variants = family === "auto" ? [] : weatherPinsOf(family);
    return (
        <>
            <TesterChipRow
                classBase="deck-tower-page__weather"
                ariaLabel="Weather (feature testing)"
                options={FAMILY_OPTIONS}
                value={family}
                onChange={(f) => onChange(f === "auto" ? "auto" : WEATHER_FAMILY_DEFAULT_PIN[f])}
            />
            {variants.length > 1 && value !== "auto" && (
                <TesterChipRow<WeatherPinId>
                    classBase="deck-tower-page__weather-variant"
                    ariaLabel="Weather variant (feature testing)"
                    options={variants.map((p) => ({ value: p.id, label: p.label }))}
                    value={value}
                    onChange={onChange}
                />
            )}
        </>
    );
};

export default WeatherToggle;

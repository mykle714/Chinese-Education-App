import React from "react";
import { Box, ButtonBase } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
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
 * Chips are the framework's frosted chip on a hued fill (`COLORS.frost`, the sky behind)
 * with the app's outline (`COLORS.border`); the chosen one is solid ink — the
 * "solid-ink control" exception to the outline rule (CLAUDE.md § Buttons & cards).
 *
 * Depended on by: DeckTowerPage.tsx.
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
    <Box
        className="deck-tower-page__time-of-day-toggle"
        role="radiogroup"
        aria-label="Time of day (feature testing)"
        sx={{ display: "flex", justifyContent: "center", gap: 0.75, px: 2, pb: 1, flexWrap: "wrap" }}
    >
        {OPTIONS.map((o) => {
            const selected = o.value === value;
            return (
                <ButtonBase
                    key={o.value}
                    className={`deck-tower-page__time-of-day-chip${selected ? " deck-tower-page__time-of-day-chip--selected" : ""}`}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange(o.value)}
                    sx={{
                        px: 1.25,
                        py: 0.5,
                        borderRadius: 999,
                        fontFamily: FONTS.cjk,
                        fontSize: SIZE.caption,
                        fontWeight: WEIGHT.bold,
                        color: selected ? COLORS.white : COLORS.onSurface,
                        backgroundColor: selected ? COLORS.onSurface : COLORS.frost,
                        border: selected ? `1px solid ${COLORS.onSurface}` : `1px solid ${COLORS.border}`,
                    }}
                >
                    {o.label}
                </ButtonBase>
            );
        })}
    </Box>
);

export default TimeOfDayToggle;

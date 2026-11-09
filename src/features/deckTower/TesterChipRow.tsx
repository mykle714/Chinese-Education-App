import { Box, ButtonBase } from "@mui/material";
import { TESTER_GROUP_SX, TESTER_ROW_SX, testerChipSx } from "./testerChipStyle";
import { useTesterInline } from "./TesterSharedRow";

/**
 * TesterChipRow — the Deck Tower's FEATURE-TESTER row of single-choice chips under the
 * header. TimeOfDayToggle and ForcedBreakPicker are this row with their own options.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It draws and
 * reports taps; the caller owns the value.
 *
 * Chips are the framework's frosted chip on a hued fill (`COLORS.frost`, the sky behind)
 * with the app's outline (`COLORS.border`); the chosen one is solid ink — the
 * "solid-ink control" exception to the outline rule (CLAUDE.md § Buttons & cards).
 * A disabled chip is the same chip, faded.
 *
 * Inside a TesterSharedRow it renders as an inline group (TESTER_GROUP_SX) beside the others.
 *
 * Depended on by: TimeOfDayToggle.tsx, ForcedBreakPicker.tsx, WeatherToggle.tsx, AuroraToggle.tsx,
 * BankingAlwaysPlayToggle.tsx; its chip look
 * lives in testerChipStyle.ts, shared with LightningStrikeChips.tsx
 * (docs/DECK_TOWER.md § "Time of day" → "Tester toggle", § "Forced game breaks").
 */


export interface TesterChipOption<V extends string> {
    value: V;
    label: string;
    disabled?: boolean;
}

interface TesterChipRowProps<V extends string> {
    /** The BEM block of the row: the row is `${classBase}-toggle`, each chip `${classBase}-chip`. */
    classBase: string;
    ariaLabel: string;
    options: readonly TesterChipOption<V>[];
    value: V;
    onChange: (value: V) => void;
}

function TesterChipRow<V extends string>({ classBase, ariaLabel, options, value, onChange }: TesterChipRowProps<V>) {
    const inline = useTesterInline();
    return (
        <Box
            className={`${classBase}-toggle`}
            role="radiogroup"
            aria-label={ariaLabel}
            sx={inline ? TESTER_GROUP_SX : TESTER_ROW_SX}
        >
            {options.map((o) => {
                const selected = o.value === value;
                return (
                    <ButtonBase
                        key={o.value}
                        className={`${classBase}-chip${selected ? ` ${classBase}-chip--selected` : ""}`}
                        role="radio"
                        aria-checked={selected}
                        disabled={o.disabled}
                        onClick={() => onChange(o.value)}
                        sx={testerChipSx(selected, o.disabled)}
                    >
                        {o.label}
                    </ButtonBase>
                );
            })}
        </Box>
    );
}

export default TesterChipRow;

import { Box, ButtonBase } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

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
 * Depended on by: TimeOfDayToggle.tsx, ForcedBreakPicker.tsx
 * (docs/DECK_TOWER.md § "Time of day" → "Tester toggle", § "Forced game breaks").
 */

/** A disabled chip's opacity: still legible, clearly not tappable. */
const DISABLED_CHIP_OPACITY = 0.45;

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
    return (
        <Box
            className={`${classBase}-toggle`}
            role="radiogroup"
            aria-label={ariaLabel}
            sx={{ display: "flex", justifyContent: "center", gap: 0.75, px: 2, pb: 1, flexWrap: "wrap" }}
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
                            opacity: o.disabled ? DISABLED_CHIP_OPACITY : 1,
                        }}
                    >
                        {o.label}
                    </ButtonBase>
                );
            })}
        </Box>
    );
}

export default TesterChipRow;

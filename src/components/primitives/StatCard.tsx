import { Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Label } from "./Label";
import SectionCard from "./SectionCard";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * `StatCard` — the shelf system's outlined figure block (docs/SHELF_REDESIGN.md § A5,
 * class `.card`): a mono overline, one big numeral, a sentence of explanation, and an
 * optional action.
 *
 * WHAT IT IS FOR: the ONE number a screen is about — the streak count on the tester
 * dashboard, the minutes balance, "24 cards due". It is deliberately singular. Three of
 * these stacked is a data table wearing a costume; if a screen has several equally
 * important figures they belong in a `RowList` with mono `value`s.
 *
 * WHY THE NUMERAL IS 38px AND NOT A TYPE-SCALE STEP: `SIZE.display` (40px) is close but
 * the design's `.big` pairs 38px with -0.035em tracking, and the tracking is what makes a
 * long figure ("1,284") read as one shape instead of four digits. The pair is copied
 * verbatim rather than snapped to the scale.
 *
 * WHAT IT IS NOT: the shell. The white / 18px / hairline box is `SectionCard`, which this
 * renders into — so a screen that wants a `.card` around content which is NOT one big
 * figure reaches for that directly instead of taking this one and fighting its slots.
 *
 * Sibling primitives: `SectionCard`, `Label` / `SectionRule` / `SectionHeader`,
 * `Row` / `RowList`.
 */

export interface StatCardProps {
    /** Mono uppercase overline naming the figure — "current streak", "minutes today". */
    label: React.ReactNode;
    /** The figure itself. A node, not a number, so a caller can suffix a unit in smaller type. */
    value: React.ReactNode;
    /** One sentence of context under the figure. */
    description?: React.ReactNode;
    /**
     * Optional call to action. Pass a MUI `<Button variant="contained">` — the theme
     * skins it as the design's `.btn2` ink pill, so this slot needs no styling of its own.
     */
    action?: React.ReactNode;
    className?: string;
    sx?: SxProps<Theme>;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, description, action, className, sx }) => (
    <SectionCard className={className ? `stat-card ${className}` : "stat-card"} sx={sx}>
        {/* The design's `.card .k` tracks at 0.13em where `.lab` tracks at 0.14em. That
            0.01em is below the threshold where anyone can tell, and keeping two overline
            recipes alive guarantees they drift, so this normalizes onto `Label`. */}
        <Label className="stat-card__label">{label}</Label>
        <Typography
            className="stat-card__value"
            sx={{
                fontFamily: FONTS.sans,
                fontSize: 38,
                fontWeight: 600,
                letterSpacing: "-0.035em",
                lineHeight: 1.05,
                marginTop: "4px",
                color: COLORS.onSurface,
            }}
        >
            {value}
        </Typography>
        {description !== undefined && (
            <Typography
                className="stat-card__description"
                sx={{ fontFamily: FONTS.sans, fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 1.45, marginTop: "5px" }}
            >
                {description}
            </Typography>
        )}
        {action}
    </SectionCard>
);

export default StatCard;

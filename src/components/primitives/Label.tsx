import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * The three OVERLINE primitives of the shelf system (docs/SHELF_REDESIGN.md § A5,
 * classes `.lab`, `.sec2`, `.shelfhd`).
 *
 * They all exist for the same reason: in this design a section is announced by a
 * MONO UPPERCASE overline, not by a bold sentence-case heading. That single
 * typographic decision was being re-typed as an ad-hoc `<Typography>` on every page,
 * and the four numbers that make it work (10px, .14em tracking, the faint ink, the
 * mono face) drifted apart every time. `Label` is those four numbers; the other two
 * are the two shapes the design wraps around it.
 *
 * WHICH ONE TO USE:
 *   Label         — a bare overline. Also the right thing for a mono count or
 *                   timestamp sitting inline (the design reuses `.lab` for both).
 *   SectionRule   — an overline whose hairline runs to the right edge. The default
 *                   section divider on a scrolling page; it separates without
 *                   claiming a whole row of vertical space.
 *   SectionHeader — an overline with a tappable affordance on the right (a chevron,
 *                   a "＋"). Use ONLY when that affordance exists; a SectionHeader
 *                   with no `action` is a SectionRule that forgot its rule.
 *
 * Depended on by: docs/SHELF_REDESIGN.md § A5. Sibling primitives: `Row`, `StatCard`.
 */

export interface LabelProps {
    children: React.ReactNode;
    /** Overrides the faint default — e.g. a label sitting on a pastel needs that hue's ink. */
    color?: string;
    className?: string;
    sx?: SxProps<Theme>;
}

/** `.lab` — mono 10px uppercase overline. The atom the other two are built from. */
export const Label: React.FC<LabelProps> = ({ children, color = COLORS.textFaint, className, sx }) => (
    <Typography
        component="span"
        className={className ? `lab ${className}` : "lab"}
        // Array form throughout these primitives: a caller's `sx` may itself be an
        // array or a theme callback, so it is APPENDED rather than object-spread.
        sx={[
            {
                fontFamily: FONTS.mono,
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color,
                lineHeight: 1.2,
            },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
    >
        {children}
    </Typography>
);

export interface SectionRuleProps {
    /** The overline text. Kept short — it is uppercased and widely tracked. */
    label: React.ReactNode;
    className?: string;
    sx?: SxProps<Theme>;
}

/**
 * `.sec2` — a `Label` followed by a hairline filling the remaining width.
 *
 * The hairline is a flex-grown `<Box>` rather than a border on the container so it
 * starts AFTER the text, at whatever width the text happens to be. A border-bottom
 * would run under the label and read as an underline.
 */
export const SectionRule: React.FC<SectionRuleProps> = ({ label, className, sx }) => (
    <Box
        className={className ? `section-rule ${className}` : "section-rule"}
        sx={[{ display: "flex", alignItems: "center", gap: "10px", padding: "19px 22px 0" }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
        <Label sx={{ whiteSpace: "nowrap" }}>{label}</Label>
        <Box className="section-rule__line" sx={{ flex: 1, height: "1px", backgroundColor: COLORS.rowBorder }} />
    </Box>
);

export interface SectionHeaderProps {
    /** The overline text, or any node when the left side is richer than one label. */
    label: React.ReactNode;
    /** Material Symbols name for the right-hand affordance (e.g. "chevron_right", "add"). */
    action?: string;
    onActionClick?: () => void;
    /** Accessible name for the affordance. Required whenever `onActionClick` is set. */
    actionLabel?: string;
    className?: string;
    sx?: SxProps<Theme>;
}

/**
 * `.shelfhd` — section header with a right-hand affordance.
 *
 * Note the asymmetry with `BentoStrip`'s own header (`.strip .sh`): that one ends in a
 * mono FACT ("×12 wins") and is never tappable, this one ends in an ICON and usually
 * is. They look similar and mean different things, so they are deliberately not the
 * same component — see docs/BENTO_SYSTEM.md § "`BentoStrip` vs `ShelfHeader`".
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
    label,
    action,
    onActionClick,
    actionLabel,
    className,
    sx,
}) => (
    <Box
        className={className ? `section-header ${className}` : "section-header"}
        sx={[
            {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "19px 22px 0",
            },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
    >
        {typeof label === "string" ? <Label>{label}</Label> : label}
        {action && (
            <Box
                className="section-header__action"
                // A button only when it does something — otherwise the icon is
                // decorative and must not land in the tab order.
                component={onActionClick ? "button" : "span"}
                type={onActionClick ? "button" : undefined}
                onClick={onActionClick}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: onActionClick ? "pointer" : "default",
                }}
            >
                <Icon name={action} size={19} color={COLORS.textSecondary} aria-label={actionLabel} />
            </Box>
        )}
    </Box>
);

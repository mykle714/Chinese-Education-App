import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * The three shapes the design's SETTINGS pages are built from
 * (docs/SHELF_REDESIGN.md § A5, artboards 11 and 11b; classes `.set`, `.set .opt`,
 * `.set .sw`).
 *
 *   SettingsSection  `.set`       a flat white card: leading glyph + title, optional
 *                                description, then its controls
 *   OptionRow        `.opt`       one choice in a radio set — a real `<input
 *                                type="radio">` behind a drawn `.rd` dot
 *   SwitchRow        `.sw`        a labelled control row; the control itself is the
 *                                caller's (a MUI `Switch`), because only the caller
 *                                knows what it does
 *
 * WHY THESE ARE NOT `Row` / `StatCard`: a `.rw` is one ENTITY in a list — it has an
 * avatar, it usually navigates, and its subtitle is one truncating line. A `.set` is a
 * GROUP of controls with a heading, and its rows wrap their descriptions over two or
 * three lines because a preference has to explain itself. Trying to serve both from
 * `Row` is what produced the MUI `Paper` + `Card` + `FormControlLabel` stack these
 * replace.
 *
 * WHY `OptionRow` KEEPS A REAL RADIO: the artboard draws `.rd` as a div. A div is not
 * checkable, not focusable, not announced, and not keyboard-navigable as a group —
 * and a radio GROUP is the one control where keyboard semantics do real work (arrow
 * keys move between options). So the input is present and visually hidden, the drawn
 * dot is `aria-hidden` decoration, and the whole row is the label.
 *
 * Consumers: `src/pages/SettingsPage.tsx`, `src/pages/AccountSecurityPage.tsx`.
 * Sibling primitives: `Label` / `SectionRule` / `SectionHeader`, `Row` / `RowList`,
 * `StatCard`.
 */

export interface SettingsSectionProps {
    /** Material Symbols name for the leading glyph — "palette", "language", "lock". */
    icon?: string;
    title: React.ReactNode;
    /** One or two sentences under the heading, saying what the section governs. */
    description?: React.ReactNode;
    /**
     * Recolours the border and the heading — the design's only `.set` modifier, used
     * for the danger zone (artboard 11b draws it at 1.5px in `#EF476F`).
     */
    tone?: "default" | "danger";
    children?: React.ReactNode;
    className?: string;
    sx?: SxProps<Theme>;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
    icon,
    title,
    description,
    tone = "default",
    children,
    className,
    sx,
}) => {
    const danger = tone === "danger";
    return (
        <Box
            className={className ? `settings-section ${className}` : "settings-section"}
            sx={[
                {
                    margin: "14px 18px 0",
                    padding: "15px 16px",
                    borderRadius: "18px",
                    backgroundColor: COLORS.white,
                    // The danger variant thickens the line as well as recolouring it —
                    // a red hairline at 1px reads as a tint, not a warning.
                    //
                    // ⚠️ 2px, NOT the artboard's 1.5px. A fractional border width is
                    // snapped to whole device pixels, so at dpr 1 (every desktop
                    // browser, and the phone frame this is developed in) `1.5px`
                    // computes back to `1px` and the emphasis silently disappears —
                    // verified in a browser. 2px is the nearest width that is actually
                    // heavier than the default everywhere.
                    border: danger ? `2px solid ${COLORS.dangerInk}` : `1px solid ${COLORS.rowBorder}`,
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            <Box className="settings-section__heading" sx={{ display: "flex", alignItems: "center", gap: "9px" }}>
                {icon && <Icon name={icon} size={19} color={danger ? COLORS.dangerInk : COLORS.iconColor} />}
                <Typography
                    className="settings-section__title"
                    component="h2"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: 15.5,
                        fontWeight: 600,
                        letterSpacing: "-0.015em",
                        color: danger ? COLORS.dangerInk : COLORS.onSurface,
                    }}
                >
                    {title}
                </Typography>
            </Box>
            {description !== undefined && (
                <Typography
                    className="settings-section__description"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: 12,
                        color: COLORS.textSecondary,
                        lineHeight: 1.45,
                        marginTop: "5px",
                    }}
                >
                    {description}
                </Typography>
            )}
            {children}
        </Box>
    );
};

export interface OptionRowProps {
    /** Shared across the whole group — this is what makes arrow-key navigation work. */
    name: string;
    value: string;
    checked: boolean;
    onChange: (value: string) => void;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    disabled?: boolean;
    className?: string;
}

export const OptionRow: React.FC<OptionRowProps> = ({
    name,
    value,
    checked,
    onChange,
    title,
    subtitle,
    disabled,
    className,
}) => (
    <Box
        component="label"
        className={`settings-option${checked ? " settings-option--on" : ""}${className ? ` ${className}` : ""}`}
        sx={{
            // `relative` is load-bearing: the real radio below is absolutely
            // positioned, and without it the input escapes to the nearest positioned
            // ancestor and drags focus scroll across the page.
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginTop: "9px",
            padding: "11px 12px",
            borderRadius: "14px",
            // Selection is carried on THREE channels — line weight, line colour and
            // ground — because the drawn dot is 15px and a single channel at that size
            // is easy to miss. The artboard does the same.
            border: checked ? `1.5px solid ${COLORS.onSurface}` : `1px solid ${COLORS.border}`,
            backgroundColor: checked ? COLORS.background : "transparent",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.55 : 1,
            // The row is the label, so the whole thing is the target.
            "&:focus-within": { outline: `2px solid ${COLORS.onSurface}`, outlineOffset: "1px" },
        }}
    >
        {/* The real control. Visually hidden rather than `display: none`, which would
            take it out of the tab order and out of the radio group entirely. */}
        <Box
            component="input"
            type="radio"
            name={name}
            value={value}
            checked={checked}
            disabled={disabled}
            onChange={() => onChange(value)}
            sx={{
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                margin: 0,
                pointerEvents: "none",
            }}
        />
        {/* `.rd` — the drawn dot. Decoration: the input above is what is announced. */}
        <Box
            className="settings-option__dot"
            aria-hidden
            sx={{
                width: 15,
                height: 15,
                borderRadius: "50%",
                flexShrink: 0,
                border: `1.5px solid ${checked ? COLORS.onSurface : COLORS.border}`,
                background: checked
                    ? `radial-gradient(circle, ${COLORS.onSurface} 42%, transparent 46%)`
                    : "none",
            }}
        />
        <Box className="settings-option__text" sx={{ flex: 1, minWidth: 0 }}>
            <Typography
                className="settings-option__title"
                sx={{ fontFamily: FONTS.sans, fontSize: 13.5, fontWeight: 600, color: COLORS.onSurface }}
            >
                {title}
            </Typography>
            {subtitle !== undefined && (
                <Typography
                    className="settings-option__subtitle"
                    sx={{ fontFamily: FONTS.sans, fontSize: 11.5, color: COLORS.textSecondary, marginTop: "1px" }}
                >
                    {subtitle}
                </Typography>
            )}
        </Box>
    </Box>
);

export interface SwitchRowProps {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    /** The control. A MUI `Switch` — the row only owns the label beside it. */
    control: React.ReactNode;
    className?: string;
}

/**
 * `.sw` — top-aligned on purpose: the subtitle runs to two or three lines and a
 * centred switch would float halfway down the paragraph instead of sitting beside the
 * thing it toggles.
 */
export const SwitchRow: React.FC<SwitchRowProps> = ({ title, subtitle, control, className }) => (
    <Box
        className={className ? `settings-switch-row ${className}` : "settings-switch-row"}
        sx={{ display: "flex", alignItems: "flex-start", gap: "12px", marginTop: "11px" }}
    >
        <Box className="settings-switch-row__text" sx={{ flex: 1, minWidth: 0 }}>
            <Typography
                className="settings-switch-row__title"
                sx={{ fontFamily: FONTS.sans, fontSize: 13.5, fontWeight: 600, color: COLORS.onSurface }}
            >
                {title}
            </Typography>
            {subtitle !== undefined && (
                <Typography
                    className="settings-switch-row__subtitle"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: 11.5,
                        color: COLORS.textSecondary,
                        lineHeight: 1.4,
                        marginTop: "2px",
                    }}
                >
                    {subtitle}
                </Typography>
            )}
        </Box>
        <Box className="settings-switch-row__control" sx={{ flexShrink: 0, marginTop: "-6px" }}>
            {control}
        </Box>
    </Box>
);

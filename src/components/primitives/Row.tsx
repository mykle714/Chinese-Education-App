import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import Icon from "../Icon";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * `Row` — the shelf system's standard list row (docs/SHELF_REDESIGN.md § A5, class
 * `.rw`), plus `RowList` (`.rows`), the column that spaces them.
 *
 * WHAT A ROW IS FOR: one entity in a list, where the list is not a collection the user
 * owns (that is the Shelf) and not a menu of destinations (that is the Bento). A friend,
 * a dictionary hit, a settings entry, a leaderboard line — anything with an identity, a
 * name, an optional second line, and at most one trailing figure.
 *
 * WHY IT REPLACES MUI's `ListItem`: the design's row is a discrete outlined CARD with a
 * radius, not a full-bleed strip with a divider under it. Every page that needed one was
 * assembling `ListItem` + `sx` overrides + a custom avatar, and no two agreed on the
 * avatar radius or the trailing figure's face. The five slots below are the whole
 * vocabulary; a row that needs a sixth is not a Row.
 *
 * THE AVATAR IS A PASTEL, SO IT CARRIES `markOutline`. At 36px it is neither large nor
 * occupied, so the fill-vs-ink rule's exception does not apply — without the inset ring
 * it is ~1.15:1 on white and disappears. See docs/SHELF_REDESIGN.md § D2.
 *
 * Sibling primitives: `Label` / `SectionRule` / `SectionHeader`, `StatCard`.
 */

export interface RowProps {
    /** Material Symbols name for the avatar glyph. Ignored when `avatar` is given. */
    icon?: string;
    /** Short text avatar (1–2 characters) — a friend's initial. Ignored when `avatar` is given. */
    initials?: string;
    /**
     * Escape hatch: a fully custom avatar. REPLACES the styled 36×36 box rather than
     * filling it, so a caller needing a different size, radius or an interactive
     * avatar (the Account profile row's tappable picker) owns the whole slot.
     */
    avatar?: React.ReactNode;
    /** Ramp hue for the avatar's pastel fill + glyph ink. Defaults to the neutral grey pair. */
    hue?: RampHue;
    title: React.ReactNode;
    /** Second line. Truncates with an ellipsis — it is a single line by design. */
    subtitle?: React.ReactNode;
    /**
     * THIRD line, set in mono — the design's second `.s` inside `.tx`. Only one row in
     * the artboards has it (Account's profile row, carrying the copyable user ID), so
     * it is the exception rather than a general-purpose slot: reach for it when a row's
     * identity genuinely needs a machine-readable line under its subtitle, not to fit
     * one more sentence in.
     */
    meta?: React.ReactNode;
    /** Trailing figure, set in mono: a count, a score, a date. */
    value?: React.ReactNode;
    /** Trailing chevron. Set it when (and only when) the row navigates. */
    chevron?: boolean;
    /** Anything else on the right — a switch, a badge. Rendered after `value`. */
    trailing?: React.ReactNode;
    to?: string;
    state?: unknown;
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
    sx?: SxProps<Theme>;
}

/**
 * Turns a row into a real anchor when it has a `to`, a real button when it only has an
 * `onClick`, and a plain div otherwise. Same contract as `BentoTile` — a navigating row
 * must be long-pressable, middle-clickable and copyable like any link.
 */
function rowLinkProps(to?: string, state?: unknown, onClick?: (e: React.MouseEvent) => void) {
    if (to) {
        return {
            component: RouterLink as React.ElementType,
            to,
            state,
            onClick,
            sx: { textDecoration: "none", color: "inherit" },
        };
    }
    return onClick
        ? { component: "button" as React.ElementType, type: "button", onClick, sx: { textAlign: "left", font: "inherit" } }
        : {};
}

export const Row: React.FC<RowProps> = ({
    icon,
    initials,
    avatar,
    hue = "grey",
    title,
    subtitle,
    meta,
    value,
    chevron,
    trailing,
    to,
    state,
    onClick,
    className,
    sx,
}) => {
    const { fill, ink } = RAMP[hue];
    // `sx` here is always a plain object literal from `rowLinkProps`, never MUI's
    // array/callback form — typing it as such keeps it spreadable below.
    const { sx: linkSx, ...link } = rowLinkProps(to, state, onClick) as {
        sx?: Record<string, string>;
        [key: string]: unknown;
    };
    const hasAvatar = avatar !== undefined || icon !== undefined || initials !== undefined;

    return (
        <Box
            {...link}
            className={className ? `row ${className}` : "row"}
            // Array form: the caller's `sx` may itself be an array or a callback, so it
            // is appended rather than spread.
            sx={[
                {
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    backgroundColor: COLORS.white,
                    border: `1px solid ${COLORS.rowBorder}`,
                    borderRadius: "16px",
                    padding: "11px 13px",
                    width: "100%",
                    cursor: to || onClick ? "pointer" : "default",
                    ...linkSx,
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            {/* `avatar` replaces the box; `icon`/`initials` fill the styled one. */}
            {avatar !== undefined && avatar}
            {avatar === undefined && hasAvatar && (
                <Box
                    className="row__avatar"
                    sx={{
                        width: 36,
                        height: 36,
                        borderRadius: "12px",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: FONTS.sans,
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: ink,
                        backgroundColor: fill,
                        // Mandatory on a pastel this small — see the header note.
                        boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                    }}
                >
                    {icon ? <Icon name={icon} size={19} color={ink} /> : initials}
                </Box>
            )}

            <Box className="row__text" sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    className="row__title"
                    sx={{ fontFamily: FONTS.sans, fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.onSurface }}
                >
                    {title}
                </Typography>
                {subtitle !== undefined && (
                    <Typography
                        className="row__subtitle"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: 11.5,
                            color: COLORS.textSecondary,
                            marginTop: "2px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        {subtitle}
                    </Typography>
                )}
                {meta !== undefined && (
                    <Typography
                        className="row__meta"
                        // A span, not the default <p>: the slot carries an inline copy
                        // BUTTON alongside its text, and a flex row of controls inside a
                        // paragraph is invalid markup.
                        component="span"
                        sx={{
                            fontFamily: FONTS.mono,
                            fontSize: 10.5,
                            color: COLORS.textFaint,
                            marginTop: "3px",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                        }}
                    >
                        {meta}
                    </Typography>
                )}
            </Box>

            {value !== undefined && (
                <Typography
                    className="row__value"
                    sx={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.iconColor, flexShrink: 0 }}
                >
                    {value}
                </Typography>
            )}
            {trailing}
            {chevron && <Icon name="chevron_right" size={17} color={COLORS.textFaint} />}
        </Box>
    );
};

export interface RowListProps {
    children: React.ReactNode;
    className?: string;
    sx?: SxProps<Theme>;
}

/** `.rows` — the column a set of `Row`s lives in. Owns the gutters and the 8px gap. */
export const RowList: React.FC<RowListProps> = ({ children, className, sx }) => (
    <Box
        className={className ? `row-list ${className}` : "row-list"}
        sx={[{ padding: "13px 16px 0", display: "flex", flexDirection: "column", gap: "8px" }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
        {children}
    </Box>
);

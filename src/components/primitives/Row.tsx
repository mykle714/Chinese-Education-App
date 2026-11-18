import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import Icon from "../Icon";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS, DATA_TYPE } from "../../theme/fonts";

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
    /**
     * Image URL drawn inside the styled avatar box in place of the glyph — a picked
     * icons8 icon (the Reader list's document icon, texts."iconId"). Wins over `icon`,
     * which then stays the fallback for callers that pass both. Ignored when `avatar`
     * is given.
     */
    iconSrc?: string;
    /** Short text avatar (1–2 characters) — a friend's initial. Ignored when `avatar` is given. */
    initials?: string;
    /**
     * Escape hatch: a fully custom avatar. REPLACES the styled 36×36 box rather than
     * filling it, so a caller needing a different size, radius or an interactive
     * avatar (the Account profile row's tappable picker) owns the whole slot.
     */
    avatar?: React.ReactNode;
    /** Ramp hue for the avatar's MID fill (the glyph is always ink). Defaults to the neutral grey pair. */
    hue?: RampHue;
    title: React.ReactNode;
    /** Second line. Truncates with an ellipsis — it is a single line by design. */
    subtitle?: React.ReactNode;
    /**
     * THIRD line, set in mono — the design's second `.s` inside `.tx`. Only one row in
     * the artboards has it (Account's profile row, carrying the copyable user ID — removed
     * 2026-11-13, the ID now lives on the Friends tab only, so the slot has NO caller
     * today), so it is the exception rather than a general-purpose slot: reach for it when a row's
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
    /**
     * Re-colours the row's face, hairline and text for a page whose ground is not paper —
     * a Tier 2 page at night passes its time-of-day look (src/timeOfDay/tier2Look.ts →
     * Tier2Look satisfies this shape, so `tones={look}` works). The avatar keeps its
     * pastel fill and ink glyph either way (pastels stay pastel on slate). Omitted = the
     * paper-ground day tones (ROW_DAY_TONES). Caller: features/reader/TextSidebar.tsx.
     */
    tones?: RowTones;
}

/** The colours `tones` can override — field names match Tier2Look's. */
export interface RowTones {
    /** The row's face. */
    surface: string;
    /** Its 1px hairline. */
    line: string;
    /** Title ink. */
    ink: string;
    /** The trailing value. */
    ink2: string;
    /** Subtitle, meta line and chevron. */
    muted: string;
}

/** The paper-ground row, as every caller without `tones` draws it. */
const ROW_DAY_TONES: RowTones = {
    surface: COLORS.white,
    line: COLORS.rowBorder,
    ink: COLORS.onSurface,
    ink2: COLORS.iconColor,
    muted: COLORS.textSecondary,
};

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
    iconSrc,
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
    tones,
}) => {
    // Day callers keep their exact colours: the meta line and chevron stay `textFaint`
    // (fainter than the subtitle) unless a `tones` set is passed, which has one muted tier.
    const t = tones ?? ROW_DAY_TONES;
    const faint = tones ? tones.muted : COLORS.textFaint;
    // v2: avatars are the hue's MID tier ("Mid: … avatars", artboards 5 and 8) and the
    // glyph on them is ink — there is no per-hue ink tier any more.
    const fill = RAMP[hue].mid;
    const ink = COLORS.onSurface;
    // `sx` here is always a plain object literal from `rowLinkProps`, never MUI's
    // array/callback form — typing it as such keeps it spreadable below.
    const { sx: linkSx, ...link } = rowLinkProps(to, state, onClick) as {
        sx?: Record<string, string>;
        [key: string]: unknown;
    };
    const hasAvatar = avatar !== undefined || iconSrc !== undefined || icon !== undefined || initials !== undefined;

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
                    backgroundColor: t.surface,
                    border: `1px solid ${t.line}`,
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
                    {iconSrc ? (
                        <Box
                            component="img"
                            className="row__avatar-image"
                            src={iconSrc}
                            alt=""
                            // Same optical size as the 19px glyph would be, with a little
                            // more room: icons8 artwork carries its own padding.
                            sx={{ width: 24, height: 24, objectFit: "contain", display: "block" }}
                        />
                    ) : icon ? <Icon name={icon} size={19} color={ink} /> : initials}
                </Box>
            )}

            <Box className="row__text" sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    className="row__title"
                    sx={{ fontFamily: FONTS.sans, fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", color: t.ink }}
                >
                    {title}
                </Typography>
                {subtitle !== undefined && (
                    <Typography
                        className="row__subtitle"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: 11.5,
                            color: t.muted,
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
                            ...DATA_TYPE,
                            fontSize: 10.5,
                            color: faint,
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
                    sx={{ ...DATA_TYPE, fontSize: 11, color: t.ink2, flexShrink: 0 }}
                >
                    {value}
                </Typography>
            )}
            {trailing}
            {chevron && <Icon name="chevron_right" size={17} color={faint} />}
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

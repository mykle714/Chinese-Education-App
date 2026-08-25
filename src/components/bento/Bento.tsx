import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { styled } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SHADOW } from "../../theme/shadows";

/**
 * Bento — the menu primitive (docs/SHELF_REDESIGN.md § A4). The component that
 * replaces `HubMenu` (decision D8).
 *
 * THE RULE THAT MAKES THE SYSTEM WORK — the whole redesign turns on this one
 * choice, so it is restated wherever either primitive is defined:
 *
 *     Bento is for MENUS OF DESTINATIONS.
 *     Shelf is for COLLECTIONS THE USER OWNS.
 *
 *     If a tile NAVIGATES, it is a Bento tile.
 *     If it represents a thing WITH A COUNT, it is a spine.
 *
 * A destination has no size, so a Bento tile has no height encoding — every tile in
 * a grid is the same height and the only weighting is `hero` (spans both columns)
 * and `low` (a shorter row of minor destinations). That is the opposite of `Spine`,
 * whose height IS its count.
 *
 * Five pieces, matching the design's classes:
 *
 *   Bento         `.bento`   the 2-column grid — owns the 16px page gutter
 *   BentoTile     `.bt`      one destination; `hero` = `.bt.w2`, `low` = `.bt.lo`
 *   BentoStrip    `.strip`   a full-width cell: a small header over a row of sub-tiles
 *   BentoSubTile  `.st`      one sub-tile inside a strip
 *   BentoTileRow  `.row`     the flex row a strip's sub-tiles sit in
 *
 * ON THE MISSING `markOutline`: every other pastel fill in the app carries the 12%
 * inset ring, because at ~1.15:1 against paper a pastel is not a shape on its own
 * (D2). A Bento tile is the deliberate exception, and the design draws the
 * distinction itself: `.msb .cells i` — 15px tall, no content — gets the inset ring,
 * while `.bt` — 112px tall, carrying a title and a subtitle — gets a soft drop
 * shadow instead. At this size the content and the shadow do the separating work,
 * and an inset hairline on a 19px-radius tile reads as a stray border. The rule is
 * therefore "a pastel needs an outline UNLESS it is large and occupied".
 *
 * Used by: entries 1 (Home), 3 (Discover), 4 (Games), 5 (Account).
 */

/**
 * `.bento` — the grid. The 16px gutter is the design's menu gutter (the Shelf's is 22px;
 * they are different numbers on purpose, since a tile's own 14px of padding already
 * insets its text).
 *
 * TWO COLUMNS IS THE DEFAULT AND THE NORM — it is what every hub in the app uses, and
 * what makes a tile big enough to carry a title and a subtitle. `columns={3}` exists for
 * the one shape the artboards also draw (Friends, artboard 8): a row of SIBLING ACTIONS
 * that belong together and are named in one word each. At three columns a tile is too
 * narrow for a subtitle, so pair it with `variant="low"` and let the ghost glyph carry
 * the meaning the one-word label compresses. Do not reach for it to fit more
 * destinations on a hub — that is what a `BentoStrip` is for.
 */
const Bento = styled(Box, {
    shouldForwardProp: (prop) => prop !== "columns",
})<{ columns?: 2 | 3 }>(({ columns = 2 }) => ({
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: 10,
    padding: "14px 16px 0",
}));


/**
 * A tile is a DESTINATION, so it must be a real anchor rather than a Box with an
 * onClick: that is what gives it middle-click/new-tab, a status-bar URL preview, and
 * keyboard focus for free. This resolves the `to`/`onClick` pair into the props that
 * turn a `Box` into a `RouterLink` when — and only when — there is a route to go to.
 *
 * `onClick` alone is still supported for the tiles that open a sheet instead of
 * navigating; those are genuinely buttons and are typed as such.
 */
function tileLinkProps(to?: string, state?: unknown, onClick?: (e: React.MouseEvent) => void) {
    if (to) {
        return {
            component: RouterLink as React.ElementType,
            to,
            state,
            onClick,
            // The tile paints its own colour and type; the anchor must not add link
            // styling on top of it.
            sx: { textDecoration: "none", color: "inherit" },
        };
    }
    return onClick ? { component: "button" as React.ElementType, type: "button", onClick } : {};
}

export type BentoTileVariant = "base" | "hero" | "low" | "compact";

/** Per-variant geometry. Kept as a table rather than branches so the three variants
 *  can be read against each other — the ghost glyph's size and offset change with
 *  the tile, and that pairing is easy to break when it is spread across ifs. */
const TILE_VARIANTS: Record<
    BentoTileVariant,
    { minHeight: number; span: number; title: number; letterSpacing: string; sub: number; ghost: number; ghostTop: number }
> = {
    base: { minHeight: 112, span: 1, title: 15.5, letterSpacing: "-0.015em", sub: 11.5, ghost: 92, ghostTop: -14 },
    hero: { minHeight: 150, span: 2, title: 23, letterSpacing: "-0.028em", sub: 12.5, ghost: 140, ghostTop: -26 },
    low: { minHeight: 90, span: 1, title: 15.5, letterSpacing: "-0.015em", sub: 11.5, ghost: 92, ghostTop: -14 },
    // The 3-up tile (Friends, artboard 8). Everything shrinks TOGETHER, and the ghost
    // shrinks most: at a third of the screen the tile is ~117px wide, so `low`'s 92px
    // glyph would fill it corner to corner and stop reading as a wash behind the label.
    compact: { minHeight: 74, span: 1, title: 14, letterSpacing: "-0.015em", sub: 11, ghost: 66, ghostTop: -10 },
};

export interface BentoTileProps {
    /** `.t` — the destination's name. */
    title: ReactNode;
    /** `.s` — one short line on what is there. Optional; a self-evident tile skips it. */
    subtitle?: ReactNode;
    /**
     * Which ramp hue the tile wears. A KEY rather than a colour, because the tile
     * needs TWO tiers of the same hue at once — the pastel `fill` for its body and
     * the matching `ink` for its ghost glyph — and passing them separately is the one
     * palette mistake that typechecks and survives review (see `RAMP`).
     *
     * Text is `COLORS.onSurface` (title) and `COLORS.textSecondary` (subtitle) on
     * every hue; never white, which is ~1.1:1 against a 93% pastel.
     */
    hue: RampHue;
    /**
     * `.bg` — the oversized ghost glyph that bleeds off the top-right. A Material
     * Symbols name (see components/Icon).
     *
     * It is drawn in the tile's OWN ink at 15%, not in neutral ink: the artboards set
     * `color:var(--purA)` on the tile and let `.bg` inherit it, so the ghost is a
     * deeper wash of the tile's own hue rather than a grey smudge on it. That is what
     * keeps a tile reading as one colour instead of two.
     *
     * It is decoration, not information: clipped, behind the text, and at 15% barely a
     * tone. Pick it so a hub reads as one family of shapes at a glance — do NOT rely
     * on it to distinguish two tiles, because the title is doing that job.
     */
    icon?: string;
    /** `.pin` — a mono pill badge in the tile's top-right corner. */
    pin?: ReactNode;
    /**
     * What the pin MEANS, which is the only thing that decides its colour:
     *   `"default"` — a fact about the destination ("14 decks", "2 modes"). Translucent
     *                 white, so it reads as a quiet note on the tile's own pastel.
     *   `"alert"`   — a count of things WAITING FOR THE USER (friend requests, pending
     *                 challenges). The app's danger pink on white, because an unread
     *                 count that blends into its tile is a notification nobody sees.
     *
     * The distinction is deliberate and worth keeping: if every pin were alert-coloured
     * the tiles would all shout, and if none were, the two counts on the Friends hub —
     * the entire discovery mechanism for challenges (docs/STUDY_CHALLENGE.md § 1, Q48) —
     * would be indistinguishable from a deck count.
     */
    pinTone?: "default" | "alert";
    variant?: BentoTileVariant;
    /**
     * Force the tile across every column of its grid, keeping `variant`'s geometry.
     *
     * `hero` already spans full width — it IS the big full-width tile — so this is for
     * the other combination the artboards use: a SHORT tile that still owns its own row
     * (Friends' Challenges bar, a `compact`/`low` tile under a 3-up of siblings). Width
     * and height are separate decisions, and folding them into one enum would mean
     * minting a variant per pairing.
     */
    fullWidth?: boolean;
    /** Destination route — the whole tile becomes a `RouterLink` to this path. */
    to?: string;
    /** Router `state` to carry with the navigation (Bubble Match's chosen level). */
    state?: unknown;
    /**
     * Receives the click event, so a tile that also has a `to` can intercept its own
     * activation — `preventDefault()` and navigate imperatively — while still leaving
     * modified clicks (⌘/ctrl/middle) to the underlying anchor. Word Search's mode
     * tiles need exactly this, to confirm before clobbering a saved board.
     */
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
}

/** `.bt` — one destination. */
export const BentoTile: React.FC<BentoTileProps> = ({
    title,
    subtitle,
    hue,
    icon,
    pin,
    pinTone = "default",
    variant = "base",
    fullWidth = false,
    to,
    state,
    onClick,
    className,
}) => {
    const v = TILE_VARIANTS[variant];
    const alertPin = pinTone === "alert";
    const spansGrid = fullWidth || v.span === 2;
    const link = tileLinkProps(to, state, onClick);
    const { fill, ink } = RAMP[hue];
    return (
        <Box
            className={`bento-tile bento-tile--${variant}${className ? ` ${className}` : ""}`}
            {...link}
            sx={{
                position: "relative",
                // A `button` element brings its own border/background/font; a tile must
                // look identical whether it navigates, opens a sheet, or does neither.
                border: "none",
                textAlign: "left",
                font: "inherit",
                // `1 / -1` rather than `span 2`: a hero is "the full width of whatever
                // grid it is in", and spelling it as a span silently means "two thirds"
                // the moment it lands in a 3-column Bento.
                gridColumn: spansGrid ? "1 / -1" : undefined,
                minHeight: v.minHeight,
                borderRadius: "19px",
                padding: "14px",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                // Content sits at the FOOT of the tile, which is what leaves the head
                // free for the ghost glyph to bleed into.
                justifyContent: "flex-end",
                background: fill,
                boxShadow: SHADOW.rest,
                cursor: to || onClick ? "pointer" : "default",
                textDecoration: "none",
            }}
        >
            {icon && (
                <Icon
                    name={icon}
                    size={v.ghost}
                    color={ink}
                    className="bento-tile__ghost"
                    sx={{ position: "absolute", top: v.ghostTop, right: -10, opacity: 0.15, pointerEvents: "none" }}
                />
            )}
            {pin && (
                <Box
                    className={`bento-tile__pin bento-tile__pin--${pinTone}`}
                    sx={{
                        position: "absolute",
                        top: 12,
                        right: 13,
                        zIndex: 1,
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                        // An alert pin is a solid chip and needs a proper minimum size:
                        // a one-digit count in a pill sized by its padding renders as an
                        // oval, not the circle a notification badge is read as.
                        ...(alertPin
                            ? {
                                color: COLORS.white,
                                background: COLORS.dangerInk,
                                fontWeight: 600,
                                minWidth: 20,
                                textAlign: "center",
                                padding: "4px 6px",
                                lineHeight: 1.2,
                            }
                            : {
                                color: COLORS.onSurface,
                                background: "rgba(255, 255, 255, 0.72)",
                                padding: "4px 8px",
                            }),
                        borderRadius: "999px",
                    }}
                >
                    {pin}
                </Box>
            )}
            <Box
                className="bento-tile__title"
                sx={{
                    // `position: relative` on the text is load-bearing: without it the
                    // ghost glyph — an absolutely-positioned later sibling — paints OVER
                    // the title rather than behind it.
                    position: "relative",
                    fontFamily: FONTS.sans,
                    fontSize: v.title,
                    fontWeight: 600,
                    letterSpacing: v.letterSpacing,
                    lineHeight: 1.2,
                    color: COLORS.onSurface,
                }}
            >
                {title}
            </Box>
            {subtitle && (
                <Box
                    className="bento-tile__subtitle"
                    sx={{
                        position: "relative",
                        fontFamily: FONTS.sans,
                        fontSize: v.sub,
                        color: COLORS.textSecondary,
                        marginTop: "3px",
                        lineHeight: 1.3,
                        // The hero is two columns wide but its subtitle should not be:
                        // a full-width line of 12.5px text under a 23px title reads as a
                        // paragraph rather than a caption.
                        ...(variant === "hero" ? { maxWidth: 250 } : {}),
                    }}
                >
                    {subtitle}
                </Box>
            )}
        </Box>
    );
};

export interface BentoStripProps {
    /** `.sh b` — the strip's caption. */
    label: ReactNode;
    /**
     * `.lab` — a mono uppercase note at the right end of the caption ("×14 wins",
     * "2 modes"). This is where the design puts a strip's STATUS, which is why a strip
     * header is not the same component as `ShelfHeader`: a shelf's header ends in a
     * chevron ("there is more of this"), a strip's ends in a fact about the set.
     */
    meta?: ReactNode;
    /**
     * An interactive control sitting immediately after the caption, on the same line.
     *
     * `meta` is a FACT about the set and `action` navigates; this is neither — it is a
     * setting that changes what the sub-tiles will launch (Bubble Match's pinyin
     * switch, which picks the run's mastery track). It sits beside the label rather
     * than at the right end so it reads as part of the group's name, not as its status.
     */
    control?: ReactNode;
    /** An affordance at the right end instead of `meta` — a Material Symbols name. */
    action?: string;
    onActionClick?: () => void;
    /** `.row` — a flex row of `BentoSubTile`. */
    children: ReactNode;
    className?: string;
}

/**
 * `.strip` — a full-width grid cell holding a captioned row of sub-tiles.
 *
 * It exists because some destinations are a SET (Games' level rows, Home's grouped
 * destinations) and promoting each member to a full tile would make a hub of six
 * things look like a hub of twenty. A strip keeps the group one visual unit.
 */
export const BentoStrip: React.FC<BentoStripProps> = ({
    label,
    meta,
    control,
    action,
    onActionClick,
    children,
    className,
}) => (
    <Box className={`bento-strip${className ? ` ${className}` : ""}`} sx={{ gridColumn: "1 / -1" }}>
        <Box
            className="bento-strip__header"
            onClick={onActionClick}
            sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 3px 7px",
                cursor: onActionClick ? "pointer" : "default",
            }}
        >
            {/* Caption + its optional control, kept together at the left end so the
                right end stays the strip's status slot (`meta`). */}
            <Box className="bento-strip__caption" sx={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <Box sx={{ fontFamily: FONTS.sans, fontSize: 13, fontWeight: 600, color: COLORS.onSurface }}>
                    {label}
                </Box>
                {control}
            </Box>
            {meta !== undefined && (
                <Box
                    className="bento-strip__meta"
                    sx={{
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: COLORS.textFaint,
                        whiteSpace: "nowrap",
                    }}
                >
                    {meta}
                </Box>
            )}
            {action && <Icon name={action} size={17} color={COLORS.textSecondary} />}
        </Box>
        <Box className="bento-strip__row" sx={{ display: "flex", gap: "9px" }}>
            {children}
        </Box>
    </Box>
);

export interface BentoSubTileProps {
    title: ReactNode;
    subtitle?: ReactNode;
    /** A ramp hue key, as `BentoTile` — fill for the body, its ink for the ghost. */
    hue: RampHue;
    /** The ghost glyph — smaller and less offset than a full tile's. */
    icon?: string;
    /** `.star` — a small mark in the top-right, for "completed" / "favourite". */
    star?: ReactNode;
    /** Destination route — the whole sub-tile becomes a `RouterLink` to this path. */
    to?: string;
    /** Router `state` to carry with the navigation. */
    state?: unknown;
    /** Receives the click event — see `BentoTileProps.onClick`. */
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
}

/** `.st` — one sub-tile inside a `BentoStrip`. Flexes to share the row evenly. */
export const BentoSubTile: React.FC<BentoSubTileProps> = ({
    title,
    subtitle,
    hue,
    icon,
    star,
    to,
    state,
    onClick,
    className,
}) => (
    <Box
        className={`bento-subtile${className ? ` ${className}` : ""}`}
        {...tileLinkProps(to, state, onClick)}
        sx={{
            border: "none",
            textAlign: "left",
            font: "inherit",
            textDecoration: "none",
            flex: 1,
            // Without this a sub-tile with a long title widens instead of wrapping,
            // and the row's even split — the thing that makes a strip read as a set —
            // goes with it.
            minWidth: 0,
            position: "relative",
            borderRadius: "15px",
            padding: "11px",
            minHeight: 80,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            overflow: "hidden",
            background: RAMP[hue].fill,
            cursor: to || onClick ? "pointer" : "default",
        }}
    >
        {icon && (
            <Icon
                name={icon}
                size={56}
                color={RAMP[hue].ink}
                className="bento-subtile__ghost"
                sx={{ position: "absolute", top: -8, right: -6, opacity: 0.16, pointerEvents: "none" }}
            />
        )}
        {star && (
            <Box
                className="bento-subtile__star"
                sx={{ position: "absolute", top: 8, right: 9, zIndex: 1, fontSize: 12, lineHeight: 1 }}
            >
                {star}
            </Box>
        )}
        <Box
            className="bento-subtile__title"
            sx={{ position: "relative", fontFamily: FONTS.sans, fontSize: 12.5, fontWeight: 600, color: COLORS.onSurface }}
        >
            {title}
        </Box>
        {subtitle && (
            <Box
                className="bento-subtile__subtitle"
                sx={{ position: "relative", fontFamily: FONTS.sans, fontSize: 10.5, color: COLORS.textSecondary }}
            >
                {subtitle}
            </Box>
        )}
    </Box>
);

export default Bento;

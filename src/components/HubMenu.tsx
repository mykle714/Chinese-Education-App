import { type ReactNode, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import { useSlideNavigate } from "../hooks/useSlideNavigate";
import { useDragScroll } from "../hooks/useDragScroll";
import { cardBaseSx, CARD_PADDING_PX } from "./hubMenuCardBase";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../theme/scale";

// Shared vertical hub menu, used by the Home (`/`), Games (`/games`), and
// Discover (`/discover`) hubs so all three stay visually identical. See
// docs/HUB_MENU_SYSTEM.md for the full design.
//
// A menu item is either:
//   - a single HubMenuRow — a large 2:1-landscape rounded card, 80% of the
//     phone-frame width and centered, or
//   - a HubMenuArrayItem — a horizontally-scrolling strip of smaller (70%-wide)
//     sub-cards, same visual language, for items that fan out into several
//     choices (e.g. Bubble Match's 3 difficulty levels).
// Every card has a persistent pastel background color (`bgColor`), chosen once
// by whoever renders it and hardcoded there — never randomized at render time
// so a given item always shows the same color. Title top-left, subtitle below
// it, icon large on the right, and an optional stat badge pinned to the
// top-right corner.
//
// HubMenu itself also accepts an optional `header`/`footer`, rendered above/
// below the card list (still inside the page's normal scroll area — see
// docs/HUB_MENU_SYSTEM.md for how that interacts with MobileTabScreen's
// scroll-away header + floating-footer clearance).

const MenuList = styled(Box)(() => ({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    gap: 28,
    padding: 0,
    marginTop: 16,
}));

const MenuCard = styled(RouterLink, {
    shouldForwardProp: (prop) => prop !== "bgcolor",
})<{ bgcolor: string }>(({ bgcolor }) => ({
    ...cardBaseSx,
    width: "80%",
    margin: "0 auto",
    backgroundColor: bgcolor,
}));

const ArraySubCard = styled(RouterLink, {
    shouldForwardProp: (prop) => prop !== "bgcolor",
})<{ bgcolor: string }>(({ bgcolor }) => ({
    ...cardBaseSx,
    flex: "0 0 70%",
    width: "70%",
    backgroundColor: bgcolor,
}));

const ArrayScroll = styled(Box)(() => ({
    display: "flex",
    gap: 16,
    width: "100%",
    overflowX: "auto",
    // Must be stated explicitly: CSS computes the *other* axis to `auto` when one
    // axis is `auto`/`scroll`, so `overflowX: auto` alone would make the strip a
    // VERTICAL scroll container too — sub-pixel rounding of the sub-cards'
    // `aspectRatio: 2/1` height then leaves a few px of vertical slop the user can
    // drag the strip around in (cards wobble in place). Nothing here is meant to
    // overflow vertically, so clipping is safe.
    overflowY: "hidden",
    // Matches MenuCard's 10% left inset (width: 80%, margin: 0 auto) so the
    // first sub-card's left edge lines up with a regular HubMenuRow above/below
    // it; mirrored on the right so the strip stays visually centered.
    padding: "0 10%",
    // Horizontal scrolling is opt-in here (the app shell uses touchAction: none).
    touchAction: "pan-x",
    scrollbarWidth: "none",
    "&::-webkit-scrollbar": { display: "none" },
}));

// Column wrapper for a fan-out strip that carries a group header above it, so
// the header + strip read as ONE menu item inside MenuList's 28px gap.
const ArrayGroup = styled(Box)(() => ({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    gap: 8,
}));

// Group header row. Its 10% side inset matches ArrayScroll's padding (and
// MenuCard's centered 80% width) so the title lines up with the first sub-card's
// left edge and the badge with the last card's right edge of a full-width row.
const ArrayGroupHeaderRow = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    padding: "0 10%",
    boxSizing: "border-box",
}));

const RowIconTile = styled(Box)(() => ({
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
    "& svg": {
        fontSize: 36,
    },
}));

// Left column of a card: title over subtitle. `alignSelf: stretch` overrides
// cardBaseSx's `alignItems: flex-start` so the column spans the card's full
// height; with top-aligned text that changes nothing visually, but it keeps the
// body from collapsing around short content.
const RowBody = styled(Box)(() => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    alignSelf: "stretch",
}));

// Right-edge slot of a card, outboard of the icon tile: a full-height column
// holding a vertical label (today only a `MarkTypeChip variant="edge"`).
// The label inside renders at ONE fixed font size on every card; this column is
// what has to be tall enough for it. Negative margins cancel the card's own padding
// (CARD_PADDING_PX) on three sides so the column spans the cell's FULL height and
// sits close to its right edge — a long track name ("RECOGNITION") needs more run
// than the padded content box gives it, and clipped text is worse than text that
// reaches nearer the edge.
//
// The label is CENTERED in that full height, so it reads as balanced against the
// card rather than anchored to one end. Note this is what makes the corner badge a
// live concern: CornerBadgeSlot floats at top/right 14 and is ~33px tall, while a
// centered ~89px run on the shortest card (136px) starts ~24px down — the two can
// touch on a card carrying both. Reserving a band for the badge is what
// EDGE_SLOT_BADGE_INSET used to do, and it was removed for reading as too much
// padding; if the overlap ever matters, move the badge rather than re-inset here.
const EDGE_SLOT_CORNER_CLEARANCE = 4;
// How much of the card's right padding the slot reclaims. Half, not all: flush to
// the edge would collide with the corner radius and read as a printing error.
const EDGE_SLOT_RIGHT_PULL = CARD_PADDING_PX / 2;
const CardEdgeSlot = styled(Box)(() => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    flexShrink: 0,
    marginTop: -CARD_PADDING_PX,
    marginBottom: -CARD_PADDING_PX,
    marginRight: -EDGE_SLOT_RIGHT_PULL,
    paddingTop: EDGE_SLOT_CORNER_CLEARANCE,
    paddingBottom: EDGE_SLOT_CORNER_CLEARANCE,
}));

const CornerBadgeSlot = styled(Box)(() => ({
    position: "absolute",
    top: 14,
    right: 14,
}));

/** Small pill for a card's top-right corner: an optional weekly ⭐ plus an
    optional "×N" count (e.g. lifetime wins). Renders nothing if both are
    empty/falsy.

    `variant` picks the fill for the surface it sits on: `"card"` (default) is
    the translucent white that reads on a pastel hub card; `"header"` is the
    neutral tint used by {@link HubMenuGroupHeader}, which sits on the plain page
    background where translucent white would disappear. */
export const HubMenuStatBadge: React.FC<{ starred?: boolean; count?: number; variant?: "card" | "header" }> = ({
    starred,
    count,
    variant = "card",
}) => {
    if (!starred && !count) return null;
    return (
        <Box
            className={`hub-menu__stat-badge hub-menu__stat-badge--${variant}`}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderRadius: "999px",
                flexShrink: 0,
                backgroundColor: variant === "header" ? COLORS.rowHoverBg : "rgba(255, 255, 255, 0.55)",
                fontSize: SIZE.caption,
                fontWeight: WEIGHT.bold,
                color: COLORS.onSurface,
                fontFamily: FONTS.sans,
            }}
        >
            {starred && <Box component="span" aria-hidden>⭐</Box>}
            {!!count && <Box component="span">×{count}</Box>}
        </Box>
    );
};

/** Header line above a fan-out strip: the game/group name on the left and an
    optional aggregate stat (e.g. a {@link HubMenuStatBadge}) on the right.
    Exported so feature-owned strips (Word Search's hub item) render the exact
    same header as a generic {@link HubMenuArrayItem}.

    This is where a GAME-WIDE total belongs — the sub-cards below it are per
    level/mode, so a count pinned to one of them would read as that card's own
    score. See docs/HUB_MENU_SYSTEM.md. */
export const HubMenuGroupHeader: React.FC<{ title: string; stat?: ReactNode; className?: string }> = ({
    title,
    stat,
    className,
}) => (
    <ArrayGroupHeaderRow className={className ?? "hub-menu__group-header"}>
        <Typography
            className="hub-menu__group-header-title"
            sx={{
                fontSize: SIZE.body,
                fontWeight: WEIGHT.bold,
                color: COLORS.textSecondary,
                fontFamily: FONTS.sans,
                lineHeight: LEADING.normal,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {title}
        </Typography>
        {stat}
    </ArrayGroupHeaderRow>
);

const CardTitle: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
    <RowBody className="hub-menu__row-body">
        <Typography
            className="hub-menu__row-title"
            sx={{
                fontSize: SIZE.bodyLg,
                fontWeight: WEIGHT.medium,
                color: COLORS.onSurface,
                fontFamily: FONTS.sans,
                lineHeight: LEADING.normal,
            }}
        >
            {title}
        </Typography>
        {subtitle && (
            <Typography
                className="hub-menu__row-subtitle"
                sx={{
                    fontSize: SIZE.body,
                    color: COLORS.textSecondary,
                    fontFamily: FONTS.sans,
                    lineHeight: LEADING.normal,
                    mt: 0.25,
                }}
            >
                {subtitle}
            </Typography>
        )}
    </RowBody>
);

/** Column wrapper that binds a {@link HubMenuGroupHeader} to the strip below it
    so the pair reads as ONE menu item. Exported for feature-owned strips that
    can't use {@link HubMenuArrayItem}'s built-in header (Word Search's). */
export const HubMenuGroup = ArrayGroup;

/** Large rounded icon tile (right side of a hub card). Exported for feature
    strips that build their own cards but want the identical icon treatment. */
export const HubMenuRowIconTile = RowIconTile;

/** Title-over-subtitle block (left side of a hub card). Exported alongside
    {@link cardBaseSx} / {@link HubMenuRowIconTile} for custom hub strips (e.g.
    Word Search's hub item). */
export const HubMenuCardTitle: React.FC<{ title: string; subtitle?: string }> = CardTitle;

/** Right-edge column of a hub card, rendered AFTER the icon tile — holds the
    vertical mark-type label. Exported so custom strips (Word Search's) place
    their label exactly where a generic {@link HubMenuRow} does. */
export const HubMenuCardEdgeSlot = CardEdgeSlot;

interface HubMenuProps {
    className?: string;
    /** Rendered above the card list, inside the same scroll area (e.g. a
        welcome banner or a TipBox). */
    header?: ReactNode;
    /** Rendered below the card list, inside the same scroll area (e.g. a
        TipBox and/or the shared `FooterSpacer` from MobileFooter, which every
        hub passes here so the last card clears the floating footer pill). */
    footer?: ReactNode;
    children: ReactNode;
}

export const HubMenu: React.FC<HubMenuProps> = ({ className, header, footer, children }) => (
    <MenuList className={className ?? "hub-menu"}>
        {/* header/footer render as direct flex children (not wrapped in their own
            Box) so a multi-part header/footer — e.g. a TipBox followed by another
            element — gets the same MenuList `gap` between its own parts as
            between the cards. */}
        {header}
        {children}
        {footer}
    </MenuList>
);

interface HubMenuRowProps {
    /** Destination route — the whole card is a RouterLink to this path. */
    to: string;
    /** Resolved icon node rendered inside the rounded tile. */
    icon: ReactNode;
    title: string;
    subtitle?: string;
    /** Persistent pastel background color for this item, e.g. `COLORS.blueAccent`.
        Chosen once by the caller and hardcoded — not randomized per render. */
    bgColor: string;
    /** React Router navigation state carried along with the link (e.g. a
        chosen game level). */
    state?: unknown;
    /** Optional stat pinned to the card's top-right corner. */
    cornerBadge?: ReactNode;
    /** Optional vertical label run up the card's RIGHT edge, outboard of the
        icon tile — used by the Games hub to name the mastery mark type a game
        feeds (`<MarkTypeChip variant="edge" />`). */
    chip?: ReactNode;
    /** Per-row class (e.g. `games-page__menu-item--bubble-match`). */
    className?: string;
}

export const HubMenuRow: React.FC<HubMenuRowProps> = ({ to, icon, title, subtitle, bgColor, state, cornerBadge, chip, className }) => {
    const slideNavigate = useSlideNavigate();
    // Intercept plain left-clicks to drive the slide-over view transition; leave
    // modified clicks (new tab/window) to the underlying RouterLink.
    const handleClick = (e: React.MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        slideNavigate(to, state !== undefined ? { state } : undefined);
    };
    return (
    <MenuCard to={to} state={state} onClick={handleClick} bgcolor={bgColor} className={className ?? "hub-menu__row"}>
        {cornerBadge && <CornerBadgeSlot className="hub-menu__row-badge">{cornerBadge}</CornerBadgeSlot>}
        <CardTitle title={title} subtitle={subtitle} />
        <RowIconTile className="hub-menu__row-icon">{icon}</RowIconTile>
        {chip && (
            <CardEdgeSlot className="hub-menu__row-chip">{chip}</CardEdgeSlot>
        )}
    </MenuCard>
    );
};

export interface HubMenuArraySubItem {
    key: string;
    to: string;
    icon: ReactNode;
    title: string;
    subtitle?: string;
    bgColor: string;
    state?: unknown;
    cornerBadge?: ReactNode;
    /** Optional right-edge vertical label — per SUB-CARD, so a strip whose
        choices differ (e.g. Word Search's modes feed different mastery tracks)
        can label each one accurately. */
    chip?: ReactNode;
}

interface HubMenuArrayItemProps {
    items: HubMenuArraySubItem[];
    /** Optional group name shown above the strip (e.g. the game's title). When
        omitted the strip renders bare, exactly as before. */
    headerTitle?: string;
    /** Optional aggregate stat for the group header — a stat that describes the
        WHOLE group rather than any one sub-card (e.g. a game's total wins).
        Ignored unless `headerTitle` is given. */
    headerStat?: ReactNode;
    className?: string;
}

/** A menu item that fans out into a horizontally-scrolling strip of smaller
    (70%-width) sub-cards instead of one full-width row — e.g. Bubble Match's
    3 difficulty levels. Desktop gets click-and-drag panning via useDragScroll;
    touch/trackpad scroll natively. Optionally topped by a group header carrying
    the group's name + an aggregate stat. */
export const HubMenuArrayItem: React.FC<HubMenuArrayItemProps> = ({ items, headerTitle, headerStat, className }) => {
    const slideNavigate = useSlideNavigate();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useDragScroll(scrollRef);

    const strip = (
        <ArrayScroll ref={scrollRef} className={headerTitle ? "hub-menu__array-item-scroll" : className ?? "hub-menu__array-item"}>
            {items.map((item) => {
                const handleClick = (e: React.MouseEvent) => {
                    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    slideNavigate(item.to, item.state !== undefined ? { state: item.state } : undefined);
                };
                return (
                    <ArraySubCard
                        key={item.key}
                        to={item.to}
                        state={item.state}
                        onClick={handleClick}
                        bgcolor={item.bgColor}
                        className="hub-menu__array-item-card"
                    >
                        {item.cornerBadge && <CornerBadgeSlot className="hub-menu__array-item-badge">{item.cornerBadge}</CornerBadgeSlot>}
                        <CardTitle title={item.title} subtitle={item.subtitle} />
                        <RowIconTile className="hub-menu__array-item-icon">{item.icon}</RowIconTile>
                        {item.chip && (
                            <CardEdgeSlot className="hub-menu__array-item-chip">{item.chip}</CardEdgeSlot>
                        )}
                    </ArraySubCard>
                );
            })}
        </ArrayScroll>
    );

    // No header → keep the bare strip so existing callers are byte-identical.
    if (!headerTitle) return strip;

    return (
        <ArrayGroup className={className ?? "hub-menu__array-group"}>
            <HubMenuGroupHeader title={headerTitle} stat={headerStat} />
            {strip}
        </ArrayGroup>
    );
};

import { type ReactNode, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import { useSlideNavigate } from "../hooks/useSlideNavigate";
import { useDragScroll } from "../hooks/useDragScroll";
import { cardBaseSx } from "./hubMenuCardBase";
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
    // Matches MenuCard's 10% left inset (width: 80%, margin: 0 auto) so the
    // first sub-card's left edge lines up with a regular HubMenuRow above/below
    // it; mirrored on the right so the strip stays visually centered.
    padding: "0 10%",
    // Horizontal scrolling is opt-in here (the app shell uses touchAction: none).
    touchAction: "pan-x",
    scrollbarWidth: "none",
    "&::-webkit-scrollbar": { display: "none" },
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

const RowBody = styled(Box)(() => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
}));

const CornerBadgeSlot = styled(Box)(() => ({
    position: "absolute",
    top: 14,
    right: 14,
}));

/** Small pill for a card's top-right corner: an optional weekly ⭐ plus an
    optional "×N" count (e.g. lifetime wins). Renders nothing if both are
    empty/falsy. */
export const HubMenuStatBadge: React.FC<{ starred?: boolean; count?: number }> = ({ starred, count }) => {
    if (!starred && !count) return null;
    return (
        <Box
            className="hub-menu__stat-badge"
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderRadius: "999px",
                backgroundColor: "rgba(255, 255, 255, 0.55)",
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

/** Large rounded icon tile (right side of a hub card). Exported for feature
    strips that build their own cards but want the identical icon treatment. */
export const HubMenuRowIconTile = RowIconTile;

/** Title-over-subtitle block (left side of a hub card). Exported alongside
    {@link cardBaseSx} / {@link HubMenuRowIconTile} for custom hub strips
    (e.g. Word Search's hub item). */
export const HubMenuCardTitle: React.FC<{ title: string; subtitle?: string }> = CardTitle;

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
    /** Per-row class (e.g. `games-page__menu-item--bubble-match`). */
    className?: string;
}

export const HubMenuRow: React.FC<HubMenuRowProps> = ({ to, icon, title, subtitle, bgColor, state, cornerBadge, className }) => {
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
}

interface HubMenuArrayItemProps {
    items: HubMenuArraySubItem[];
    className?: string;
}

/** A menu item that fans out into a horizontally-scrolling strip of smaller
    (70%-width) sub-cards instead of one full-width row — e.g. Bubble Match's
    3 difficulty levels. Desktop gets click-and-drag panning via useDragScroll;
    touch/trackpad scroll natively. */
export const HubMenuArrayItem: React.FC<HubMenuArrayItemProps> = ({ items, className }) => {
    const slideNavigate = useSlideNavigate();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useDragScroll(scrollRef);

    return (
        <ArrayScroll ref={scrollRef} className={className ?? "hub-menu__array-item"}>
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
                    </ArraySubCard>
                );
            })}
        </ArrayScroll>
    );
};

import React from "react";
import { COLORS } from "../theme/colors";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import { FONTS } from "../theme/fonts";
import { LEADING, WEIGHT } from "../theme/scale";

// The app's one page header (shelf redesign A2b, docs/SHELF_REDESIGN.md).
//
// ⚠️ THERE IS NO HEADER BAR ANY MORE. The header used to be a 60px `COLORS.header`
// strip with a circular IconButton in it. In the design it is not a bar at all: the
// title sits directly on the paper ground with generous top padding and no
// background, no border and no fixed height (`.hd` / `.lhd` in shelf-system.css).
// Nothing measured the old 60px, so removing it is safe.

// The four header sizes. The design has two header CLASSES — `.hd` (hubs and node
// drill-ins) and `.lhd` (leaf pages) — but writes `.hd` at three title sizes via
// inline overrides, and those overrides are not noise: they track how much else is
// on the header line.
//
//   24px  hub          nothing but a title
//   21px  node         a back chevron shares the line  (Games, Reader, Arena, …)
//   18px  dense        a back chevron AND a crowded right slot (Card Detail, Learn —
//                      four actions each, where 21px starts colliding)
//   17px  leaf         `.lhd`, the game/settings drill-in header
//
// `dense` is the one that must be asked for. The other three fall out of props the
// caller is already passing (see `resolvedSize`), because they follow from the
// navigation shape; `dense` follows from what the PAGE decided to put in the right
// slot, which no other prop knows about. Deriving it by counting `rightContent`'s
// children was the alternative and it is a trap — most callers pass a single wrapping
// Box or fragment, so the count is 1 no matter how many buttons are inside.
export type PageHeaderSize = "hub" | "node" | "dense" | "leaf";

interface SizeSpec {
    /** Container padding, `.hd` = 23/22/0, `.lhd` = 21/18/0. */
    padding: string;
    /** Title font-size in px. */
    titleSize: number;
    /** Title tracking — tightens as the title grows, per the design. */
    titleTracking: string;
    /** Gap between the right-slot's children. */
    rightGap: number;
}

const SIZE_SPEC: Record<PageHeaderSize, SizeSpec> = {
    hub: { padding: "23px 22px 0", titleSize: 24, titleTracking: "-0.025em", rightGap: 11 },
    node: { padding: "23px 22px 0", titleSize: 21, titleTracking: "-0.02em", rightGap: 11 },
    // Tighter right gap too: the whole point of `dense` is that the line is full.
    dense: { padding: "23px 22px 0", titleSize: 18, titleTracking: "-0.018em", rightGap: 10 },
    leaf: { padding: "21px 18px 0", titleSize: 17, titleTracking: "-0.015em", rightGap: 9 },
};

const Header = styled(Box, {
    shouldForwardProp: (prop) => prop !== "size",
})<{ size: PageHeaderSize }>(({ size }) => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    padding: SIZE_SPEC[size].padding,
    // Block native pan/scroll: dragging from the header must not scroll/bounce
    // the page (it sits above drag-to-sort/game surfaces). Mark a child scrollable
    // explicitly if one ever needs it.
    touchAction: "none",
}));

// The back chevron and the title are ONE group (`.hd .back`), tight at 9px, so the
// chevron reads as belonging to the title rather than as a separate toolbar button
// floating at the left edge. This is why there is no IconButton here any more — the
// 40px ripple target it drew was the whole reason the two used to look detached.
const BackGroup = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
    cursor: "pointer",
}));

interface PageHeaderProps {
    title: string;
    onBack?: () => void;
    showBack?: boolean;
    // Which way the back chevron points, and therefore WHICH GLYPH is drawn:
    // "left" is the node-page lateral arrow (`arrow_back`), "down" is the leaf-page
    // drill-in chevron (`keyboard_arrow_down`). These used to be one rotated
    // ExpandMoreIcon; the design draws them as two different Material Symbols, which
    // also reads better — a rotated chevron is not the same shape as an arrow.
    // See LeafPageHeader / NodePageHeader and docs/LEAF_NODE_PAGES.md.
    arrowDirection?: "down" | "left";
    // Title scale. Defaults are derived from the other two props so no existing
    // caller has to pass it: no back button -> "hub", lateral arrow -> "node",
    // drill-in chevron -> "leaf". Pass it explicitly for "dense" — a header whose
    // right slot carries three or more actions, which no other prop can tell.
    size?: PageHeaderSize;
    // Single ReactNode slot rendered flush-right (e.g. a settings gear, an undo
    // button, a toggle chip). Compose it from the Header* exports below rather than
    // hand-rolling chips and buttons per page. Do NOT put the minute-points flame
    // here — the header renders it for every page already (see the right slot).
    rightContent?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    onBack,
    showBack = true,
    rightContent,
    arrowDirection = "down",
    size,
}) => {
    const navigate = useNavigate();
    const resolvedSize: PageHeaderSize = size ?? (showBack ? (arrowDirection === "left" ? "node" : "leaf") : "hub");
    const spec = SIZE_SPEC[resolvedSize];

    const titleNode = (
        <Typography
            className="page-header__title"
            sx={{
                fontSize: spec.titleSize,
                fontWeight: WEIGHT.semibold,
                letterSpacing: spec.titleTracking,
                lineHeight: LEADING.tight,
                color: COLORS.onSurface,
                fontFamily: FONTS.sans,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
            }}
        >
            {title}
        </Typography>
    );

    return (
        <Header className="page-header" size={resolvedSize}>
            {showBack ? (
                <BackGroup
                    className="page-header__back"
                    onClick={onBack ?? (() => navigate(-1))}
                    role="button"
                    aria-label="Back"
                >
                    <Icon
                        className="page-header__back-icon"
                        name={arrowDirection === "left" ? "arrow_back" : "keyboard_arrow_down"}
                        size={arrowDirection === "left" ? 21 : 22}
                    />
                    {titleNode}
                </BackGroup>
            ) : (
                titleNode
            )}

            {/* Right: the page's configurable content slot, then the minute-points
                flame LAST. `marginLeft:auto` rather than `justify-content:space-between` on
                the container, so a header with no right content still keeps its title
                hard against the left edge.

                The FLAME IS RENDERED HERE, ONCE, FOR EVERY HEADER IN THE APP — pages do
                not opt in. It is an ambient indicator ("is my time counting right now?"),
                and a question the user can only ask where the answer is visible; when it
                was opt-in the answer was simply absent on the menus (Home, Games,
                Discover, Decks & Cards, Dictionary, Arena, Friends, …) and on two game
                pages that had forgotten it (Hydra Bubbles, Speed Reading). Off an
                eligible page `useMinutePoints` forces `isActive` false, so the badge
                draws its own IDLE state — grey flame, grey count — which is the correct
                answer there ("not earning"), not a missing one.

                Flame LAST, so it lands in the same corner of the screen on every page —
                a fixed place a learner's eye can go for "am I earning?" without reading
                the header. Per-page actions queue up to its LEFT and vary in number; if
                the flame led the row, its screen position would move with them.

                ⚠️ Exactly one `PageHeader` may be mounted at a time on a minute-EARNING
                page. `useMinutePoints` runs a 1-second accrual tick per hook instance,
                so two live headers on such a page would count every second twice. Today
                nothing renders two (every call site is one page = one header, and the
                branchy pages return them from mutually exclusive branches) — keep it
                that way rather than adding a second header to a page. */}
            <Box
                className="page-header__right-content"
                sx={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: `${spec.rightGap}px` }}
            >
                {rightContent}
                <MinutePointsFireBadge />
            </Box>
        </Header>
    );
};

export default PageHeader;

// ── rightContent building blocks ──────────────────────────────────────────────
// The design gives the right slot exactly four shapes. They live here, beside the
// header, because "what may sit in a header's right slot" is a property of the
// header — before this, every page that needed a toggle re-declared the same 14-line
// `toggleSx` helper (flp, Bubble Match and Word Search each had a byte-identical copy).
//
// The fifth design shape, `.fire`, is NOT here and is not a slot primitive at all:
// the app ships it as `src/minutePoints/MinutePointsFireBadge.tsx` (flame + count in
// `COLORS.fireActive`, which IS the design's `#E65100`), and `PageHeader` renders it
// into every header itself. Pages neither import nor pass it.

/**
 * `.hd .meta` — mono uppercase metadata (a card count, a division name, "live").
 * Read-only text; use HeaderIconButton if it should be tappable.
 */
export const HeaderMetaLabel: React.FC<{ children: React.ReactNode; color?: string; className?: string }> = ({
    children,
    color = COLORS.textFaint,
    className,
}) => (
    <Typography
        className={className ? `page-header__meta ${className}` : "page-header__meta"}
        sx={{
            fontFamily: FONTS.mono,
            fontSize: 10.5,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color,
            whiteSpace: "nowrap",
            lineHeight: LEADING.none,
        }}
    >
        {children}
    </Typography>
);

/**
 * An icon action in the right slot, in the design's TWO skins:
 *
 *   - `"outlined"` (`.hd .btn`) — a 32×32 rounded-11 outlined box. Used on HUB
 *     headers (see the Account artboard). The outline is the point there: a hub
 *     header carries a single lone action on bare paper, and an unboxed glyph has
 *     nothing to separate it from the page.
 *   - `"bare"` (default) — the glyph alone at 19px. Used on leaf/game and drill-in
 *     headers, where 2–4 actions sit in a row and boxing each one would build the
 *     toolbar strip the redesign just removed.
 */
export const HeaderIconButton: React.FC<{
    icon: string;
    onClick?: () => void;
    label: string;
    color?: string;
    disabled?: boolean;
    variant?: "outlined" | "bare";
    className?: string;
}> = ({ icon, onClick, label, color = COLORS.iconColor, disabled = false, variant = "bare", className }) => (
    <Box
        className={className ? `page-header__btn ${className}` : "page-header__btn"}
        onClick={disabled ? undefined : onClick}
        role="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
            ...(variant === "outlined"
                ? { width: 32, height: 32, borderRadius: "11px", border: `1px solid ${COLORS.border}` }
                : {}),
        }}
    >
        <Icon name={icon} size={19} color={color} />
    </Box>
);

/**
 * `.lhd .tg` — a mono toggle chip ("pinyin", "autoplay"). Off = grey fill + ink2
 * text; on = solid ink + white text. Note this is an INVERSION, not a tint change:
 * the design signals "on" by flipping the chip to the ink ground, which reads at a
 * glance in a way a slightly-darker grey does not.
 */
export const HeaderToggleChip: React.FC<{
    children: React.ReactNode;
    active: boolean;
    onClick?: () => void;
    disabled?: boolean;
    startIcon?: string;
    className?: string;
}> = ({ children, active, onClick, disabled = false, startIcon, className }) => (
    <Box
        // The active state carries its own class as well as `aria-pressed`, so a
        // surrounding surface can restyle just the ON chip with a plain class selector
        // (the game accent ground does — see gameSurfaceSx). An attribute selector
        // would work, but a named class is what the rest of the app reads for.
        className={[
            "page-header__toggle",
            active ? "page-header__toggle--active" : "",
            className ?? "",
        ].filter(Boolean).join(" ")}
        onClick={disabled ? undefined : onClick}
        role="button"
        aria-pressed={active}
        aria-disabled={disabled || undefined}
        sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontFamily: FONTS.mono,
            fontSize: 10,
            lineHeight: LEADING.none,
            padding: "6px 8px",
            borderRadius: "7px",
            whiteSpace: "nowrap",
            backgroundColor: active ? COLORS.onSurface : COLORS.grey,
            color: active ? COLORS.white : COLORS.iconColor,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
        }}
    >
        {startIcon && <Icon name={startIcon} size={13} color={active ? COLORS.white : COLORS.iconColor} />}
        {children}
    </Box>
);

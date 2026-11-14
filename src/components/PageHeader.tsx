import React from "react";
import { COLORS } from "../theme/colors";
import { Box, Typography } from "@mui/material";
import { styled, type SxProps, type Theme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import { useScrollSafeTap } from "../hooks/useScrollSafeTap";
import { CYCLE_CHIP_FONT_PX, cycleChipFontPx } from "./cycleChipSizing";
import {
    BACK_ARROW_ICON,
    BACK_ARROW_PX,
    BACK_GROUP_GAP_PX,
    DENSE_HEADER_PAD_TOP_PX,
    DENSE_HEADER_PAD_X_PX,
    DENSE_HEADER_TITLE_PX,
    DENSE_HEADER_TITLE_TRACKING,
    DENSE_HEADER_RIGHT_GAP_PX,
    HUB_HEADER_PAD_TOP_PX,
    HUB_HEADER_PAD_X_PX,
    HUB_HEADER_TITLE_PX,
    HUB_HEADER_TITLE_TRACKING,
    OUTLINED_CHIP_ICON_PX,
    outlinedChipSx,
} from "./pageHeaderSizing";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import { FONTS, DATA_TYPE } from "../theme/fonts";
import { LEADING, WEIGHT } from "../theme/scale";
import { SAFE_TOP } from "../theme/safeArea";

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
//   28px  hub          nothing but a title
//   24px  node         a back chevron shares the line  (Games, Reader, Arena, …)
//   21px  dense        a back chevron AND a crowded right slot (Card Detail, Learn —
//                      four actions each, where 24px starts colliding)
//   20px  leaf         `.lhd`, the game/settings drill-in header
//
// SCALE (2026-11-05): every header size AND every right-slot primitive below (icons,
// chips, meta label, avatar, flame) was scaled up ~15% together from the design's
// 24/21/18/17 so the header reads larger without changing its hierarchy. Keep the
// ratios when retuning — the title steps and the control sizes were moved as one.
// EXCEPTION: the outlined chips (audio chip, HeaderActionChip) were scaled up with the
// rest, then put back to their pre-scale 15px glyph / 4px pad / 12px type (pageHeaderSizing.ts).
//
// `dense` is the one that must be asked for. The other three fall out of props the
// caller is already passing (see `resolvedSize`), because they follow from the
// navigation shape; `dense` follows from what the PAGE decided to put in the right
// slot, which no other prop knows about. Deriving it by counting `rightContent`'s
// children was the alternative and it is a trap — most callers pass a single wrapping
// Box or fragment, so the count is 1 no matter how many buttons are inside.
export type PageHeaderSize = "hub" | "node" | "dense" | "leaf";

interface SizeSpec {
    /** Container top padding in px, `.hd` = 23, `.lhd` = 27. */
    padTop: number;
    /**
     * Container bottom padding in px — `HEADER_PAD_BOTTOM_PX` for EVERY size (user,
     * 2026-11-14), so whatever a page puts first under its header (a tab selector, a
     * card, a list) starts the same distance below it on every page. Kept per size
     * so a future size can still diverge deliberately.
     */
    padBottom: number;
    /** Container horizontal padding in px, `.hd` = 22, `.lhd` = 18. */
    padX: number;
    /** Title font-size in px. */
    titleSize: number;
    /** Title tracking — tightens as the title grows, per the design. */
    titleTracking: string;
    /** Gap between the right-slot's children. */
    rightGap: number;
}

// ── Right-slot control sizes (scaled with the titles, 2026-11-05) ──────────────
/** A HeaderIconButton's glyph, px (19 before the scale-up). */
const HEADER_ICON_PX = 22;
/** The `outlined` HeaderIconButton's box, px (32 before). */
const HEADER_OUTLINED_BTN_PX = 36;
/** The leaf header's drill-in `keyboard_arrow_down` chevron, px (22 before). */
const DOWN_CHEVRON_PX = 25;
/** HeaderMetaLabel's mono caps, px (10.5 before). */
const HEADER_META_FONT_PX = 12;
/** The filled mono chips' (HeaderToggleChip, HeaderCycleChip) padding and corner ("6px 8px" / 7px before). */
const HEADER_CHIP_PADDING = "7px 9px";
const HEADER_CHIP_RADIUS = "8px";

/**
 * The ONE gap between a page header and the content under it, in px (user, 2026-11-14:
 * "a universal padding for that header so all content for all pages that use the header
 * has that bit of space"). 14px = the app's card gutter (`SectionCard`'s 14px top
 * margin). Before it, the three `.hd` sizes (hub/node/dense) had 0 — the design left
 * them flush and each page brought its own top gutter — and `leaf` had 8. A page whose
 * content still pads its own top now gets that ON TOP of this gap.
 *
 * Overridden by: `components/sheet/sheetStyled.ts` → `SheetHeaderSlot` (a panel's
 * title band centres itself with equal top/bottom padding).
 * Docs: docs/designGuidelines.md (header spacing); docs/LEAF_NODE_PAGES.md.
 */
const HEADER_PAD_BOTTOM_PX = 14;

const SIZE_SPEC: Record<PageHeaderSize, SizeSpec> = {
    hub: { padTop: HUB_HEADER_PAD_TOP_PX, padBottom: HEADER_PAD_BOTTOM_PX, padX: HUB_HEADER_PAD_X_PX, titleSize: HUB_HEADER_TITLE_PX, titleTracking: HUB_HEADER_TITLE_TRACKING, rightGap: 11 },
    node: { padTop: 23, padBottom: HEADER_PAD_BOTTOM_PX, padX: 22, titleSize: 24, titleTracking: "-0.02em", rightGap: 11 },
    // Tighter right gap too: the whole point of `dense` is that the line is full.
    dense: { padTop: DENSE_HEADER_PAD_TOP_PX, padBottom: HEADER_PAD_BOTTOM_PX, padX: DENSE_HEADER_PAD_X_PX, titleSize: DENSE_HEADER_TITLE_PX, titleTracking: DENSE_HEADER_TITLE_TRACKING, rightGap: DENSE_HEADER_RIGHT_GAP_PX },
    // ⚠️ The leaf band is DELIBERATELY deeper than the design's `21px 18px 0`
    // (2026-09-05). At 17px (now 20px) the leaf title is the smallest in the app, so the same
    // padding that reads as generous under a 24px hub title read as cramped here —
    // the header looked short. The extra 6px above and 8px below buy the small title
    // the same optical breathing room the large ones already had, WITHOUT growing the
    // title itself (which would collide with the crowded right slots leaf/game pages
    // carry). The bottom was 8px until 2026-11-14, when every size moved to the shared
    // `HEADER_PAD_BOTTOM_PX`.
    leaf: { padTop: 27, padBottom: HEADER_PAD_BOTTOM_PX, padX: 18, titleSize: 20, titleTracking: "-0.015em", rightGap: 9 },
};

/**
 * The header title's type style at a given size — face, weight, size, tracking and
 * leading, but NOT colour (that is `titleColor`, below). Depended on by: PageHeader.
 */
const pageHeaderTitleTypeSx = (size: PageHeaderSize) => ({
    fontFamily: FONTS.sans,
    fontSize: SIZE_SPEC[size].titleSize,
    fontWeight: WEIGHT.semibold,
    letterSpacing: SIZE_SPEC[size].titleTracking,
    lineHeight: LEADING.tight,
});

// THE SAFE-AREA TOP INSET LIVES HERE, once, for every header in the app.
//
// `index.html` ships `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style:
// black-translucent` (it takes both), so the page now paints under the iPhone's
// status bar — that is what makes the band behind the clock match the page instead of
// staying paper-white (see src/theme/safeArea.ts for the full why). The cost is that
// the top of the page is now UNDER the clock, and the header is the app's first row on
// every screen, so it is the one element that has to absorb the inset. Adding it to the
// header's own top padding (rather than padding the frame) keeps the surface itself
// full-bleed: the ground still runs edge to edge behind the strip, and only the TEXT
// moves down. On a device with no inset `SAFE_TOP` is `0px` and the geometry is exactly
// the design's.
//
// `safeAreaTop: false` is for a header that is NOT at the top of the screen — today only
// the flp merge sheet's header (SheetPanel), which would otherwise gain 47px of dead
// space in the middle of the page.
const Header = styled(Box, {
    shouldForwardProp: (prop) => prop !== "size" && prop !== "safeAreaTop",
})<{ size: PageHeaderSize; safeAreaTop: boolean }>(({ size, safeAreaTop }) => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    paddingTop: safeAreaTop ? `calc(${SIZE_SPEC[size].padTop}px + ${SAFE_TOP})` : `${SIZE_SPEC[size].padTop}px`,
    paddingLeft: SIZE_SPEC[size].padX,
    paddingRight: SIZE_SPEC[size].padX,
    paddingBottom: SIZE_SPEC[size].padBottom,
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
    gap: BACK_GROUP_GAP_PX,
    minWidth: 0,
    cursor: "pointer",
}));

interface PageHeaderProps {
    // Optional: a header with no title draws only its back arrow and right slot. The
    // flp's TowerStudyHeader omits it (2026-11-08) to free the row for its controls.
    title?: string;
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
    // Whether this header sits at the TOP OF THE SCREEN and must therefore clear the
    // status bar (see the Header styled-component). True for every page header; pass
    // false only for a header rendered inside a panel/sheet that has content above it.
    safeAreaTop?: boolean;
    // Single ReactNode slot rendered flush-right (e.g. a settings gear, an undo
    // button, a toggle chip). Compose it from the Header* exports below rather than
    // hand-rolling chips and buttons per page. Do NOT put the minute-points flame
    // here — the header renders it for every page already (see the right slot).
    rightContent?: React.ReactNode;
    // Suppress the minute-points flame. Default true, and PAGES MUST NOT PASS IT — the
    // flame is ambient and every page gets it (see the right slot).
    //
    // The one caller is SheetPanel's MERGE HEADER. A sheet now carries the flame in its
    // own chrome row, beside the ✕, at every height (see SheetPanel's `showMinutePoints`),
    // which is strictly better than the merged header's copy: it answers "am I earning?"
    // while the sheet is half-open too, not only once the sheet has covered the page.
    // Leaving the header's copy in as well would put two flames one row apart AND mount a
    // second `useMinutePoints` accrual tick — see the ⚠️ on the right slot.
    showFlame?: boolean;
    // Rendered to the RIGHT of the flame — the one thing allowed past it. Exists for the
    // Deck Tower's profile picture (DeckTowerAvatar → HeaderAvatarButton), which the user
    // asked to sit in the far corner. Every other page leaves this unset, so the flame
    // keeps its fixed corner everywhere else; see the right slot.
    trailingContent?: React.ReactNode;
    // Title ink — and the back arrow's, when set. Defaults to `COLORS.onSurface` (the
    // arrow to `COLORS.iconColor`). Only for a header drawn over a ground the default ink
    // cannot read on — today the Deck Tower, whose sky darkens into space as a tower is
    // climbed, and its study header over that sky (white, `ISO.white`;
    // docs/DECK_TOWER.md § Layers, § "Studying the tower").
    titleColor?: string;
}

const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    onBack,
    showBack = true,
    rightContent,
    arrowDirection = "down",
    size,
    safeAreaTop = true,
    showFlame = true,
    trailingContent,
    titleColor,
}) => {
    const navigate = useNavigate();
    const resolvedSize: PageHeaderSize = size ?? (showBack ? (arrowDirection === "left" ? "node" : "leaf") : "hub");
    const spec = SIZE_SPEC[resolvedSize];

    const titleNode = title ? (
        <Typography
            className="page-header__title"
            sx={{
                ...pageHeaderTitleTypeSx(resolvedSize),
                color: titleColor ?? COLORS.onSurface,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
            }}
        >
            {title}
        </Typography>
    ) : null;

    return (
        <Header className="page-header" size={resolvedSize} safeAreaTop={safeAreaTop}>
            {showBack ? (
                <BackGroup
                    className="page-header__back"
                    onClick={onBack ?? (() => navigate(-1))}
                    role="button"
                    aria-label="Back"
                >
                    <Icon
                        className="page-header__back-icon"
                        name={arrowDirection === "left" ? BACK_ARROW_ICON : "keyboard_arrow_down"}
                        size={arrowDirection === "left" ? BACK_ARROW_PX : DOWN_CHEVRON_PX}
                        color={titleColor}
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
                was opt-in the answer was simply absent on the menus (Menu, Games,
                Dictionary, Arena, Friends, …) and on two game
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
                that way rather than adding a second header to a page. The rule is really
                one mounted FLAME: an flp game break draws one outside any PageHeader
                (GameBreakChrome), so the flp hides its study header, flame included
                (TowerStudyHeader `hidden`), for exactly the phases the break's area is up.

                EXCEPTION (2026-10-09): `trailingContent` renders AFTER the flame. Only
                the Deck Tower passes it (the profile picture that raises the
                AccountSheet), so on td alone the flame sits one control in from the
                corner. */}
            <Box
                className="page-header__right-content"
                sx={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: `${spec.rightGap}px` }}
            >
                {rightContent}
                {showFlame && <MinutePointsFireBadge />}
                {trailingContent}
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
            fontFamily: FONTS.label,
            fontSize: HEADER_META_FONT_PX,
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
 *   - `"outlined"` (`.hd .btn`) — a 36×36 rounded-12 outlined box (32×32 before the 2026-11-05 scale-up). Used on HUB
 *     headers (see the Account artboard). The outline is the point there: a hub
 *     header carries a single lone action on bare paper, and an unboxed glyph has
 *     nothing to separate it from the page.
 *   - `"bare"` (default) — the glyph alone at 22px (`HEADER_ICON_PX`). Used on leaf/game and drill-in
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
    /**
     * The `outlined` skin's ring colour. Defaults to the paper hairline (`COLORS.border`);
     * a button standing on a SCENE ground (td's sky) passes its own ink instead, because
     * --line2 goes muddy off paper — the same rule as `outlinedChipSx`.
     */
    outlineColor?: string;
    className?: string;
    /** Hover tooltip (the native `title`), for an action whose label needs more words than `label` (no caller since UserProfilePage was deleted 2026-11-13). */
    title?: string;
    /** Set for a TOGGLE: drives `aria-pressed`. Leave undefined for a plain action. No caller since UserProfilePage's challenge block was deleted 2026-11-13. */
    pressed?: boolean;
    /** Glyph fill: 0 = outlined (default), 1 = filled — e.g. a toggle's on state, so it does not rely on colour alone. */
    fill?: 0 | 1;
    /**
     * Fire on a touch's release instead of its `click`, so a tap still lands while the page
     * is coasting from a fling (the browser spends that tap's click on stopping the scroll).
     * For scroll actions only — see `useScrollSafeTap` for why it is opt-in.
     */
    scrollSafeTap?: boolean;
}> = ({ icon, onClick, label, color = COLORS.iconColor, disabled = false, variant = "bare", outlineColor = COLORS.border, className, title, pressed, fill = 0, scrollSafeTap = false }) => {
    const tapHandlers = useScrollSafeTap(onClick);
    const pressProps = disabled ? {} : scrollSafeTap ? tapHandlers : { onClick };
    return (
    <Box
        className={className ? `page-header__btn ${className}` : "page-header__btn"}
        {...pressProps}
        role="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        aria-pressed={pressed}
        title={title}
        sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
            ...(variant === "outlined"
                ? { width: HEADER_OUTLINED_BTN_PX, height: HEADER_OUTLINED_BTN_PX, borderRadius: "12px", border: `1px solid ${outlineColor}` }
                : {}),
        }}
    >
        <Icon name={icon} size={HEADER_ICON_PX} color={color} fill={fill} />
    </Box>
    );
};

/**
 * `.lhd .tg` — a mono toggle chip ("pinyin"). Off = grey fill + ink2 text; on =
 * solid ink + white text. Note this is an INVERSION, not a tint change: the design
 * signals "on" by flipping the chip to the ink ground, which reads at a glance in a
 * way a slightly-darker grey does not.
 *
 * For a control with MORE than two states, use HeaderCycleChip below — binary
 * `aria-pressed` cannot describe one.
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
            ...DATA_TYPE,
            fontSize: CYCLE_CHIP_FONT_PX,
            lineHeight: LEADING.none,
            padding: HEADER_CHIP_PADDING,
            borderRadius: HEADER_CHIP_RADIUS,
            whiteSpace: "nowrap",
            backgroundColor: active ? COLORS.onSurface : COLORS.grey,
            color: active ? COLORS.white : COLORS.iconColor,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
        }}
    >
        {startIcon && <Icon name={startIcon} size={CYCLE_CHIP_ICON_PX} color={active ? COLORS.white : COLORS.iconColor} />}
        {children}
    </Box>
);

/**
 * A LABELLED action in the header — HeaderIconButton with its words spelled out, for an
 * action whose glyph alone does not say what it does (the Writing Notebook's "Change").
 * Styled as AudioModeChip's `outlined` skin (the Deck Tower study header's audio chip): no
 * fill, glyph + label in `ink`, held together by a thin pill outline in that same ink
 * (`outlinedChipSx`, which also sets its face). An action, not
 * a state: no `aria-pressed`. `ariaLabel` may say more than the visible text (e.g. the
 * current word).
 *
 * Its outline is the chip's own ink, not `COLORS.border` (CLAUDE.md § Buttons & cards) —
 * copied from the audio chip, so the two read as one control family.
 */
export const HeaderActionChip: React.FC<{
    children: React.ReactNode;
    onClick?: () => void;
    icon?: string;
    ariaLabel?: string;
    /** Glyph, text and outline colour. Default ink2 (`COLORS.iconColor`), the header icons' ink. */
    ink?: string;
    disabled?: boolean;
    className?: string;
    /** Fire on a touch's release so a tap lands mid-fling — as HeaderIconButton's `scrollSafeTap`. */
    scrollSafeTap?: boolean;
}> = ({ children, onClick, icon, ariaLabel, ink = COLORS.iconColor, disabled = false, className, scrollSafeTap = false }) => {
    const tapHandlers = useScrollSafeTap(onClick);
    const pressProps = disabled ? {} : scrollSafeTap ? tapHandlers : { onClick };
    return (
    <Box
        className={className ? `page-header__action ${className}` : "page-header__action"}
        {...pressProps}
        role="button"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            flexShrink: 0,
            whiteSpace: "nowrap",
            lineHeight: LEADING.none,
            color: ink,
            ...outlinedChipSx(ink),
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
        }}
    >
        {icon && <Icon name={icon} size={OUTLINED_CHIP_ICON_PX} color={ink} />}
        {children}
    </Box>
    );
};

/**
 * Horizontal breathing room inside a HeaderCycleChip, in `ch` of its mono face, on
 * top of the longest label's exact width. Tuned by eye rather than derived: a chip
 * sized to its text to the character reads as clipped even when it is not, and a
 * word sitting flush against the chip's radius reads as cramped.
 */
const CYCLE_CHIP_SLACK_CH = 4;

/** The gap between a leading icon and the label, in px. Shared by the layout and the width. */
const CYCLE_CHIP_ICON_GAP_PX = 5;

/** The leading glyph's size, in px. Fixed: it is the chip's anchor, not part of the text. */
const CYCLE_CHIP_ICON_PX = 15;

/**
 * What a leading icon costs the chip's fixed width: the glyph plus the gap before
 * the label. Added to the width only when an icon is actually passed, so the `ch`
 * count keeps meaning "characters of label" rather than becoming a fudge that
 * silently bakes in an icon that may not be there.
 */
const CYCLE_CHIP_ICON_ALLOWANCE_PX = CYCLE_CHIP_ICON_PX + CYCLE_CHIP_ICON_GAP_PX;


/**
 * A multi-state sibling of HeaderToggleChip: one tap advances to the next state
 * rather than flipping a boolean, and the chip's own label says which state is live.
 * Same `.lhd .tg` skin, so a header can mix the two without looking it.
 *
 * `active` drives only the ink/grey inversion — it means "this state does
 * something", not "on". A three-state control has no boolean to expose, so this
 * chip carries NO `aria-pressed`; `ariaLabel` must name the current state and
 * ideally what tapping does, since that is all a screen reader gets.
 *
 * A cycling chip's labels differ in length, so unlike `HeaderToggleChip` it needs a
 * FIXED width: sized to its own longest label via `widthCh`, it stays put as the
 * user taps through, and everything to its left stops shuffling sideways under the
 * thumb that is still tapping. The optional per-state `icon` is included in that
 * width via cycleChipIconAllowancePx, so it does not eat the label's room.
 *
 * A label longer than CYCLE_CHIP_COMFORTABLE_LABEL_CH renders smaller so that one
 * long word cannot size the whole control — see `cycleChipFontPx`. It happens
 * automatically for a plain-string label; pass `fontPx` only to override it.
 *
 * The icon is PINNED to the left edge and the label centres in what is left, rather
 * than the pair centring together. The icon is the chip's anchor — it is the part
 * that says at a glance what the control is about — and an anchor that slides as the
 * label changes length is not one. It also means the label's own box is a constant
 * size in every state, which is what lets a shrunken word stay optically centred.
 *
 * `tone` picks the ACTIVE skin. `"ink"` (default) is the shared `.lhd .tg.on`
 * inversion — solid ink, white text. `"blu"` is a mid-blue (`COLORS.bluM`) fill
 * with ink text and NO outline (a deliberate exception to the buttons-and-cards
 * outline rule, by design call 2026-10-06). The inactive state is grey in both
 * tones. The blu tone also tags the chip `page-header__toggle--blu`.
 * `"bare"` drops the chip entirely — no fill, no padding, no corners — leaving the glyph
 * and label as floating text in `ink` in EVERY state, so the label alone carries the
 * state. A surface that still wants the pair read as ONE control draws its own outline
 * through `sx` (AudioModeChip does, via `outlinedChipSx`). It also tags the chip
 * `page-header__toggle--bare`, which gameSurfaceSx reads to leave it unfilled on a game ground. For a surface where a filled chip draws too much attention (the Deck Tower study
 * header over the sky, 2026-10-26).
 *
 * `sx` is layered LAST, over the chip's own skin.
 *
 * `fitLabels` is the width rule for a chip whose `sx` changes its FONT. `widthCh` is
 * measured in `ch`, which was exact only while the chip was set in a mono face (it no longer
 * is — see `widthCh`); a fitted chip instead stacks EVERY label invisibly in the label box (one grid cell),
 * which sizes the box to the longest label in whatever face, size and case the chip is
 * actually set in — still a constant width across states, with no measurement to keep in
 * sync. The label then inherits the chip's own size (the mono shrink rule, which exists
 * to keep the mono chip narrow, does not apply). `iconPx` resizes the pinned glyph.
 *
 * Built for the audio-mode chip (mute / passthrough / media) — see
 * src/components/AudioModeChip.tsx and docs/AUDIO_PLAYBACK.md.
 */
export const HeaderCycleChip: React.FC<{
    children: React.ReactNode;
    /** Whether the CURRENT state is a doing-something state (drives the inversion). */
    active: boolean;
    /**
     * Fixed label width, in `ch` of the chip's face. ⚠️ Written for a MONO face, where it
     * was an exact character count; since 2026-11-13 the chip is set in `DATA_TYPE`
     * (sans, tabular figures only), so it is exact for digits and an ESTIMATE for letters.
     * The one caller (AudioModeChip) passes `fitLabels`, which ignores this. Pass the longest label's length, derived
     * from the label table rather than hard-coded, so adding a state cannot make
     * the chip jump again.
     */
    widthCh: number;
    /**
     * Optional leading Material Symbols glyph, per state. Verify any name against
     * https://fonts.google.com/metadata/icons — a name missing from the face renders
     * as its own raw text inside the chip (see src/components/Icon.tsx).
     */
    icon?: string;
    ariaLabel: string;
    /**
     * Override for the label's size in px. Normally omitted: a plain-string label
     * sizes itself via `cycleChipFontPx`. Pass it only when the label is not a bare
     * string, or when a caller genuinely needs a size the rule would not choose.
     */
    fontPx?: number;
    /** Active-state skin: solid ink (default), mid blue, or bare text. See the block comment. */
    tone?: "ink" | "blu" | "bare";
    /** The `bare` tone's text + glyph colour (default `COLORS.onSurface`); ignored otherwise. */
    ink?: string;
    onClick?: () => void;
    className?: string;
    /** Layered over the chip's own sx (see the block comment). */
    sx?: SxProps<Theme>;
    /**
     * Every state's label: size the chip to the longest one in its ACTUAL font instead
     * of by `widthCh` (see the block comment). For a chip whose `sx` changes its font.
     */
    fitLabels?: readonly string[];
    /** The pinned glyph's size, px (default CYCLE_CHIP_ICON_PX). */
    iconPx?: number;
}> = ({ children, active, widthCh, icon, ariaLabel, fontPx, tone = "ink", onClick, className, sx, fitLabels, iconPx = CYCLE_CHIP_ICON_PX, ink = COLORS.onSurface }) => {
    // A string label sizes itself; anything else falls back to the full size, since the
    // shrink rule is measured in characters and cannot read an arbitrary node. A fitted
    // chip's label inherits the chip's own (restyled) size instead.
    const labelPx = fitLabels
        ? "inherit"
        : fontPx ?? (typeof children === "string" ? cycleChipFontPx(children) : CYCLE_CHIP_FONT_PX);
    // Resolved per tone so the fill, the text and the icon prop cannot disagree.
    const isBlu = tone === "blu";
    const isBare = tone === "bare";
    const activeFill = isBlu ? COLORS.bluM : COLORS.onSurface;
    const activeInk = isBlu ? COLORS.onSurface : COLORS.white;
    // Bare: one ink in every state — there is no fill for the state to invert.
    const fg = isBare ? ink : active ? activeInk : COLORS.iconColor;
    return (
        <Box
        className={[
            "page-header__toggle",
            "page-header__cycle",
            active ? "page-header__toggle--active" : "",
            isBlu ? "page-header__toggle--blu" : "",
            // Lets a surface's descendant rules (gameSurfaceSx) tell a fill-less chip
            // from a filled toggle.
            isBare ? "page-header__toggle--bare" : "",
            className ?? "",
        ].filter(Boolean).join(" ")}
        onClick={onClick}
        role="button"
        aria-label={ariaLabel}
        sx={[{
            display: "inline-flex",
            alignItems: "center",
            // The icon is pinned left and the label takes the rest; see the block comment.
            justifyContent: "flex-start",
            gap: `${CYCLE_CHIP_ICON_GAP_PX}px`,
            ...DATA_TYPE,
            // The chip's OWN size stays full even when the label shrinks, because the
            // width below is measured in `ch` of this element's face — a per-state
            // font here would make the "fixed" width move with the label.
            fontSize: CYCLE_CHIP_FONT_PX,
            lineHeight: LEADING.none,
            padding: isBare ? 0 : HEADER_CHIP_PADDING,
            borderRadius: isBare ? 0 : HEADER_CHIP_RADIUS,
            whiteSpace: "nowrap",
            // `ch` against the mono face is one character advance, so `widthCh` chars
            // is EXACTLY the longest label with zero slack — enough for subpixel
            // rounding to clip its last glyph, and far too tight to read as a chip.
            // CYCLE_CHIP_SLACK_CH is the breathing room, added inside the derived
            // value so every state still measures identically. Callers derive `widthCh`
            // from `cycleChipWidthCh`, which already discounts any shrunken label.
            // A fitted chip takes its width from its stacked labels instead (fitLabels).
            width: fitLabels
                ? "auto"
                : icon
                    ? `calc(${widthCh}ch + ${CYCLE_CHIP_SLACK_CH}ch + ${CYCLE_CHIP_ICON_ALLOWANCE_PX}px)`
                    : `calc(${widthCh}ch + ${CYCLE_CHIP_SLACK_CH}ch)`,
            backgroundColor: isBare ? "transparent" : active ? activeFill : COLORS.grey,
            color: fg,
            cursor: "pointer",
        }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
        {icon && (
            <Icon
                name={icon}
                size={iconPx}
                color={fg}
            />
        )}
        <Box
            component="span"
            className="page-header__cycle-label"
            // flex:1 makes this span the whole of the chip minus the pinned icon, so the
            // word centres in the remaining space rather than in the chip as a whole.
            sx={{
                flex: 1,
                textAlign: "center",
                fontSize: labelPx,
                // Fitted: every label in one grid cell, so the cell is the longest one.
                ...(fitLabels ? { display: "grid", "& > *": { gridArea: "1 / 1" } } : {}),
            }}
        >
            {fitLabels ? (
                <>
                    {fitLabels.map((l) => (
                        <span key={l} className="page-header__cycle-sizer" aria-hidden style={{ visibility: "hidden" }}>
                            {l}
                        </span>
                    ))}
                    <span className="page-header__cycle-current">{children}</span>
                </>
            ) : children}
        </Box>
    </Box>
    );
};

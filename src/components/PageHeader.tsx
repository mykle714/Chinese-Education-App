import React from "react";
import { COLORS } from "../theme/colors";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import { FONTS } from "../theme/fonts";
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
    /** Container top padding in px, `.hd` = 23, `.lhd` = 27. */
    padTop: number;
    /**
     * Container bottom padding in px. Zero for the three `.hd` sizes — those headers
     * sit above content that brings its own top gutter, so the design leaves the
     * header itself flush. `leaf` is the exception: see the note on SIZE_SPEC.leaf.
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

const SIZE_SPEC: Record<PageHeaderSize, SizeSpec> = {
    hub: { padTop: 23, padBottom: 0, padX: 22, titleSize: 24, titleTracking: "-0.025em", rightGap: 11 },
    node: { padTop: 23, padBottom: 0, padX: 22, titleSize: 21, titleTracking: "-0.02em", rightGap: 11 },
    // Tighter right gap too: the whole point of `dense` is that the line is full.
    dense: { padTop: 23, padBottom: 0, padX: 22, titleSize: 18, titleTracking: "-0.018em", rightGap: 10 },
    // ⚠️ The leaf band is DELIBERATELY deeper than the design's `21px 18px 0`
    // (2026-09-05). At 17px the leaf title is the smallest in the app, so the same
    // padding that reads as generous under a 24px hub title read as cramped here —
    // the header looked short. The extra 6px above and 8px below buy the small title
    // the same optical breathing room the large ones already had, WITHOUT growing the
    // title itself (which would collide with the crowded right slots leaf/game pages
    // carry). The bottom padding matters most: it is additive to whatever top gutter
    // the body brings (Settings' first `.set` contributes only 14px), so before this
    // the title sat almost against the first card.
    leaf: { padTop: 27, padBottom: 8, padX: 18, titleSize: 17, titleTracking: "-0.015em", rightGap: 9 },
};

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
                {showFlame && <MinutePointsFireBadge />}
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

/**
 * Horizontal breathing room inside a HeaderCycleChip, in `ch` of its mono face, on
 * top of the longest label's exact width. Tuned by eye rather than derived: a chip
 * sized to its text to the character reads as clipped even when it is not, and a
 * word sitting flush against the chip's radius reads as cramped.
 */
const CYCLE_CHIP_SLACK_CH = 4;

/**
 * What a leading icon costs the chip's fixed width: the 13px glyph plus the 5px gap
 * before the label. Added to the width only when an icon is actually passed, so the
 * `ch` count keeps meaning "characters of label" rather than becoming a fudge that
 * silently bakes in an icon that may not be there.
 */
const CYCLE_CHIP_ICON_ALLOWANCE_PX = 18;

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
 * width via CYCLE_CHIP_ICON_ALLOWANCE_PX, so it does not eat the label's room.
 *
 * Built for the audio-mode chip (mute / passthrough / media) — see
 * src/components/AudioModeChip.tsx and docs/AUDIO_PLAYBACK.md.
 */
export const HeaderCycleChip: React.FC<{
    children: React.ReactNode;
    /** Whether the CURRENT state is a doing-something state (drives the inversion). */
    active: boolean;
    /**
     * Fixed label width, in `ch` of the chip's MONO face — so it is an exact
     * character count, not an estimate. Pass the longest label's length, derived
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
    onClick?: () => void;
    className?: string;
}> = ({ children, active, widthCh, icon, ariaLabel, onClick, className }) => (
    <Box
        className={[
            "page-header__toggle",
            "page-header__cycle",
            active ? "page-header__toggle--active" : "",
            className ?? "",
        ].filter(Boolean).join(" ")}
        onClick={onClick}
        role="button"
        aria-label={ariaLabel}
        sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "5px",
            fontFamily: FONTS.mono,
            fontSize: 10,
            lineHeight: LEADING.none,
            padding: "6px 8px",
            borderRadius: "7px",
            whiteSpace: "nowrap",
            // `ch` against the mono face is one character advance, so `widthCh` chars
            // is EXACTLY the longest label with zero slack — enough for subpixel
            // rounding to clip its last glyph, and far too tight to read as a chip.
            // CYCLE_CHIP_SLACK_CH is the breathing room, added inside the derived
            // value so every state still measures identically.
            width: icon
                ? `calc(${widthCh}ch + ${CYCLE_CHIP_SLACK_CH}ch + ${CYCLE_CHIP_ICON_ALLOWANCE_PX}px)`
                : `calc(${widthCh}ch + ${CYCLE_CHIP_SLACK_CH}ch)`,
            backgroundColor: active ? COLORS.onSurface : COLORS.grey,
            color: active ? COLORS.white : COLORS.iconColor,
            cursor: "pointer",
        }}
    >
        {icon && <Icon name={icon} size={13} color={active ? COLORS.white : COLORS.iconColor} />}
        {children}
    </Box>
);

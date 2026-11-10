import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import Icon from "../Icon";
import { useScreenOverlayHost } from "../../hooks/useScreenOverlayHost";
import { tier2Var } from "../../timeOfDay/tier2Chrome";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, WEIGHT } from "../../theme/scale";
import { isCurrentDestination, useMenuDestinations, type MenuDestination } from "./menuDestinations";

/**
 * MenuPopover: what the footer's Menu tab raises (2026-11-06). It replaced the `/menu`
 * bento page. The tab no longer navigates; it opens this list of rows over whatever page
 * is on screen, and a row tap goes to that page.
 *
 * LOOK (the Deck Tower's art style, docs/DECK_TOWER.md § Footer). The popover is cut from
 * the same card stock as the slab footer and the tower's cards, so it reads as a second
 * flashcard lifted off the slab:
 *   - face `cardFace`, standing on a 6px `cardWall` lip (flat iso shading, no outline);
 *   - a down-right cast shadow, the scene's iso light direction;
 *   - rows are keycaps. Idle rows are bare on the face. The CURRENT page's row, and any
 *     row under a finger, is the slab's active-tab keycap (`cardBeige` + a 3px inset
 *     `cardWall` lip), so "you are here" uses the same mark the footer uses;
 *   - each row leads with a chip in its destination's ramp hue, three-tone like a tower
 *     object: `mid` face over a `mark` lip, ink icon on top.
 * Every card colour reads `tier2Var(…)` exactly as the slab does, so on a Tier 2 page (the
 * Dictionary at night) popover and slab turn slate together. The hue chips keep their
 * ramp colours.
 *
 * ⚠️ No `1px COLORS.border` outline on the rows or the card, which departs from the app's
 * "every tappable button and card carries the outline" rule (CLAUDE.md § Buttons & cards).
 * This follows the slab footer, whose td style has no outlines either: shape comes from
 * the lip and the cast shadow.
 *
 * PLACEMENT. Anchored bottom-right, just above the footer under the Menu tab (the
 * rightmost tab). The caller passes the footer's footprint (`footerClearance`: the flat
 * bar's `FOOTER_TOTAL_HEIGHT` or the slab's `SLAB_FOOTER_TOTAL_HEIGHT`), so this file does
 * not import MobileFooter, which imports it. It grows out of its bottom-right corner.
 *
 * DIM. It is a dim, so it follows the app rule (src/components/overlayHost.ts § "THE RULE
 * FOR A DIM"): portaled to the phone frame, `position: absolute; inset: 0`, z-index
 * above the footer's 100. The footer stays put and is dimmed along with the page, so a
 * tap on the Menu tab while open lands on the scrim and closes it.
 *
 * CLOSES on: scrim tap, Escape, a row tap (after navigating), and any route change made
 * some other way (browser back, edge swipe), so it never outlives the page it opened over.
 *
 * Docs: docs/NAVIGATION.md § Menu. Depends on: menuDestinations.ts. Only caller:
 * MobileFooter.tsx.
 * LAYER: shared UI component (src/components). Knows routes only through the destinations list.
 */

// Enter/exit timing. The enter matches the footer/page-slide easing (FooterPresenter);
// the exit is shorter because a dismissal should get out of the way.
const ENTER_MS = 220;
const EXIT_MS = 140;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Above the footer (100) and the page-slide exit clone (50); the same tier as the other
// frame-hosted dims (useScreenOverlayHost's usage example).
const Z_INDEX = 200;

// Geometry, matched to the slab: its 16px side inset, its radius family (22 card / 16
// keycap), its 6px lip and its `10px 16px` cast offset.
const SIDE_INSET = 16;
const GAP_ABOVE_FOOTER = 12;
const CARD_WIDTH = 236;
const CARD_RADIUS = 22;
const CARD_LIP = 6;
const CAST_X = 10;
const CAST_Y = 16;
const ROW_HEIGHT = 52;

const Scrim = styled(Box)(() => ({
    position: "absolute",
    inset: 0,
    zIndex: Z_INDEX,
    backgroundColor: COLORS.scrim,
    // The dim must not let a drag scroll the page beneath it.
    touchAction: "none",
}));

const Card = styled(Box)(() => ({
    position: "absolute",
    right: SIDE_INSET,
    width: CARD_WIDTH,
    maxWidth: `calc(100% - ${SIDE_INSET * 2}px)`,
    zIndex: Z_INDEX + 1,
    padding: 6,
    boxSizing: "border-box",
    borderRadius: CARD_RADIUS,
    backgroundColor: tier2Var("footerFace", COLORS.cardFace),
    // Lip first, then the cast shadow beyond it. The cast is `COLORS.scrim`, a translucent ink,
    // so it darkens the dimmed page the way the slab's translucent cast darkens the sky.
    boxShadow: `0 ${CARD_LIP}px 0 ${tier2Var("footerWall", COLORS.cardWall)}, ${CAST_X}px ${CAST_Y + CARD_LIP}px 0 ${COLORS.scrim}`,
    transformOrigin: "bottom right",
    touchAction: "none",
}));

const Row = styled(Box, {
    shouldForwardProp: (prop) => prop !== "current",
})<{ current?: boolean }>(({ current }) => {
    // The keycap: the slab's active tab, byte for byte (MobileFooter → SlabFooterItem).
    const keycap = {
        backgroundColor: tier2Var("footerKey", COLORS.cardBeige),
        boxShadow: `inset 0 -3px 0 ${tier2Var("footerWall", COLORS.cardWall)}`,
    };
    return {
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: ROW_HEIGHT,
        padding: "0 10px",
        borderRadius: 16,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        ...(current ? keycap : { backgroundColor: "transparent" }),
        "&:active": { ...keycap, transform: "translateY(1px)" },
        "&:focus-visible": { outline: `2px solid ${COLORS.onSurface}`, outlineOffset: -2 },
    };
});

// A small iso object in the destination's hue: `mid` face standing on a `mark` lip.
const HueChip = styled(Box)(() => ({
    width: 34,
    height: 34,
    flexShrink: 0,
    borderRadius: 11,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
}));

const GroupRule = styled(Box)(() => ({
    height: 1,
    flexShrink: 0,
    margin: "6px 10px",
    backgroundColor: tier2Var("footerWall", COLORS.cardWall),
}));

interface MenuPopoverProps {
    open: boolean;
    onClose: () => void;
    /** Screen bottom edge → footer top, as a CSS length (it carries the safe-area inset). */
    footerClearance: string;
}

const MenuPopover: React.FC<MenuPopoverProps> = ({ open, onClose, footerClearance }) => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { main, gated } = useMenuDestinations();

    // Two-phase mount so the exit can animate: `mounted` keeps the DOM up through the
    // exit transition; `shown` drives the transform/opacity. Opening mounts first (shown
    // false), then flips `shown` on the next frame so the browser has a start state to
    // transition from.
    const [mounted, setMounted] = useState(open);
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (open) {
            setMounted(true);
            const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
            return () => cancelAnimationFrame(raf);
        }
        setShown(false);
        const t = window.setTimeout(() => setMounted(false), EXIT_MS);
        return () => window.clearTimeout(t);
    }, [open]);

    const { anchorRef, host } = useScreenOverlayHost(mounted);

    // Close on any route change that did not come from a row (browser back, edge swipe).
    // Keyed on pathname only: it must not fire on the open itself.
    useEffect(() => {
        if (open) onClose();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- route changes only
    }, [pathname]);

    // Escape closes (desktop / hardware keyboards).
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    // The current page is the MOST SPECIFIC matching destination, so
    // a nested route lights only its own row, not its parent's as well.
    const currentKey = [...main, ...gated]
        .filter((d) => isCurrentDestination(d, pathname))
        .sort((a, b) => b.route.length - a.route.length)[0]?.key;

    const go = (dest: MenuDestination) => {
        onClose();
        // Already on that exact page: just close. On a drill-in of it, the row still goes
        // to its root.
        if (pathname !== dest.route) navigate(dest.route);
    };

    const renderRow = (dest: MenuDestination) => {
        const current = dest.key === currentKey;
        const ramp = RAMP[dest.hue];
        return (
            <Row
                key={dest.key}
                className={`menu-popover__row menu-popover__row--${dest.key}${current ? " menu-popover__row--current" : ""}`}
                current={current}
                role="menuitem"
                tabIndex={0}
                aria-current={current ? "page" : undefined}
                onClick={() => go(dest)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(dest); } }}
            >
                <HueChip
                    className="menu-popover__hue-chip"
                    sx={{ backgroundColor: ramp.mid, boxShadow: `inset 0 -3px 0 ${ramp.mark}` }}
                >
                    <Icon className="menu-popover__row-icon" name={dest.icon} size={20} weight={500} fill={1} color={COLORS.onSurface} />
                </HueChip>
                <Typography
                    className="menu-popover__row-title"
                    sx={{
                        fontFamily: FONTS.sans,
                        // 15px flat, between the slab's 11px labels and body-lg: a row label,
                        // pinned like the footer's own label sizes rather than on the body ramp.
                        fontSize: 15,
                        fontWeight: WEIGHT.semibold,
                        lineHeight: LEADING.tight,
                        color: current
                            ? tier2Var("footerInkActive", COLORS.onSurface)
                            : tier2Var("footerInk", COLORS.onSurface),
                    }}
                >
                    {dest.title}
                </Typography>
            </Row>
        );
    };

    const transition = shown
        ? `transform ${ENTER_MS}ms ${EASING}, opacity ${ENTER_MS}ms ${EASING}`
        : `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;

    return (
        <>
            <span ref={anchorRef} hidden />
            {host && mounted && createPortal(
                <>
                    <Scrim
                        className="menu-popover__scrim"
                        onClick={onClose}
                        sx={{ opacity: shown ? 1 : 0, transition: `opacity ${shown ? ENTER_MS : EXIT_MS}ms ease` }}
                    />
                    <Card
                        className="menu-popover"
                        role="menu"
                        aria-label="Menu"
                        sx={{
                            bottom: `calc(${footerClearance} + ${GAP_ABOVE_FOOTER}px)`,
                            opacity: shown ? 1 : 0,
                            transform: shown ? "none" : "translateY(10px) scale(0.94)",
                            transition,
                        }}
                    >
                        {main.map(renderRow)}
                        {/* Rule and gated group together or not at all. */}
                        {gated.length > 0 && (
                            <>
                                <GroupRule className="menu-popover__group-rule" />
                                {gated.map(renderRow)}
                            </>
                        )}
                    </Card>
                </>,
                host,
            )}
        </>
    );
};

export default MenuPopover;

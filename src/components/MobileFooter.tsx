import { useCallback, useState } from "react";
import { runFooterTabOverride } from "./footerTabOverride";
import MenuPopover from "./menuPopover/MenuPopover";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { LEADING } from "../theme/scale";
import { SAFE_BOTTOM } from "../theme/safeArea";
import Icon from "./Icon";
import { SLAB_CAST_SHADOW_VAR } from "./footerCastShadow";
import { routeFooterStyle } from "../routes/routeMeta";
import { tier2Var } from "../timeOfDay/tier2Chrome";
import { CARD_SURFACE_RADIUS } from "../theme/surfaces";
import { roundedEdgeFillet, roundedEdgeRimLight } from "../theme/roundedEdge";
import { registerDictionaryTabTap, requestDictionarySearchFocus } from "../features/dictionary/dictionarySearchFocus";

// Footer bar geometry (shelf redesign `.fbar`, docs/SHELF_REDESIGN.md A2a). Exported
// so scroll containers (see MobileTabScreen) can reserve matching bottom padding and
// never let content hide behind the bar.
//
// ⚠️ The bar is FLAT AND FULL-WIDTH as of the redesign — it used to be a detached
// rounded pill inset 16px on every side, which is where the old `FLOATING_FOOTER_*`
// names came from. Nothing floats any more, so the family was renamed to `FOOTER_*`
// and the old `FLOATING_FOOTER_INSET` (the pill's gap to the frame edge) was DELETED
// rather than renamed: a flush bar has no inset, and a permanently-zero constant
// named "gap from the edges" is a trap for the next reader, not a tuning knob.
// (The one floating footer, the Deck Tower's `slab`, has its own SLAB_FOOTER_* family
// below; the FOOTER_* constants describe the bar only.)
export const FOOTER_HEIGHT = 74;
// Extra breathing gap added on top of the bar's own footprint, so the last row clears
// it with a little slack. Bump this (not HEIGHT) to give every page more bottom room
// without resizing or repositioning the bar itself. 16 here makes the clearance
// exactly 90px, which is the design's own `.clear` spacer height.
export const FOOTER_EXTRA_GAP = 16;
// Total vertical space the bar occupies plus a breathing gap above it, used as the
// scroll area's paddingBottom so the last row clears the bar. = the design's `.clear`.
export const FOOTER_CLEARANCE = FOOTER_HEIGHT + FOOTER_EXTRA_GAP;

// The bar's REAL on-screen footprint, as a CSS string.
//
// Since `viewport-fit=cover` (index.html) the page paints under the home indicator, so
// `bottom: 0` is the physical bottom edge of the screen rather than the bottom of the
// safe area. The bar therefore GROWS by the bottom inset and pads its labels off it —
// otherwise the tab row sits under the indicator. Everything measured off the bar (its
// hide travel, the scroll clearance, the bottom edge-fade) must use this, not the bare
// 74px. See src/theme/safeArea.ts. On a device with no inset it is exactly 74px.
export const FOOTER_TOTAL_HEIGHT = `calc(${FOOTER_HEIGHT}px + ${SAFE_BOTTOM})`;
// Same, for the scroll reservation: the design's 90px clearance plus the inset.
export const FOOTER_TOTAL_CLEARANCE = `calc(${FOOTER_CLEARANCE}px + ${SAFE_BOTTOM})`;

// ── The SLAB style (Tower Style design, `.sx-flp .ft`) ────────────────────────────
// Worn only by routes whose registry row says `footerStyle: "slab"` (today: the Deck Tower at `/`,
// and since 2026-10-29 the Dictionary tab, /dictionary — and
// acp, /discover/sort/:language).
// Instead of a flat bar flush to the edge it is a floating flashcard: a cream slab held
// off the screen's sides and bottom, standing on a lip in the card's shaded wall colour,
// casting an iso shadow onto whatever is painted behind it (the tower's sky).
// Docs: docs/DECK_TOWER.md § Footer.
//
// Its gap to the screen's bottom edge. The design's 26px sits inside an iPhone frame, so
// on a device whose home-indicator inset is larger the inset wins instead of the slab
// sitting on the indicator.
export const SLAB_FOOTER_BOTTOM = `max(26px, ${SAFE_BOTTOM})`;
// Gap to the screen's left/right edges.
const SLAB_FOOTER_SIDE_INSET = 16;
// The slab's own height, and the lip it stands on — the card's thickness.
const SLAB_FOOTER_HEIGHT = 64;
const SLAB_FOOTER_LIP = 6;
// Corner radius: the app's card-sized-surface radius (theme/surfaces.ts → 15px, the same
// curve as the cards, td's filter keys and the card stock). It used to be its own 22px,
// which read rounder than everything else on screen (user call 2026-11-08).
const SLAB_FOOTER_RADIUS = CARD_SURFACE_RADIUS;
// The face's padding round the tab keys.
const SLAB_FOOTER_PADDING = 6;
// The active tab key's radius. It started CONCENTRIC with the slab (its radius minus the
// padding between them = 9); bumped +2 to 11 (user call 2026-11-10) so the key reads
// slightly rounder — the corner gap to the slab is no longer exactly even.
const SLAB_KEY_RADIUS = SLAB_FOOTER_RADIUS - SLAB_FOOTER_PADDING + 2;
// The lip is a DIAGONAL wall (2026-11-08), showing below AND to the right of the face —
// the slab's thickness seen from the tower's (1, 1) light, like the other raised keys
// (td's filter keys, TowerFilterKeys.tsx; the mini cards' card stock, sortCardStock.ts →
// `panelWall`). box-shadow cannot slant, so it is the face's outline stepped 1px at a time
// along (1, 1), one copy per px of lip, so the wall stays continuous round the radius.
// (It used to be a solid `0 6px 0` lip — the wall seen straight from the front.)
// The face's perimeter is a hairline ROUNDED edge (theme/roundedEdge.ts, 2026-11-08 — the
// filter keys' and card stock's edge): a 1px rim light on the face's top-left edge and a
// 0.5px fillet, half-way between face and wall colour, over the lip's first step. Both
// colours are `tier2Var(…)` CSS variables; the helper mixes them with `color-mix`.
const slabLipShadow = (face: string, wall: string) =>
    [
        roundedEdgeRimLight(face),
        roundedEdgeFillet(face, wall),
        ...Array.from({ length: SLAB_FOOTER_LIP }, (_, i) => `${i + 1}px ${i + 1}px 0 ${wall}`),
    ].join(", ");
// The cast shadow on the sky: along the SAME (1, 1) diagonal as the lip, reaching
// SLAB_CAST_REACH past the wall on both axes — the tower style's one shadow rule, shared
// with td's filter keys (TowerFilterKeys.tsx → `CAST_PX` = wall 5 + reach 4) and the
// card stock (sortCardStock.ts → `panelCastShadow`, wall 4 + reach 4). Hard-edged like the
// filter keys. (It was the design's `10px 16px` until 2026-11-08 — steeper than every
// other object's shadow, so the slab looked lit from a different sun.)
const SLAB_CAST_REACH = 4;
const SLAB_CAST_PX = SLAB_FOOTER_LIP + SLAB_CAST_REACH;
// The band from the screen's bottom edge to the slab's TOP — the slab's real footprint.
// A page laid out around the slab (the Deck Tower's scroller clip and spacer) reserves
// this, as a CSS string because it carries the safe area. The cast shadow is excluded:
// it falls on sky and may overlap the scene.
export const SLAB_FOOTER_TOTAL_HEIGHT = `calc(${SLAB_FOOTER_BOTTOM} + ${SLAB_FOOTER_HEIGHT + SLAB_FOOTER_LIP}px)`;
// Same, for a scroll reservation: the footprint plus the bar's breathing gap, so a list
// over the slab clears it by the same 16px it clears the bar by.
export const SLAB_FOOTER_TOTAL_CLEARANCE = `calc(${SLAB_FOOTER_TOTAL_HEIGHT} + ${FOOTER_EXTRA_GAP}px)`;
// How far FooterPresenter pushes the slab to clear the frame's bottom edge entirely:
// its footprint plus the cast shadow, or the shadow's tail would peek up when hidden.
export const SLAB_FOOTER_HIDDEN_OFFSET = `calc(${SLAB_FOOTER_BOTTOM} + ${SLAB_FOOTER_HEIGHT + SLAB_CAST_PX}px)`;

// The single, app-wide bottom spacer. Render it as the LAST child of any
// footer-bearing scroll surface (hubs, decks, dictionary, card details, mastered
// cards) so the final row clears the footer bar. We rely on this explicit block —
// NOT MobileTabScreen's ScrollArea paddingBottom — because that padding is (a) eaten
// when the flex content column overflows its computed height and (b) covered by the
// scroll area's bottom edge-fade mask. One shared height (FOOTER_CLEARANCE)
// means a single edit reflows every page at once. It reads the route's footer style, so
// on a slab route (the Dictionary) it clears the taller floating slab instead of the bar.
export const FooterSpacer: React.FC = () => {
    const { pathname } = useLocation();
    return (
        <Box
            className="footer-spacer"
            sx={{ width: "100%", height: routeFooterStyle(pathname) === "slab" ? SLAB_FOOTER_TOTAL_CLEARANCE : FOOTER_TOTAL_CLEARANCE, flexShrink: 0 }}
        />
    );
};

// Extra room BELOW FooterSpacer, so a page that exactly fills the screen can still
// be dragged up a little and settle back. FooterSpacer only guarantees the last row
// CLEARS the footer — it leaves zero slack, so a full hub feels pinned: the content
// stops dead on the bar with nothing behind it.
//
// This is overscroll comfort, not clearance, which is why it is a separate constant
// and a separate element: raising FOOTER_CLEARANCE would push every footer-bearing
// surface in the app (decks, dictionary, card details) away from its footer as a side
// effect of wanting a bit of give on the hubs.
export const SCROLL_PAST_HEIGHT = 96;

// Render AFTER FooterSpacer on scroll surfaces that should have a little give at the
// bottom. Purely decorative space — nothing may be positioned inside it.
export const ScrollPastSpacer: React.FC = () => (
    <Box
        className="scroll-past-spacer"
        sx={{ width: "100%", height: SCROLL_PAST_HEIGHT, flexShrink: 0 }}
    />
);

// The footer is a flat, full-width bar flush to the bottom of the nearest positioned
// ancestor (MobileTabScreen's ScreenRoot, or the phone frame for pages that render it
// directly). It is separated from the content by a hairline rather than by a drop
// shadow, and it is painted in the paper ground so it reads as part of the page rather
// than as a floating object. This is the ONLY footer style in the app — there is no
// pill variant any more. Surfaces that render it must reserve
// FOOTER_CLEARANCE of bottom space so content never hides behind it.
const Footer = styled(Box)(() => ({
    backgroundColor: COLORS.background,
    borderTop: `1px solid ${COLORS.rowBorder}`,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    // Block native pan/scroll: dragging from the footer must not scroll/bounce
    // the page (it sits over drag-to-sort/game surfaces).
    touchAction: "none",
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // Grown by the home-indicator inset, with matching bottom padding so the four tab
    // labels keep their designed position relative to the bar's TOP edge and the extra
    // height is dead space under the indicator. See FOOTER_TOTAL_HEIGHT.
    height: FOOTER_TOTAL_HEIGHT,
    paddingBottom: SAFE_BOTTOM,
    boxSizing: "border-box",
    zIndex: 10,
}));

// One tab. The active state is ink + weight 600 + a short underline bar drawn as an
// ::after, exactly as `.fbar div.on` does it — NOT an opacity change, which is what
// the pill used and which read as "dimmed" rather than "not selected".
const FooterItem = styled(Box, {
    shouldForwardProp: (prop) => prop !== "active",
})<{ active?: boolean }>(({ active }) => ({
    flex: 1,
    textAlign: "center",
    paddingBottom: 7,
    cursor: "pointer",
    // The underline occupies 8px (2px bar + 6px margin) under the active label only,
    // so an inactive tab's label would sit 8px lower than the active one. The
    // transparent placeholder on inactive tabs keeps all four labels on one baseline.
    "&::after": {
        content: '""',
        display: "block",
        width: 14,
        height: 2,
        margin: "6px auto 0",
        backgroundColor: active ? COLORS.onSurface : "transparent",
    },
}));

// The slab (see the SLAB_FOOTER_* constants), in two layers:
//   - SlabFooter (outer): position + the cast shadow on the sky. Transparent: box-shadow
//     paints only outside the box, so the face above covers the rest.
//   - SlabFooterFace (inner): the flashcard itself, painted in the flashcard's own colours
//     — the same stock the tower's cards are cut from (ISO.card): cardFace top, cardWall lip
//     (diagonal — below and right, see `slabLipShadow`).
//     (It used to be drawn through the Deck Tower's time-of-day wash as an SVG `url()`
//     filter; cut 2026-10-30 — WebKit rasterises that on the CPU on every repaint.)
//   Every slab colour reads `tier2Var(…, its card colour)`: a Tier 2 page under the slab
//   (the Dictionary, src/timeOfDay/tier2Chrome.ts) turns it slate at night; with no Tier 2
//   page up the variables are unset and the slab is the card stock above.
const SlabFooter = styled(Box)(() => ({
    position: "absolute",
    left: SLAB_FOOTER_SIDE_INSET,
    right: SLAB_FOOTER_SIDE_INSET,
    bottom: SLAB_FOOTER_BOTTOM,
    height: SLAB_FOOTER_HEIGHT,
    borderRadius: SLAB_FOOTER_RADIUS,
    boxShadow: `${SLAB_CAST_PX}px ${SLAB_CAST_PX}px 0 var(${SLAB_CAST_SHADOW_VAR}, transparent)`,
    // Same reason as the bar: a drag from the footer must not pan the page under it.
    touchAction: "none",
    zIndex: 10,
}));

const SlabFooterFace = styled(Box)(() => ({
    height: "100%",
    backgroundColor: tier2Var("footerFace", COLORS.cardFace),
    borderRadius: "inherit",
    boxShadow: slabLipShadow(tier2Var("footerFace", COLORS.cardFace), tier2Var("footerWall", COLORS.cardWall)),
    display: "grid",
    // One equal column per tab — `grid-auto-flow: column` rather than a fixed count, so
    // the slab stays balanced if a tab is ever flagged off.
    gridAutoFlow: "column",
    gridAutoColumns: "1fr",
    padding: SLAB_FOOTER_PADDING,
    boxSizing: "border-box",
    // Containing block for the sliding SlabFooterSelector.
    position: "relative",
}));

// The active tab's selector: ONE flat rounded rectangle — the beige face panel (cardBeige)
// with the app's 1px outline (CLAUDE.md § Buttons & cards) — that SLIDES between tab cells
// rather than each tab drawing its own background. It was a keycap with a 3px inset
// diagonal lip + rounded edge until 2026-11-10; the user asked for the plain rectangle the
// app's other selectors use, so it is flat now (no lip, no rim light, no fillet — it is
// not a raised object any more). The outline reads Tier 2's `outline` so the night slate
// gets its white-12% ring.
//
// Geometry: it sits in the face's padding box, one column wide (the face is `1fr`
// columns, so a column = (inner width) / tab count), and moves by `translateX(i * 100%)`
// — a percentage of its OWN width, i.e. exactly one column per step. Transform-only, so
// the slide is compositor-driven and never relayouts the tabs.
const SLAB_SELECTOR_SLIDE = "transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const SlabFooterSelector = styled(Box)(() => ({
    position: "absolute",
    top: SLAB_FOOTER_PADDING,
    bottom: SLAB_FOOTER_PADDING,
    left: SLAB_FOOTER_PADDING,
    boxSizing: "border-box",
    borderRadius: SLAB_KEY_RADIUS,
    backgroundColor: tier2Var("footerKey", COLORS.cardBeige),
    border: `1px solid ${tier2Var("outline", COLORS.border)}`,
    transition: `${SLAB_SELECTOR_SLIDE}, opacity 150ms ease`,
    pointerEvents: "none",
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
}));

// One slab tab: icon over label. Transparent — the selector behind it marks the active
// one; `position: relative` lifts the tab's content above the absolutely-placed selector.
const SlabFooterItem = styled(Box)(() => ({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    cursor: "pointer",
}));

// The top-level footer tabs. Every other surface is a drill-in reached from one of
// these — there is no separate Games tab; Games lives under Menu. Account is not a
// destination either: it is a maximizable sheet (AccountSheet, with Settings as one of
// its tabs) raised from the Deck Tower header's avatar.
//
// The four tabs, left to right: Flashcards · Lessons · Dictionary · Menu (2026-11-10; the
// first tab was labelled "Deck" until 2026-11-08). Flashcards is the Deck Tower, which
// renders at `/` (it replaced the old Home tab, the fdp, on 2026-11-04). Lessons
// (`/lessons`) took Arena's slot on 2026-11-10 and is a "coming soon" placeholder for now;
// Arena went back to being a Menu row (src/components/menuPopover/menuDestinations.ts).
//
// Menu is the one tab that is NOT a destination: it does not navigate. A tap raises
// MenuPopover, a list of rows (Reader, Tester Dashboard, …) over whatever page is on screen.
// It sits last so the popover can anchor bottom-right, right above it. The `/menu` bento
// page it used to open was deleted 2026-11-06. `menu` remains a FooterTab because the
// Menu-reached pages (Reader, Arena, the `/friends/*` drill-ins, …) still light it (routeMeta `footerTab`).
export type FooterTab = "deck" | "menu" | "lessons" | "dictionary";

// Which footer is drawn: the app-wide flat `bar`, or the floating `slab` a route opts
// into through its registry row (`footerStyle`, src/routes/routeMeta.ts).
export type FooterStyle = "bar" | "slab";

/** One footer tab: its key, label, slab icon (Material Symbols name) and tap handler. */
interface FooterTabRow {
    tab: FooterTab;
    label: string;
    icon: string;
    onClick: () => void;
}

interface MobileFooterProps {
    activePage?: FooterTab;
    // Which footer to draw. FooterPresenter picks it from the route. Defaults to the bar.
    variant?: FooterStyle;
    // Spread onto the bar element. Used by FooterPresenter to drive the vertical
    // slide-in/out transform (the footer is animated independently of the page-slide
    // transitions). See FooterPresenter / docs/LEAF_NODE_PAGES.md.
    style?: React.CSSProperties;
}

const MobileFooter: React.FC<MobileFooterProps> = ({ activePage = "deck", variant = "bar", style }) => {
    const navigate = useNavigate();
    // Whether the Menu tab's popover is up (MenuPopover). Local state: the footer is
    // rendered once at frame level, so this survives navigation between footer routes.
    const [menuOpen, setMenuOpen] = useState(false);
    const closeMenu = useCallback(() => setMenuOpen(false), []);
    // Rendered next to either footer style; anchored above whichever one is drawn.
    const menuPopover = (
        <MenuPopover
            open={menuOpen}
            onClose={closeMenu}
            footerClearance={variant === "slab" ? SLAB_FOOTER_TOTAL_HEIGHT : FOOTER_TOTAL_HEIGHT}
        />
    );

    // One row per tab, in the design's left-to-right order. This used to be four
    // copy-pasted JSX blocks differing only in label, icon and handler; with the icons
    // gone (decision D5) there was nothing left to justify the repetition.
    // `icon` (a Material Symbols name) is drawn by the slab only — the bar stays text-only.
    const baseTabs: FooterTabRow[] = [
        { tab: "deck", label: "Flashcards", icon: "stacks", onClick: () => navigate("/") },
        // Placeholder page for now (src/features/lessons/LessonsPage.tsx) — not flagged.
        { tab: "lessons", label: "Lessons", icon: "school", onClick: () => navigate("/lessons") },
        {
            tab: "dictionary", label: "Dictionary", icon: "translate",
            // Single tap navigates only; a double tap also focuses the search field
            // (src/features/dictionary/dictionarySearchFocus.ts).
            onClick: () => {
                navigate("/dictionary");
                if (registerDictionaryTabTap()) requestDictionarySearchFocus();
            },
        },
        // Opens the popover instead of navigating. Closing is the popover's job: while
        // open its scrim covers this tab, so a second tap lands on the scrim.
        { tab: "menu", label: "Menu", icon: "apps", onClick: () => setMenuOpen(true) },
    ];
    // The tab the selector shows, ahead of the route. React Router v7 runs every
    // navigation as a React transition, so while the destination page is still loading
    // (a lazy route chunk suspending) or mounting, `activePage` — read from the location
    // by FooterPresenter — keeps the OLD tab, and the selector would wait for the page.
    // A tap records the tab it is heading to as an urgent state update, which commits
    // before the transition does, so the selector starts sliding on the tap itself.
    // `fromKey` ties the record to the location it was made on (`location.key` is new for
    // every completed navigation, redirects included): once the location moves on, the
    // record is stale and the route is the truth again — no effect needed to clear it.
    // Menu never records one (it opens the popover; it does not navigate).
    const { key: locationKey } = useLocation();
    const [pendingTab, setPendingTab] = useState<{ tab: FooterTab; fromKey: string } | null>(null);
    const displayedTab = pendingTab && pendingTab.fromKey === locationKey ? pendingTab.tab : activePage;

    const TABS: FooterTabRow[] = baseTabs.map((t) => ({
        ...t,
        // The page on screen may take over a tab's tap (footerTabOverride.ts — acp opened
        // from the Deck Tower plays its circle Back on the Flashcards tab); otherwise navigate.
        onClick: () => {
            if (t.tab !== "menu") setPendingTab({ tab: t.tab, fromKey: locationKey });
            if (!runFooterTabOverride(t.tab)) t.onClick();
        },
    }));

    if (variant === "slab") {
        // Which cell the sliding selector sits in (-1 = no tab lit → selector hidden).
        const activeIndex = TABS.findIndex((t) => t.tab === displayedTab);
        return (
            <>
                <SlabFooter className="mobile-footer mobile-footer--slab" style={style}>
                    <SlabFooterFace className="mobile-footer__slab-face">
                        {/* The sliding selector. Persists across footer routes (the footer is
                            rendered once at frame level), so a tab change animates it from the
                            old cell to the new one. A page that lights no tab hides it. */}
                        <SlabFooterSelector
                            className="mobile-footer__slab-selector"
                            style={{
                                width: `calc((100% - ${2 * SLAB_FOOTER_PADDING}px) / ${TABS.length})`,
                                transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
                                opacity: activeIndex < 0 ? 0 : 1,
                            }}
                        />
                        {TABS.map(({ tab, label, icon, onClick }) => {
                            // `displayedTab`, not `activePage`: the ink moves with the selector.
                            const active = displayedTab === tab;
                            const tone = active
                                ? tier2Var("footerInkActive", COLORS.onSurface)
                                : tier2Var("footerInk", COLORS.textSecondary);
                            return (
                                <SlabFooterItem
                                    key={tab}
                                    className={`mobile-footer-item mobile-footer-item--${tab}${active ? " mobile-footer-item--active" : ""}`}
                                    onClick={onClick}
                                >
                                    {/* Filled, weight 500 — the design's icon-font axes for this bar. */}
                                    <Icon className={`mobile-footer__${tab}-icon`} name={icon} size={22} weight={500} fill={1} color={tone} />
                                    <Typography
                                        className={`mobile-footer__${tab}-label`}
                                        sx={{
                                            // 11px/600 flat, the design's `.ft div` — like the bar's
                                            // 12px, pinned independently of the body ramp.
                                            fontSize: 11,
                                            fontWeight: 600,
                                            lineHeight: LEADING.tight,
                                            color: tone,
                                            fontFamily: FONTS.sans,
                                        }}
                                    >
                                        {label}
                                    </Typography>
                                </SlabFooterItem>
                            );
                        })}
                    </SlabFooterFace>
                </SlabFooter>
                {menuPopover}
            </>
        );
    }

    return (
        <>
            <Footer className="mobile-footer" style={style}>
                {TABS.map(({ tab, label, onClick }) => {
                    const active = displayedTab === tab;
                    return (
                        <FooterItem
                            key={tab}
                            className={`mobile-footer-item mobile-footer-item--${tab}${active ? " mobile-footer-item--active" : ""}`}
                            active={active}
                            onClick={onClick}
                        >
                            <Typography
                                className={`mobile-footer__${tab}-label`}
                                sx={{
                                    // 12px flat, not a scale token: the design pins `.fbar`
                                    // labels at this size independently of the body ramp.
                                    fontSize: 12,
                                    fontWeight: active ? 600 : 400,
                                    lineHeight: LEADING.tight,
                                    color: active ? COLORS.onSurface : COLORS.textFaint,
                                    fontFamily: FONTS.sans,
                                }}
                            >
                                {label}
                            </Typography>
                        </FooterItem>
                    );
                })}
            </Footer>
            {menuPopover}
        </>
    );
};

export default MobileFooter;

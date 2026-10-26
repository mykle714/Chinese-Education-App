import { useNavigate } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { LEADING } from "../theme/scale";
import { SAFE_BOTTOM } from "../theme/safeArea";
import Icon from "./Icon";
import { SLAB_CAST_SHADOW_VAR, SLAB_FILTER_VAR } from "./footerCastShadow";

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
// Worn only by routes whose registry row says `footerStyle: "slab"` (today: /deck-tower).
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
// The slab's own height, and the lip it stands on (a solid `0 6px 0` shadow, like a
// card's wall seen from the front).
const SLAB_FOOTER_HEIGHT = 64;
const SLAB_FOOTER_LIP = 6;
// The cast shadow's offset onto the sky (the design's `10px 16px`): down-right, the
// same direction the tower's iso objects throw theirs.
const SLAB_CAST_X = 10;
const SLAB_CAST_Y = 16;
// The band from the screen's bottom edge to the slab's TOP — the slab's real footprint.
// A page laid out around the slab (the Deck Tower's scroller clip and spacer) reserves
// this, as a CSS string because it carries the safe area. The cast shadow is excluded:
// it falls on sky and may overlap the scene.
export const SLAB_FOOTER_TOTAL_HEIGHT = `calc(${SLAB_FOOTER_BOTTOM} + ${SLAB_FOOTER_HEIGHT + SLAB_FOOTER_LIP}px)`;
// How far FooterPresenter pushes the slab to clear the frame's bottom edge entirely:
// its footprint plus the cast shadow, or the shadow's tail would peek up when hidden.
export const SLAB_FOOTER_HIDDEN_OFFSET = `calc(${SLAB_FOOTER_BOTTOM} + ${SLAB_FOOTER_HEIGHT + SLAB_FOOTER_LIP + SLAB_CAST_Y}px)`;

// The single, app-wide bottom spacer. Render it as the LAST child of any
// footer-bearing scroll surface (hubs, decks, dictionary, card details, mastered
// cards) so the final row clears the footer bar. We rely on this explicit block —
// NOT MobileTabScreen's ScrollArea paddingBottom — because that padding is (a) eaten
// when the flex content column overflows its computed height and (b) covered by the
// scroll area's bottom edge-fade mask. One shared height (FOOTER_CLEARANCE)
// means a single edit reflows every page at once.
export const FooterSpacer: React.FC = () => (
    <Box
        className="footer-spacer"
        sx={{ width: "100%", height: FOOTER_TOTAL_CLEARANCE, flexShrink: 0 }}
    />
);

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

// The slab (see the SLAB_FOOTER_* constants), in two layers so the page's light can reach
// the slab without reaching its shadow:
//   - SlabFooter (outer): position + the cast shadow on the sky. Never filtered — the sky
//     is the light, so a shadow on it is not lit either. Transparent: box-shadow paints
//     only outside the box, so the face above covers the rest.
//   - SlabFooterFace (inner): the flashcard itself, drawn through the page's light filter
//     (`--footer-slab-filter`, footerCastShadow.ts → setFooterSlabFilter; the Deck Tower's
//     time-of-day wash). Painted in the flashcard's own colours — the same stock the
//     tower's cards are cut from (ISO.card): cardFace top, cardWall lip.
const SlabFooter = styled(Box)(() => ({
    position: "absolute",
    left: SLAB_FOOTER_SIDE_INSET,
    right: SLAB_FOOTER_SIDE_INSET,
    bottom: SLAB_FOOTER_BOTTOM,
    height: SLAB_FOOTER_HEIGHT,
    borderRadius: 22,
    boxShadow: `${SLAB_CAST_X}px ${SLAB_CAST_Y}px 0 var(${SLAB_CAST_SHADOW_VAR}, transparent)`,
    // Same reason as the bar: a drag from the footer must not pan the page under it.
    touchAction: "none",
    zIndex: 10,
}));

const SlabFooterFace = styled(Box)(() => ({
    height: "100%",
    backgroundColor: COLORS.cardFace,
    borderRadius: "inherit",
    boxShadow: `0 ${SLAB_FOOTER_LIP}px 0 ${COLORS.cardWall}`,
    filter: `var(${SLAB_FILTER_VAR}, none)`,
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    padding: 6,
    boxSizing: "border-box",
}));

// One slab tab: icon over label. The active tab is a beige keycap set into the slab —
// the card's inset face panel (cardBeige) with the shaded wall as its bottom lip.
const SlabFooterItem = styled(Box, {
    shouldForwardProp: (prop) => prop !== "active",
})<{ active?: boolean }>(({ active }) => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 16,
    cursor: "pointer",
    backgroundColor: active ? COLORS.cardBeige : "transparent",
    boxShadow: active ? `inset 0 -3px 0 ${COLORS.cardWall}` : "none",
}));

// The four top-level footer tabs. Every other surface is a drill-in reached from
// one of these — there is no separate Games tab anymore; Games lives under Menu.
//
// Dictionary took Account's slot (2026-10-09). Account is no longer a destination:
// it is a maximizable sheet raised from the Home header's avatar button
// (AccountSheet), with Settings as its own gear beside that avatar.
//
// Home and Menu swapped contents (2026-10-10): Home (`/`) is now the decks page (the
// fdp — study hand + Cards/Decks sheets) under the account header, and the hub bento
// that used to be Home moved to the second tab as Menu (`/menu`). The old
// `"flashcards"` tab key is gone; its drill-ins light `"home"` now.
//
// Deck (the experimental Deck Tower, `/deck-tower`) took Discover's slot (2026-10-17),
// and the Discover hub itself was deleted the same day; its one drill-in (Sort Cards)
// now lights Home.
export type FooterTab = "home" | "menu" | "deck" | "dictionary";

// Which footer is drawn: the app-wide flat `bar`, or the floating `slab` a route opts
// into through its registry row (`footerStyle`, src/routes/routeMeta.ts).
export type FooterStyle = "bar" | "slab";

interface MobileFooterProps {
    activePage?: FooterTab;
    // Which footer to draw. FooterPresenter picks it from the route. Defaults to the bar.
    variant?: FooterStyle;
    // Spread onto the bar element. Used by FooterPresenter to drive the vertical
    // slide-in/out transform (the footer is animated independently of the page-slide
    // transitions). See FooterPresenter / docs/LEAF_NODE_PAGES.md.
    style?: React.CSSProperties;
}

const MobileFooter: React.FC<MobileFooterProps> = ({ activePage = "home", variant = "bar", style }) => {
    const navigate = useNavigate();

    // One row per tab, in the design's left-to-right order. This used to be four
    // copy-pasted JSX blocks differing only in label, icon and handler; with the icons
    // gone (decision D5) there was nothing left to justify the repetition.
    // `icon` (a Material Symbols name) is drawn by the slab only — the bar stays text-only.
    const TABS: { tab: FooterTab; label: string; icon: string; onClick: () => void }[] = [
        { tab: "home", label: "Home", icon: "home", onClick: () => navigate("/") },
        { tab: "menu", label: "Menu", icon: "apps", onClick: () => navigate("/menu") },
        { tab: "deck", label: "Deck", icon: "stacks", onClick: () => navigate("/deck-tower") },
        { tab: "dictionary", label: "Dictionary", icon: "translate", onClick: () => navigate("/dictionary") },
    ];

    if (variant === "slab") {
        return (
            <SlabFooter className="mobile-footer mobile-footer--slab" style={style}>
                <SlabFooterFace className="mobile-footer__slab-face">
                    {TABS.map(({ tab, label, icon, onClick }) => {
                        const active = activePage === tab;
                        const tone = active ? COLORS.onSurface : COLORS.textSecondary;
                        return (
                            <SlabFooterItem
                                key={tab}
                                className={`mobile-footer-item mobile-footer-item--${tab}${active ? " mobile-footer-item--active" : ""}`}
                                active={active}
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
        );
    }

    return (
        <Footer className="mobile-footer" style={style}>
            {TABS.map(({ tab, label, onClick }) => {
                const active = activePage === tab;
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
    );
};

export default MobileFooter;

import { useNavigate } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useDiscoverNavigation } from "../hooks/useDiscoverNavigation";
import HomeIcon from "@mui/icons-material/Home";
import StyleIcon from "@mui/icons-material/Style";
import LanguageIcon from "@mui/icons-material/Language";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../theme/scale";

// Floating-pill geometry. Exported so scroll containers (see MobileTabScreen)
// can reserve matching bottom padding and never let content hide behind the bar.
export const FLOATING_FOOTER_HEIGHT = 64;
export const FLOATING_FOOTER_INSET = 16;
// Extra breathing gap added on top of the pill's own footprint, so the last row
// clears the bar with a little slack. Bump this (not HEIGHT/INSET) to give every
// page more bottom room without resizing or repositioning the pill itself.
export const FLOATING_FOOTER_EXTRA_GAP = 12;
// Total vertical space the floating pill occupies plus a breathing gap above it,
// used as the scroll area's paddingBottom so the last row clears the bar.
export const FLOATING_FOOTER_CLEARANCE =
    FLOATING_FOOTER_HEIGHT + FLOATING_FOOTER_INSET * 2 + FLOATING_FOOTER_EXTRA_GAP;

// The single, app-wide bottom spacer. Render it as the LAST child of any
// footer-bearing scroll surface (hubs, decks, dictionary, card details, mastered
// cards) so the final row clears the floating footer pill. We rely on this
// explicit block — NOT MobileTabScreen's ScrollArea paddingBottom — because that
// padding is (a) eaten when the flex content column overflows its computed height
// and (b) covered by the scroll area's bottom edge-fade mask. One shared height
// (FLOATING_FOOTER_CLEARANCE) means a single edit reflows every page at once.
export const FooterSpacer: React.FC = () => (
    <Box
        className="footer-spacer"
        sx={{ width: "100%", height: FLOATING_FOOTER_CLEARANCE, flexShrink: 0 }}
    />
);

// The footer is always a detached, rounded pill, anchored to the bottom of the
// nearest positioned ancestor (MobileTabScreen's ScreenRoot, or the phone frame
// for pages that render it directly) and hovering above the content. This is the
// ONLY footer style in the app — there is no flat/in-flow variant. Surfaces that
// render it must reserve FLOATING_FOOTER_CLEARANCE of bottom space so content
// never hides behind the pill.
const Footer = styled(Box)(() => ({
    backgroundColor: COLORS.header,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    flexShrink: 0,
    // Block native pan/scroll: dragging from the footer must not scroll/bounce
    // the page (it sits over drag-to-sort/game surfaces).
    touchAction: "none",
    position: "absolute",
    left: FLOATING_FOOTER_INSET,
    right: FLOATING_FOOTER_INSET,
    bottom: FLOATING_FOOTER_INSET,
    height: FLOATING_FOOTER_HEIGHT,
    borderRadius: FLOATING_FOOTER_HEIGHT / 2,
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.20)",
    overflow: "hidden", // clip item ripples/dividers to the pill shape
    zIndex: 10,
}));

const FooterContent = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
}));

const FooterItem = styled(Box)<{ active?: boolean }>(({ active }) => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    padding: "10px",
    flex: 1,
    cursor: "pointer",
    transition: "opacity 0.2s ease-in-out",
    opacity: active ? 1 : 0.6,
    "&:hover": {
        opacity: 1,
    },
}));

const FooterDivider = styled(Box)(() => ({
    width: 1,
    height: 32,
    backgroundColor: COLORS.border,
}));

// The four top-level footer tabs. Every other surface is a drill-in reached from
// one of these (or from the Home menu) — there is no separate Games tab anymore;
// Games lives under the Home menu.
export type FooterTab = "flashcards" | "discover" | "home" | "account";

interface MobileFooterProps {
    activePage?: FooterTab;
    // Spread onto the pill element. Used by FooterPresenter to drive the
    // vertical slide-in/out transform (the footer is animated independently of the
    // page-slide transitions). See FooterPresenter / docs/LEAF_NODE_PAGES.md.
    style?: React.CSSProperties;
}

const MobileFooter: React.FC<MobileFooterProps> = ({ activePage = "home", style }) => {
    const navigate = useNavigate();
    const { goToDiscover } = useDiscoverNavigation();

    const handleFlashcardsClick = () => {
        navigate("/flashcards/decks");
    };

    const handleDiscoverClick = () => {
        goToDiscover();
    };

    const handleHomeClick = () => {
        navigate("/");
    };

    const handleAccountClick = () => {
        navigate("/account");
    };

    return (
        <Footer className="mobile-footer" style={style}>
            <FooterContent className="mobile-footer-content">
                <FooterItem
                    className="mobile-footer-item"
                    active={activePage === "home"}
                    onClick={handleHomeClick}
                >
                    <HomeIcon className="mobile-footer__home-icon" sx={{ fontSize: 24, color: COLORS.iconColor }} />
                    <Typography
                        className="mobile-footer__home-label"
                        sx={{
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.regular,
                            lineHeight: LEADING.tight,
                            color: COLORS.onSurface,
                            fontFamily: FONTS.sans,
                        }}
                    >
                        Home
                    </Typography>
                </FooterItem>

                <FooterDivider className="mobile-footer-divider" />

                <FooterItem
                    className="mobile-footer-item"
                    active={activePage === "flashcards"}
                    onClick={handleFlashcardsClick}
                >
                    <StyleIcon className="mobile-footer__flashcards-icon" sx={{ fontSize: 24, color: COLORS.iconColor }} />
                    <Typography
                        className="mobile-footer__flashcards-label"
                        sx={{
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.regular,
                            lineHeight: LEADING.tight,
                            color: COLORS.onSurface,
                            fontFamily: FONTS.sans,
                        }}
                    >
                        Flashcards
                    </Typography>
                </FooterItem>

                <FooterDivider className="mobile-footer-divider" />

                <FooterItem
                    className="mobile-footer-item"
                    active={activePage === "discover"}
                    onClick={handleDiscoverClick}
                >
                    <LanguageIcon className="mobile-footer__discover-icon" sx={{ fontSize: 24, color: COLORS.iconColor }} />
                    <Typography
                        className="mobile-footer__discover-label"
                        sx={{
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.regular,
                            lineHeight: LEADING.tight,
                            color: COLORS.onSurface,
                            fontFamily: FONTS.sans,
                        }}
                    >
                        Discover
                    </Typography>
                </FooterItem>

                <FooterDivider className="mobile-footer-divider" />

                <FooterItem
                    className="mobile-footer-item"
                    active={activePage === "account"}
                    onClick={handleAccountClick}
                >
                    <AccountCircleIcon className="mobile-footer__account-icon" sx={{ fontSize: 24, color: COLORS.iconColor }} />
                    <Typography
                        className="mobile-footer__account-label"
                        sx={{
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.regular,
                            lineHeight: LEADING.tight,
                            color: COLORS.onSurface,
                            fontFamily: FONTS.sans,
                        }}
                    >
                        Account
                    </Typography>
                </FooterItem>
            </FooterContent>
        </Footer>
    );
};

export default MobileFooter;

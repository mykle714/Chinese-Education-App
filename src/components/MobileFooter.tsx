import { useNavigate } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useDiscoverNavigation } from "../hooks/useDiscoverNavigation";
import HomeIcon from "@mui/icons-material/Home";
import LanguageIcon from "@mui/icons-material/Language";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";

// Design tokens from Figma
const COLORS = {
    header: "#F2F2F4",
    border: "#5C5C66",
    iconColor: "#323232",
    textColor: "#272727",
};

const Footer = styled(Box)(() => ({
    backgroundColor: COLORS.header,
    width: "100%",
    height: 96,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    flexShrink: 0,
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

interface MobileFooterProps {
    activePage?: "home" | "discover" | "games" | "account";
}

const MobileFooter: React.FC<MobileFooterProps> = ({ activePage = "home" }) => {
    const navigate = useNavigate();
    const { goToDiscover } = useDiscoverNavigation();

    const handleHomeClick = () => {
        navigate("/flashcards/decks");
    };

    const handleDiscoverClick = () => {
        goToDiscover();
    };

    const handleGamesClick = () => {
        navigate("/games");
    };

    const handleAccountClick = () => {
        navigate("/account");
    };

    return (
        <Footer className="mobile-footer">
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
                            fontSize: 12,
                            fontWeight: 400,
                            lineHeight: 1.21,
                            color: COLORS.textColor,
                            fontFamily: '"Inter", sans-serif',
                        }}
                    >
                        Home
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
                            fontSize: 12,
                            fontWeight: 400,
                            lineHeight: 1.21,
                            color: COLORS.textColor,
                            fontFamily: '"Inter", sans-serif',
                        }}
                    >
                        Discover
                    </Typography>
                </FooterItem>

                <FooterDivider className="mobile-footer-divider" />

                <FooterItem
                    className="mobile-footer-item"
                    active={activePage === "games"}
                    onClick={handleGamesClick}
                >
                    <SportsEsportsIcon className="mobile-footer__games-icon" sx={{ fontSize: 24, color: COLORS.iconColor }} />
                    <Typography
                        className="mobile-footer__games-label"
                        sx={{
                            fontSize: 12,
                            fontWeight: 400,
                            lineHeight: 1.21,
                            color: COLORS.textColor,
                            fontFamily: '"Inter", sans-serif',
                        }}
                    >
                        Games
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
                            fontSize: 12,
                            fontWeight: 400,
                            lineHeight: 1.21,
                            color: COLORS.textColor,
                            fontFamily: '"Inter", sans-serif',
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

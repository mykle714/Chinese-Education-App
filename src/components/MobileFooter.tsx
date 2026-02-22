import { useNavigate, useLocation } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import HomeIcon from "@mui/icons-material/Home";
import LanguageIcon from "@mui/icons-material/Language";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";

// Design tokens from Figma
const COLORS = {
    header: "#D7D7D4",
    border: "#625F63",
    iconColor: "#323232",
    textColor: "#272727",
};

const Footer = styled(Box)(({ theme }) => ({
    backgroundColor: COLORS.header,
    width: "100%",
    maxWidth: 393,
    height: 96,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    flexShrink: 0,
}));

const FooterContent = styled(Box)(({ theme }) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
}));

const FooterItem = styled(Box)<{ active?: boolean }>(({ theme, active }) => ({
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

const FooterDivider = styled(Box)(({ theme }) => ({
    width: 1,
    height: 32,
    backgroundColor: COLORS.border,
}));

interface MobileFooterProps {
    activePage?: "home" | "discover" | "account";
}

const MobileFooter: React.FC<MobileFooterProps> = ({ activePage = "home" }) => {
    const navigate = useNavigate();
    const location = useLocation();

    const handleHomeClick = () => {
        navigate("/flashcards/decks");
    };

    const handleDiscoverClick = () => {
        navigate("/discover");
    };

    const handleAccountClick = () => {
        navigate("/profile");
    };

    return (
        <Footer className="mobile-footer">
            <FooterContent className="mobile-footer-content">
                <FooterItem
                    className="mobile-footer-item"
                    active={activePage === "home"}
                    onClick={handleHomeClick}
                >
                    <HomeIcon sx={{ fontSize: 24, color: COLORS.iconColor }} />
                    <Typography
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
                    <LanguageIcon sx={{ fontSize: 24, color: COLORS.iconColor }} />
                    <Typography
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
                    active={activePage === "account"}
                    onClick={handleAccountClick}
                >
                    <AccountCircleIcon sx={{ fontSize: 24, color: COLORS.iconColor }} />
                    <Typography
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

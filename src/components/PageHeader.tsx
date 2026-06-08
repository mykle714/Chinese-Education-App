import React from "react";
import { Box, IconButton, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

const Header = styled(Box)(() => ({
    backgroundColor: "#F2F2F4",
    height: 60,
    minHeight: 60,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    // Block native pan/scroll: dragging from the header must not scroll/bounce
    // the page (it sits above drag-to-sort/game surfaces). Mark a child scrollable
    // explicitly if one ever needs it.
    touchAction: "none",
}));

const Toolbar = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    height: 59,
    padding: "0 12px",
    position: "relative",
}));

interface PageHeaderProps {
    title: string;
    onBack?: () => void;
    showBack?: boolean;
    // Single ReactNode slot rendered flush-right. The base header has no
    // opinion about what goes here — footer-tab surfaces should use
    // `MobileDemoHeader` (which fills this slot with the hamburger menu)
    // rather than wiring `MobileNavDrawer` into every page.
    rightContent?: React.ReactNode;
    // Icon rendered immediately to the left of the title. On footer-tab
    // surfaces this mirrors the active footer tab's icon as a page-identity
    // badge. Ignored when `showBack` is true (back button owns the slot).
    leftIcon?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, onBack, showBack = true, rightContent, leftIcon }) => {
    const navigate = useNavigate();

    return (
        <Header className="page-header">
            <Toolbar className="page-header__toolbar">
                {/* Left: back button (hidden on top-level pages) */}
                {showBack ? (
                    <IconButton
                        className="page-header__back-button"
                        size="small"
                        sx={{ color: "#1C1C1E" }}
                        onClick={onBack ?? (() => navigate(-1))}
                    >
                        <ExpandMoreIcon />
                    </IconButton>
                ) : leftIcon ? (
                    <Box
                        className="page-header__left-icon"
                        sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34 }}
                    >
                        {leftIcon}
                    </Box>
                ) : (
                    <Box sx={{ width: 34 }} /> /* placeholder matching back button size */
                )}

                {/* Title: left-aligned, touching the back button or its placeholder */}
                <Typography
                    className="page-header__title"
                    sx={{
                        flex: 1,
                        fontSize: SIZE.bodyLg,
                        fontWeight: WEIGHT.regular,
                        color: "#1C1C1E",
                        fontFamily: FONTS.sans,
                        whiteSpace: "nowrap",
                    }}
                >
                    {title}
                </Typography>

                {/* Right: configurable content slot */}
                <Box
                    className="page-header__right-content"
                    sx={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 1 }}
                >
                    {rightContent}
                </Box>
            </Toolbar>
        </Header>
    );
};

export default PageHeader;

import React from "react";
import { Box, IconButton, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";

const Header = styled(Box)(() => ({
    backgroundColor: "#D7D7D4",
    height: 60,
    minHeight: 60,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
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
    rightItems?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, onBack, showBack = true, rightItems }) => {
    const navigate = useNavigate();

    return (
        <Header className="page-header">
            <Toolbar className="page-header__toolbar">
                {/* Left: back button (hidden on top-level pages) */}
                {showBack ? (
                    <IconButton
                        className="page-header__back-button"
                        size="small"
                        sx={{ color: "#1D1B20" }}
                        onClick={onBack ?? (() => navigate(-1))}
                    >
                        <ExpandMoreIcon />
                    </IconButton>
                ) : (
                    <Box sx={{ width: 34 }} /> /* spacer to keep title centered */
                )}

                {/* Center: title, absolutely centered relative to the toolbar */}
                <Typography
                    className="page-header__title"
                    sx={{
                        position: "absolute",
                        left: "50%",
                        transform: "translateX(-50%)",
                        fontSize: 16,
                        fontWeight: 400,
                        color: "#1D1B20",
                        fontFamily: '"Inter", sans-serif',
                        whiteSpace: "nowrap",
                    }}
                >
                    {title}
                </Typography>

                {/* Right: configurable action items */}
                <Box
                    className="page-header__right-items"
                    sx={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 1 }}
                >
                    {rightItems}
                </Box>
            </Toolbar>
        </Header>
    );
};

export default PageHeader;

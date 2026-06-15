import { type ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../theme/scale";

// Shared vertical hub menu, used by the Games hub (`/games`) and the Discover hub
// (`/discover`) so the two stay visually identical. Each row is a full-width link
// with a rounded icon tile, a title, an optional subtitle, and a trailing
// chevron. Pages supply their own row `className` (for per-item styling/targeting)
// and the resolved icon node (image asset or fallback MUI icon).

const MenuList = styled(Box)(() => ({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    padding: 0,
}));

const MenuRow = styled(RouterLink)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 16,
    width: "100%",
    padding: "16px 20px",
    borderBottom: `1px solid ${COLORS.rowBorder}`,
    textDecoration: "none",
    color: "inherit",
    backgroundColor: "transparent",
    transition: "background-color 120ms ease",
    "&:hover": {
        backgroundColor: COLORS.rowHoverBg,
    },
}));

const RowIconTile = styled(Box)(() => ({
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.iconBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
}));

const RowBody = styled(Box)(() => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
}));

export const HubMenu: React.FC<{ className?: string; children: ReactNode }> = ({ className, children }) => (
    <MenuList className={className ?? "hub-menu"}>{children}</MenuList>
);

interface HubMenuRowProps {
    /** Destination route — the whole row is a RouterLink to this path. */
    to: string;
    /** Resolved icon node rendered inside the rounded tile. */
    icon: ReactNode;
    title: string;
    subtitle?: string;
    /** Per-row class (e.g. `games-page__menu-item--bubble-match`). */
    className?: string;
}

export const HubMenuRow: React.FC<HubMenuRowProps> = ({ to, icon, title, subtitle, className }) => (
    <MenuRow to={to} className={className ?? "hub-menu__row"}>
        <RowIconTile className="hub-menu__row-icon">{icon}</RowIconTile>
        <RowBody className="hub-menu__row-body">
            <Typography
                className="hub-menu__row-title"
                sx={{
                    fontSize: SIZE.bodyLg,
                    fontWeight: WEIGHT.medium,
                    color: COLORS.onSurface,
                    fontFamily: FONTS.sans,
                    lineHeight: LEADING.normal,
                }}
            >
                {title}
            </Typography>
            {subtitle && (
                <Typography
                    className="hub-menu__row-subtitle"
                    sx={{
                        fontSize: SIZE.body,
                        color: COLORS.textSecondary,
                        fontFamily: FONTS.sans,
                        lineHeight: LEADING.normal,
                        mt: 0.25,
                    }}
                >
                    {subtitle}
                </Typography>
            )}
        </RowBody>
        <ChevronRightIcon sx={{ color: COLORS.textSecondary, flexShrink: 0 }} />
    </MenuRow>
);

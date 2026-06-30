import React from "react";
import { Badge, Box, IconButton, Typography, useTheme } from "@mui/material";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import BlockIcon from "@mui/icons-material/Block";
import { FIRE_ACTIVE_COLOR } from "../pages/FlashcardsLearnPage/constants";
import { useMinutePoints } from "./useMinutePoints";
import { useMinutePointsPaused } from "./minutePointsPause";
import { SIZE , WEIGHT} from "../theme/scale";

// Calls useMinutePoints internally rather than accepting it as a prop, so the
// per-second TICK only re-renders this leaf component instead of whatever page
// hosts the badge — critical for not interrupting in-progress drag gestures.
const MinutePointsFireBadge: React.FC = () => {
    const minutePoints = useMinutePoints();
    // Paused (e.g. flp icon-layout editor): accumulation is on hold, so the flame goes
    // grey and a red no-entry symbol overlays it to signal "not counting".
    const paused = useMinutePointsPaused();
    const theme = useTheme();
    const inactiveColor = theme.palette.text.secondary;
    const borderColor = theme.palette.divider;
    const activeColor = paused ? inactiveColor : (minutePoints.isActive ? FIRE_ACTIVE_COLOR : inactiveColor);

    return (
        <Box
            className="minute-points-fire-badge"
            sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}
        >
            <Badge
                className="minute-points-fire-badge__count"
                badgeContent={minutePoints.currentPoints}
                color="primary"
                max={99}
                sx={{
                    "& .MuiBadge-badge": {
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.bold,
                        minWidth: "16px",
                        height: "16px",
                        padding: "0 4px",
                        backgroundColor: activeColor,
                        color: "white",
                        border: `1px solid ${borderColor}`,
                    },
                }}
            >
                <IconButton
                    className="minute-points-fire-badge__icon-button"
                    size="small"
                    sx={{ padding: "4px", position: "relative" }}
                    disableRipple
                >
                    <LocalFireDepartmentIcon
                        className="minute-points-fire-badge__icon"
                        sx={{
                            color: activeColor,
                            fontSize: SIZE.title,
                            filter: (!paused && minutePoints.isActive) ? "drop-shadow(0 0 4px rgba(230, 81, 0, 0.6))" : "none",
                            animation: (!paused && minutePoints.isAnimating) ? "minutePointsFirePulse 0.6s ease-out" : "none",
                            "@keyframes minutePointsFirePulse": {
                                "0%, 100%": { transform: "scale(1)" },
                                "50%": { transform: "scale(1.2)", filter: "drop-shadow(0 0 8px rgba(230, 81, 0, 0.8))" },
                            },
                        }}
                    />
                    {/* Paused: a giant red no-entry symbol over the (greyed) flame. */}
                    {paused && (
                        <BlockIcon
                            className="minute-points-fire-badge__paused-overlay"
                            sx={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                transform: "translate(-50%, -50%)",
                                // Larger than the flame so the "no" reads clearly.
                                fontSize: `calc(${SIZE.title} * 1.6)`,
                                color: "#e53935",
                                pointerEvents: "none",
                            }}
                        />
                    )}
                </IconButton>
            </Badge>
            <Typography
                className="minute-points-fire-badge__seconds"
                sx={{
                    fontSize: SIZE.micro,
                    fontWeight: WEIGHT.bold,
                    color: activeColor,
                    lineHeight: 1,
                    marginTop: "-2px",
                }}
            >
                {minutePoints.liveSeconds}s
            </Typography>
        </Box>
    );
};

export default MinutePointsFireBadge;

import React from "react";
import { Box, Badge, IconButton, Typography } from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import SettingsIcon from "@mui/icons-material/Settings";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Header, Toolbar, PageTools } from "./styled";
import { COLORS } from "./constants";
import type { LastMarkUndoSnapshot } from "./types";
import { useWorkPoints } from "../../hooks/useWorkPoints";

interface FlashcardsLearnHeaderProps {
    selectedCategory: string | null;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    workPoints: ReturnType<typeof useWorkPoints>;
}

const FlashcardsLearnHeader: React.FC<FlashcardsLearnHeaderProps> = ({
    selectedCategory,
    lastMarkUndoSnapshot,
    isAnimating,
    isUndoing,
    onBack,
    onUndo,
    workPoints,
}) => {
    return (
        <Header className="mobile-demo-header">
            <Toolbar className="mobile-demo-toolbar">
                <IconButton
                    className="mobile-demo-back-button"
                    size="small"
                    sx={{ color: COLORS.onSurface }}
                    onClick={onBack}
                >
                    <ExpandMoreIcon />
                </IconButton>
                <Typography
                    className="mobile-demo-page-title"
                    sx={{
                        fontSize: 16,
                        fontWeight: 400,
                        color: COLORS.onSurface,
                        textAlign: "left",
                    }}
                >
                    {selectedCategory ? `Learn: ${selectedCategory}` : 'Learn'}
                </Typography>
                <PageTools className="mobile-demo-page-tools">
                    <IconButton
                        className="mobile-demo-tool-button"
                        size="small"
                        sx={{ color: COLORS.onSurface }}
                        onClick={onUndo}
                        disabled={!lastMarkUndoSnapshot || isAnimating || isUndoing}
                    >
                        <UndoIcon />
                    </IconButton>
                    <IconButton className="mobile-demo-tool-button" size="small" sx={{ color: COLORS.onSurface }}>
                        <SettingsIcon />
                    </IconButton>
                    {/* Work Points Fire Icon with Seconds Counter */}
                    <Box className="mobile-demo-work-points" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                        <Badge
                            className="mobile-demo-work-points-badge"
                            badgeContent={workPoints.currentPoints}
                            color="primary"
                            max={99}
                            sx={{
                                '& .MuiBadge-badge': {
                                    fontSize: '0.625rem',
                                    fontWeight: 'bold',
                                    minWidth: '16px',
                                    height: '16px',
                                    padding: '0 4px',
                                    backgroundColor: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                                    color: 'white',
                                    border: `1px solid ${COLORS.header}`,
                                }
                            }}
                        >
                            <IconButton
                                className="mobile-demo-tool-button work-points-fire-icon"
                                size="small"
                                sx={{
                                    padding: '4px',
                                }}
                            >
                                <LocalFireDepartmentIcon
                                    className="mobile-demo-fire-icon"
                                    sx={{
                                        color: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                                        fontSize: '1.25rem',
                                        filter: workPoints.isActive ? 'drop-shadow(0 0 4px rgba(230, 81, 0, 0.6))' : 'none',
                                        animation: workPoints.isAnimating ? 'pulse 0.6s ease-out' : 'none',
                                        '@keyframes pulse': {
                                            '0%, 100%': { transform: 'scale(1)' },
                                            '50%': { transform: 'scale(1.2)', filter: 'drop-shadow(0 0 8px rgba(230, 81, 0, 0.8))' },
                                        },
                                    }}
                                />
                            </IconButton>
                        </Badge>
                        {/* Seconds counter — driven by hook's live 1s timer */}
                        <Typography
                            className="mobile-demo-seconds-counter"
                            sx={{
                                fontSize: '0.625rem',
                                fontWeight: 'bold',
                                color: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                                lineHeight: 1,
                                marginTop: '-2px',
                            }}
                        >
                            {workPoints.liveSeconds}s
                        </Typography>
                    </Box>
                </PageTools>
            </Toolbar>
        </Header>
    );
};

export default FlashcardsLearnHeader;

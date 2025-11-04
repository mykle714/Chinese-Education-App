import React, { useEffect } from 'react';
import {
    Badge,
    Box,
    CircularProgress,
    useTheme,
    useMediaQuery,
    keyframes
} from '@mui/material';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';

interface WorkPointsBadgeProps {
    points: number;
    isActive: boolean;
    isAnimating: boolean;
    progressToNextPoint: number; // 0-100 percentage
}

// Animation keyframes
const pointEarnedAnimation = keyframes`
  0% { 
    transform: scale(1); 
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  50% { 
    transform: scale(1.15); 
    box-shadow: 0 4px 20px rgba(255, 152, 0, 0.6);
  }
  100% { 
    transform: scale(1); 
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
`;

const breathingAnimation = keyframes`
  0%, 100% { 
    opacity: 1;
    transform: scale(1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  50% { 
    opacity: 0.85;
    transform: scale(1.05);
    box-shadow: 0 4px 16px rgba(255, 152, 0, 0.4);
  }
`;

const activeGlowAnimation = keyframes`
  0%, 100% { 
    box-shadow: 0 0 10px rgba(255, 152, 0, 0.3);
  }
  50% { 
    box-shadow: 0 0 20px rgba(255, 152, 0, 0.6);
  }
`;

export const WorkPointsBadge: React.FC<WorkPointsBadgeProps> = ({
    points,
    isActive,
    isAnimating,
    progressToNextPoint
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    // Debug: Log isActive prop changes
    useEffect(() => {
        console.log('[WORK-POINTS-BADGE-DEBUG] isActive prop:', isActive, {
            timestamp: new Date().toISOString()
        });
    }, [isActive]);

    // Always show the badge to display work points, including 0
    // This helps users understand the work points system even when starting

    return (
        <Box
            sx={{
                position: 'fixed',
                top: isMobile ? 12 : 16,
                right: isMobile ? 12 : 16,
                zIndex: 1100,
                // Ensure it doesn't interfere with other UI elements
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            {/* Circular progress ring around the badge */}
            <Box
                sx={{
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <CircularProgress
                    variant="determinate"
                    value={progressToNextPoint}
                    size={isMobile ? 56 : 64}
                    thickness={3}
                    sx={{
                        position: 'absolute',
                        color: isActive
                            ? theme.palette.primary.main
                            : theme.palette.grey[400],
                        opacity: isActive ? 0.8 : 0.4,
                        // Only transition color, opacity, and filter - NOT the progress value itself
                        transition: 'color 0.3s ease-in-out, opacity 0.3s ease-in-out, filter 0.3s ease-in-out',
                        // Add glow effect when active
                        filter: isActive
                            ? 'drop-shadow(0 0 8px rgba(255, 152, 0, 0.5))'
                            : 'none',
                        // Disable MUI's default progress transition for smooth real-time animation
                        '& .MuiCircularProgress-circle': {
                            transition: 'none !important',
                        }
                    }}
                />
                {/* Background circle for better contrast */}
                <CircularProgress
                    variant="determinate"
                    value={100}
                    size={isMobile ? 56 : 64}
                    thickness={3}
                    sx={{
                        position: 'absolute',
                        color: theme.palette.grey[200],
                        opacity: 0.3,
                    }}
                />
                <Badge
                    badgeContent={points}
                    color="primary"
                    max={999}
                    sx={{
                        '& .MuiBadge-badge': {
                            fontSize: isMobile ? '0.75rem' : '0.875rem',
                            fontWeight: 'bold',
                            minWidth: isMobile ? '20px' : '24px',
                            height: isMobile ? '20px' : '24px',
                            borderRadius: '50%',
                            // Animation for point earning
                            animation: isAnimating ? `${pointEarnedAnimation} 0.6s ease-out` : 'none',
                            // Enhanced styling
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            border: '2px solid white',
                            // Dynamic colors based on activity
                            backgroundColor: isActive
                                ? theme.palette.primary.main
                                : theme.palette.grey[500],
                            color: 'white',
                        }
                    }}
                >
                    <Box
                        sx={{
                            width: isMobile ? 40 : 48,
                            height: isMobile ? 40 : 48,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '50%',
                            backgroundColor: isActive
                                ? theme.palette.primary.main
                                : theme.palette.grey[300],
                            // Breathing animation when active
                            animation: isActive ? `${breathingAnimation} 2s ease-in-out infinite` : 'none',
                            // Enhanced styling with pronounced active state
                            boxShadow: isActive
                                ? '0 4px 16px rgba(255, 152, 0, 0.3)'
                                : '0 2px 8px rgba(0,0,0,0.1)',
                            border: '2px solid white',
                            // Additional glow effect when active
                            '&::before': isActive ? {
                                content: '""',
                                position: 'absolute',
                                top: '-2px',
                                left: '-2px',
                                right: '-2px',
                                bottom: '-2px',
                                borderRadius: 'inherit',
                                background: 'linear-gradient(45deg, #ff9800, #ff5722)',
                                zIndex: -1,
                                animation: `${activeGlowAnimation} 2s ease-in-out infinite`,
                            } : {},
                            // Transition for smooth state changes
                            transition: 'all 0.3s ease-in-out',
                        }}
                    >
                        <LocalFireDepartmentIcon
                            sx={{
                                fontSize: isMobile ? '1.5rem' : '1.8rem',
                                color: isActive ? 'white' : theme.palette.grey[600]
                            }}
                        />
                    </Box>
                </Badge>
            </Box>
        </Box>
    );
};

export default WorkPointsBadge;

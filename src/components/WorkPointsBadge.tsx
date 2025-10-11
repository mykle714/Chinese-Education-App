import React from 'react';
import {
    Badge,
    Chip,
    Box,
    useTheme,
    useMediaQuery,
    keyframes
} from '@mui/material';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';

interface WorkPointsBadgeProps {
    points: number;
    isActive: boolean;
    isAnimating: boolean;
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
    isAnimating
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

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
            }}
        >
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
                <Chip
                    icon={<LocalFireDepartmentIcon />}
                    label="Work"
                    color={isActive ? "primary" : "default"}
                    size={isMobile ? "small" : "medium"}
                    sx={{
                        fontWeight: 'bold',
                        // Breathing animation when active
                        animation: isActive ? `${breathingAnimation} 2s ease-in-out infinite` : 'none',
                        // Enhanced styling with pronounced active state
                        boxShadow: isActive
                            ? '0 4px 16px rgba(255, 152, 0, 0.3)'
                            : '0 2px 8px rgba(0,0,0,0.1)',
                        border: '2px solid',
                        borderColor: isActive
                            ? '#ff9800' // Bright orange for active state
                            : theme.palette.grey[300],
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
                        // Icon styling
                        '& .MuiChip-icon': {
                            color: isActive ? 'inherit' : theme.palette.grey[600],
                            fontSize: isMobile ? '1rem' : '1.2rem',
                        },
                        // Label styling
                        '& .MuiChip-label': {
                            fontSize: isMobile ? '0.75rem' : '0.875rem',
                            fontWeight: 'bold',
                        },
                        // Hover effect (even though pointer events are disabled, this provides visual feedback)
                        '&:hover': {
                            transform: 'translateY(-1px)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        },
                        // Transition for smooth state changes
                        transition: 'all 0.3s ease-in-out',
                    }}
                />
            </Badge>

        </Box>
    );
};

export default WorkPointsBadge;

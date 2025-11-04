import { Box, Typography } from '@mui/material';
import MarketViewer from '../components/MarketViewer';
import { useWorkPoints } from '../hooks/useWorkPoints';

function MarketViewerPage() {
    // Single spacing variable for easy adjustment
    const GRID_SPACING = 500;

    // Progressive unlocking: 1 stand per hour of study (60 points = 1 hour)
    const POINTS_PER_STAND = 60;

    // Get user's total study time (accumulated work points + today's partial progress)
    const { totalStudyTimeMinutes } = useWorkPoints();

    // Calculate how many stands to unlock (max 9)
    const unlockedStandCount = Math.min(
        Math.floor(totalStudyTimeMinutes / POINTS_PER_STAND),
        9
    );

    // Helper function to calculate isometric position
    const getIsometricPosition = (row: number, col: number) => ({
        x: (col - row) * GRID_SPACING,
        y: (col + row) * (GRID_SPACING / 2)  // Half spacing for isometric 2:1 ratio
    });

    // All stand filenames (9 stands in 3x3 grid)
    const allStandImages = [
        'openart-0661d2d3-67b1-4b61-8fe6-72bb83a866cd.png',
        'openart-0701d8fb-af1d-4206-a2df-9e30c5d645e9.png',
        'openart-47136d64-93b9-4ae1-b52b-ca61e464a434.png',
        'openart-a7309c8b-c58b-4204-81a0-73a1475d9eaf.png',
        'openart-c964a14b-3095-492a-83af-ac6b71300735.png',
        'openart-d1f151e1-623b-49e1-910a-250aa038cf5a.png',
        'openart-dcbe097a-02dc-427a-88aa-c9e78983e649.png',
        'openart-de23bbc8-8256-4a1d-9f15-ab08c8b064a7.png',
        'openart-ecc2e7c9-bec0-40d6-9689-f73afb05cd0f.png'
    ];

    // Filter to show only unlocked stands based on study time
    const standImages = allStandImages.slice(0, unlockedStandCount);

    // Debug logging
    console.log('[Night Market] totalStudyTimeMinutes:', totalStudyTimeMinutes);
    console.log('[Night Market] unlockedStandCount:', unlockedStandCount);
    console.log('[Night Market] standImages.length:', standImages.length);

    // Generate layers with calculated positions
    const layers = [
        // Background layer (always present to prevent "no layers" error)
        {
            imagePath: '/assets/night-market/dirt-background.png',
            x: 0,
            y: 0,
            zIndex: 0,
            scale: 1.0
        },
        // Stand layers (3x3 grid in isometric view)
        ...standImages.map((filename, index) => {
            const row = Math.floor(index / 3);  // 0, 1, or 2
            const col = index % 3;              // 0, 1, or 2
            const pos = getIsometricPosition(row, col);

            return {
                imagePath: `/assets/night-market/${filename}`,
                x: pos.x,
                y: pos.y,
                zIndex: row + 1,  // Back row = zIndex 1, front row = zIndex 3
                scale: 1.0
            };
        })
    ];

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                height: 'calc(100vh - 64px)', // Full viewport height minus app bar
                overflow: 'hidden',
                position: 'relative'
            }}
        >
            {/* Page Title - overlay style */}
            <Box
                sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)',
                    p: 2
                }}
            >
                <Typography
                    variant="h4"
                    component="h1"
                    sx={{
                        color: 'white',
                        fontWeight: 'bold',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                    }}
                >
                    Night Market
                </Typography>
            </Box>

            {/* Canvas Viewer - fills remaining space */}
            <Box
                sx={{
                    flexGrow: 1,
                    width: '100%',
                    height: '100%',
                    position: 'relative'
                }}
            >
                <MarketViewer layers={layers} />
            </Box>
        </Box>
    );
}

export default MarketViewerPage;

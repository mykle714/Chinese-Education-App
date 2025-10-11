import React from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Divider,
    useMediaQuery,
    useTheme
} from '@mui/material';
import type { VocabEntry, HskLevel } from '../types';

interface VocabDisplayCardProps {
    entry: VocabEntry | null;
}

// Helper function to get HSK level number
const getHskNumber = (hskLevel: HskLevel) => {
    switch (hskLevel) {
        case 'HSK1': return '1';
        case 'HSK2': return '2';
        case 'HSK3': return '3';
        case 'HSK4': return '4';
        case 'HSK5': return '5';
        case 'HSK6': return '6';
        default: return '1';
    }
};

// Helper function to render tag badges
const renderTags = (entry: VocabEntry) => (
    <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 0.5 }}>
        {entry.hskLevelTag && (
            <Box
                sx={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: 'secondary.main',
                    color: 'secondary.contrastText',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold'
                }}
            >
                {getHskNumber(entry.hskLevelTag)}
            </Box>
        )}
    </Box>
);

const VocabDisplayCard: React.FC<VocabDisplayCardProps> = React.memo(({ entry }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    return (
        <Box
            sx={{
                width: isMobile ? '100%' : 320,
                mb: isMobile ? 2 : 0,
            }}
        >
            <Card
                sx={{
                    position: 'relative',
                    boxShadow: entry ? 6 : 2,
                    border: entry
                        ? `2px solid ${theme.palette.primary.main}`
                        : `1px solid ${theme.palette.divider}`,
                    backgroundColor: theme.palette.background.paper,
                    opacity: entry ? 1 : 0.6,
                    ...(isMobile ? {
                        // Mobile styling
                        borderRadius: 0,
                        borderTop: 'none',
                        borderLeft: 'none',
                        borderRight: 'none',
                    } : {
                        // Desktop styling
                        borderRadius: 2,
                    }),
                }}
            >
                {entry && renderTags(entry)}
                <CardContent sx={{ pb: 2 }}>
                    {entry ? (
                        // Show vocabulary entry content
                        <>
                            <Typography
                                variant={isMobile ? "h5" : "h6"}
                                component="h3"
                                gutterBottom
                                sx={{
                                    fontWeight: 'bold',
                                    pr: entry.hskLevelTag ? 6 : 0, // Space for tags
                                    fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                                }}
                            >
                                {entry.entryKey}
                            </Typography>

                            <Divider sx={{ mb: 1.5 }} />

                            <Typography
                                variant="body1"
                                color="text.secondary"
                                sx={{
                                    mb: entry.createdAt ? 1.5 : 0,
                                    lineHeight: 1.6,
                                }}
                            >
                                {entry.entryValue}
                            </Typography>

                            {entry.createdAt && (
                                <>
                                    <Divider sx={{ mb: 1 }} />
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{
                                            display: 'block',
                                            textAlign: 'right',
                                        }}
                                    >
                                        Added: {new Date(entry.createdAt).toLocaleDateString()}
                                    </Typography>
                                </>
                            )}
                        </>
                    ) : (
                        // Show empty placeholder content
                        <>
                            <Typography
                                variant={isMobile ? "h5" : "h6"}
                                component="h3"
                                gutterBottom
                                sx={{
                                    fontWeight: 'bold',
                                    color: 'text.disabled',
                                    fontStyle: 'italic',
                                }}
                            >
                                No vocabulary entry found
                            </Typography>

                            <Divider sx={{ mb: 1.5 }} />

                            <Typography
                                variant="body2"
                                color="text.disabled"
                                sx={{
                                    lineHeight: 1.6,
                                    fontStyle: 'italic',
                                }}
                            >
                                Select text to search for matching vocabulary entries in your collection.
                            </Typography>
                        </>
                    )}
                </CardContent>
            </Card>
        </Box>
    );
}, (prevProps, nextProps) => {
    // Custom comparison function for better memoization
    // Only re-render if the entry actually changed
    if (prevProps.entry === null && nextProps.entry === null) {
        return true; // Both null, no re-render needed
    }

    if (prevProps.entry === null || nextProps.entry === null) {
        return false; // One is null, other isn't - re-render needed
    }

    // Both entries exist, compare their key properties
    return (
        prevProps.entry.id === nextProps.entry.id &&
        prevProps.entry.entryKey === nextProps.entry.entryKey &&
        prevProps.entry.entryValue === nextProps.entry.entryValue &&
        prevProps.entry.hskLevelTag === nextProps.entry.hskLevelTag
    );
});

VocabDisplayCard.displayName = 'VocabDisplayCard';

export default VocabDisplayCard;

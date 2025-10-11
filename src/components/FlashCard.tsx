import React from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Divider,
    Chip,
} from '@mui/material';

// HSK Level type
type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

interface VocabEntry {
    id: number;
    entryKey: string;
    entryValue: string;
    hskLevelTag?: HskLevel | null;
    createdAt: string;
}

interface FlashCardProps {
    entry: VocabEntry;
    displayEntry: VocabEntry;
    isFlipped: boolean;
    onFlip: () => void;
    entryKey: string;
    entryValue: string;
    isFlippable?: boolean; // New prop to control whether the card can be flipped
}


// Helper function to render tag badges
const renderTags = (entry: VocabEntry) => (
    <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 0.5, zIndex: 10 }}>
        {entry.hskLevelTag && (
            <Chip
                label={entry.hskLevelTag}
                size="small"
                sx={{
                    backgroundColor: '#2196f3',
                    color: 'white',
                    fontSize: '0.7rem',
                    height: '20px'
                }}
            />
        )}
    </Box>
);

const FlashCard: React.FC<FlashCardProps> = ({
    entry,
    displayEntry,
    isFlipped,
    onFlip,
    entryKey,
    entryValue,
    isFlippable = true // Default to true for backwards compatibility
}) => {
    // Content is now updated immediately when props change
    // Timing control is handled by the parent component (FlashcardsPage)

    return (
        <Box
            className="flashcard-container"
            sx={{
                width: "100%",
                maxWidth: 500,
                height: 300,
                perspective: "1000px !important",
                cursor: isFlippable ? "pointer" : "default",
            }}
            onClick={isFlippable ? onFlip : undefined}
        >
            {/* Card Wrapper - This rotates in 3D space */}
            <Box
                className={`flashcard-wrapper ${isFlipped ? 'flipped' : 'not-flipped'}`}
                sx={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    transformStyle: "preserve-3d !important",
                    transition: "transform 0.6s ease-in-out !important",
                    transform: isFlipped ? "rotateY(180deg) !important" : "rotateY(0deg) !important",
                    transformOrigin: "center center !important",
                }}
            >
                {/* Front Face */}
                <Card
                    className="flashcard-front"
                    sx={{
                        position: "absolute",
                        width: "100%",
                        height: "100%",
                        backfaceVisibility: "hidden !important",
                        transform: "rotateY(0deg) !important",
                        transformOrigin: "center center !important",
                        transition: "transform 0.6s ease-in-out, box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1) !important",
                        borderRadius: 2,
                        boxShadow: 3,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "visible !important",
                        '&:hover': {
                            boxShadow: 6,
                        }
                    }}
                >
                    {/* Tags for front face */}
                    {renderTags(entry)}

                    <CardContent
                        className="flashcard-front-content"
                        sx={{
                            flexGrow: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                            p: 3,
                            textAlign: 'center'
                        }}
                    >
                        <Typography
                            variant="h4"
                            component="h2"
                            gutterBottom
                            sx={{
                                fontWeight: 'bold',
                                color: 'primary.main',
                                mb: 3
                            }}
                        >
                            {entryKey}
                        </Typography>
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                                opacity: 0.7,
                                mt: 'auto'
                            }}
                        >
                            (Click card to see the definition)
                        </Typography>
                    </CardContent>
                </Card>

                {/* Back Face */}
                <Card
                    className="flashcard-back"
                    sx={{
                        position: "absolute",
                        width: "100%",
                        height: "100%",
                        backfaceVisibility: "hidden !important",
                        transform: "rotateY(180deg) !important",
                        transformOrigin: "center center !important",
                        transition: "transform 0.6s ease-in-out, box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1) !important",
                        borderRadius: 2,
                        boxShadow: 3,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "visible !important",
                        backgroundColor: "background.paper",
                        '&:hover': {
                            boxShadow: 6,
                        }
                    }}
                >
                    {/* Tags for back face - use displayEntry for delayed content */}
                    {renderTags(displayEntry)}

                    <CardContent
                        className="flashcard-back-content"
                        sx={{
                            flexGrow: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            p: 3,
                        }}
                    >
                        <Typography variant="h5" component="h2" gutterBottom sx={{ fontWeight: 'bold' }}>
                            {displayEntry.entryKey}
                        </Typography>
                        <Divider sx={{ mb: 2 }} />
                        <Typography
                            variant="body1"
                            color="text.secondary"
                            sx={{
                                flexGrow: 1,
                                mb: 2,
                                fontSize: '1.1rem',
                                lineHeight: 1.6
                            }}
                        >
                            {entryValue}
                        </Typography>
                        {displayEntry.createdAt && (
                            <>
                                <Divider sx={{ mt: 'auto' }} />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                                    Added: {new Date(displayEntry.createdAt).toLocaleDateString()}
                                </Typography>
                            </>
                        )}
                    </CardContent>
                </Card>
            </Box>
        </Box>
    );
};

export default FlashCard;

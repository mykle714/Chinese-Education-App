import { Box, Typography, Chip, IconButton } from "@mui/material";
import { stripParentheses } from "../utils/definitionUtils";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RepeatIcon from "@mui/icons-material/Repeat";
import type { VocabEntry } from "../types";

interface MiniVocabCardProps {
    entry: VocabEntry;
    onClick?: (entry: VocabEntry) => void;
    onDelete?: (entry: VocabEntry) => void;
    onCycle?: (entry: VocabEntry) => void;
}

// Design tokens
const COLORS = {
    cardBackground: "#D8D8DC",
    onSurface: "#1C1C1E",
    textSecondary: "#5C5C66",
    // Category colors matching the deck colors
    categoryUnfamiliar: "#EF476F",
    categoryTarget: "#FF8E47",
    categoryComfortable: "#05C793",
    categoryMastered: "#779BE7",
};


// Helper function to get category color
const getCategoryColor = (category?: string) => {
    switch (category) {
        case 'Unfamiliar':
            return COLORS.categoryUnfamiliar;
        case 'Target':
            return COLORS.categoryTarget;
        case 'Comfortable':
            return COLORS.categoryComfortable;
        case 'Mastered':
            return COLORS.categoryMastered;
        default:
            return COLORS.textSecondary;
    }
};

const MiniVocabCard: React.FC<MiniVocabCardProps> = ({ entry, onClick, onDelete, onCycle }) => {
    return (
        <Box
            className="mini-vocab-card"
            onClick={() => onClick?.(entry)}
            sx={{
                width: 92,
                height: 132,
                backgroundColor: COLORS.cardBackground,
                borderRadius: '8px',
                boxShadow: '2px 4px 4px rgba(0, 0, 0, 0.25)',
                cursor: onClick ? 'pointer' : 'default',
                transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                display: 'flex',
                flexDirection: 'column',
                padding: '8px',
                position: 'relative',
                overflow: 'hidden',
                '&:hover': {
                    ...(onClick ? {
                        transform: 'translateY(-4px)',
                        boxShadow: '2px 6px 8px rgba(0, 0, 0, 0.3)',
                    } : {}),
                    '& .action-buttons': {
                        opacity: 1,
                    },
                },
            }}
        >
            {/* Action Buttons - Top Corners */}
            <Box
                className="action-buttons"
                sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px',
                    opacity: 0,
                    transition: 'opacity 0.2s ease-in-out',
                    zIndex: 2,
                }}
            >
                {/* Cycle Button - Top Left */}
                {onCycle && (
                    <IconButton
                        className="mini-vocab-card__cycle-button"
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCycle(entry);
                        }}
                        sx={{
                            backgroundColor: '#2196f3',
                            color: 'white',
                            width: 28,
                            height: 28,
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                            '&:hover': {
                                backgroundColor: '#1976d2',
                                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                            },
                        }}
                    >
                        <RepeatIcon className="mini-vocab-card__cycle-icon" sx={{ fontSize: 18, color: 'white' }} />
                    </IconButton>
                )}

                {/* Delete Button - Top Right */}
                {onDelete && (
                    <IconButton
                        className="mini-vocab-card__delete-button"
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(entry);
                        }}
                        sx={{
                            backgroundColor: '#ef5350',
                            color: 'white',
                            width: 28,
                            height: 28,
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                            '&:hover': {
                                backgroundColor: '#d32f2f',
                                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                            },
                        }}
                    >
                        <DeleteOutlineIcon className="mini-vocab-card__delete-icon" sx={{ fontSize: 18, color: 'white' }} />
                    </IconButton>
                )}
            </Box>
            {/* Category Badge - top left */}
            {entry.category && (
                <Box
                    className="mini-vocab-card__category-wrapper"
                    sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        zIndex: 1,
                    }}
                >
                    <Chip
                        className="mini-vocab-card__category-chip"
                        label={entry.category}
                        size="small"
                        sx={{
                            backgroundColor: getCategoryColor(entry.category),
                            color: 'white',
                            fontSize: '0.65rem',
                            height: '20px',
                            fontWeight: 'bold',
                            '& .MuiChip-label': {
                                padding: '0 6px',
                            },
                        }}
                    />
                </Box>
            )}

            {/* Entry Key (Word/Character) */}
            <Box
                className="mini-vocab-card__key-wrapper"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexGrow: 1,
                    minHeight: 48,
                    mt: 1.5, // shift down so the category chip doesn't cover the word
                    mb: 0.5,
                    width: '100%',
                    minWidth: 0,
                }}
            >
                <Typography
                    className="mini-vocab-card__entry-key"
                    sx={{
                        // Shrink one step when the word is long; CSS handles ellipsis beyond that
                        // ≤3 chars: full size; 4+ chars: reduced so 4 chars fit (76px) but 5 don't
                        fontSize: entry.entryKey.length > 3 ? '0.9375rem' : '1.25rem',
                        fontWeight: 'bold',
                        color: COLORS.onSurface,
                        textAlign: 'center',
                        lineHeight: 1.2,
                        width: '100%',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {entry.entryKey}
                </Typography>
            </Box>

            {/* Pronunciation (if available) — font size steps down so full pinyin fits the ~76px card width */}
            {entry.pronunciation && (
                <Typography
                    className="mini-vocab-card__pronunciation"
                    sx={{
                        fontSize:
                            entry.pronunciation.length <= 12 ? '0.625rem'
                            : entry.pronunciation.length <= 16 ? '0.56rem'
                            : entry.pronunciation.length <= 22 ? '0.48rem'
                            : '0.42rem',
                        color: COLORS.textSecondary,
                        textAlign: 'center',
                        mb: 0.5,
                        fontStyle: 'italic',
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        width: '100%',
                    }}
                >
                    {entry.pronunciation}
                </Typography>
            )}

            {/* Entry Value (Definition) */}
            <Typography
                className="mini-vocab-card__entry-value"
                sx={{
                    fontSize: '0.75rem',
                    color: COLORS.textSecondary,
                    textAlign: 'center',
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    minHeight: 24,
                }}
            >
                {stripParentheses(entry.definition ?? '')}
            </Typography>
        </Box>
    );
};

export default MiniVocabCard;

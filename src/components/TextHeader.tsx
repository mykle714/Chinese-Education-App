import { Box, Typography, Chip, CircularProgress } from "@mui/material";
import type { VocabEntry } from "../types";

// Text interface for TypeScript
interface Text {
    id: string;
    title: string;
    description: string;
    content: string;
    createdAt: string;
    characterCount: number;
}

interface TextHeaderProps {
    selectedText: Text;
    processingVocab: boolean;
    loadedCards: VocabEntry[];
    vocabError: string | null;
    formatDate: (dateString: string) => string;
}

function TextHeader({
    selectedText,
    processingVocab,
    loadedCards,
    vocabError,
    formatDate
}: TextHeaderProps) {
    return (
        <Box
            className="reader-page-text-header"
            sx={{ mb: 3, pb: 2, borderBottom: '1px solid rgba(0, 0, 0, 0.08)' }}
        >
            <Typography
                className="reader-page-text-title"
                variant="h4"
                component="h1"
                sx={{ mb: 1, fontWeight: 'bold' }}
            >
                {selectedText.title}
            </Typography>
            <Typography
                className="reader-page-text-description"
                variant="body1"
                color="text.secondary"
                sx={{ mb: 2 }}
            >
                {selectedText.description}
            </Typography>
            <Box
                className="reader-page-text-meta"
                sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
            >
                <Chip
                    className="reader-page-text-char-count-chip"
                    label={`${selectedText.characterCount} chars`}
                    size="small"
                    color="primary"
                    variant="outlined"
                />
                <Typography
                    className="reader-page-text-date"
                    variant="body2"
                    color="text.secondary"
                >
                    {formatDate(selectedText.createdAt)}
                </Typography>

                {/* Vocabulary processing status */}
                {processingVocab && (
                    <Chip
                        className="reader-page-vocab-processing-chip"
                        icon={<CircularProgress className="reader-page-vocab-processing-spinner" size={12} />}
                        label="Processing vocabulary..."
                        size="small"
                        color="info"
                        variant="outlined"
                    />
                )}

                {!processingVocab && loadedCards.length > 0 && (
                    <Chip
                        className="reader-page-vocab-loaded-chip"
                        label={`${loadedCards.length} vocab entries loaded`}
                        size="small"
                        color="success"
                        variant="outlined"
                    />
                )}

                {vocabError && (
                    <Chip
                        className="reader-page-vocab-error-chip"
                        label="Vocab processing failed"
                        size="small"
                        color="error"
                        variant="outlined"
                    />
                )}
            </Box>
        </Box>
    );
}

export default TextHeader;

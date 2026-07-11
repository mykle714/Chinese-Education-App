import { Box, Typography, Chip, CircularProgress } from "@mui/material";
import { WEIGHT } from '../../theme/scale';
import type { Text } from "../../types";

interface TextHeaderProps {
    selectedText: Text;
    processingVocab: boolean;
    vocabError: string | null;
    formatDate: (dateString: string) => string;
    // No back/edit/delete handlers here: back lives in the ReaderDocumentSurface
    // header's left arrow, and Edit/Delete — plus the validation Approve/Flag
    // actions — are icon buttons in that same header's right slot
    // (docs/LEAF_NODE_PAGES.md) — see ReaderDocumentPage's docHeaderRightContent.
}

function TextHeader({
    selectedText,
    processingVocab,
    vocabError,
    formatDate,
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
                sx={{ mb: 1, fontWeight: WEIGHT.bold }}
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
                sx={{
                    display: 'flex',
                    gap: 2,
                    alignItems: 'center',
                    flexWrap: 'nowrap',
                    overflowX: 'auto',
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                }}
            >
                <Chip
                    className="reader-page-text-char-count-chip"
                    label={`${selectedText.characterCount} chars`}
                    size="small"
                    color="primary"
                    variant="outlined"
                    sx={{ flexShrink: 0 }}
                />
                <Typography
                    className="reader-page-text-date"
                    variant="body2"
                    color="text.secondary"
                    sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
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
                        sx={{ flexShrink: 0 }}
                    />
                )}

                {vocabError && (
                    <Chip
                        className="reader-page-vocab-error-chip"
                        label="Vocab processing failed"
                        size="small"
                        color="error"
                        variant="outlined"
                        sx={{ flexShrink: 0 }}
                    />
                )}
            </Box>
        </Box>
    );
}

export default TextHeader;

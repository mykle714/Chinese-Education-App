import { Box, Typography, Chip, CircularProgress } from "@mui/material";
import { WEIGHT } from '../../theme/scale';
import type { Text } from "../../types";
import { COLORS } from "../../theme/colors";

// The open document's title block (ReaderDocumentPage). Shows only the title plus
// the transient vocabulary-processing status chips — the character count and
// creation date were removed from the Reader UI on 2026-11-05 (the `characterCount`
// / `createdAt` fields still come over the wire).
// Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Frontend.

interface TextHeaderProps {
    selectedText: Text;
    processingVocab: boolean;
    vocabError: string | null;
    // No back/edit/delete handlers here: back lives in the ReaderDocumentSurface
    // header's left arrow, and Edit/Delete are icon buttons in that same header's
    // right slot (docs/LEAF_NODE_PAGES.md) — see ReaderDocumentPage's
    // docHeaderRightContent.
}

function TextHeader({
    selectedText,
    processingVocab,
    vocabError,
}: TextHeaderProps) {
    const showStatus = processingVocab || !!vocabError;
    return (
        <Box
            className="reader-page-text-header"
            sx={{ mb: 3, pb: 2, borderBottom: `1px solid ${COLORS.rowBorder}` }}
        >
            <Typography
                className="reader-page-text-title"
                variant="h4"
                component="h1"
                sx={{ fontWeight: WEIGHT.bold }}
            >
                {selectedText.title}
            </Typography>

            {/* Vocabulary processing status — the row only exists while there is
            something to report, so an idle header is just the title. */}
            {showStatus && (
                <Box
                    className="reader-page-text-status"
                    sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mt: 2 }}
                >
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
            )}
        </Box>
    );
}

export default TextHeader;

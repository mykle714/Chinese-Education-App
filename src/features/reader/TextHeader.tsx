import { Box, CircularProgress } from "@mui/material";
import { LEADING, SIZE, WEIGHT } from '../../theme/scale';
import { FONTS } from "../../theme/fonts";
import { COLORS } from "../../theme/colors";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

// The open document's vocabulary-processing status (ReaderDocumentPage), shown above the
// dictionary keycap while there is something to report — nothing at all when idle.
//
// The document TITLE no longer lives here: since 2026-11-17 it is the page header's title
// (ReaderDocumentSurface `title`), so this file is now status-only despite its name.
//
// Flat look (readerStyles.ts): small pastel pills (mid-tier fill, ink text, hairline)
// instead of MUI's outlined info/error Chips.
// Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Frontend.

interface TextHeaderProps {
    // The page's time-of-day look (ReaderDocumentPage → useTier2Look) — the pills' hairline.
    look: Tier2Look;
    processingVocab: boolean;
    vocabError: string | null;
}

/** One status pill: a ramp MID fill with ink text (a pastel by day and night). Not
 *  tappable, so the quiet `line` hairline rather than the button outline. */
const statusPillSx = (fill: string, look: Tier2Look) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    px: 1.25,
    py: 0.375,
    borderRadius: "999px",
    backgroundColor: fill,
    border: `1px solid ${look.line}`,
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    lineHeight: LEADING.tight,
    color: COLORS.onSurface,
}) as const;

function TextHeader({ look, processingVocab, vocabError }: TextHeaderProps) {
    if (!processingVocab && !vocabError) return null;
    return (
        <Box
            className="reader-page-text-status"
            sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', pb: 1.5 }}
        >
            {processingVocab && (
                <Box component="span" className="reader-page-vocab-processing-chip" sx={statusPillSx(COLORS.bluM, look)}>
                    <CircularProgress
                        className="reader-page-vocab-processing-spinner"
                        size={10}
                        thickness={6}
                        sx={{ color: COLORS.onSurface }}
                    />
                    Processing vocabulary…
                </Box>
            )}

            {vocabError && (
                <Box component="span" className="reader-page-vocab-error-chip" sx={statusPillSx(COLORS.redM, look)}>
                    Vocab processing failed
                </Box>
            )}
        </Box>
    );
}

export default TextHeader;

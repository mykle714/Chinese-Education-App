import { Box, Alert } from "@mui/material";
import { styled } from "@mui/material/styles";
import MiniVocabCard from "./MiniVocabCard";
import DelayedCircularProgress from "./DelayedCircularProgress";
import { cardStaggerDelayMs } from "../utils/cardStagger";
import type { VocabEntry } from "../types";

// Fixed-width wrapping grid of MiniVocabCards. Shared by the /decks previews
// (Learn Now / Learn Later) and the dedicated /flashcards/mastered page so the
// loading / error / empty / list states stay identical across them.
const CardsPreviewContainer = styled(Box)(() => ({
    // 3 cards × 92px + 2 gaps × 16px + 2 sides × 28px padding = 364px
    width: 364,
    margin: "0 auto",
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    padding: 28,
    justifyContent: "flex-start",
}));

interface MiniVocabCardGridProps {
    // Entries to render once loaded.
    entries: VocabEntry[];
    // Render the spinner instead of cards while true.
    loading: boolean;
    // Render an error alert when set (takes precedence over the empty state).
    error?: string | null;
    // Message shown when there are no entries.
    emptyMessage: string;
    // Tap handler for an individual card (should be referentially stable so the
    // memoized cards don't all re-render — pass a useCallback).
    onCardClick: (entry: VocabEntry) => void;
    // Class on the grid container itself (e.g. "decks-cards-preview").
    containerClassName: string;
    // Prefix for the loading/error/empty element class names so each usage keeps
    // descriptive, distinct hooks (e.g. "flashcards-decks__library").
    classPrefix: string;
}

const MiniVocabCardGrid: React.FC<MiniVocabCardGridProps> = ({
    entries,
    loading,
    error,
    emptyMessage,
    onCardClick,
    containerClassName,
    classPrefix,
}) => (
    <CardsPreviewContainer className={containerClassName}>
        {loading ? (
            <Box
                className={`${classPrefix}-loading`}
                sx={{ display: "flex", justifyContent: "center", width: "100%", py: 4 }}
            >
                <DelayedCircularProgress className={`${classPrefix}-spinner`} />
            </Box>
        ) : error ? (
            <Box className={`${classPrefix}-error`} sx={{ width: "100%", px: 2 }}>
                <Alert className={`${classPrefix}-error-alert`} severity="error">
                    {error}
                </Alert>
            </Box>
        ) : entries.length === 0 ? (
            <Box className={`${classPrefix}-empty`} sx={{ width: "100%", px: 2 }}>
                <Alert className={`${classPrefix}-empty-alert`} severity="info">
                    {emptyMessage}
                </Alert>
            </Box>
        ) : (
            // Staggered pop-in for the first cards only (see cardStaggerDelayMs).
            entries.map((entry, index) => (
                <MiniVocabCard
                    key={entry.id}
                    entry={entry}
                    onClick={onCardClick}
                    animationDelayMs={cardStaggerDelayMs(index)}
                />
            ))
        )}
    </CardsPreviewContainer>
);

export default MiniVocabCardGrid;

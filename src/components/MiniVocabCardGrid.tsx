import { Box, Alert } from "@mui/material";
import { styled } from "@mui/material/styles";
import MiniVocabCard from "./MiniVocabCard";
import DelayedCircularProgress from "./DelayedCircularProgress";
import { useIncrementalList } from "../hooks/useIncrementalList";
import type { VocabEntry } from "../types";

// Fixed-width wrapping grid of MiniVocabCards. Shared by the /decks Learn Now
// preview and the dedicated /flashcards/mastered page so the loading / error /
// empty / list states stay identical across them.
const CardsPreviewContainer = styled(Box)(() => ({
    // 3 cards × 92px + 2 gaps × 16px + 2 sides × 28px padding = 364px
    width: 364,
    margin: "0 auto",
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    padding: 28,
    justifyContent: "flex-start",
    // Pack wrapped rows at the top so a reserved (taller-than-filled) height keeps
    // rows top-aligned instead of distributing them down the free space.
    alignContent: "flex-start",
}));

// Cards are revealed one row at a time (3 fit the 364px row), paced by a timer in
// useIncrementalList, which keeps each render small so the page's buttons stay
// pressable while a large deck fills in. The paced reveal also *is* the pop-in
// cascade: each row's cards pop together (delay 0) the moment they're revealed,
// and the timer gap makes successive rows read as a sequential waterfall. Every
// card animates, so there is no per-index delay cap and none sits invisible
// waiting its turn.
const REVEAL_BATCH = 3;

// Geometry used to reserve the grid's final height up front. Without this, each
// revealed row would grow the container and push everything below it (the next
// preview section, the Mastered link) downward — so lower cards would appear and
// then visibly shift down as the rows above them fill in. Reserving the full
// height lets cards pop into fixed top-to-bottom slots with no reflow of siblings.
const CARDS_PER_ROW = 3; // matches the 364px row width (and REVEAL_BATCH)
const CARD_HEIGHT_PX = 132; // MiniVocabCard fixed height
const ROW_GAP_PX = 16; // CardsPreviewContainer `gap`
const GRID_PADDING_PX = 28; // CardsPreviewContainer `padding`

const reservedGridHeight = (count: number): number => {
    const rows = Math.ceil(count / CARDS_PER_ROW);
    return GRID_PADDING_PX * 2 + rows * CARD_HEIGHT_PX + Math.max(rows - 1, 0) * ROW_GAP_PX;
};

interface MiniVocabCardGridProps {
    // Full list of entries to reveal once loaded. Must be referentially stable
    // (state set once from a fetch) so the reveal cascade isn't restarted every
    // render — see useIncrementalList.
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
}) => {
    // Progressively reveal the deck so a large list never mounts in one blocking
    // render (keeps taps on surrounding buttons responsive).
    const visibleEntries = useIncrementalList(entries, REVEAL_BATCH);

    // Reserve the final height while cards are being revealed so growing rows
    // don't push sibling sections below the grid downward (see reservedGridHeight).
    const showingCards = !loading && !error && entries.length > 0;

    return (
        <CardsPreviewContainer
            className={containerClassName}
            sx={showingCards ? { minHeight: reservedGridHeight(entries.length) } : undefined}
        >
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
                // Each card pops in on reveal (delay 0); the paced reveal between
                // rows produces the sequential cascade.
                visibleEntries.map((entry) => (
                    <MiniVocabCard
                        key={entry.id}
                        entry={entry}
                        onClick={onCardClick}
                        animationDelayMs={0}
                    />
                ))
            )}
        </CardsPreviewContainer>
    );
};

export default MiniVocabCardGrid;

import { type ReactNode } from "react";
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
// and the timer gap makes successive rows read as a sequential waterfall. Only
// the first CASCADE_LIMIT cards take part in this waterfall; the rest appear at
// once with no animation (see CASCADE_LIMIT below).
const REVEAL_BATCH = 3;

// Only the first N cards participate in the paced reveal / pop-in cascade; once
// they've animated in, every remaining card is revealed in a single commit and
// rendered with no entrance animation. This keeps the waterfall short and snappy
// for large decks (mastered can be hundreds of cards) instead of dragging the
// stagger out over the whole list.
const CASCADE_LIMIT = 15;

// Per-card delay (ms) between successive cards in `staggerReveal` mode. Applied as a
// CSS animation-delay so the first CASCADE_LIMIT cards fan in as one smooth stagger,
// with no paced remounting.
const STAGGER_STEP_MS = 35;

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
    // Optional custom card renderer. When omitted the grid draws the standard
    // MiniVocabCard; callers that need a different card (e.g. Quick Mark's 3-state
    // triage card) pass their own. Receives the same paced-reveal index so the
    // cascade delay stays consistent.
    renderCard?: (entry: VocabEntry, index: number, animationDelayMs?: number) => ReactNode;
    // Optional content rendered after the cards, inside the grid container (full-width
    // row). Used by paginating callers for a "load more" sentinel / spinner.
    footer?: ReactNode;
    // Reveal strategy for the entrance animation:
    //   - false (default): the paced batch reveal (3 cards per tick) — a row-by-row
    //     waterfall that also keeps huge decks (mastered) responsive while filling in.
    //   - true: render ALL entries immediately and animate only the first CASCADE_LIMIT,
    //     each offset by STAGGER_STEP_MS, so they fan in as one smooth stagger and the
    //     rest simply appear. For callers that already bound their list size (e.g. Quick
    //     Mark paginates ~100/page and its cards use contentVisibility), this avoids the
    //     paced reveal's "3, then a batch, then the rest" stepping.
    staggerReveal?: boolean;
}

const MiniVocabCardGrid: React.FC<MiniVocabCardGridProps> = ({
    entries,
    loading,
    error,
    emptyMessage,
    onCardClick,
    containerClassName,
    classPrefix,
    renderCard,
    footer,
    staggerReveal = false,
}) => {
    // Progressively reveal the deck so a large list never mounts in one blocking
    // render (keeps taps on surrounding buttons responsive). In staggerReveal mode the
    // caller has bounded its own list, so we skip the paced reveal and mount everything
    // at once (the hook is still called unconditionally, its result just unused).
    const pacedEntries = useIncrementalList(entries, REVEAL_BATCH, undefined, CASCADE_LIMIT);
    const visibleEntries = staggerReveal ? entries : pacedEntries;

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
                // The first CASCADE_LIMIT cards pop in on reveal (delay 0) and the
                // paced reveal between rows produces the sequential cascade; cards
                // past the limit are revealed all at once and render with no
                // entrance animation (undefined animationDelayMs).
                <>
                    {visibleEntries.map((entry, index) => {
                        // Paced mode: each card animates on reveal with delay 0 (the
                        // reveal timing itself is the waterfall). Stagger mode: all cards
                        // mount together, so the first CASCADE_LIMIT get an increasing
                        // per-card delay to fan in; the rest render with no animation.
                        const animationDelayMs =
                            index < CASCADE_LIMIT
                                ? (staggerReveal ? index * STAGGER_STEP_MS : 0)
                                : undefined;
                        return renderCard ? (
                            renderCard(entry, index, animationDelayMs)
                        ) : (
                            <MiniVocabCard
                                key={entry.id}
                                entry={entry}
                                onClick={onCardClick}
                                animationDelayMs={animationDelayMs}
                            />
                        );
                    })}
                    {footer}
                </>
            )}
        </CardsPreviewContainer>
    );
};

export default MiniVocabCardGrid;

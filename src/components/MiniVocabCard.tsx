import { memo } from "react";
import { Box, IconButton, useTheme } from "@mui/material";
import MiniCard from "./MiniCard";
import CardIconLayer from "../cardIcons/CardIconLayer";
import { isAdvancedLayout } from "../cardIcons/cardIconLayout";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../utils/definitionUtils";
import { resolveTextColor } from "../utils/cardTextColor";
import { resolveCardColor } from "../utils/cardColor";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RepeatIcon from "@mui/icons-material/Repeat";
import type { VocabEntry } from "../types";
import { masteryBar, type MasteryBarId } from "../utils/masteryCompute";
import { SHADOW } from "../theme/shadows";
import { MINI_CARD_RING } from "./miniCardFace";

interface MiniVocabCardProps {
    entry: VocabEntry;
    onClick?: (entry: VocabEntry) => void;
    onDelete?: (entry: VocabEntry) => void;
    onCycle?: (entry: VocabEntry) => void;
    /**
     * Draw the bottom mastery window strip. Default true — every deck/collection surface
     * wants it, because there the card's job is partly to report progress.
     *
     * Set false where the card is a PREVIEW of a word rather than a readout of the
     * learner's standing on it (the provisional lent-card notice and sort offer): a
     * borrowed card's bars are either empty or a half-round's worth of marks, so the
     * strip is noise at best and a discouraging "you know nothing" mark at worst, in a
     * dialog whose only question is "do you want this word?". Suppressing it also drops
     * the strip's reserved height, so the definition sits lower and the card breathes.
     *
     * This prop is now the ONLY mastery switch on the card. It used to leak: the corner
     * utcm letter badge was never gated by it, so a suppressed card still got stamped
     * with a `U`. The badge is gone (frame 17), so "false" now means what it says.
     */
    showMasteryStrip?: boolean;
    /**
     * The surface's mastery LENS (docs/DECKS_FEATURE.md § "Mastery Centers").
     *
     * ALWAYS exactly one bar — the card carries a single eight-cell window for the lens
     * it is shown under, and nothing else. Defaults to `core`, so a card on any
     * recognition/production surface (the fdp, search, the sort offer) reports
     * recognition and production only; a Reading Center card passes `reading` and
     * reports that instead.
     *
     * The strip used to draw one track per goal the account pursued, which put reading
     * and writing progress onto pages that were not asking about them — the whole
     * reason the Centers exist. One surface, one question, one bar.
     */
    lens?: MasteryBarId;
    // When set, the card plays the shared `cardPopIn` animation on mount, delayed
    // by this many ms. Callers (e.g. the /decks card previews) pass `index * step`
    // to stagger a freshly-loaded row into a left-to-right cascade. Omit elsewhere
    // (card detail page, flashcard back) to render with no entrance animation.
    animationDelayMs?: number;
    /**
     * Replaces the THEME card face (`palette.flashcard.flashCard`) as the fallback fill
     * for this one surface. Only the default changes: a card with its own `cardColor`
     * (advanced layout) still draws in that colour, because its per-card Contrast text
     * colours were chosen against it and could be unreadable on anything else.
     *
     * Used by the Reading Center's swipe grid (`ReadingSwipeGrid`), whose flipped tile
     * shows the mini card on white to match the grid's white tiles
     * (docs/READING_WRITING_CENTERS.md § Phase 2).
     */
    defaultBackground?: string;
}

const MiniVocabCardComponent: React.FC<MiniVocabCardProps> = ({ entry, onClick, onDelete, onCycle, animationDelayMs, showMasteryStrip = true, lens = "core", defaultBackground }) => {
    const fc = useTheme().palette.flashcard;
    // The lens bar, or null when the strip is suppressed. Computed here from
    // `typedMarkHistory` rather than read off `entry.category`, because that column is the
    // CORE band by definition and would be the wrong answer inside a Reading/Writing Center.
    // MiniCard draws the strip (docs/MASTERY_REWORK.md § "Mini cards").
    const bar = showMasteryStrip ? masteryBar(entry.typedMarkHistory, lens) : null;
    // Render a custom icon arrangement behind the text only for ADVANCED layouts:
    // multiple icons, OR a single icon that has been moved/resized/rotated off its
    // default placement. Plain default-icon cards keep the single slot icon. Uses the
    // shared isAdvancedLayout() gate (cardIconLayout.ts) rather than a hand-rolled length
    // check so single-icon advanced designs aren't dropped. CardIconLayer is fully
    // percentage-based, so it scales to the 92×132 card. See docs/CARD_ICON_LAYOUT.md.
    const hasAdvancedLayout = isAdvancedLayout(entry.iconLayout);
    // Per-card background fill (migration 94): tint the thumbnail to match the flashcard's BACK
    // face (which this mini mirrors). Applied ONLY when the card is using an advanced layout —
    // same gate the flashcard face uses, INCLUDING a custom text placement (so pass textLayout
    // too), which is why this is a separate check from the icon-only `hasAdvancedLayout` above.
    // Falls back to the caller's `defaultBackground`, else the THEME's card face (matches
    // `CardFace`'s `faceBg`).
    const isUsingAdvancedLayout = isAdvancedLayout(entry.iconLayout, entry.textLayout);
    const faceBg = (isUsingAdvancedLayout ? resolveCardColor(entry.cardColor) : undefined) ?? defaultBackground ?? fc.flashCard;
    return (
        <MiniCard
            className="mini-vocab-card"
            onClick={() => onClick?.(entry)}
            language={entry.language}
            entryKey={entry.entryKey}
            // Sense-resolved, matching the dd printed below the word.
            pronunciation={resolveDisplayPronunciation(entry)}
            // dd via the shared resolver so the thumbnail matches the card face's chosen
            // sense (vet.selectedSense) rather than det's definitions[0].
            definition={resolveDisplayDefinition(entry)}
            iconId={entry.iconId}
            iconLayer={hasAdvancedLayout ? <CardIconLayer layout={entry.iconLayout!} /> : undefined}
            background={faceBg}
            // Per-card Contrast text-color overrides (migration 89), same as the card face.
            characterColor={resolveTextColor(entry.textColors?.foreign)}
            definitionColor={resolveTextColor(entry.textColors?.english)}
            hoverLift={!!onClick}
            animationDelayMs={animationDelayMs}
            masteryBar={bar}
            sx={{
                cursor: onClick ? 'pointer' : 'default',
                // The hover state additionally reveals the corner action buttons, which
                // is this card's alone — the shared face only steps the elevation.
                '&:hover': {
                    ...(onClick ? { boxShadow: `${MINI_CARD_RING}, ${SHADOW.float}` } : {}),
                    '& .action-buttons': { opacity: 1 },
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
                            boxShadow: SHADOW.chip,
                            '&:hover': {
                                backgroundColor: '#1976d2',
                                boxShadow: SHADOW.float,
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
                            boxShadow: SHADOW.chip,
                            '&:hover': {
                                backgroundColor: '#d32f2f',
                                boxShadow: SHADOW.float,
                            },
                        }}
                    >
                        <DeleteOutlineIcon className="mini-vocab-card__delete-icon" sx={{ fontSize: 18, color: 'white' }} />
                    </IconButton>
                )}
            </Box>
        </MiniCard>
    );
};

// Memoized: the /decks previews render long lists of these, and unrelated
// parent state (e.g. toggling a snackbar) must not re-render every card. Props
// are primitives + a stable `entry`, so referential equality is sufficient.
const MiniVocabCard = memo(MiniVocabCardComponent);

export default MiniVocabCard;

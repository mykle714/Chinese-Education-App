import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import Icon from "./Icon";
import PracticeWritingButton from "./handwriting/PracticeWritingButton";
import { WORD_TOOL_PILL_SX } from "./wordToolPill";
import { CARD_BASE_WIDTH } from "../features/flashcards/constants";
import type { VocabEntry } from "../types";

/**
 * `WordToolsRail` — the design's `.wtl.top` (artboards 18–25).
 *
 * ── What lives here ───────────────────────────────────────────────────────────
 * Every action a learner takes on the word in front of them, as one row of labelled
 * pills ABOVE the card and OUTSIDE its boundary: it is always one tap away without
 * opening a menu, and it is clear of the bottom of the screen — which on these pages
 * belongs to the thumb (swiping the card, raising the info panel).
 *
 *   `Write it`  — the practice-writing popup (docs/PRACTICE_WRITING.md);
 *   `Compare`   — load this word into Compare Words (docs/WORD_COMPARE_FEATURE.md);
 *   `Customize` — open the flashcard icon editor (fie) on this card
 *                 (docs/CARD_ICON_LAYOUT.md).
 *
 * `Customize` used to sit behind a `•••` on the card's own top edge (`CardOpsRail`,
 * deleted 2026-11-05 together with the card-note feature that shared it). With note
 * gone it was a one-item menu, so it joined the other two here.
 *
 * Each pill self-hides when it cannot act — writing is Chinese-only and capped at four
 * characters (its button owns that gate), Compare needs a host that can receive the
 * word, Customize needs a card to edit (absent in the Dictionary eip) — and
 * when none survives the rail renders nothing rather than leaving an empty strip above
 * the card.
 *
 * Exception: the Dictionary page's eip has NO card, so it puts the rail at the bottom of
 * the eip's DEFINITION tab (EipSheet `showWordTools` → InfoCardPanelBody
 * `definitionFooter`), zeroing the margin through `sx`.
 *
 * Width is pinned to `CARD_BASE_WIDTH` so the rail is exactly as wide as the card it
 * captions. A rail running the full page gutter reads as page chrome; one that lines up
 * with the card's edges reads as belonging to the card without being on it.
 *
 * Referenced by docs/SHELF_REDESIGN.md (artboards 18–25),
 * docs/PRACTICE_WRITING.md, docs/WORD_COMPARE_FEATURE.md ("Entry points"),
 * docs/CARD_ICON_LAYOUT.md (Customize entry point) and docs/DECK_TOWER.md § "Studying the tower" → "The buttons" (`pillSx`).
 */

export interface WordToolsRailProps {
    entry: VocabEntry;
    /**
     * Load this word into Compare Words. Omit on a surface that has nowhere to put it
     * — the button then self-hides rather than rendering a dead pill.
     */
    onCompare?: (entry: VocabEntry) => void;
    /**
     * Open the flashcard icon editor (fie) on this word's card. Omit where there is no
     * card to customize (the Dictionary eip) — the pill then self-hides.
     */
    onCustomize?: () => void;
    /**
     * Called before ANY pill acts, in the capture phase — so it also runs ahead of
     * `Write it`, whose handler is internal to PracticeWritingButton. The flp uses it to
     * flip the card to its answer face first (FlashcardsLearnPage `revealAnswer`).
     */
    onToolPress?: () => void;
    className?: string;
    sx?: SxProps<Theme>;
    /**
     * Layered over WORD_TOOL_PILL_SX on EVERY pill, so a host can restyle the rail's
     * buttons without them drifting apart — the Deck Tower session's plate buttons
     * (src/features/flashcards/FlashcardsLearnPage/towerPlate.ts).
     */
    pillSx?: SxProps<Theme>;
}

export const WordToolsRail: React.FC<WordToolsRailProps> = ({ entry, onCompare, onCustomize, onToolPress, className, sx, pillSx }) => {
    // Re-checked here purely to decide whether the CONTAINER is worth rendering;
    // PracticeWritingButton owns the real gate and returns null on its own.
    const writingEligible = entry.language === "zh" && [...entry.entryKey].length <= 4;
    if (!writingEligible && !onCompare && !onCustomize) return null;

    // These pages sit inside flip/drag-sensitive surfaces (the flp card is directly
    // below), so a press here must not bubble into a swipe.
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    return (
        <Box
            className={className ? `word-tools-rail ${className}` : "word-tools-rail"}
            sx={[
                {
                    display: "flex",
                    justifyContent: "center",
                    gap: "7px",
                    margin: "0 auto 16px",
                    maxWidth: CARD_BASE_WIDTH,
                    width: "100%",
                    // `Write it` is wrapped in a star Badge, so the flex child is the
                    // Badge rather than the pill — push the stretch down onto the pill
                    // itself or the rail buttons come out different widths.
                    "& .MuiBadge-root": { display: "flex", flex: 1, minWidth: 0 },
                    "& .MuiBadge-root > *": { width: "100%" },
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
            onPointerDown={stop}
            onClickCapture={onToolPress}
        >
            <PracticeWritingButton
                character={entry.entryKey}
                language={entry.language}
                // `|| undefined` so a dictionary-only entry (no vet row) records no
                // writing mark rather than posting one against card 0.
                vocabEntryId={entry.id || undefined}
                appearance="rail"
                railSx={pillSx}
            />
            {onCompare && (
                <Typography
                    component="button"
                    type="button"
                    className="word-tools-rail__compare"
                    onClick={(e) => { stop(e); onCompare(entry); }}
                    onMouseDown={stop}
                    onTouchStart={stop}
                    sx={[WORD_TOOL_PILL_SX, ...(Array.isArray(pillSx) ? pillSx : [pillSx])]}
                >
                    <Icon name="compare_arrows" size={17} />
                    Compare
                </Typography>
            )}
            {onCustomize && (
                <Typography
                    component="button"
                    type="button"
                    className="word-tools-rail__customize"
                    onClick={(e) => { stop(e); onCustomize(); }}
                    onMouseDown={stop}
                    onTouchStart={stop}
                    sx={[WORD_TOOL_PILL_SX, ...(Array.isArray(pillSx) ? pillSx : [pillSx])]}
                >
                    {/* The brush, as on the old `•••` rail — the pencil-ish `draw` is
                        `Write it`'s, and the two must not be confused side by side. */}
                    <Icon name="brush" size={17} />
                    Customize
                </Typography>
            )}
        </Box>
    );
};

export default WordToolsRail;

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
 * ── The distinction this rail exists to draw ──────────────────────────────────
 * A flashcard surface has two kinds of action on it and they were previously mixed
 * together in the eip's definition tab (`InfoCardActionBar`, deleted with this pass):
 *
 *   things you do to the CARD — customize its icons, file it into a deck, delete it.
 *       Those belong to the card object, so they live ON the card, behind its `•••`
 *       (`CardOpsRail`).
 *   things you do with the WORD — practise writing it, load it into Compare. Those
 *       would still make sense if the card did not exist, so they belong to the PAGE.
 *
 * This rail is the second kind. It sits ABOVE the card and OUTSIDE its boundary, which
 * is the whole point: it is visibly not part of the card, it is always one tap away
 * without opening a menu, and it is clear of the bottom of the screen — which on these
 * pages belongs to the thumb (swiping the card, raising the info panel).
 *
 * ── Why the two tools are the ones here ───────────────────────────────────────
 * They are the app's two word-level drills that leave this page: `Write it` opens the
 * practice-writing popup (docs/PRACTICE_WRITING.md) and `Compare` loads this word into
 * Compare Words (docs/WORD_COMPARE_FEATURE.md). Either self-hides when it cannot act —
 * writing is Chinese-only and capped at four characters (its button owns that gate),
 * Compare needs a host that can receive the word — and when neither survives the rail
 * renders nothing rather than leaving an empty strip above the card.
 *
 * Width is pinned to `CARD_BASE_WIDTH` so the rail is exactly as wide as the card it
 * captions. A rail running the full page gutter reads as page chrome; one that lines up
 * with the card's edges reads as belonging to the card without being on it.
 *
 * Referenced by docs/SHELF_REDESIGN.md (artboards 18–25),
 * docs/PRACTICE_WRITING.md and docs/WORD_COMPARE_FEATURE.md ("Entry points").
 */

export interface WordToolsRailProps {
    entry: VocabEntry;
    /**
     * Load this word into Compare Words. Omit on a surface that has nowhere to put it
     * — the button then self-hides rather than rendering a dead pill.
     */
    onCompare?: (entry: VocabEntry) => void;
    className?: string;
    sx?: SxProps<Theme>;
}

export const WordToolsRail: React.FC<WordToolsRailProps> = ({ entry, onCompare, className, sx }) => {
    // Re-checked here purely to decide whether the CONTAINER is worth rendering;
    // PracticeWritingButton owns the real gate and returns null on its own.
    const writingEligible = entry.language === "zh" && [...entry.entryKey].length <= 4;
    if (!writingEligible && !onCompare) return null;

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
                    // itself or the two rail buttons come out different widths.
                    "& .MuiBadge-root": { display: "flex", flex: 1, minWidth: 0 },
                    "& .MuiBadge-root > *": { width: "100%" },
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
            onPointerDown={stop}
        >
            <PracticeWritingButton
                character={entry.entryKey}
                language={entry.language}
                // `|| undefined` so a dictionary-only entry (no vet row) records no
                // writing mark rather than posting one against card 0.
                vocabEntryId={entry.id || undefined}
                appearance="rail"
            />
            {onCompare && (
                <Typography
                    component="button"
                    type="button"
                    className="word-tools-rail__compare"
                    onClick={(e) => { stop(e); onCompare(entry); }}
                    onMouseDown={stop}
                    onTouchStart={stop}
                    sx={WORD_TOOL_PILL_SX}
                >
                    <Icon name="compare_arrows" size={17} />
                    Compare
                </Typography>
            )}
        </Box>
    );
};

export default WordToolsRail;

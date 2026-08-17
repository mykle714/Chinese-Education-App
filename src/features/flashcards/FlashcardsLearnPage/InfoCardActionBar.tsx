import React from "react";
import { Box, Button, useTheme } from "@mui/material";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import AddToDeckMenu from "../AddToDeckMenu";
import PracticeWritingButton from "../../../components/handwriting/PracticeWritingButton";
import { FC_FONT } from "../constants";
import { SIZE, WEIGHT } from "../../../theme/scale";
import type { VocabEntry } from "../types";

/**
 * The row of card-level actions at the END of the eip's definition tab
 * (`InfoCardTabContent`, tab 0) — "Add to Deck…", "Compare To…" and
 * "Practice Writing Me".
 *
 * ── Why here and not in the header ────────────────────────────────────────────
 * These three used to be icon buttons in the eip header's action grid, where they
 * competed with the header's job (identity: headword, dd, sense picker, speaker) and
 * were unlabelled. As labelled buttons in the tab body they read as what they are.
 * The bar SCROLLS with the definition content rather than being pinned — the tab is
 * short enough that pinning would cost more vertical room than it buys.
 *
 * Every button self-hides on its own precondition, and the survivors re-flex to equal
 * widths (wrapping to a second row when the sheet is narrow):
 *   • Add to Deck — needs a vet row (`entry.id`); absent for a dictionary-only entry.
 *   • Compare To — needs `onOpenCompare` from the host page.
 *   • Practice Writing Me — zh, 1–4 characters (the component's own gate).
 * When all three are absent the bar renders nothing at all.
 *
 * Referenced by docs/DECKS_FEATURE.md, docs/WORD_COMPARE_FEATURE.md and
 * docs/HANDWRITING_RECOGNITION.md ("Entry points").
 */
export interface InfoCardActionBarProps {
    currentEntry: VocabEntry;
    onOpenCompare?: (entry: VocabEntry) => void;
}

const InfoCardActionBar: React.FC<InfoCardActionBarProps> = ({ currentEntry, onOpenCompare }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Mirrors the eip's other controls: the panel sits inside flip/drag-sensitive
    // surfaces, so presses must not bubble to any wrapping card's handlers.
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    // Nothing to offer — don't leave an empty bordered strip behind. Practice Writing
    // owns its own gate internally, so it is re-checked here (zh + 1–4 chars) purely to
    // decide whether the CONTAINER is worth rendering.
    const writingEligible =
        currentEntry.language === "zh" && [...currentEntry.entryKey].length <= 4;
    if (!currentEntry.id && !onOpenCompare && !writingEligible) return null;

    return (
        <Box
            className="mobile-demo-definition-action-bar"
            sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                paddingTop: "4px",
                // Equal widths within a row; the 140px basis is what makes a narrow
                // sheet wrap instead of squeezing three labels into one line.
                "& > *": { flex: "1 1 140px", minWidth: 0 },
                // PracticeWritingButton wraps its Button in a star Badge, so the flex
                // child is the Badge — push the width down onto the button itself.
                "& .MuiBadge-root": { display: "flex" },
                // One place styles all three buttons, including PracticeWritingButton's
                // (which is rendered by a shared component and takes no sx of its own) —
                // so the bar can't end up with two MUI-primary buttons beside one themed
                // one. Same card palette the rest of the panel uses.
                "& .MuiButton-root": {
                    width: "100%",
                    color: fc.onSurface,
                    borderColor: fc.border,
                    fontFamily: FC_FONT,
                    fontSize: SIZE.caption,
                    fontWeight: WEIGHT.semibold,
                    textTransform: "none",
                    "&:hover": { borderColor: fc.onSurface },
                },
            }}
        >
            {/* File this card into a deck (docs/DECKS_FEATURE.md). Self-hides for a
                dictionary-only entry, which has no vet row to add. */}
            <AddToDeckMenu
                vocabEntryId={currentEntry.id}
                className="mobile-demo-definition-add-to-deck"
                label="Add to Deck…"
            />
            {onOpenCompare && (
                <Button
                    className="mobile-demo-definition-compare"
                    variant="outlined"
                    size="small"
                    startIcon={<CompareArrowsIcon />}
                    onClick={(e) => { stop(e); onOpenCompare(currentEntry); }}
                    onMouseDown={stop}
                    onTouchStart={stop}
                    onTouchEnd={stop}
                >
                    Compare To…
                </Button>
            )}
            {/* Chinese-only; renders null for every other language (its own gate).
                `id || undefined` so a dictionary-only entry (no vet row) records no
                writing mark rather than posting one against card 0. */}
            <PracticeWritingButton
                character={currentEntry.entryKey}
                language={currentEntry.language}
                vocabEntryId={currentEntry.id || undefined}
            />
        </Box>
    );
};

export default InfoCardActionBar;

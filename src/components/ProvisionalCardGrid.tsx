import React from "react";
import { Box } from "@mui/material";
import MiniVocabCard from "./MiniVocabCard";
import type { VocabEntry } from "../types";

/**
 * ProvisionalCardGrid — the lent cards as MINI PREVIEW CARDS, two per row.
 *
 * Shared by the pre-round notice (src/components/ProvisionalCardsNotice.tsx) and the
 * end-of-round sort offer (src/components/ProvisionalSortOffer.tsx) so the learner
 * meets the same thing both times: the actual cards, exactly as they look everywhere
 * else in the app.
 *
 * WHY MiniVocabCard AND NOT A LOCAL CARD
 * This surface previews CARDS, so it renders the app's real card thumbnail — the same
 * `MiniVocabCard` the decks page, the collection view, Quick Mark and the flashcard
 * back all use. Nothing about the lent-card preview is special enough to justify a
 * second card design: a bespoke one would drift from the real thing (icon layouts,
 * per-card colors, text-color overrides, the utcm badge, the sense-resolved dd) and
 * would teach the learner a card shape they never see again. Everything the card shows
 * is derived from the entry by the card itself, which is why this component holds no
 * per-field layout at all.
 *
 * The one thing turned OFF is the mastery strip (`showMasteryStrip={false}`). A lent
 * card carries no progress worth reporting — empty bars before the round, a partial
 * round's marks after it — and these dialogs ask "do you want this word?", not "how
 * well do you know it?". It also removes the last thing that differed between the two
 * paths a preview can arrive by (see `discoverCardToProvisionalEntry`).
 *
 * SHAPE — 92×132 cards, two per row
 * The card's geometry is fixed at 92×132, so the row width is arithmetic:
 * 2 × 92 + 16 gap = 200px, centered in a popup that is 276–340px wide. Three per row
 * (what MiniVocabCardGrid does at 364px) does not fit; two does, comfortably, and
 * halves the vertical run so a typical lent set (4–8 cards) is fully visible without
 * scrolling. There is deliberately no container box behind the grid — the cards carry
 * their own surface, so the grid reads the same on the notice's beige card and on the
 * offer's flashcard-colored popup.
 *
 * This is NOT MiniVocabCardGrid: that one owns a 3-per-row 364px track plus paced
 * incremental reveal for decks of hundreds. A lent set is a handful of cards inside a
 * dialog, so it renders in one commit and only needs the width to differ.
 *
 * The grid is the one scrollable region of its dialog: a large lent set must not grow
 * the card past the viewport. Scrolling is opt-in per container (CLAUDE.md § Touch &
 * Scroll), hence the explicit `touchAction: "pan-y"`.
 *
 * Referenced by: docs/PROVISIONAL_CARDS.md § 5.
 */

const CARD_WIDTH = 92; // MiniVocabCard's fixed width
const GRID_GAP = 16;
const CARDS_PER_ROW = 2;
// 2 × 92 + 1 × 16 = 200. Stated as arithmetic so it stays correct if the gap moves.
const GRID_WIDTH = CARDS_PER_ROW * CARD_WIDTH + (CARDS_PER_ROW - 1) * GRID_GAP;

// Per-card delay for the entrance cascade, matching MiniVocabCardGrid's step so a
// lent set fans in the same way a deck preview does.
const STAGGER_STEP_MS = 35;

export interface ProvisionalCardGridProps {
    /** The lent cards. Empty renders nothing. */
    entries: VocabEntry[];
    /** Cap on the scroll area's height in px. Default 210. */
    maxHeight?: number;
}

const ProvisionalCardGrid: React.FC<ProvisionalCardGridProps> = ({ entries, maxHeight = 210 }) => {
    if (entries.length === 0) return null;

    // TWO elements, deliberately: the outer one scrolls, the inner one is the fixed
    // 200px track. They cannot be merged. The scroll container is the thing whose
    // width a classic desktop scrollbar eats into, and the app sets `border-box`
    // globally — so a single element carrying width + padding + overflow ends up with
    // a content box NARROWER than 200px and wraps to one card per row (which is
    // exactly what it did). Keeping the track free of both padding and overflow means
    // its 200px is 200px no matter what the scrollbar and the shadow padding do.
    return (
        <Box
            className="provisional-card-grid"
            sx={{
                width: "100%",
                maxHeight,
                overflowY: "auto",
                touchAction: "pan-y",
                display: "flex",
                justifyContent: "center",
                // Room for the cards' drop shadow and pop-in scale so neither is
                // clipped against the scroll container's edge.
                padding: "3px 3px 6px",
            }}
        >
            <Box
                className="provisional-card-grid__track"
                sx={{
                    width: GRID_WIDTH,
                    // Belt and braces against a future padding/border on this element:
                    // the track's width must be its CONTENT width or the last card in
                    // each row wraps away.
                    boxSizing: "content-box",
                    flex: "0 0 auto",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: `${GRID_GAP}px`,
                    justifyContent: "flex-start",
                    // Pack wrapped rows at the top rather than distributing them down
                    // any spare height, so a short set sits under the copy above it.
                    alignContent: "flex-start",
                }}
            >
                {entries.map((entry, index) => (
                    <MiniVocabCard
                        key={entry.entryKey}
                        entry={entry}
                        // No onClick: the preview is read-only. The card renders with a
                        // default cursor and no hover lift when the handler is omitted,
                        // which is exactly right here — tapping a lent card does nothing;
                        // the dialog's own buttons are the decision.
                        //
                        // No mastery strip either: a borrowed card has no progress worth
                        // reporting, and the dialog is asking "do you want this word?",
                        // not "how well do you know it?".
                        showMasteryStrip={false}
                        animationDelayMs={index * STAGGER_STEP_MS}
                    />
                ))}
            </Box>
        </Box>
    );
};

export default ProvisionalCardGrid;

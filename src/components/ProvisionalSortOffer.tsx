import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import MinimizablePopup from "./MinimizablePopup";
import ProvisionalCardGrid from "./ProvisionalCardGrid";
import { useProvisionalEntries } from "../hooks/useProvisionalEntries";
import { COLORS, SIZE, WEIGHT } from "../theme";
import type { Language } from "../types";

/**
 * ProvisionalSortOffer — the end-of-round "keep the cards you played" popup.
 *
 * A round topped up with temporary cards (docs/PROVISIONAL_CARDS.md) ends with an
 * offer rather than a silent cleanup: the player just spent a whole round with those
 * words, which is the best possible moment to ask whether they want to keep them.
 * Accepting opens the sort flow in SET MODE, seeded with exactly the words this round
 * used (`?set=provisional` in SortCardsPage), which ends on its own completion popup
 * (ProvisionalSortDonePopup) once the last card of the set is resolved.
 *
 * SHAPE
 * On a game it stacks OVER the end-of-run popup — both stay on screen, and the two
 * collapse to opposite corners in different colors so they never read as one thing:
 * the end popup to the top-right in the neutral card color, this one to the TOP-LEFT
 * in the blue accent (its minimize button matches its puck). Minimizing it is the
 * "not right now, but don't take it away" answer; "Not now" dismisses it outright.
 * On flp there is no game field to return to, so the popup gates the exit instead and
 * is not minimizable — see FlashcardsLearnPage.
 *
 * WHAT IT SHOWS
 * The same mini-card grid as the pre-round notice — the app's real MiniVocabCard
 * thumbnails, two per row — fetched through
 * `useProvisionalEntries` — i.e. through the sort-set endpoint, which intersects the
 * asked-for words with what the learner genuinely still holds. So a card sorted in
 * another tab drops out of the table by itself, and when nothing is left the offer
 * does not appear at all.
 *
 * Nothing is lost by declining: the temporary cards stay, marks earned on them stay,
 * the same offer appears after the next round, and sorting later still preserves the
 * progress (StarterPacksService.sortCard promotes the row in place).
 *
 * Referenced by: BubbleMatchPage, MatchSpeedPage, SpeedReadingPage, WordSearchPage,
 * FlashcardsLearnPage.
 */
export interface ProvisionalSortOfferProps {
    /** Whether the offer is on screen. Renders nothing when false. */
    open: boolean;
    /** The temporary words this round used. */
    words: string[];
    /** Study language — selects which sort flow to open. */
    language: Language;
    /** "Not now" — the caller decides what dismissal means (close, or leave the page). */
    onDismiss: () => void;
    /** Called just before navigating into the sort flow, e.g. to tear down a game loop. */
    onNavigate?: () => void;
    /** Collapsed into the top-left puck. Omit `onMinimize` to make it non-minimizable. */
    minimized?: boolean;
    onMinimize?: () => void;
    onRestore?: () => void;
    /** `absolute` (default) for a game stage; `fixed` for a page with no stage. */
    positioning?: "absolute" | "fixed";
    /**
     * Stacking order. Default 210 — one step above a game's end popup (200), which it
     * deliberately stacks over. A page whose chrome sits higher (flp's dialogs run in
     * the 1200s) passes its own value.
     */
    zIndex?: number;
    /** Label of the dismiss button. Default "Not now". */
    dismissLabel?: string;
}

const ProvisionalSortOffer: React.FC<ProvisionalSortOfferProps> = ({
    open,
    words,
    language,
    onDismiss,
    onNavigate,
    minimized,
    onMinimize,
    onRestore,
    positioning = "absolute",
    zIndex = 210,
    dismissLabel = "Not now",
}) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { entries, loading } = useProvisionalEntries(language, words, undefined, open);

    // Nothing to offer: either the round used no lent cards, or every one of them has
    // since been sorted. Also stay silent while the lookup is in flight so the popup
    // never pops in empty and then reflows as the grid lands.
    if (!open || loading || entries.length === 0) return null;

    // Navigate on the SERVER's list, not the caller's: the entries are already narrowed
    // to what is genuinely still provisional, so the sort flow can't open on a card that
    // is no longer offerable.
    const offerWords = entries.map((entry) => entry.entryKey);

    const handleSort = (): void => {
        onNavigate?.();
        // `from` records WHERE the offer was accepted, so the sort flow's completion popup
        // can name its exit button ("Back to Bubble Match") and still have a target when
        // there is no history to pop (deep link / reload).
        navigate(
            `/discover/sort/${language}?set=provisional&words=${encodeURIComponent(offerWords.join(","))}` +
                `&from=${encodeURIComponent(location.pathname)}`
        );
    };

    return (
        <MinimizablePopup
            classPrefix="provisional-sort-offer"
            corner="top-left"
            // Distinct from the neutral end-of-run puck sitting in the other corner.
            puckColor={COLORS.infoInk}
            accentContrast="#FFFFFF"
            minimized={minimized}
            onMinimize={onMinimize}
            onRestore={onRestore}
            positioning={positioning}
            // Above the end-of-run popup (200), with a lighter scrim: the field is
            // already dimmed once and dimming it twice reads as a broken overlay.
            zIndex={zIndex}
            scrimColor="rgba(20, 20, 28, 0.18)"
        >
            <Typography
                className="provisional-sort-offer__title"
                sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}
            >
                Keep {offerWords.length === 1 ? "this card" : `these ${offerWords.length} cards`}?
            </Typography>
            <Typography
                className="provisional-sort-offer__body"
                sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, lineHeight: 1.4 }}
            >
                You just played with {offerWords.length === 1 ? "this borrowed card" : "these borrowed cards"}.
                Sort {offerWords.length === 1 ? "it" : "them"} to move
                {offerWords.length === 1 ? " it" : " them"} into your deck — your progress comes along.
            </Typography>

            <ProvisionalCardGrid entries={entries} maxHeight={200} />

            <Box
                className="provisional-sort-offer__actions"
                sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}
            >
                <Button
                    className="provisional-sort-offer__sort-btn"
                    variant="contained"
                    onClick={handleSort}
                    sx={{
                        py: 1.25,
                        borderRadius: "14px",
                        textTransform: "none",
                        fontSize: SIZE.bodyLg,
                        fontWeight: WEIGHT.bold,
                        backgroundColor: COLORS.infoInk,
                        "&:hover": { backgroundColor: COLORS.infoInk },
                    }}
                >
                    Sort {offerWords.length === 1 ? "this card" : "these cards"}
                </Button>
                <Button
                    className="provisional-sort-offer__dismiss-btn"
                    variant="outlined"
                    onClick={onDismiss}
                    sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
                >
                    {dismissLabel}
                </Button>
            </Box>
        </MinimizablePopup>
    );
};

export default ProvisionalSortOffer;

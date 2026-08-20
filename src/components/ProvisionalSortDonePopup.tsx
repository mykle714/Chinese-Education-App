import React from "react";
import { Box, Button, Typography } from "@mui/material";
import MinimizablePopup from "./MinimizablePopup";
import { COLORS, SIZE, WEIGHT } from "../theme";

/**
 * ProvisionalSortDonePopup — the end of the provisional SET-MODE sort flow.
 *
 * A fixed set (`/discover/sort/:language?set=provisional`) is DONE once its queue
 * empties. The page used to bounce straight back with `navigate(-1)`, which meant the
 * learner's last card vanished under an instant route change with no confirmation that
 * anything happened. Instead the page now stops on this popup and hands the exit back to
 * them: return to whatever opened the offer (a game's end screen, flp), or go Home.
 *
 * Deliberately NOT minimizable — there is no board left underneath to look at, so the
 * popup gates the exit the same way flp's offer does. Every route out of set mode goes
 * through one of these two buttons.
 *
 * Referenced by: src/features/discover/SortCardsPage.tsx. See docs/PROVISIONAL_CARDS.md § 7.
 */
export interface ProvisionalSortDonePopupProps {
    /** How many cards the learner resolved in this pass — drives the summary line. */
    sortedCount: number;
    /**
     * Name of the page the flow was entered from (`originLabelFor`), or null when it is
     * unknown (deep link, reload, an origin with no label) — the button then reads
     * "Go back".
     */
    originLabel: string | null;
    /** Return to the origin page. */
    onBack: () => void;
    /** Go to the home hub. */
    onHome: () => void;
}

const ProvisionalSortDonePopup: React.FC<ProvisionalSortDonePopupProps> = ({
    sortedCount,
    originLabel,
    onBack,
    onHome,
}) => (
    <MinimizablePopup
        classPrefix="provisional-sort-done"
        // No stage to sit inside: scp is a normal page, so the scrim covers the viewport.
        positioning="fixed"
        puckColor={COLORS.blueMain}
        accentContrast="#FFFFFF"
        zIndex={210}
    >
        <Typography
            className="provisional-sort-done__title"
            sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}
        >
            All sorted!
        </Typography>
        <Typography
            className="provisional-sort-done__body"
            sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, lineHeight: 1.4 }}
        >
            {sortedCount === 1
                ? "That card is handled — the cards you kept are in your deck now, with their progress."
                : `Those ${sortedCount} cards are handled — the ones you kept are in your deck now, with their progress.`}
        </Typography>

        <Box
            className="provisional-sort-done__actions"
            sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}
        >
            <Button
                className="provisional-sort-done__back-btn"
                variant="contained"
                onClick={onBack}
                sx={{
                    py: 1.25,
                    borderRadius: "14px",
                    textTransform: "none",
                    fontSize: SIZE.bodyLg,
                    fontWeight: WEIGHT.bold,
                    backgroundColor: COLORS.blueMain,
                    "&:hover": { backgroundColor: COLORS.blueMain },
                }}
            >
                {originLabel ? `Back to ${originLabel}` : "Go back"}
            </Button>
            <Button
                className="provisional-sort-done__home-btn"
                variant="outlined"
                onClick={onHome}
                sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
            >
                Go to Home
            </Button>
        </Box>
    </MinimizablePopup>
);

export default ProvisionalSortDonePopup;

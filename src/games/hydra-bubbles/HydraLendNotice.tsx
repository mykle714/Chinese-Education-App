import React from "react";
import { Box, Button, Typography } from "@mui/material";
import { WEIGHT } from "../../theme/scale";
import { COLORS } from "../../theme/colors";

/**
 * Hydra Bubbles — the one-shot mid-run lending notice (docs/HYDRA_BUBBLES.md § 6.4).
 *
 * A NOTIFICATION, NOT A REVIEW STEP. It says we have started lending words and has a
 * single "Got it" dismissal — deliberately NO table of words, unlike
 * `ProvisionalCardsNotice`. An endless run cannot know its card set in advance, so
 * the itemized form does not apply and Hydra is absent from `CARD_BASELINE_ITEMIZED`
 * (server/contracts/wire.ts). The end-of-run `ProvisionalSortOffer` is where the
 * actual words are named.
 *
 * FULL-SCREEN AND INPUT-BLOCKING, which is why the caller freezes the field behind
 * it. Not to protect a clock — Hydra has none — but because a modal over a live drag
 * either eats the pointer or strands a half-finished match underneath it.
 */
interface HydraLendNoticeProps {
    open: boolean;
    onDismiss: () => void;
}

const HydraLendNotice: React.FC<HydraLendNoticeProps> = ({ open, onDismiss }) => {
    if (!open) return null;
    return (
        <Box
            className="hydra-lend-notice"
            sx={{
                position: "fixed",
                inset: 0,
                zIndex: 1400,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                px: "22px",
                // `.modal` — the design's scrim is the ink token at 45%, not pure black;
                // black over a warm paper ground reads as a hole rather than a veil.
                backgroundColor: "rgba(23,22,26,0.45)",
            }}
        >
            <Box
                className="hydra-lend-notice__card"
                sx={{
                    width: "100%",
                    maxWidth: 380,
                    borderRadius: "18px",
                    backgroundColor: COLORS.card,
                    p: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    textAlign: "center",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                }}
            >
                <Typography
                    className="hydra-lend-notice__title"
                    sx={{ fontSize: 16, fontWeight: WEIGHT.bold }}
                >
                    Borrowing a few words
                </Typography>
                <Typography
                    className="hydra-lend-notice__body"
                    sx={{ fontSize: 12.5, lineHeight: 1.5, color: COLORS.iconColor }}
                >
                    The board is growing faster than your Learn Now cards can fill it, so we're
                    lending you some new words to keep playing. You can keep any of them at the
                    end of the run.
                </Typography>
                <Button
                    className="hydra-lend-notice__dismiss"
                    variant="contained"
                    onClick={onDismiss}
                    sx={{
                        // `.modal .cd .go` — ink, not the theme primary. A dismissal that
                        // takes the accent colour reads as the recommended one of several
                        // choices; there is only one.
                        mt: "6px",
                        py: "11px",
                        borderRadius: "14px",
                        textTransform: "none",
                        fontSize: 13.5,
                        fontWeight: WEIGHT.bold,
                        backgroundColor: COLORS.onSurface,
                        color: COLORS.white,
                        boxShadow: "none",
                        "&:hover": { backgroundColor: COLORS.onSurface, boxShadow: "none" },
                    }}
                >
                    Got it
                </Button>
            </Box>
        </Box>
    );
};

export default HydraLendNotice;

import React from "react";
import { Box, Button, Typography } from "@mui/material";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
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
                px: 3,
                backgroundColor: "rgba(0,0,0,0.45)",
            }}
        >
            <Box
                className="hydra-lend-notice__card"
                sx={{
                    width: "100%",
                    maxWidth: 380,
                    borderRadius: "18px",
                    backgroundColor: COLORS.card,
                    p: 3,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1.5,
                    textAlign: "center",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                }}
            >
                <Typography
                    className="hydra-lend-notice__title"
                    sx={{ fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold }}
                >
                    Borrowing a few words
                </Typography>
                <Typography
                    className="hydra-lend-notice__body"
                    sx={{ fontSize: SIZE.body, lineHeight: LEADING.normal }}
                >
                    The board is growing faster than your Learn Now cards can fill it, so we're
                    lending you some new words to keep playing. You can keep any of them at the
                    end of the run.
                </Typography>
                <Button
                    className="hydra-lend-notice__dismiss"
                    variant="contained"
                    onClick={onDismiss}
                    sx={{ mt: 1, py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.bold }}
                >
                    Got it
                </Button>
            </Box>
        </Box>
    );
};

export default HydraLendNotice;

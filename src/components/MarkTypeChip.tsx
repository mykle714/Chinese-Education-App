import { Box, Typography } from "@mui/material";
import type { MarkType } from "../types";
import { MARK_TYPE_COLORS, MARK_TYPE_LABELS } from "../utils/masteryCompute";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, TRACKING } from "../theme/scale";

/**
 * Small pill naming ONE mastery mark type — a colored dot plus the uppercase
 * track name ("RECOGNITION", "READING", …).
 *
 * Used on the Games hub so a player can see which of the four mastery tracks a
 * game feeds before they open it (docs/MASTERY_REWORK.md § "Games select by their
 * own mark type", docs/HUB_MENU_SYSTEM.md). The dot color and the label both come
 * from the shared maps in `utils/masteryCompute`, so the chip matches the cdp
 * stacked progress bar's segment colors exactly — the same track is the same hue
 * on both surfaces.
 *
 * Lives in `components/` rather than `features/flashcards/` because its consumers
 * are the games (`src/games/**`), which must not reach into another feature
 * folder (docs/FRONTEND_LAYERING.md).
 *
 * `variant` picks the treatment for the surface it sits on:
 *   - `"card"` (default) — pill with a translucent-white fill, reads on a pastel
 *     hub card;
 *   - `"surface"` — same pill with a neutral tint, for the plain page background;
 *   - `"edge"` — NO pill and NO color dot: just the track name as faded grey
 *     letters turned 90° counter-clockwise, meant to run up the right edge of a
 *     hub card (HubMenu's `CardEdgeSlot`). Deliberately quiet — on the Games hub
 *     the track name is a footnote, not a second title. Note this variant drops
 *     the MARK_TYPE_COLORS hue, so it is the one place the chip does NOT
 *     color-match the cdp stacked progress bar.
 */

export const MarkTypeChip: React.FC<{
    markType: MarkType;
    variant?: "card" | "surface" | "edge";
    className?: string;
}> = ({ markType, variant = "card", className }) => {
    const label = MARK_TYPE_LABELS[markType];
    return variant === "edge" ? (
        <Typography
            className={`mark-type-chip mark-type-chip--edge mark-type-chip--${markType} ${className ?? ""}`}
            sx={{
                // `vertical-rl` turns the letters 90° clockwise; the extra 180°
                // rotation flips the run so it reads bottom-to-top, which is what
                // lets it sit under a card's top-right corner badge.
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                // ONE fixed size on every card, matching the pill variants' label —
                // the track name is a footnote and should read identically wherever
                // it appears. It is CardEdgeSlot's job to be tall enough for the
                // longest name (it cancels the card's vertical padding to span the
                // full cell); this never scales itself to fit.
                fontSize: SIZE.micro,
                fontWeight: WEIGHT.bold,
                color: COLORS.textSecondary,
                opacity: 0.5,
                fontFamily: FONTS.sans,
                letterSpacing: TRACKING.caps,
                textTransform: "uppercase",
                lineHeight: 1,
                whiteSpace: "nowrap",
                // Backstop only. In vertical writing mode the block axis is the
                // height, so this bounds the run to the slot — which now spans the
                // whole cell, so nothing today comes close to hitting it.
                maxHeight: "100%",
                overflow: "hidden",
                flexShrink: 0,
            }}
        >
            {label}
        </Typography>
    ) : (
    <Box
        className={`mark-type-chip mark-type-chip--${markType} ${className ?? ""}`}
        sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.625,
            px: 0.875,
            py: 0.25,
            borderRadius: "999px",
            flexShrink: 0,
            // Keep the pill hugging its text instead of stretching to the width of
            // the (flex-column) card body it usually sits in.
            alignSelf: "flex-start",
            maxWidth: "100%",
            backgroundColor: variant === "surface" ? COLORS.rowHoverBg : "rgba(255, 255, 255, 0.55)",
        }}
    >
        <Box
            className="mark-type-chip__dot"
            aria-hidden
            sx={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                flexShrink: 0,
                backgroundColor: MARK_TYPE_COLORS[markType],
            }}
        />
        <Typography
            className="mark-type-chip__label"
            sx={{
                fontSize: SIZE.micro,
                fontWeight: WEIGHT.bold,
                color: COLORS.onSurface,
                fontFamily: FONTS.sans,
                letterSpacing: TRACKING.caps,
                textTransform: "uppercase",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
            }}
        >
            {label}
        </Typography>
    </Box>
    );
};

export default MarkTypeChip;

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
 * `variant` picks the pill fill for the surface it sits on — mirroring
 * HubMenuStatBadge's variants: `"card"` (default) is translucent white, which
 * reads on a pastel hub card; `"surface"` is a neutral tint for the plain page
 * background.
 */
export const MarkTypeChip: React.FC<{
    markType: MarkType;
    variant?: "card" | "surface";
    className?: string;
}> = ({ markType, variant = "card", className }) => (
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
            {MARK_TYPE_LABELS[markType]}
        </Typography>
    </Box>
);

export default MarkTypeChip;

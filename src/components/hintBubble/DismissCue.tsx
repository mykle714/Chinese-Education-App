import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import TouchAppOutlinedIcon from "@mui/icons-material/TouchAppOutlined";
import { COLORS } from "../../theme";
import { WEIGHT } from "../../theme/scale";

/**
 * DismissCue — the "Tap / 👆 to / dismiss" cue printed in the bottom-right corner of a
 * tap-to-dismiss hint bubble: three short right-aligned lines, a tapping hand beside the
 * middle "to" (owner, 2026-11-08).
 *
 * LAYER: shared presentation (src/components). Pure render; the whole bubble is the tap
 * target, never this cue.
 *
 * Callers (each positions it with `sx`, since only the caller knows its own padding):
 *   - the flp hint pawn's bubble (features/flashcards/FlashcardsLearnPage/hintPawn/
 *     PawnHintBody.tsx, docs/HINT_PAWN.md), behind the `pawnDismissCue` soft intro;
 *   - the app notifications' sticky banners (src/components/notifications/
 *     NotificationViewport.tsx, docs/NOTIFICATIONS.md).
 *
 * Extracted from PawnHintBody 2026-11-14 so the two cannot drift apart.
 */

/**
 * The cue's text size: 10px, ONE STEP BELOW the type scale's smallest token
 * (`SIZE.micro`, 11px) — owner asked for it smaller still (2026-11-08). A local value, not
 * a token; a few other spots inline 10px too (e.g. card/SensePicker.tsx).
 */
const DISMISS_CUE_FONT_SIZE = "0.625rem";

export default function DismissCue({ className = "dismiss-cue", sx }: { className?: string; sx?: SxProps<Theme> }) {
    return (
        <Box
            className={className}
            sx={[
                {
                    flexShrink: 0,
                    alignSelf: "flex-end",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    fontSize: DISMISS_CUE_FONT_SIZE,
                    fontWeight: WEIGHT.semibold,
                    lineHeight: 1.1,
                    color: COLORS.textSecondary,
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            <span className={`${className}__line`}>Tap</span>
            <Box component="span" className={`${className}__line`} sx={{ display: "flex", alignItems: "center", gap: "2px" }}>
                <TouchAppOutlinedIcon className={`${className}__icon`} sx={{ fontSize: 12 }} />
                to
            </Box>
            <span className={`${className}__line`}>dismiss</span>
        </Box>
    );
}

import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";

/**
 * Shared `sx` fragments for the Reader (`/reader` list + `/reader/:id` document).
 *
 * The Reader wears the Friends panel's FLAT look (docs/FRIENDS_FEATURE.md,
 * src/features/friends/friendStyles.ts): the paper ground (`COLORS.background`), white
 * cards and rows with the `rowBorder` hairline, mid-tier pastel buttons with ink text
 * (hue never carries text), and plain-text loading / error lines instead of spinners and
 * MUI Alerts. Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look.
 *
 * Kept out of the components so each of those files exports only its component (the
 * react-refresh rule this repo lints for).
 *
 * ⚠️ `readerMutedTextSx`, `readerMessageSx` and the pill recipe in `readerPillButtonSx`
 * repeat friendStyles.ts's `mutedTextSx` / `messageSx` / `filledRowButtonSx`. Features
 * may not import from each other (docs/FRONTEND_LAYERING.md), so the shared home would be
 * a primitive under src/components — not done yet.
 *
 * Layer: feature styles (src/features/reader). Depended on by: TextSidebar.tsx,
 * TextHeader.tsx, ReaderEditToolbar.tsx, DeleteDocumentDialog.tsx, ReaderDocumentPage.tsx.
 */

/** The white card radius — SectionCard's 18px (src/components/primitives/SectionCard.tsx). */
export const READER_CARD_RADIUS = "18px";

/** A white card on the paper ground: SectionCard's skin without its page gutters. */
export const readerCardSx = {
    backgroundColor: COLORS.white,
    border: `1px solid ${COLORS.rowBorder}`,
    borderRadius: READER_CARD_RADIUS,
} as const;

/** Centred loading / empty-state copy (friendStyles → `mutedTextSx`). */
export const readerMutedTextSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    color: COLORS.textSecondary,
    textAlign: "center",
    py: 3,
} as const;

/** Inline error line (friendStyles → `messageSx`). */
export const readerMessageSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: COLORS.dangerInk,
} as const;

/**
 * A filled PILL button — the toolbar's Save and the delete dialog's Delete. The friends
 * recipe: a mid-tier ramp fill with INK text, the app's 1px button outline (CLAUDE.md §
 * Buttons & cards), caption-sized and compact. `fill` is a ramp MID colour; pass
 * `COLORS.white` for the neutral (Cancel) pill.
 */
export const readerPillButtonSx = (fill: string) => ({
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    lineHeight: LEADING.tight,
    color: COLORS.onSurface,
    backgroundColor: fill,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "999px",
    minWidth: 0,
    height: 30,
    px: 1.75,
    // Opts out of the ~300ms double-tap-zoom delay so rapid taps register at once.
    touchAction: "manipulation",
    "&:hover": { backgroundColor: fill, filter: "brightness(0.97)" },
    // Keep the fill when disabled (MUI would swap in its grey) so a blank draft's Save
    // reads as "not yet" rather than as a different control.
    "&.Mui-disabled": { color: COLORS.onSurface, backgroundColor: fill, opacity: 0.45 },
} as const);

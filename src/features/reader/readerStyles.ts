import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

/**
 * Shared `sx` fragments for the Reader (`/reader` list + `/reader/:id` document).
 *
 * The Reader is a TIER 2 page (docs/SHELF_REDESIGN.md § 7b "Time of day", since
 * 2026-11-17): each page calls `useTier2Look()` once and passes the `look` down, so the
 * ground is the pale sky tint by day and slate at night — the Dictionary's look. Inside
 * that it keeps the Friends panel's FLAT shapes (docs/FRIENDS_FEATURE.md,
 * src/features/friends/friendStyles.ts): flat cards and rows on a `line` hairline,
 * mid-tier pastel buttons with ink text (hue never carries text, and pastels stay pastel
 * at night), and plain-text loading / error lines instead of spinners and MUI Alerts.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look.
 *
 * Every fragment takes the page's `look`; the surfaces, hairlines and text colours come
 * from it, the pastel fills from COLORS / RAMP.
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
 * ReaderListToolbar.tsx, ReaderEditToolbar.tsx, ReaderReadAloudButton.tsx,
 * ReaderDocumentGrid.tsx, ReaderSortMenu.tsx, DeleteDocumentDialog.tsx, TextArea.tsx,
 * ReaderDocumentPage.tsx.
 */

/** The card radius — SectionCard's 18px (src/components/primitives/SectionCard.tsx). */
export const READER_CARD_RADIUS = "18px";

/**
 * A popover menu's paper in the flat Reader look: the look's surface, hairline, 14px
 * radius. Pair with `elevation: 0` (no MUI shadow). Used by the grid card's ⋯ menu
 * (ReaderDocumentGrid) and the toolbar's sort menu (ReaderSortMenu). MUI portals the menu
 * to <body>, so it must be coloured here rather than inherit from the page.
 */
export const readerMenuPaperSx = (look: Tier2Look) => ({
    backgroundColor: look.surface,
    border: `1px solid ${look.line}`,
    borderRadius: "14px",
}) as const;

/** Centred loading / empty-state copy (friendStyles → `mutedTextSx`). */
export const readerMutedTextSx = (look: Tier2Look) => ({
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    color: look.muted,
    textAlign: "center",
    py: 3,
}) as const;

/**
 * Inline error line (friendStyles → `messageSx`). The v2 `dangerInk` role IS plain ink,
 * so on a Tier 2 page it is the look's ink (light at night).
 */
export const readerMessageSx = (look: Tier2Look) => ({
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: look.ink,
}) as const;

/**
 * A PILL button — the toolbar's Save / New document, the delete dialog's actions, the
 * Read button. The friends recipe: caption-sized, compact, the app's 1px button outline
 * (CLAUDE.md § Buttons & cards; the look's `outline`).
 *
 *   `fill` given   — FILLED: a ramp MID colour with INK text (COLORS.onSurface), the
 *                    same by day and by night (pastels stay pastel on slate).
 *   `fill` omitted — NEUTRAL (Cancel, idle Read): the look's surface with the look's ink,
 *                    so it turns slate at night with the page.
 */
export const readerPillButtonSx = (look: Tier2Look, fill?: string) => {
    const background = fill ?? look.surface;
    const ink = fill ? COLORS.onSurface : look.ink;
    return {
        textTransform: "none",
        fontFamily: FONTS.sans,
        fontSize: SIZE.caption,
        fontWeight: WEIGHT.semibold,
        lineHeight: LEADING.tight,
        color: ink,
        backgroundColor: background,
        border: `1px solid ${look.outline}`,
        borderRadius: "999px",
        minWidth: 0,
        height: 30,
        px: 1.75,
        // Opts out of the ~300ms double-tap-zoom delay so rapid taps register at once.
        touchAction: "manipulation",
        "&:hover": { backgroundColor: background, filter: "brightness(0.97)" },
        // Keep the fill when disabled (MUI would swap in its grey) so a blank draft's Save
        // reads as "not yet" rather than as a different control.
        "&.Mui-disabled": { color: ink, backgroundColor: background, opacity: 0.45 },
    } as const;
};

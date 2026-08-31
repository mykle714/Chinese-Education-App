import { Box } from "@mui/material";
import Icon from "./Icon";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { WEIGHT, TRACKING } from "../theme/scale";

/**
 * `SheetPill` — the capsule that raises a bottom sheet.
 *
 * The app has exactly one affordance for "there is a sheet down there, tap to
 * raise it": a small centred capsule floating over the bottom of the surface,
 * `↑ <label>`. It ships on the flp (More Info → the eip), the fdp (Sets & Cards →
 * the decks sheet) and the cdp (More Info → the eip). This component is the shared
 * body of that shape so the three stay identical.
 *
 * Positioning contract: it is `position: absolute` and expects to be rendered
 * inside a positioned FRAME (not inside a scroll area), so the sheet's scrim can
 * cover it — the pill dims and stops taking taps exactly when it has nothing left
 * to do. `bottom` is measured from that frame; pass `FOOTER_CLEARANCE` on a page
 * that keeps the footer bar and `0`-ish on a footerless one.
 *
 * ── One frame, two pills (`align`) ────────────────────────────────────────────
 * A surface with TWO sheets (the fdp: Cards and Decks) puts its pills side by side.
 * They are still absolutely positioned individually rather than wrapped in a flex
 * row, because the scrim/zIndex contract above is per-pill and a wrapper would have
 * to reproduce it. `align` shifts each one off the frame's midline by half the gap:
 * "left" sits its right edge a half-gap before centre, "right" its left edge a
 * half-gap after. The PAIR is therefore centred as a unit whatever the two labels
 * measure — neither pill has to know the other's width.
 *
 * The flp keeps its own `MoreInfoPill` (`FlashcardsLearnPage/styled.ts`) because
 * that page MEASURES the pill (`useCardSlotPadding`) to size the card slot and
 * carries flip-state semantics; its visual spec is the one reproduced here.
 *
 * Referenced by docs/SHELF_REDESIGN.md, docs/DECKS_FEATURE.md, docs/LEAF_NODE_PAGES.md.
 */

/**
 * Gap between the two pills of a side-by-side pair, in px. Each pill is offset by
 * half of it, so the pair stays centred on the frame's midline.
 */
export const PILL_PAIR_GAP = 10;

export interface SheetPillProps {
    /** Text on the pill, e.g. "More Info" / "Sets & Cards". */
    label: string;
    onClick: () => void;
    /** Distance from the bottom of the positioned frame, in px. */
    bottom: number;
    /** Fixed pill height, in px — pages reserve this much space in their own flow. */
    height?: number;
    /** Drawn but inert and greyed: the surface is busy (e.g. the icon editor is open). */
    disabled?: boolean;
    /**
     * Faded but STILL TAPPABLE — there is nothing to expand on yet. A tap in this
     * state is how the surface explains itself (the flp's "flip the card first"
     * hint), so it must reach the handler.
     */
    dimmed?: boolean;
    /** Gentle bounce until the affordance has been used once. */
    pulse?: boolean;
    /** Accessible name; defaults to `Open ${label}`. */
    ariaLabel?: string;
    /** Set when the pill toggles a sheet whose open state the caller tracks. */
    ariaExpanded?: boolean;
    /**
     * Where the pill sits across the frame. "center" (default) is the single-sheet
     * case; "left"/"right" are the two halves of a two-sheet surface — see the
     * positioning contract above.
     */
    align?: "center" | "left" | "right";
    /** Leading icon; the arrow is the shared "this raises a sheet" mark. */
    iconName?: string;
    className?: string;
}

export const SheetPill: React.FC<SheetPillProps> = ({
    label,
    onClick,
    bottom,
    height = 34,
    disabled = false,
    dimmed = false,
    pulse = false,
    ariaLabel,
    ariaExpanded,
    iconName = "arrow_upward",
    align = "center",
    className,
}) => {
    // The static half of the pill's transform. It is factored out because the pulse
    // keyframes must RE-DECLARE it: a transform animation replaces the static value
    // wholesale, so every frame carries the placement as well as the bounce.
    const alignTransform =
        align === "left"
            ? `translateX(calc(-100% - ${PILL_PAIR_GAP / 2}px))`
            : align === "right"
                ? `translateX(${PILL_PAIR_GAP / 2}px)`
                : "translateX(-50%)";
    return (
    <Box
        component="button"
        type="button"
        className={className ? `sheet-pill ${className}` : "sheet-pill"}
        onClick={disabled ? undefined : onClick}
        aria-label={ariaLabel ?? `Open ${label}`}
        aria-disabled={disabled}
        aria-expanded={ariaExpanded}
        sx={{
            position: "absolute",
            bottom: `${bottom}px`,
            left: "50%",
            transform: alignTransform,
            zIndex: 2,
            height: `${height}px`,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "0 16px 0 14px",
            borderRadius: 999,
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.white,
            cursor: disabled ? "default" : "pointer",
            whiteSpace: "nowrap",
            // Only the busy case swallows taps; a dimmed pill still reaches its handler.
            pointerEvents: disabled ? "none" : "auto",
            opacity: disabled ? 0.32 : dimmed ? 0.32 : 1,
            transition: "opacity 0.35s ease",
            animation: pulse && !disabled ? "sheetPillPulse 1.6s ease-in-out infinite" : "none",
            "@keyframes sheetPillPulse": {
                "0%, 100%": { transform: `${alignTransform} translateY(0)`, opacity: 0.7 },
                "50%": { transform: `${alignTransform} translateY(-4px)`, opacity: 1 },
            },
        }}
    >
        <Icon name={iconName} size={16} sx={{ opacity: 0.72 }} />
        <Box
            component="span"
            className="sheet-pill__label"
            sx={{
                fontFamily: FONTS.sans,
                fontSize: 13,
                fontWeight: WEIGHT.semibold,
                letterSpacing: TRACKING.wide,
                color: COLORS.onSurface,
            }}
        >
            {label}
        </Box>
    </Box>
    );
};

export default SheetPill;

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
 * The flp keeps its own `MoreInfoPill` (`FlashcardsLearnPage/styled.ts`) because
 * that page MEASURES the pill (`useCardSlotPadding`) to size the card slot and
 * carries flip-state semantics; its visual spec is the one reproduced here.
 *
 * Referenced by docs/SHELF_REDESIGN.md, docs/DECKS_FEATURE.md, docs/LEAF_NODE_PAGES.md.
 */

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
    className,
}) => (
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
            // The pulse keyframes re-declare this translate: a transform animation
            // replaces the static one wholesale, so both halves live in each frame.
            transform: "translateX(-50%)",
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
                "0%, 100%": { transform: "translateX(-50%) translateY(0)", opacity: 0.7 },
                "50%": { transform: "translateX(-50%) translateY(-4px)", opacity: 1 },
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

export default SheetPill;

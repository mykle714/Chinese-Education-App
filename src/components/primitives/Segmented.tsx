import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * `Segmented` — the design's `.trkseg`: a hairline-outlined pill split into 2–4
 * mono-uppercase choices, exactly one of which is active (filled ink, paper text).
 *
 * ── Why this is a primitive and not a page-local control ──────────────────────
 * The shelf system already owns three "pick one of a few" shapes and they mean
 * different things, so they are deliberately different components:
 *
 *   `Segmented` (`.trkseg`) — pick which SLICE of the same data you are looking at.
 *       The content below it does not change kind, only which track/period/lens it
 *       reports. Small, mono, quiet: it is a lens control, not a destination.
 *   `.tabs2` (eip tab strip)  — pick which KIND of content to show. Full width,
 *       sentence case, underlined. Lives in the eip, not here.
 *   `.chip` / `.mode` (MUI theme overrides) — a filter or a mode that changes what
 *       an action will DO.
 *
 * The first of those had two independent copies pending (cdp's Know/Read/Write track
 * switch and the eip's own sense/lens toggles), which is precisely how a design
 * system stops being one — hence this file.
 *
 * NOT a MUI `ToggleButtonGroup`: the group ships 44px-tall touch targets, a ripple and
 * a border-collapse scheme that all have to be overridden away to reach an 8.5px mono
 * pill, and what survived the overrides was a `Box` with extra steps.
 *
 * Depended on by: docs/SHELF_REDESIGN.md § A5. Sibling primitives: `Label`, `Row`.
 */

export interface SegmentedOption<T extends string> {
    value: T;
    /** Rendered uppercase and widely tracked, so keep it to one short word. */
    label: string;
}

export interface SegmentedProps<T extends string> {
    options: readonly SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Accessible name for the group as a whole, e.g. "Mastery track". */
    ariaLabel: string;
    className?: string;
    sx?: SxProps<Theme>;
}

export function Segmented<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    className,
    sx,
}: SegmentedProps<T>) {
    return (
        <Box
            className={className ? `segmented ${className}` : "segmented"}
            role="tablist"
            aria-label={ariaLabel}
            sx={[
                {
                    display: "flex",
                    flexShrink: 0,
                    border: `1px solid ${COLORS.rowBorder}`,
                    borderRadius: "999px",
                    // The active segment is a solid fill that must clip to the pill's
                    // curve; without this the ink square pokes out of both ends.
                    overflow: "hidden",
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            {options.map((option, index) => {
                const active = option.value === value;
                return (
                    <Typography
                        key={option.value}
                        component="button"
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`segmented__option segmented__option--${option.value}${active ? " segmented__option--active" : ""}`}
                        onClick={() => onChange(option.value)}
                        sx={{
                            fontFamily: FONTS.label,
                            fontSize: 8.5,
                            fontWeight: 500,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            lineHeight: 1.2,
                            padding: "4px 9px",
                            cursor: "pointer",
                            userSelect: "none",
                            border: "none",
                            // A divider BETWEEN segments only — a leading border would
                            // double up with the container's own outline.
                            borderLeft: index === 0 ? "none" : `1px solid ${COLORS.rowBorder}`,
                            backgroundColor: active ? COLORS.onSurface : "transparent",
                            color: active ? COLORS.background : COLORS.textFaint,
                            // No transition on the fill: the control switches what is
                            // being reported below it, and a 200ms cross-fade on the
                            // pill reads as lag on a change that is instant.
                            "&:hover": { color: active ? COLORS.background : COLORS.textSecondary },
                        }}
                    >
                        {option.label}
                    </Typography>
                );
            })}
        </Box>
    );
}

export default Segmented;

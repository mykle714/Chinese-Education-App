import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { COLORS } from "../theme/colors";

/**
 * Icon — the app's single icon primitive (docs/SHELF_REDESIGN.md, decision D3).
 *
 * The redesign replaces per-icon `@mui/icons-material` component imports with the
 * Material Symbols Rounded LIGATURE face: you name a glyph as a string and the font
 * substitutes it. This wrapper exists so that naming is the ONLY thing a call site
 * does — every mechanical detail (the `.ms` class, the variation axes, the optical
 * size coupling, selection blocking) lives here.
 *
 * WHY A WRAPPER AND NOT A BARE `<span className="ms">`:
 *   1. A bare span renders the literal text "nights_stay" for as long as the face is
 *      missing or the ligature feature is off. One place to get that right.
 *   2. Material Symbols is a VARIABLE font on four axes. `font-variation-settings`
 *      is easy to write inconsistently across 200 call sites and produces icons that
 *      are subtly different weights on different screens.
 *   3. `opsz` must track the rendered size or the glyph's stroke weight drifts —
 *      that coupling is done here, once, rather than remembered per site.
 *
 * Glyph names come from the design's artboards verbatim (`nights_stay`, `chevron_right`,
 * `local_fire_department`). They are Google's canonical Material Symbols names, so a
 * name that renders in the artboard renders here.
 *
 * MATERIAL SYMBOLS is NOT MATERIAL ICONS. The older Material *Icons* set carries names
 * that Symbols dropped or renamed, and a name missing from the face fails silently in
 * code and very loudly on screen: the ligature never substitutes, so the control renders
 * the raw string "MULTITRACK_AUDIO" in the header. That shipped in AudioModeChip on
 * 2026-08-28 (`multitrack_audio` is Icons-only; the Symbols equivalent is `graphic_eq`).
 * A glyph name recalled from memory is not evidence — check it against the `name` fields
 * of https://fonts.google.com/metadata/icons before using it, and look at what rendered.
 *
 * Depended on by: every page converted to the shelf system.
 * See docs/SHELF_REDESIGN.md § A1 and the `.ms` rule in src/index.css.
 */

export interface IconProps {
    /**
     * The Material Symbols ligature name, e.g. "nights_stay". Taken verbatim from the
     * artboard's `<span class="ms">…</span>` content.
     */
    name: string;
    /**
     * Rendered size in px. Also drives the `opsz` axis (clamped to the font's 20–48
     * range), so a 64px hero icon and a 16px row chevron carry the stroke weight the
     * face was drawn for at that size rather than a scaled-up 24px outline.
     */
    size?: number;
    /** Defaults to the ink ramp's icon tone (--ink2). */
    color?: string;
    /**
     * Stroke weight, 100–700. The design uses the 400 default everywhere; raise it only
     * for an icon that must hold its own against heavy type beside it.
     */
    weight?: number;
    /** 0 = outlined (the design's default), 1 = filled. */
    fill?: 0 | 1;
    /** Escape hatch for positioning/opacity. Do not set font-family or the axes here. */
    sx?: SxProps<Theme>;
    className?: string;
    "aria-label"?: string;
}

const Icon: React.FC<IconProps> = ({
    name,
    size = 20,
    color = COLORS.iconColor,
    weight = 400,
    fill = 0,
    sx,
    className,
    "aria-label": ariaLabel,
}) => (
    <Box
        component="span"
        // `.ms` (src/index.css) carries the family + ligature settings; this component
        // carries only what varies per instance.
        className={className ? `ms ${className}` : "ms"}
        // An icon with no label is decorative — the adjacent text names the action, and
        // announcing "chevron_right" would be noise. One WITH a label is the control
        // itself (a bare header button), so it needs a role and a name.
        aria-hidden={ariaLabel ? undefined : true}
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
        sx={{
            fontSize: size,
            color,
            // opsz tracks the rendered size, clamped to the axis's real range.
            fontVariationSettings: `'FILL' ${fill}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${Math.min(48, Math.max(20, size))}`,
            ...sx,
        }}
    >
        {name}
    </Box>
);

export default Icon;

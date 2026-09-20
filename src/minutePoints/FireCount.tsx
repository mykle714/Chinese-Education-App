import { Box, Typography } from "@mui/material";
import Icon from "../components/Icon";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * `FireCount` — the app's flame-and-number readout, as a PURE presentational
 * component: a Material Symbols Rounded `local_fire_department` glyph beside a mono
 * tabular count, 4px apart, both in one tone.
 *
 * This is the design's `.hd .fire` treatment (docs/SHELF_REDESIGN.md) extracted out of
 * `MinutePointsFireBadge` so that a SECOND caller can show a minutes figure without
 * re-deriving the glyph, the gap, the mono/tabular numerals and the fill-clip maths.
 * There are two callers today and they need opposite things from it:
 *
 *   `MinutePointsFireBadge`  the viewer's OWN live balance, in every page header. It
 *                            passes `fillPct` so the glyph doubles as the seconds
 *                            gauge, and it owns all of the state — the hooks, the
 *                            eligibility branch, the tick, the pulse.
 *   `ProfileStatsCard`       SOMEBODY ELSE's banked minutes for ONE language, a static
 *                            figure on a profile. No fill, no pulse, no ticking.
 *
 * ⚠️ THAT SECOND CALLER IS WHY THIS IS PRESENTATIONAL. `MinutePointsFireBadge` reads
 * `useMinutePoints()` internally and is therefore hard-wired to the signed-in viewer
 * and their selected language; dropping it onto a profile would have shown the
 * VIEWER'S own live count under somebody else's name. The visual is shareable, the
 * source of the number is not, so the number is a prop.
 */

/** The flame's rendered size when a caller does not ask for another, in px. */
export const FIRE_GLYPH_SIZE_PX = 22.5;

/**
 * Where the flame's INK sits inside its em box, as a percentage of that box measured
 * from the bottom. A Material Symbols glyph does not touch the edges of its em square,
 * so a raw 0–100% clip would spend its first and last ~8% moving through empty space —
 * the fill would look stalled at both ends. Clipping between these two marks makes the
 * orange line track the visible flame instead of the invisible box.
 *
 * Exported because the one caller that computes a fill level has to map its 0–100
 * progress onto this band, and a second copy of these numbers would drift.
 */
export const INK_BOTTOM_PCT = 8;
export const INK_TOP_PCT = 94;

export interface FireCountProps {
    /** The figure beside the flame. A node so a caller can suffix a unit. */
    value: React.ReactNode;
    /** Ink for both glyph and numeral. Defaults to the design's `COLORS.fireActive`. */
    tone?: string;
    /** Glyph size in px. The numeral scales with `countFontSize`, not with this. */
    glyphSize?: number;
    /**
     * Numeral size — a px number or any CSS length. It takes a string so a caller can
     * pass a `SIZE` token (those are `rem`, and respect the reader's browser font
     * size); the default stays the design's literal 11px, which the header badge is
     * authored at.
     */
    countFontSize?: number | string;
    /**
     * Height of the bottom-anchored fill window over the glyph, as a percentage of the
     * glyph box — already mapped onto the ink band by the caller.
     *
     * Omit it for a FLAT solid flame, which is what a static figure wants: a part-full
     * gauge beside a number that cannot move is a lie the eye has to re-check. Pass it
     * only where the level means something.
     */
    fillPct?: number;
    /** Ease the fill's height over exactly one second instead of snapping to it. */
    animateFill?: boolean;
    /** Strike the numeral through — "this is not counting". */
    struck?: boolean;
    /** Accessible name for the whole readout. */
    title?: string;
    className?: string;
    /** Applied to the root, for placement (position, margin) only. */
    sx?: React.ComponentProps<typeof Box>["sx"];
}

const FireCount: React.FC<FireCountProps> = ({
    value,
    tone = COLORS.fireActive,
    glyphSize = FIRE_GLYPH_SIZE_PX,
    countFontSize = 11,
    fillPct,
    animateFill = false,
    struck = false,
    title,
    className,
    sx,
}) => {
    // A caller that passes no level gets one solid glyph; one that does gets a faint
    // ghost with a clipped solid copy over it. The ghost only exists to be the GROUND
    // the level is read against, so without a level it would just dim the badge.
    const isGauge = fillPct !== undefined;

    return (
        <Box
            className={className ? `fire-count ${className}` : "fire-count"}
            title={title}
            sx={[
                {
                    display: "flex",
                    alignItems: "center",
                    // The design's 4px: tight enough that the glyph reads as the count's
                    // UNIT rather than as a separate icon that happens to sit nearby.
                    gap: "4px",
                    fontFamily: FONTS.mono,
                    color: tone,
                    // Fade rather than snap between tones. Chromium leaves a ghost
                    // repaint when a filter is removed outright, which is why the old
                    // glow was animated to transparent instead of `none`; with the glow
                    // gone this is just a colour transition, but the reasoning holds.
                    transition: "color 0.3s ease-out",
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            <Box
                className="fire-count__flame"
                sx={{
                    position: "relative",
                    width: `${glyphSize}px`,
                    height: `${glyphSize}px`,
                    // The glyph is inline-block with line-height 1; zeroing the line box
                    // keeps the wrapper exactly one em tall so the clip maths is exact.
                    lineHeight: 0,
                    flexShrink: 0,
                }}
            >
                {/* The vessel. Filled rather than outlined: an outline would give the
                    rising level a second edge to cross and read as a gauge, and the
                    glyph's job is to be recognised at a glance. Faint ONLY as a gauge's
                    ground — a flat flame is drawn at full strength and is the whole
                    readout. */}
                <Icon
                    className="fire-count__icon"
                    name="local_fire_department"
                    size={glyphSize}
                    color={tone}
                    fill={1}
                    sx={{
                        position: "absolute",
                        left: 0,
                        bottom: 0,
                        opacity: isGauge ? 0.24 : 1,
                        transition: "opacity 0.3s ease-out",
                    }}
                />
                {/* The level. A bottom-anchored window over an identical glyph: the
                    window grows, the glyph inside it does not move (it is pinned to the
                    window's bottom edge, which is the wrapper's bottom edge). Not
                    rendered at all without a level, rather than held at 100% — an
                    unmounted layer cannot animate on the way in or out, and the solid
                    base glyph above already reads as a full flame. */}
                {isGauge && (
                    <Box
                        className="fire-count__flame-fill"
                        aria-hidden
                        sx={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: `${fillPct}%`,
                            overflow: "hidden",
                            // Linear, and exactly the tick interval: the level should
                            // arrive at each second's value just as the next tick starts,
                            // with no easing that would make it visibly accelerate
                            // mid-second.
                            transition: animateFill ? "height 1s linear" : "none",
                            willChange: "height",
                        }}
                    >
                        <Icon
                            name="local_fire_department"
                            size={glyphSize}
                            // `tone`, not a hard-coded orange: going idle must desaturate
                            // the level, never discard it. Grey-on-grey then makes the
                            // whole glyph read flat, which is the idle state's point.
                            color={tone}
                            fill={1}
                            sx={{ position: "absolute", left: 0, bottom: 0, transition: "color 0.3s ease-out" }}
                        />
                    </Box>
                )}
            </Box>
            <Typography
                className="fire-count__count"
                component="span"
                sx={{
                    fontFamily: FONTS.mono,
                    fontSize: countFontSize,
                    // Tabular so the row does not shift width as the count ticks over.
                    fontVariantNumeric: "tabular-nums",
                    color: tone,
                    lineHeight: 1,
                    textDecoration: struck ? "line-through" : "none",
                }}
            >
                {value}
            </Typography>
        </Box>
    );
};

export default FireCount;

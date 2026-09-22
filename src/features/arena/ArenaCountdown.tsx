import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { formatCountdownParts } from "./arenaStyles";

/**
 * The arena's clock — `.cdcard` and `.opens` in `Arena Flow - Shelf System.html`.
 *
 * ONE component for both, because they are the same object: the two classes are
 * byte-identical in the artboards' stylesheet and differ only in their caption. What
 * changes between states is which instant is being counted to and what to call it:
 *
 *   live     "ARENA CLOSES IN"      → the arena's `closesAt`
 *   results  "NEXT ARENA OPENS IN"  → the next formation
 *   out      "NEXT ARENA OPENS IN"  → the next formation
 *   waiting  "YOUR ARENA OPENS IN"  → the next formation, now with a seat in it
 *
 * ── IT IS NOT A CARD ────────────────────────────────────────────────────────────────
 * Despite the `.cdcard` class name it has no fill, no border and no radius — it is
 * centred type on the paper ground. That is the point: the countdown is the page's
 * headline under the banner, and boxing it would make it one more panel in a stack of
 * panels. It was a bordered `SectionCard` with the viewer's rank on its right before the
 * arena flow; the rank moved out (it is on the viewer's own board row, highlighted) and
 * the box went with it.
 *
 * ── THE TIMEZONE SUFFIX IS LOAD-BEARING ─────────────────────────────────────────────
 * When the arena's timezone differs from the viewer's, `subtitle` names the zone
 * (docs/ARENA_FEATURE.md § 3). Membership and the clock are frozen at formation, so a
 * member who flies keeps racing to the arena's clock, and an unqualified "Closes Sunday
 * 16:00" would be quietly wrong for exactly that person. The caller composes the string;
 * this component only draws it.
 */
export interface ArenaCountdownProps {
    /** Mono overline — "Arena closes in", "Next arena opens in". Uppercased by the style. */
    label: string;
    /** The instant being counted to, ISO-8601. */
    target: string;
    /** The line under the figure — "Closes Sunday 16:00", optionally zone-qualified. */
    subtitle: string;
    className?: string;
}

const ArenaCountdown: React.FC<ArenaCountdownProps> = ({ label, target, subtitle, className }) => {
    // Held as the raw remainder rather than as formatted parts, so the formatting rule
    // lives in exactly one place (`formatCountdownParts`) and this component re-renders
    // on a number rather than on an array identity.
    const [remaining, setRemaining] = useState(() => new Date(target).getTime() - Date.now());

    useEffect(() => {
        // Re-seed immediately: `target` can change between states (closesAt → the next
        // opening) while this component stays mounted, and waiting a second to correct
        // it would show the OLD arena's clock for one tick.
        setRemaining(new Date(target).getTime() - Date.now());
        const id = window.setInterval(() => setRemaining(new Date(target).getTime() - Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [target]);

    const parts = formatCountdownParts(remaining);

    return (
        <Box className={className ? `arena-countdown ${className}` : "arena-countdown"} sx={{ margin: "16px 22px 0", textAlign: "center" }}>
            <Typography
                className="arena-countdown__label"
                sx={{
                    fontFamily: FONTS.label,
                    fontSize: 13,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: COLORS.textFaint,
                }}
            >
                {label}
            </Typography>
            <Box
                className="arena-countdown__row"
                sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", marginTop: "8px" }}
            >
                <Box
                    className="arena-countdown__figure"
                    sx={{
                        display: "flex",
                        // Baseline, not centre: the 52px figures and the 21px unit letters
                        // are wildly different sizes, and centring would float the small
                        // ones in the middle of the big ones rather than sitting them on
                        // the same line.
                        alignItems: "baseline",
                        justifyContent: "center",
                        gap: "5px",
                        fontFamily: FONTS.mono,
                        fontSize: 52,
                        lineHeight: 0.95,
                        letterSpacing: "-0.03em",
                        fontWeight: 500,
                        color: COLORS.onSurface,
                        // Tabular figures so the row does not jitter sideways once a
                        // second as digits change width. The whole point of a live clock
                        // is that only the numbers move.
                        fontVariantNumeric: "tabular-nums",
                    }}
                >
                    {parts.map((part) => (
                        <Box component="span" key={part.unit} sx={{ display: "contents" }}>
                            {part.value}
                            <Box
                                component="span"
                                className="arena-countdown__unit"
                                sx={{ fontSize: 21, color: COLORS.textSecondary, marginRight: "4px" }}
                            >
                                {part.unit}
                            </Box>
                        </Box>
                    ))}
                </Box>
                <Typography
                    className="arena-countdown__subtitle"
                    sx={{ fontFamily: FONTS.sans, fontSize: 16, color: COLORS.textSecondary }}
                >
                    {subtitle}
                </Typography>
            </Box>
        </Box>
    );
};

export default ArenaCountdown;

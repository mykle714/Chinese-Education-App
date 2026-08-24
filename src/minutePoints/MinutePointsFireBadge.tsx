import React from "react";
import { Box, Typography } from "@mui/material";
import Icon from "../components/Icon";
import { useMinutePoints } from "./useMinutePoints";
import { useAuth } from "../AuthContext";
import { useMinutePointsPaused } from "./minutePointsPause";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * The minute-points flame — the app's single earning indicator, in every header.
 *
 * This is the design's `.hd .fire` / `.lhd .fire` treatment (docs/SHELF_REDESIGN.md):
 * a Material Symbols Rounded `local_fire_department` glyph at 15px beside a mono count
 * at 11px, both in `COLORS.fireActive` (#E65100 — the design writes the same hex), with a
 * 4px gap. Nothing else: no MUI `Badge` bubble, no bordered counter chip, no drop-shadow
 * glow, no circular ground.
 *
 * ── WHY IT GOT SMALLER RATHER THAN RESTYLED ──────────────────────────────────────────
 * The old badge was a 24px filled MUI icon carrying an overlaid count bubble and an
 * animated orange glow. It read as the loudest thing in the header on every page — and it
 * is ambient: it reports that time is accruing, which is true almost all of the time. The
 * design demotes it to a quiet mono readout beside a small glyph, so it is legible when
 * looked at and silent when not. The one moment it should be noticed — a point actually
 * landing — is still animated, and now that it is the only motion in the component, a
 * short scale pulse is enough.
 *
 * ── THE THREE STATES ─────────────────────────────────────────────────────────────────
 *   active  the flame and the count in fireActive orange; time is accruing.
 *   idle    both in the muted ink; not earning — either an eligible page the user has
 *           gone quiet on, or an ineligible one (every menu/browse surface).
 *   paused  same muted ink plus a struck-through count — accumulation is deliberately on
 *           hold (flp icon-layout editor). The old treatment overlaid a large red
 *           no-entry glyph on the flame, which at 15px would be a red smudge; a line
 *           through the number says "this is not counting" at any size.
 *
 * Calls `useMinutePoints` internally rather than taking it as a prop, so the per-second
 * tick re-renders this leaf only — never the page hosting it, which would interrupt an
 * in-progress drag gesture.
 *
 * Rendered by: `PageHeader` itself, LAST in its right slot, on EVERY header in the app —
 * pages neither import nor pass it. On a page that is not in MINUTE_POINTS_ELIGIBLE_PAGES
 * (the hub menus, the cdp, the deck/collection browsers) `useMinutePoints` forces
 * `isActive` false, so the badge draws its idle grey there: "not earning" is an answer,
 * and one worth showing everywhere the learner can ask the question.
 *
 * Renders nothing when signed out — there is no balance to report, and "0 0s" would read
 * as a broken counter rather than as "no account".
 */
const MinutePointsFireBadge: React.FC = () => {
    const { user } = useAuth();
    const minutePoints = useMinutePoints();
    const paused = useMinutePointsPaused();
    // Hooks first, then bail: a signed-out visitor on a public page has no minute
    // balance, so the header shows no flame at all.
    if (!user) return null;
    const earning = !paused && minutePoints.isActive;
    const tone = earning ? COLORS.fireActive : COLORS.textSecondary;

    return (
        <Box
            className="minute-points-fire-badge"
            sx={{
                display: "flex",
                alignItems: "center",
                // The design's 4px: tight enough that the glyph reads as the count's UNIT
                // rather than as a separate icon that happens to sit nearby.
                gap: "4px",
                fontFamily: FONTS.mono,
                color: tone,
                // Fade rather than snap between earning and idle. Chromium leaves a ghost
                // repaint when a filter is removed outright, which is why the old glow was
                // animated to transparent instead of `none` — with the glow gone this is
                // just a colour transition, but the same reasoning applies.
                transition: "color 0.3s ease-out",
                animation: (earning && minutePoints.isAnimating)
                    ? "minutePointsFirePulse 0.6s ease-out"
                    : "none",
                "@keyframes minutePointsFirePulse": {
                    "0%, 100%": { transform: "scale(1)" },
                    "50%": { transform: "scale(1.16)" },
                },
            }}
        >
            <Icon
                className="minute-points-fire-badge__icon"
                name="local_fire_department"
                size={15}
                color={tone}
                // Filled: a hollow flame at 15px loses its silhouette, and this glyph's
                // whole job is to be recognised at a glance rather than read.
                fill={1}
            />
            <Typography
                className="minute-points-fire-badge__count"
                component="span"
                sx={{
                    fontFamily: FONTS.mono,
                    fontSize: 11,
                    // Tabular so the row does not shift width as the count ticks over.
                    fontVariantNumeric: "tabular-nums",
                    color: tone,
                    lineHeight: 1,
                    textDecoration: paused ? "line-through" : "none",
                }}
            >
                {minutePoints.currentPoints}
                {/* The live seconds toward the next point, kept as a faint suffix rather
                    than the old second line: it is the reason the flame is worth glancing
                    at mid-session, but it is not the figure. */}
                <Box
                    component="span"
                    className="minute-points-fire-badge__seconds"
                    sx={{ fontSize: 9, opacity: 0.65, marginLeft: "3px" }}
                >
                    {minutePoints.liveSeconds}s
                </Box>
            </Typography>
        </Box>
    );
};

export default MinutePointsFireBadge;

import React, { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import Icon from "../components/Icon";
import { useMinutePoints } from "./useMinutePoints";
import { useAuth } from "../AuthContext";
import { useMinutePointsPaused } from "./minutePointsPause";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * Rendered size of the flame glyph, in px. Shared by the base and the fill copy.
 *
 * The design's `.hd .fire` draws it at 15px beside an 11px count. It is drawn 50% larger
 * here (2026-08-24) because the glyph now carries the seconds as a fill level, not just an
 * identity: at 15px the ink band is ~13px tall, so one second of progress is a fifth of a
 * pixel and the creep is invisible. Enlarging the glyph is what makes the animation
 * legible; the count stays at 11px, so the flame — not the number — is the thing the eye
 * lands on, which matches what it now reports.
 */
const FLAME_SIZE_PX = 22.5;

/**
 * Where the flame's INK sits inside its em box, as a percentage of that box measured
 * from the bottom. A Material Symbols glyph does not touch the edges of its em square,
 * so a raw 0–100% clip would spend its first and last ~8% moving through empty space —
 * the fill would look stalled at both ends. Clipping between these two marks makes the
 * orange line track the visible flame instead of the invisible box.
 */
const INK_BOTTOM_PCT = 8;
const INK_TOP_PCT = 94;

/**
 * The largest rise (in points of the ink band) that is allowed to ANIMATE. One second of
 * study advances the level by exactly 1/60 of the band, so anything appreciably larger is
 * not a tick — it is the first paint after the day's total loads from the server, or a
 * resume, or any other jump — and animating it would sweep the flame from empty to its
 * real level in a single second, which reads as sixty seconds of progress arriving at
 * once. Those jumps snap; only the per-second creep is interpolated.
 */
const SMOOTH_STEP_LIMIT_PCT = ((INK_TOP_PCT - INK_BOTTOM_PCT) / 60) * 1.6;

/**
 * The minute-points flame — the app's single earning indicator, in every header.
 *
 * This is the design's `.hd .fire` / `.lhd .fire` treatment (docs/SHELF_REDESIGN.md):
 * a Material Symbols Rounded `local_fire_department` glyph beside a mono count at 11px,
 * both in `COLORS.fireActive` (#E65100 — the design writes the same hex), with a 4px gap.
 * The glyph is drawn at `FLAME_SIZE_PX`, 50% over the design's 15px — see that constant. Nothing else: no MUI `Badge` bubble, no bordered counter chip, no drop-shadow
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
 * ── THE FLAME IS THE SECONDS COUNTER ─────────────────────────────────────────────────
 * Progress toward the next point used to be a literal `42s` suffix beside the count. Two
 * numbers sat side by side in the same readout, one of which (the count) matters and one
 * of which (the seconds) is pure countdown noise the eye has to parse to discard. The
 * seconds are now drawn INSIDE the glyph: the flame renders twice, a hollow ghost of
 * itself underneath and a solid `fireActive` copy on top clipped to a bottom-anchored
 * window whose height is `progressToNextPoint`. The flame therefore fills with orange over
 * the minute and empties the instant a point lands — the same information, read as a level
 * rather than as a number, and it costs no horizontal space in the header.
 *
 * The clip height carries a 1s LINEAR transition so the level creeps continuously between
 * the hook's one-second ticks instead of stepping. That transition plays for ONE shape of
 * change only — a rise of about 1/60 of the band, which is what one second of study is
 * worth (`SMOOTH_STEP_LIMIT_PCT`). Everything else snaps: the wrap at a point landing
 * (interpolating it would drain the flame over a second and read as losing progress — the
 * scale pulse marks the moment instead), and any larger rise, which is a load or a resync
 * and would otherwise sweep a whole minute of progress past the eye in one second.
 *
 * ── THE STATES ───────────────────────────────────────────────────────────────────────
 * The badge draws in one of two MODES, chosen by whether the current page can earn at all
 * (`isEligiblePage`). The gauge only exists where the number it reports can move.
 *
 *   OFF-STUDY MODE (every menu, hub and browse surface — the cdp, the deck browsers, the
 *   hubs). One flat, solid `fireActive` flame beside the count. No ghost, no clipped fill
 *   layer, no pulse. A part-full gauge on a page that cannot fill it is a lie the eye has
 *   to re-check every time it lands there: it invites the learner to watch a level that
 *   is frozen by construction. The count is still the real balance, so the flame here is
 *   pure identity — "this is your minutes number" — and nothing more.
 *
 *   STUDY MODE (`MINUTE_POINTS_ELIGIBLE_PAGES`) — the ghost + fill treatment, in two
 *   activity states:
 *     active  the flame in fireActive orange, filling; time is accruing.
 *     idle    the same flame and the same level, in muted ink — an eligible page the user
 *             has gone quiet on. Only the COLOUR changes between active and idle: the
 *             level is neither reset nor flattened, because the banked seconds are not
 *             lost, because resetting it made every resume replay the whole fill in one
 *             second, and because a learner returning to the page should find the flame
 *             where they left it.
 *     paused  same muted ink plus a struck-through count — accumulation is deliberately on
 *             hold (flp icon-layout editor). The old treatment overlaid a large red
 *             no-entry glyph on the flame, which at header sizes is a red smudge, and
 *             which would now also obscure the fill level; a line through the number says
 *             "this is not counting" at any size and leaves the glyph alone.
 *
 * Calls `useMinutePoints` internally rather than taking it as a prop, so the per-second
 * tick re-renders this leaf only — never the page hosting it, which would interrupt an
 * in-progress drag gesture.
 *
 * Rendered by: `PageHeader` itself, LAST in its right slot, on EVERY header in the app —
 * pages neither import nor pass it. On a page that is not in MINUTE_POINTS_ELIGIBLE_PAGES
 * `useMinutePoints` also forces `isActive` false; the badge does not lean on that, it
 * branches on `isEligiblePage` directly, because "cannot earn here" and "could earn here
 * but has gone quiet" are different answers and only the second one has a level to show.
 *
 * Renders nothing when signed out — there is no balance to report, and "0" would read
 * as a broken counter rather than as "no account".
 */
const MinutePointsFireBadge: React.FC = () => {
    const { user } = useAuth();
    const minutePoints = useMinutePoints();
    const paused = useMinutePointsPaused();

    // A page that cannot accrue minutes gets the flat solid flame — see OFF-STUDY MODE
    // above. Note this is NOT `!isActive`: an eligible page the learner has gone quiet on
    // is still a study surface and keeps its (greyed) gauge.
    const isStudySurface = minutePoints.isEligiblePage;
    const earning = !paused && minutePoints.isActive;
    // Off-study the flame is always solid orange: there is no earning/idle distinction to
    // report there, so greying it would only ask a question the page cannot answer.
    const tone = (earning || !isStudySurface) ? COLORS.fireActive : COLORS.textSecondary;

    // 0–100 progress toward the next minute point, mapped onto the glyph's ink band.
    // Computed whether or not we are earning: the seconds already banked are not lost when
    // the learner goes quiet, so the LEVEL must not move on an activity change — only its
    // colour does. (Zeroing it while idle made every resume replay a 0→level rise in one
    // second, and `ACTIVITY_TIMEOUT_MS` is 15s, so that was most of the time.)
    const progress = Math.min(100, Math.max(0, minutePoints.progressToNextPoint));
    const fillHeightPct = progress <= 0
        ? 0
        : INK_BOTTOM_PCT + (progress / 100) * (INK_TOP_PCT - INK_BOTTOM_PCT);

    // Animate ONLY a plausible one-second rise (1/60 of the band). A drop is the wrap at a
    // point landing — interpolating it would drain the flame over a second and read as
    // losing progress. A rise bigger than one tick is a load or a resync, and sweeping up
    // to it would look like a minute passing in a second. Both snap.
    // Compared against the level the DOM currently shows: the effect below updates the ref
    // AFTER the render, so this render still sees the previous one.
    const prevFillRef = useRef<number>(fillHeightPct);
    const step = fillHeightPct - prevFillRef.current;
    const isSmoothTick = step > 0 && step <= SMOOTH_STEP_LIMIT_PCT;
    useEffect(() => {
        prevFillRef.current = fillHeightPct;
    });

    // Hooks first, then bail: a signed-out visitor on a public page has no minute
    // balance, so the header shows no flame at all.
    if (!user) return null;

    return (
        <Box
            className="minute-points-fire-badge"
            // The seconds are no longer written out, so the only place the exact figure
            // survives is the accessible name.
            title={`${minutePoints.currentPoints} minute points — ${minutePoints.liveSeconds}s toward the next`}
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
            <Box
                className="minute-points-fire-badge__flame"
                sx={{
                    position: "relative",
                    width: `${FLAME_SIZE_PX}px`,
                    height: `${FLAME_SIZE_PX}px`,
                    // The glyph is inline-block with line-height 1; zeroing the line box
                    // keeps the wrapper exactly one em tall so the clip maths is exact.
                    lineHeight: 0,
                    flexShrink: 0,
                }}
            >
                {/* The vessel. Filled rather than outlined: an outline would give the
                    rising level a second edge to cross and read as a gauge, and the glyph's
                    job is to be recognised at a glance. Always faint, in EVERY state — the
                    ghost/level contrast is what draws the level at all, so dropping it
                    while idle would hide the banked seconds behind a flat glyph. Idle
                    changes the ink, never the shape. */}
                <Icon
                    className="minute-points-fire-badge__icon"
                    name="local_fire_department"
                    size={FLAME_SIZE_PX}
                    color={tone}
                    fill={1}
                    sx={{
                        position: "absolute",
                        left: 0,
                        bottom: 0,
                        // Faint only in study mode, where it is the GROUND the level is
                        // read against. Off-study there is no level, so the same glyph is
                        // drawn at full strength and is the whole badge.
                        opacity: isStudySurface ? 0.24 : 1,
                        transition: "opacity 0.3s ease-out",
                    }}
                />
                {/* The level, STUDY MODE ONLY. A bottom-anchored window over an identical
                    glyph: the window grows, the glyph inside it does not move (it is
                    pinned to the window's bottom edge, which is the wrapper's bottom
                    edge). Off-study it is not rendered at all rather than merely held at
                    100% — an unmounted layer cannot animate on the way in or out, and the
                    solid base glyph above already reads as a full flame. */}
                {isStudySurface && <Box
                    className="minute-points-fire-badge__flame-fill"
                    aria-hidden
                    sx={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: `${fillHeightPct}%`,
                        overflow: "hidden",
                        // Linear, and exactly the tick interval: the level should arrive at
                        // each second's value just as the next tick starts, with no easing
                        // that would make it visibly accelerate mid-second.
                        transition: isSmoothTick ? "height 1s linear" : "none",
                        willChange: "height",
                    }}
                >
                    <Icon
                        name="local_fire_department"
                        size={FLAME_SIZE_PX}
                        // `tone`, not a hard-coded orange: going idle must desaturate the
                        // level, never discard it. Grey-on-grey then makes the whole glyph
                        // read flat, which is the idle state's whole point.
                        color={tone}
                        fill={1}
                        sx={{ position: "absolute", left: 0, bottom: 0, transition: "color 0.3s ease-out" }}
                    />
                </Box>}
            </Box>
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
            </Typography>
        </Box>
    );
};

export default MinutePointsFireBadge;

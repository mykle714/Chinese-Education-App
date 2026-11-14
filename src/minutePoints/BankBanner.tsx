import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import Icon from "../components/Icon";
import { Label, SectionCard } from "../components/primitives";
import { useAuth } from "../AuthContext";
import { fetchLanguageSummary } from "./minutePointsSync";
import { COLORS } from "../theme/colors";
import { DATA_TYPE, FONTS } from "../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../theme/scale";
import { minutesAsDurationParts } from "../utils/formatDuration";

/**
 * BankBanner — the AccountSheet's minute bank (docs/DAILY_MINUTE_BANKING.md § 6),
 * directly under the profile row.
 *
 *   ┌────────────────────────────┬────────────┐
 *   │    Accumulated minutes     │  TODAY'S   │  ← today column: orgTint section,
 *   │                            │  MINUTES   │     the card's full-height right
 *   │        🔥 21h 24m          │+(🔥 1h 26) │     side; `org` pill with today's
 *   │                            │            │     minutes (not yet banked)
 *   └────────────────────────────┴────────────┘
 *     accumulated column (1fr)     today column (auto)
 *
 * The real balance is the sum of the two. The split is presentational — the server has
 * already credited today's minutes to the NET wallet (§ 2) — and it mirrors the hp
 * banking run, which re-enacts today's minutes joining the bank on the next streak day.
 *
 *   • Main figure = `max(0, totalMinutePoints − todayMinutes)`. Clamped because the
 *     template-author −N tool debits NET without lowering today's `minutesEarned`.
 *   • The today column is NOT rendered while today is 0 (Q11b); the accumulated column
 *     then spans the whole card.
 *   • No caption under the figure.
 *
 * STRUCTURE: a two-column CSS grid directly on `SectionCard` (`1fr auto`), padding 0 and
 * `overflow: hidden` so the today column's tint is clipped to the card's rounded corners.
 * Each column pads itself. DOM order = reading order (accumulated, then today). Not built
 * on `StatCard`: that primitive is one centered figure under a mono overline, and this
 * card is two columns with a header-style title.
 *
 * Fetches its own summary on mount, like the sheet's library counts and velocity: the
 * sheet is mounted only while open, so every open is fresh. It does NOT call
 * `useMinutePoints` — that would start a second 1-second accrual tick.
 *
 * Not tappable, so it carries the card hairline, not the button outline. Language-scoped
 * to `user.selectedLanguage`.
 *
 * LAYER: client view (minute-points feature). Server call via `minutePointsSync`.
 */
function BankBanner({ className }: { className?: string }) {
    const { user, token } = useAuth();
    const language = user?.selectedLanguage || "zh";
    const [figures, setFigures] = useState<{ banked: number; today: number } | null>(null);

    // Token via a ref: a silent refresh must not re-run the load (CLAUDE.md).
    const tokenRef = useRef(token);
    useEffect(() => { tokenRef.current = token; }, [token]);

    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        fetchLanguageSummary(language, tokenRef.current).then((summary) => {
            if (cancelled || !summary) return;
            setFigures({
                banked: Math.max(0, summary.totalMinutePoints - summary.todayMinutes),
                today: summary.todayMinutes,
            });
        });
        return () => { cancelled = true; };
    }, [user?.id, language]);

    const showToday = figures !== null && figures.today > 0;

    return (
        <SectionCard
            className={className ? `bank-banner ${className}` : "bank-banner"}
            sx={{
                display: "grid",
                // Accumulated takes the rest; today sizes to its content. With no today
                // column the single `1fr` track spans the card.
                gridTemplateColumns: showToday ? "1fr auto" : "1fr",
                padding: 0,
                overflow: "hidden",
            }}
        >
            {/* ── Accumulated column: header + big figure, both centered in the column ── */}
            <Box
                className="bank-banner__accumulated"
                sx={{
                    minWidth: 0,
                    padding: "14px 16px",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                }}
            >
                <Typography
                    component="h3"
                    className="bank-banner__title"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.subtitle,
                        fontWeight: WEIGHT.semibold,
                        lineHeight: LEADING.tight,
                        color: COLORS.onSurface,
                    }}
                >
                    Accumulated minutes
                </Typography>
                {/* Same numeral recipe as StatCard's `.stat-card__value` (38px / 600 /
                    −0.035em), so this figure matches the app's other big stats. */}
                <Typography
                    component="div"
                    className="bank-banner__value"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: 38,
                        fontWeight: 600,
                        letterSpacing: "-0.035em",
                        lineHeight: 1.05,
                        marginTop: "4px",
                        color: COLORS.onSurface,
                    }}
                >
                    {/* Flame + duration centered TOGETHER as one unit: the flame sits in
                        the flow, so it counts toward the width the column centers. */}
                    <Box component="span" className="bank-banner__value-figure" sx={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <Icon
                            className="bank-banner__value-flame"
                            name="local_fire_department"
                            size={32}
                            color={COLORS.fireActive}
                            fill={1}
                        />
                        {/* Held at an em dash until the summary lands, so the card keeps
                            its height and nothing under it shifts. */}
                        {figures ? (
                            <DurationFigure minutes={figures.banked} unitFontSize={20} unitColor={COLORS.textSecondary} partClassName="bank-banner__value-part" />
                        ) : "—"}
                    </Box>
                </Typography>
            </Box>

            {/* ── Today column: the card's right side ──
                Full card height (a grid cell stretches), clipped to the card's right
                corners by the card's `overflow: hidden`. One `rowBorder` hairline on its
                inner edge divides it from the accumulated column. Ground: the palest
                orange, `orgTint`; the PILL inside sits on the stronger `org` surface in
                `fireActive` ink, so the number is the one saturated thing in it. */}
            {showToday && (
                <Box
                    className="bank-banner__today"
                    title={`${figures.today} minutes today — added at the start of tomorrow`}
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        // 16px sides (was 8px) so the pill doesn't press against
                        // the divider and the card edge (user, 2026-11-14).
                        padding: "10px 16px",
                        backgroundColor: COLORS.orgTint,
                        borderLeft: `1px solid ${COLORS.rowBorder}`,
                    }}
                >
                    {/* Two lines on purpose: on one, the 10px tracked caps run ~112px and
                        widen the column, squeezing the accumulated side on small phones.
                        `textSecondary` rather than Label's default `textFaint`, which
                        washes out on the orgTint ground. */}
                    <Label className="bank-banner__today-label" color={COLORS.textSecondary} sx={{ lineHeight: 1.25 }}>
                        Today's
                        <br />
                        minutes
                    </Label>
                    {/* The `+` sits OUTSIDE the pill, in front of it: the pill holds only
                        the minutes, and the sign reads as "added to the total". */}
                    <Box
                        className="bank-banner__today-row"
                        sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                            color: COLORS.fireActive,
                            ...DATA_TYPE,
                            // Digits at 15px, unit letters at 11px — the same
                            // big-digits / small-units split as the main figure.
                            fontSize: 15,
                            lineHeight: 1,
                            whiteSpace: "nowrap",
                        }}
                    >
                        {/* 20px, up from the row's 15px (user, 2026-11-14): at digit size the
                            sign read as a stray tick beside the pill. */}
                        <Box component="span" className="bank-banner__today-sign" sx={{ fontSize: 20 }}>
                            +
                        </Box>
                        <Box
                            className="bank-banner__today-pill"
                            sx={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "2px",
                                padding: "4px 9px 4px 7px",
                                borderRadius: "999px",
                                backgroundColor: COLORS.org,
                            }}
                        >
                            {/* 19px, a step above the 15px digits: the flame is the pill's
                                emblem, and at digit size it read as a stray glyph. */}
                            <Icon name="local_fire_department" size={19} color={COLORS.fireActive} fill={1} />
                            <span className="bank-banner__today-duration">
                                <DurationFigure minutes={figures.today} unitFontSize={11} unitColor="inherit" partClassName="bank-banner__today-part" hideMinuteUnit />
                            </span>
                        </Box>
                    </Box>
                </Box>
            )}
        </SectionCard>
    );
}

/**
 * A minute balance as "1h 26m" (y-w-d-h-m ladder, docs/DAILY_MINUTE_BANKING.md § 6),
 * the digits at the surrounding font size and the unit letters smaller. Used twice:
 *   • the main figure — 38px digits, 20px units in the secondary ink. Shrinking the
 *     suffixes cuts the width by about a third, which is what keeps a long balance
 *     ("2w 3d 4h 10m") inside the accumulated column on a phone;
 *   • the today pill — 15px digits, 11px units in the pill's own flame ink, with the
 *     trailing "m" dropped (`hideMinuteUnit`; user, 2026-11-14): the "Today's minutes"
 *     label above already names the unit, so "+🔥 26" / "+🔥 1h 26" reads cleanly.
 */
function DurationFigure({
    minutes,
    unitFontSize,
    unitColor,
    partClassName,
    hideMinuteUnit = false,
}: {
    minutes: number;
    unitFontSize: number;
    /** A COLORS token, or "inherit" to take the surrounding ink. */
    unitColor: string;
    /** BEM base for each part; the unit letter gets `${partClassName}-unit`. */
    partClassName: string;
    /** Omit the "m" suffix on the minutes part (the larger units keep theirs). */
    hideMinuteUnit?: boolean;
}) {
    const parts = minutesAsDurationParts(minutes, { weeks: true, years: true });
    return (
        <>
            {parts.map(({ value, unit }, index) => (
                <span key={unit} className={partClassName}>
                    {index > 0 && " "}
                    {value}
                    {!(hideMinuteUnit && unit === "m") && (
                    <Box
                        component="span"
                        className={`${partClassName}-unit`}
                        sx={{ fontSize: unitFontSize, fontWeight: 500, letterSpacing: 0, color: unitColor, marginLeft: "1px" }}
                    >
                        {unit}
                    </Box>
                    )}
                </span>
            ))}
        </>
    );
}

export default BankBanner;

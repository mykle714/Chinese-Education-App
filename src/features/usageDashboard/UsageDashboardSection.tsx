import { useState } from "react";
import { Box, Typography } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { Label, SectionCard, SectionRule, Segmented } from "../../components/primitives";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { LANGUAGE_NAMES, type Language } from "../../../server/contracts/wire";
import {
    DEFAULT_USAGE_WINDOW,
    USAGE_WINDOWS,
    type UsageDashboard,
    type UsageDay,
    type UsageWindowDays,
} from "../../api/usage";
import { useUsageDashboard } from "./useUsageDashboard";
import UsageDailyChart from "./UsageDailyChart";
import UsageRecentUsers from "./UsageRecentUsers";
import { gameLabel } from "./usageFormat";

/**
 * UsageDashboardSection — the admin-only User Usage section at the bottom of the tester
 * dashboard (docs/USAGE_DASHBOARD.md).
 *
 * Renders nothing unless `user.isAdmin` (migration 168). That is the UX half of the
 * gate; the security half is UsageDashboardService on the server, which 403s anyone
 * else — this section only reads other accounts' data, so both halves exist.
 *
 * Layout, top to bottom, all on the shelf primitives:
 *   rule + window switch (7D / 30D / 90D / ALL)
 *   headline      — accounts + today / 7-day / 30-day active (window-independent)
 *   daily chart   — one metric at a time, picked by a lens switch
 *   window totals — sums + distinct users over the window
 *   recent        — the individual learners behind those totals, by name
 *   languages     — minutes + active users per study language, with a meter
 *   features      — cards added, wins (per game), writing, iw, AI lookups
 */

const WINDOW_OPTIONS = USAGE_WINDOWS.map((d) => ({ value: String(d), label: d === 0 ? "All" : `${d}d` }));

/** The four chart lenses. Each names its series, readout unit and ramp hue. */
type ChartMetric = "minutes" | "active" | "opens" | "signups";
const CHART_METRICS: Record<ChartMetric, { label: string; unit: string; hue: RampHue; pick: (d: UsageDay) => number }> = {
    minutes: { label: "Min", unit: "min", hue: "blu", pick: (d) => d.minutes },
    active: { label: "Studied", unit: "users", hue: "grn", pick: (d) => d.activeUsers },
    opens: { label: "Opens", unit: "users", hue: "pur", pick: (d) => d.appOpenUsers },
    signups: { label: "Signups", unit: "new", hue: "org", pick: (d) => d.signups },
};
const CHART_OPTIONS = (Object.keys(CHART_METRICS) as ChartMetric[]).map((k) => ({ value: k, label: CHART_METRICS[k].label }));

/** A mono figure over a label — one cell of the headline strip. */
function HeadlineCell({ label, value }: { label: string; value: number }) {
    return (
        <Box className="usage-dashboard__headline-cell" sx={{ minWidth: 0 }}>
            <Typography className="usage-dashboard__headline-value" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.title, fontWeight: WEIGHT.semibold, letterSpacing: "-0.03em", color: COLORS.onSurface, lineHeight: 1.1 }}>
                {value.toLocaleString()}
            </Typography>
            <Label className="usage-dashboard__headline-label">{label}</Label>
        </Box>
    );
}

/**
 * One label / figure line inside a card. `sub` is a muted second figure (distinct
 * users), `meter` an optional 0–1 bar under the line.
 */
function StatLine({ label, value, sub, meter, hue = "blu", indent = false }: {
    label: string;
    value: number;
    sub?: string;
    meter?: number;
    hue?: RampHue;
    indent?: boolean;
}) {
    return (
        <Box className={`usage-dashboard__stat-line${indent ? " usage-dashboard__stat-line--indent" : ""}`} sx={{ py: "7px", pl: indent ? "14px" : 0, "& + &": { borderTop: `1px solid ${COLORS.rowBorder}` } }}>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <Typography className="usage-dashboard__stat-label" sx={{ flex: 1, minWidth: 0, fontFamily: FONTS.sans, fontSize: indent ? SIZE.caption : SIZE.body, color: indent ? COLORS.textSecondary : COLORS.onSurface }}>
                    {label}
                </Typography>
                {sub && (
                    <Typography className="usage-dashboard__stat-sub" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textFaint, whiteSpace: "nowrap" }}>
                        {sub}
                    </Typography>
                )}
                <Typography className="usage-dashboard__stat-value" sx={{ fontFamily: FONTS.mono, fontSize: indent ? SIZE.caption : SIZE.body, color: COLORS.onSurface, minWidth: 44, textAlign: "right" }}>
                    {value.toLocaleString()}
                </Typography>
            </Box>
            {meter !== undefined && (
                <Box className="usage-dashboard__stat-meter" sx={{ mt: "5px", height: 4, borderRadius: 2, backgroundColor: COLORS.grey, overflow: "hidden" }}>
                    <Box sx={{ width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%`, height: "100%", backgroundColor: RAMP[hue].mark }} />
                </Box>
            )}
        </Box>
    );
}

const users = (n: number) => `${n.toLocaleString()} ${n === 1 ? "user" : "users"}`;

/** The loaded body. Split out so the shell (rule + switch) stays put across states. */
function UsageBody({ data, chartMetric, onChartMetric }: {
    data: UsageDashboard;
    chartMetric: ChartMetric;
    onChartMetric: (m: ChartMetric) => void;
}) {
    const metric = CHART_METRICS[chartMetric];
    const topLanguageMinutes = data.languages.reduce((m, l) => Math.max(m, l.minutes), 0);

    return (
        <>
            <SectionCard className="usage-dashboard__headline">
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                    <HeadlineCell label="Accounts" value={data.headline.totalUsers} />
                    <HeadlineCell label="Today" value={data.headline.dau} />
                    <HeadlineCell label="7 days" value={data.headline.wau} />
                    <HeadlineCell label="30 days" value={data.headline.mau} />
                </Box>
                <Typography className="usage-dashboard__headline-note" sx={{ mt: "8px", fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary }}>
                    Learners who studied at least a minute. Always today-anchored.
                </Typography>
            </SectionCard>

            <SectionCard className="usage-dashboard__chart-card">
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: "10px", gap: "8px" }}>
                    <Label className="usage-dashboard__chart-label">Daily</Label>
                    <Segmented
                        className="usage-dashboard__chart-lens"
                        ariaLabel="Chart metric"
                        options={CHART_OPTIONS}
                        value={chartMetric}
                        onChange={onChartMetric}
                    />
                </Box>
                <UsageDailyChart
                    points={data.days.map((d) => ({ date: d.date, value: metric.pick(d) }))}
                    unit={metric.unit}
                    hue={metric.hue}
                />
            </SectionCard>

            <SectionCard className="usage-dashboard__totals">
                <Label className="usage-dashboard__card-label">In this window</Label>
                <Box sx={{ mt: "4px" }}>
                    <StatLine label="Minutes studied" value={data.totals.minutes} />
                    <StatLine label="Learners who studied" value={data.totals.activeUsers} />
                    <StatLine label="Learners who opened the app" value={data.totals.appOpenUsers} />
                    <StatLine label="Sign-ins" value={data.totals.signIns} />
                    <StatLine label="New accounts" value={data.totals.signups} />
                </Box>
            </SectionCard>

            <SectionCard className="usage-dashboard__recent-users">
                <UsageRecentUsers users={data.recentUsers} generatedAt={data.generatedAt} />
            </SectionCard>

            <SectionCard className="usage-dashboard__languages">
                <Label className="usage-dashboard__card-label">By language</Label>
                <Box sx={{ mt: "4px" }}>
                    {data.languages.length === 0 ? (
                        <Typography className="usage-dashboard__empty" sx={{ py: "7px", fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.textSecondary }}>
                            No study in this window.
                        </Typography>
                    ) : (
                        data.languages.map((l) => (
                            <StatLine
                                key={l.language}
                                label={LANGUAGE_NAMES[l.language as Language] ?? l.language}
                                value={l.minutes}
                                sub={`${users(l.activeUsers)} · min`}
                                meter={topLanguageMinutes > 0 ? l.minutes / topLanguageMinutes : 0}
                                hue="blu"
                            />
                        ))
                    )}
                </Box>
            </SectionCard>

            <SectionCard className="usage-dashboard__features">
                <Label className="usage-dashboard__card-label">Feature usage</Label>
                <Box sx={{ mt: "4px" }}>
                    {data.features.map((f) => (
                        <Box key={f.key} className={`usage-dashboard__feature usage-dashboard__feature--${f.key}`}>
                            <StatLine label={f.label} value={f.events} sub={users(f.users)} />
                            {/* Wins are the one feature with a meaningful sub-breakdown. */}
                            {f.key === "gameWins" && data.games.map((g) => (
                                <StatLine key={g.game} label={gameLabel(g.game)} value={g.wins} sub={users(g.users)} indent />
                            ))}
                        </Box>
                    ))}
                </Box>
            </SectionCard>
        </>
    );
}

export default function UsageDashboardSection() {
    const [windowDays, setWindowDays] = useState<UsageWindowDays>(DEFAULT_USAGE_WINDOW);
    const [chartMetric, setChartMetric] = useState<ChartMetric>("minutes");
    const { data, loading, error } = useUsageDashboard(windowDays);

    return (
        <Box className="usage-dashboard" sx={{ pb: "24px" }}>
            <SectionRule
                className="usage-dashboard__rule"
                label="User usage"
                right={
                    <Segmented
                        className="usage-dashboard__window"
                        ariaLabel="Time window"
                        options={WINDOW_OPTIONS}
                        value={String(windowDays)}
                        onChange={(v) => setWindowDays(Number(v) as UsageWindowDays)}
                    />
                }
            />

            {error ? (
                <Typography className="usage-dashboard__error" sx={{ padding: "12px 22px 0", fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.dangerInk }}>
                    {error}
                </Typography>
            ) : !data ? (
                <Box className="usage-dashboard__loading" sx={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
                    <DelayedCircularProgress />
                </Box>
            ) : (
                // Dim, don't blank, while a new window loads over the old one.
                <Box className="usage-dashboard__body" sx={{ opacity: loading ? 0.55 : 1, transition: "opacity 150ms ease" }}>
                    <UsageBody data={data} chartMetric={chartMetric} onChartMetric={setChartMetric} />
                </Box>
            )}
        </Box>
    );
}

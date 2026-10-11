import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import Icon from "../components/Icon";
import { StatCard } from "../components/primitives";
import { useAuth } from "../AuthContext";
import { fetchLanguageSummary } from "./minutePointsSync";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * BankBanner — the AccountSheet's minute bank (docs/DAILY_MINUTE_BANKING.md § 6),
 * directly under the profile row.
 *
 *   ┌─────────────────────────────────────────┐
 *   │ BANKED                          +🔥 12  │  ← today's minutes, not yet banked
 *   │ 🔥 1,284                                │  ← NET through the end of yesterday
 *   └─────────────────────────────────────────┘
 *
 * The real balance is the sum of the two. The split is presentational — the server has
 * already credited today's minutes to the NET wallet (§ 2) — and it mirrors the hp
 * banking run, which re-enacts the chip joining the bank on the next streak day.
 *
 *   • Main figure = `max(0, totalMinutePoints − todayMinutes)`. Clamped because the
 *     template-author −N tool debits NET without lowering today's `minutesEarned`.
 *   • The chip is NOT rendered while today is 0 (Q11b).
 *
 * Fetches its own summary on mount, like the sheet's library counts and velocity: the
 * sheet is mounted only while open, so every open is fresh. It does NOT call
 * `useMinutePoints` — that would start a second 1-second accrual tick.
 *
 * Built on `StatCard` (shelf system); it is not tappable, so it carries the card
 * hairline, not the button outline. Language-scoped to `user.selectedLanguage`.
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

    return (
        <StatCard
            className={className ? `bank-banner ${className}` : "bank-banner"}
            sx={{ position: "relative" }}
            // The chip rides the `lead` slot only to get inside the card; it is
            // absolutely placed in the top-right corner and takes no layout space.
            lead={
                figures && figures.today > 0 ? (
                    <Box
                        className="bank-banner__today-chip"
                        title={`${figures.today} minutes today — banked at the start of tomorrow`}
                        sx={{
                            position: "absolute",
                            top: 12,
                            right: 14,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "2px",
                            padding: "2px 7px 2px 6px",
                            borderRadius: "999px",
                            backgroundColor: COLORS.orgTint,
                            color: COLORS.fireActive,
                            fontFamily: FONTS.mono,
                            fontSize: 11,
                            fontVariantNumeric: "tabular-nums",
                            lineHeight: 1,
                        }}
                    >
                        +
                        <Icon name="local_fire_department" size={13} color={COLORS.fireActive} fill={1} />
                        {figures.today.toLocaleString()}
                    </Box>
                ) : null
            }
            label="Banked"
            value={
                <Box component="span" className="bank-banner__value" sx={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <Icon name="local_fire_department" size={32} color={COLORS.fireActive} fill={1} />
                    {/* Held at an em dash until the summary lands, so the card keeps its
                        height and nothing under it shifts. */}
                    {figures ? figures.banked.toLocaleString() : "—"}
                </Box>
            }
            description="Minutes banked through yesterday. Today's join at 4 AM."
        />
    );
}

export default BankBanner;

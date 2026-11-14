import type { ReactNode } from "react";
import { Box } from "@mui/material";
import { COLORS, LEADING, SIZE, TRACKING, WEIGHT, DATA_TYPE } from "../../theme";
import { formatTimeMs } from "../../utils/timeUtils";
import PersonalBestLine from "./PersonalBestLine";
import { formatAccuracy, type RunTier, type RunTiers } from "./runTiers";
import type { PersonalBestGame } from "../../../server/contracts/personalBests";

/** The personal best as the speed panel shows it (`FlpBreakPersonalBest`'s shape). */
export interface RunTierPersonalBest {
    game: PersonalBestGame;
    best: number;
    isNewBest: boolean;
}

/**
 * RunTierPanels — a finished run's results as two large panels, STACKED with speed on top
 * (docs/GAMES_FEATURE.md § Run tiers). Each panel carries its own figures, so the results
 * card needs nothing else under its heading:
 *
 *   Speed     — the tier numeral, the run's time, and the personal best (once it settles).
 *   Accuracy  — the tier numeral and "correct/attempts · percent". Omitted in a game that
 *               keeps no error count.
 *
 * Presentation only. Rendered by the break's results card (`GameBreakResultCard`).
 *
 * The panels are read-only, so they carry the app's `COLORS.border` outline but no raised
 * rounded edge. The numeral column has a fixed width so both panels' figures line up.
 */
export default function RunTierPanels({
    tiers,
    personalBest,
    className,
}: {
    tiers: RunTiers;
    /** Null until the server's verdict settles, or when the game keeps no best. */
    personalBest: RunTierPersonalBest | null;
    className?: string;
}) {
    return (
        <Box
            className={`run-tier-panels${className ? ` ${className}` : ""}`}
            sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%", maxWidth: 300 }}
        >
            <RunTierPanel axis="speed" label="Speed" tier={tiers.speed.tier} figure={formatTimeMs(tiers.speed.elapsedMs)}>
                {personalBest && (
                    <PersonalBestLine
                        game={personalBest.game}
                        best={personalBest.best}
                        isNewBest={personalBest.isNewBest}
                        align="start"
                        className="run-tier-panels__personal-best"
                    />
                )}
            </RunTierPanel>
            {tiers.accuracy && (
                <RunTierPanel
                    axis="accuracy"
                    label="Accuracy"
                    tier={tiers.accuracy.tier}
                    figure={formatAccuracy(tiers.accuracy.correct, tiers.accuracy.attempts)}
                />
            )}
        </Box>
    );
}

/** Width of the tier numeral's column, so the two panels' figures share one left edge. */
const NUMERAL_COLUMN_PX = 52;

function RunTierPanel({
    axis,
    label,
    tier,
    figure,
    children,
}: {
    axis: "speed" | "accuracy";
    label: string;
    tier: RunTier;
    /** The panel's headline figure: the time, or the accuracy fraction. */
    figure: string;
    /** Extra lines under the figure (the speed panel's personal best). */
    children?: ReactNode;
}) {
    return (
        <Box
            className={`run-tier-panels__panel run-tier-panels__panel--${axis}`}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                px: 2,
                py: 1.5,
                borderRadius: "16px",
                border: `1px solid ${COLORS.border}`,
                bgcolor: COLORS.white,
                textAlign: "left",
            }}
        >
            <Box
                className="run-tier-panels__tier"
                sx={{
                    flex: `0 0 ${NUMERAL_COLUMN_PX}px`,
                    textAlign: "center",
                    ...DATA_TYPE,
                    fontSize: SIZE.display,
                    fontWeight: WEIGHT.bold,
                    lineHeight: LEADING.none,
                    color: COLORS.onSurface,
                }}
            >
                {tier}
            </Box>
            <Box className="run-tier-panels__body" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.25 }}>
                <Box
                    component="span"
                    className="run-tier-panels__label"
                    sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, letterSpacing: TRACKING.caps, textTransform: "uppercase", color: COLORS.textSecondary }}
                >
                    {label}
                </Box>
                <Box
                    component="span"
                    className="run-tier-panels__figure"
                    sx={{ ...DATA_TYPE, fontSize: SIZE.title, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight, color: COLORS.onSurface }}
                >
                    {figure}
                </Box>
                {children}
            </Box>
        </Box>
    );
}

import { Box } from "@mui/material";
import { COLORS, FONTS } from "../../theme";
import { formatTimeMs } from "../../utils/timeUtils";
import { PERSONAL_BEST_GAMES, type PersonalBestGame } from "../../../server/contracts/personalBests";

/**
 * PersonalBestLine — the end-screen row "Personal best 1:23", with a gold "New best!"
 * pill when this run set it (docs/WRITING_PRACTICE_REWORK.md § 2a). Formats by the game's
 * unit (ms → m:ss, count → number). Renders nothing until a best exists.
 *
 * Presentation only; pair with `usePersonalBest`.
 */
export default function PersonalBestLine({
    game,
    best,
    isNewBest,
    unitLabel,
    className,
}: {
    game: PersonalBestGame;
    best: number | null;
    isNewBest: boolean;
    /** Count games: the unit after the number ("matches"), so it reads like the popup above it. */
    unitLabel?: string;
    className?: string;
}) {
    if (best === null) return null;
    const unit = PERSONAL_BEST_GAMES[game].unit;
    const shown = unit === "ms" ? formatTimeMs(best) : unitLabel ? `${best} ${unitLabel}` : String(best);
    return (
        <Box
            className={`personal-best-line${className ? ` ${className}` : ""}`}
            sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, color: COLORS.textSecondary, fontSize: "0.9rem" }}
        >
            <span className="personal-best-line__label">Personal best</span>
            <Box component="span" className="personal-best-line__value" sx={{ fontFamily: FONTS.mono, color: COLORS.onSurface, fontWeight: 600 }}>
                {shown}
            </Box>
            {isNewBest && (
                <Box
                    component="span"
                    className="personal-best-line__new"
                    sx={{
                        bgcolor: COLORS.gld,
                        color: COLORS.onSurface,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 999,
                        px: 1,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                    }}
                >
                    New best!
                </Box>
            )}
        </Box>
    );
}

import { Box, Typography } from "@mui/material";
import type { ArenaEntry } from "../../api/arena";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { rankChipSx, zoneRowSx } from "./arenaStyles";

/**
 * One row of the arena board (docs/ARENA_FEATURE.md § 2.1).
 *
 * ⚠️ WHAT THIS ROW MAY SHOW IS A PRIVACY DECISION, NOT A LAYOUT ONE (Q20).
 * Name, avatar, language badge and score — nothing else. An arena puts a learner
 * in front of 24 strangers they did not choose and cannot leave, so a streak
 * here would expose their daily routine (including the day they broke it) to
 * people with no relationship to them. /friends can show more because both
 * parties opted into seeing each other. Adding a field here means reopening that
 * question, not adjusting a component.
 *
 * Synthetic members render EXACTLY like humans, with no marker of any kind. That
 * is the entire point of padding; a visible "bot" tag would tell a learner in a
 * thin division that their competition is fake, which is worse than the empty
 * board padding exists to prevent.
 */
export default function ArenaEntryRow({ entry }: { entry: ArenaEntry }) {
    return (
        <Box
            className={`arena-page__row arena-page__row--${entry.zone}${entry.isViewer ? " arena-page__row--viewer" : ""}`}
            sx={zoneRowSx(entry.zone, entry.isViewer)}
        >
            <Box className="arena-page__row-rank" sx={rankChipSx}>
                {entry.rank}
            </Box>

            <Box className="arena-page__row-identity" sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    className="arena-page__row-name"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        fontWeight: entry.isViewer ? WEIGHT.bold : WEIGHT.semibold,
                        color: COLORS.onSurface,
                        // A long display name must not push the score off the row.
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {entry.name}
                </Typography>
                <Typography
                    className="arena-page__row-language"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.micro,
                        color: COLORS.textSecondary,
                    }}
                >
                    {entry.language}
                </Typography>
            </Box>

            <Box
                className="arena-page__row-score"
                sx={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.1 }}
            >
                <Typography
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.subtitle,
                        fontWeight: WEIGHT.bold,
                        // A zero is drawn muted rather than hidden — "0 so far" is
                        // information, and a blank would read as a rendering bug.
                        color: entry.score > 0 ? COLORS.onSurface : COLORS.textSecondary,
                        lineHeight: 1.1,
                    }}
                >
                    {entry.score.toLocaleString()}
                </Typography>
                <Typography
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary }}
                >
                    minutes
                </Typography>
            </Box>
        </Box>
    );
}

import { Box, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

interface ChallengeDetailHeaderProps {
    /** The other player's display name — the header's whole subject. */
    opponentName: string;
}

/**
 * The masthead of View Challenge (docs/STUDY_CHALLENGE.md § 5.4).
 *
 * ⚠️ NodePage's own header names the SCREEN ("View Challenge"), not the challenge —
 * it is a navigation bar shared with every other drill-in and cannot grow a subtitle.
 * So the challenge names itself here, in the page body, at a size that says this is a
 * head-to-head rather than a settings page. What used to sit here was a single
 * body-sized "vs Large User" line that read as a caption for the card under it.
 *
 * ⚠️ NAME ONLY — NO SUBTITLE (2026-09-01). The header used to carry a status line
 * ("Round 2 of 3 · closes 4 AM Sunday" on your side, "<name> is still playing…" on
 * theirs). Both restated the test card directly beneath them — the numerals draw the
 * round count, the card's head carries the close date, and an unplayed opponent round
 * already reads "not done". The masthead now says whose page this is and nothing else.
 *
 * ⚠️ NAME ONLY — NO SIDE INDICATOR EITHER (2026-09-02). The header also carried an
 * eyebrow (a blue/red rule + a "Your challenge" / "Their side" kicker) that re-inked in
 * place as the pager crossed halfway. It is gone: the test card beneath it already
 * carries the same blue/red ownership ink and names the player, and the pager dots say
 * which of the two pages you are on. The masthead is now just "vs <name>", identical on
 * both pages, and so takes no `side` at all.
 */
function ChallengeDetailHeader({ opponentName }: ChallengeDetailHeaderProps) {
    return (
        <Box className="challenge-detail-header" sx={{ px: 2.5, pt: 2, pb: 0.5 }}>
            <Typography
                className="challenge-detail-header__title"
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.heading,
                    fontWeight: WEIGHT.bold,
                    // Tight tracking is what makes a two-word name read as a masthead
                    // rather than as a heading that happens to be large.
                    letterSpacing: "-0.038em",
                    lineHeight: LEADING.none,
                    color: COLORS.onSurface,
                }}
            >
                vs {opponentName}
            </Typography>
        </Box>
    );
}

export default ChallengeDetailHeader;

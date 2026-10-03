import { Box } from "@mui/material";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT, TRACKING } from "../../../theme/scale";

/**
 * A Center page's section heading — the design's `.wsec`: a 14px title on the left
 * and a mono overline on the right ("YOUR CHARACTERS · FROM YOUR CARDS · 412").
 *
 * One component so every section on both Centers starts on the same 24px gutter with
 * the same baseline; the design draws them identically on both pages.
 *
 * Layer: feature component (src/features/flashcards/centers).
 * Docs: docs/READING_WRITING_CENTERS.md § "Page anatomy".
 */
interface CenterSectionHeadingProps {
    title: string;
    /** The right-hand overline, if any. Rendered uppercase. */
    meta?: string;
    className?: string;
}

const CenterSectionHeading: React.FC<CenterSectionHeadingProps> = ({ title, meta, className }) => (
    <Box
        className={`center-section-heading${className ? ` ${className}` : ""}`}
        sx={{
            alignSelf: "stretch",
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "12px",
            padding: "18px 24px 9px",
        }}
    >
        <Box
            component="b"
            className="center-section-heading__title"
            sx={{ fontFamily: FONTS.sans, fontSize: 14, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}
        >
            {title}
        </Box>
        {meta && (
            <Box
                component="span"
                className="center-section-heading__meta"
                sx={{
                    fontFamily: FONTS.label,
                    fontSize: 10,
                    letterSpacing: TRACKING.caps,
                    textTransform: "uppercase",
                    // The design's `.wsec .lab` lifts the overline from --faint to --ink2:
                    // on a tinted page ground the faint grey loses too much contrast.
                    color: COLORS.iconColor,
                    whiteSpace: "nowrap",
                }}
            >
                {meta}
            </Box>
        )}
    </Box>
);

export default CenterSectionHeading;

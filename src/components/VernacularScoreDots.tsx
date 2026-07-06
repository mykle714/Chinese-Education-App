import { Box } from "@mui/material";
import { COLORS } from "../theme/colors";

interface VernacularScoreDotsProps {
  /** The word's vernacularScore, 1 (literary) … 5 (natural colloquial). */
  score: number;
  /** Dot diameter in px (default 8, matching the eip vernacular meter). */
  dotSize?: number;
  /** Gap between dots in px (default 4). */
  gap?: number;
  /** Color of a filled dot (also the filled dot's border). */
  filledColor?: string;
  /** Border color of an empty dot. */
  emptyBorderColor?: string;
  className?: string;
}

/**
 * Five-dot register meter for a word's `vernacularScore` (1 = literary … 5 = natural
 * colloquial): `score` dots filled, the rest hollow. Shared by the eip vernacular row
 * (InfoCardPanelBody) and the discover sort-card mini badge (SortCardsPage) so the two
 * stay visually identical — presentation layer, colors passed in by the caller so it
 * adapts to the flashcard theme vs. the app palette.
 */
export default function VernacularScoreDots({
  score,
  dotSize = 8,
  gap = 4,
  filledColor = COLORS.onSurface,
  emptyBorderColor = COLORS.border,
  className,
}: VernacularScoreDotsProps) {
  return (
    <Box
      className={`vernacular-score-dots${className ? ` ${className}` : ""}`}
      sx={{ display: "flex", alignItems: "center", gap: `${gap}px` }}
      aria-label={`vernacular register ${score} of 5`}
    >
      {[1, 2, 3, 4, 5].map((level) => {
        const filled = level <= score;
        return (
          <Box
            key={level}
            className="vernacular-score-dots__dot"
            sx={{
              width: dotSize,
              height: dotSize,
              borderRadius: "50%",
              background: filled ? filledColor : "transparent",
              border: `1.5px solid ${filled ? filledColor : emptyBorderColor}`,
            }}
          />
        );
      })}
    </Box>
  );
}

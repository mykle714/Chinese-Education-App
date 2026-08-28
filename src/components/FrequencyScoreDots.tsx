import { Box } from "@mui/material";
import { COLORS } from "../theme/colors";

interface FrequencyScoreDotsProps {
  /** The word's frequencyScore, 1 (would stop the conversation) … 5 (everyday). */
  score: number;
  /** Dot diameter in px (default 8, matching the eip frequency meter). */
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
 * Five-dot meter for a word's `frequencyScore` — how often it comes up in everyday
 * conversation (1 = would stop the conversation … 5 = everyday): `score` dots
 * filled, the rest hollow. Shared by the eip frequency row (InfoCardPanelBody) and the
 * discover sort-card mini badge (SortCardsPage) so the two stay visually identical —
 * presentation layer, colors passed in by the caller so it adapts to the flashcard
 * theme vs. the app palette.
 *
 * The user-facing caption above this meter reads "Commonality" (SortCardsPage,
 * VocabCardDetailBody, InfoCardPanelBody) — kept because it now matches the data.
 * Until migration 122 this scored REGISTER, not frequency.
 */
export default function FrequencyScoreDots({
  score,
  dotSize = 8,
  gap = 4,
  filledColor = COLORS.onSurface,
  emptyBorderColor = COLORS.border,
  className,
}: FrequencyScoreDotsProps) {
  return (
    <Box
      className={`frequency-score-dots${className ? ` ${className}` : ""}`}
      sx={{ display: "flex", alignItems: "center", gap: `${gap}px` }}
      aria-label={`conversation frequency ${score} of 5`}
    >
      {[1, 2, 3, 4, 5].map((level) => {
        const filled = level <= score;
        return (
          <Box
            key={level}
            className="frequency-score-dots__dot"
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

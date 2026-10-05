/**
 * LevelStepper — ‹ Level N › control for the eight Practice Writing levels.
 *
 * Replaced the four-tab bar (Trace / Step Through / Memorize / Test) when the drill
 * grew to eight levels (docs/WRITING_PRACTICE_REWORK.md § 1): eight word labels do
 * not fit across the 300px panel. The centre shows "Level N" with the level's name
 * under it, a gold ★ when that level has been cleared, and a row of eight dots — gold
 * for each cleared level, an ink ring on the current one — so the learner sees their
 * whole star progress without stepping through every level.
 *
 * Presentation only; the host owns the index. Used by PracticeWritingPopup — `embedded`
 * as the header of the single-character WritingPanel, and as its own floating pill under
 * the 2×2 grid.
 */
import { Box, IconButton } from "@mui/material";
import { ChevronLeft, ChevronRight } from "@mui/icons-material";
import { COLORS } from "../../theme";
import { SHADOW } from "../../theme/shadows";
import { WRITING_LEVELS } from "../../../server/contracts/writingLevels";

interface LevelStepperProps {
  /** 0-based index into WRITING_LEVELS. */
  index: number;
  onChange: (index: number) => void;
  /** Level NUMBERS already cleared (stars) — 1-based, as stored (migration 172). */
  completedLevels: Set<number>;
  width: number;
  /**
   * Inside a WritingPanel header: drop the pill's own background / shadow / radius and
   * the bottom-anchoring margin — the panel's header band supplies the chrome.
   */
  embedded?: boolean;
}

export default function LevelStepper({ index, onChange, completedLevels, width, embedded = false }: LevelStepperProps) {
  const level = WRITING_LEVELS[index];
  const last = WRITING_LEVELS.length - 1;
  const cleared = completedLevels.has(level.level);

  const arrowSx = {
    color: COLORS.iconColor,
    "&.Mui-disabled": { color: COLORS.border },
  } as const;

  return (
    <Box
      className={`level-stepper${embedded ? " level-stepper--embedded" : ""}`}
      sx={{
        width,
        mx: "auto",
        display: "flex",
        alignItems: "center",
        px: 0.5,
        py: 0.75,
        ...(embedded ? {} : { mt: "auto", bgcolor: COLORS.header, borderRadius: 999, boxShadow: SHADOW.chip }),
      }}
    >
      <IconButton
        className="level-stepper__prev"
        aria-label="Previous level"
        onClick={() => onChange(Math.max(0, index - 1))}
        disabled={index === 0}
        sx={arrowSx}
      >
        <ChevronLeft />
      </IconButton>

      <Box className="level-stepper__center" sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0.25 }}>
        <Box className="level-stepper__title" sx={{ fontWeight: 600, fontSize: "0.95rem", color: COLORS.onSurface, lineHeight: 1.2 }}>
          {/* Star is absolutely placed left of the title so clearing a level never
              shifts the words. */}
          <Box component="span" sx={{ position: "relative" }}>
            <Box
              component="span"
              className="level-stepper__star"
              sx={{
                position: "absolute",
                right: "100%",
                mr: 0.5,
                color: COLORS.gld,
                visibility: cleared ? "visible" : "hidden",
              }}
            >
              ★
            </Box>
            Level {level.level}
          </Box>
        </Box>
        <Box className="level-stepper__name" sx={{ fontSize: "0.72rem", color: COLORS.textSecondary, lineHeight: 1.2 }}>
          {level.name}
        </Box>
        <Box className="level-stepper__dots" sx={{ display: "flex", gap: 0.75, mt: 0.5 }}>
          {WRITING_LEVELS.map((l, i) => (
            <Box
              key={l.mode}
              component="button"
              type="button"
              aria-label={`Level ${l.level}: ${l.name}`}
              className={`level-stepper__dot${i === index ? " level-stepper__dot--current" : ""}`}
              onClick={() => onChange(i)}
              sx={{
                width: 8,
                height: 8,
                p: 0,
                borderRadius: "50%",
                cursor: "pointer",
                bgcolor: completedLevels.has(l.level) ? COLORS.gld : COLORS.card,
                border: "none",
                // The current level wears an ink ring (outline keeps the dot's size).
                outline: i === index ? `1.5px solid ${COLORS.onSurface}` : "none",
                outlineOffset: 1.5,
              }}
            />
          ))}
        </Box>
      </Box>

      <IconButton
        className="level-stepper__next"
        aria-label="Next level"
        onClick={() => onChange(Math.min(last, index + 1))}
        disabled={index === last}
        sx={arrowSx}
      >
        <ChevronRight />
      </IconButton>
    </Box>
  );
}

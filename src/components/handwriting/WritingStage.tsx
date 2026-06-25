/**
 * WritingStage — one writing panel: an optional grey guide + the capture canvas +
 * a verify-result (✓/✗) overlay, inside a single relative box of `size` px.
 *
 * Reused by PracticeWritingPopup in three places:
 *   • the single-character panel,
 *   • the focused (enlarged) multi-character panel,
 *   • the scaled-down 2×2 grid previews (the caller wraps this in a CSS
 *     `transform: scale()` so every panel still captures/seeds ink in the SAME
 *     `size` coordinate space — recognition stays consistent regardless of the
 *     on-screen size).
 *
 * Spec: docs/HANDWRITING_RECOGNITION.md ("Practice surface").
 */
import { forwardRef } from "react";
import { Box, CircularProgress } from "@mui/material";
import { CheckCircle, Cancel } from "@mui/icons-material";
import { COLORS } from "../../theme";
import HanziGuide from "./HanziGuide";
import WritingCanvas from "./WritingCanvas";
import type { Ink, WritingCanvasHandle } from "./types";

export type StageResult = "idle" | "correct" | "wrong";

interface WritingStageProps {
  character: string;
  /** Logical capture size; ink coords live in this space. */
  size: number;
  /** Whether the canvas accepts input (false = read-only preview, e.g. grid). */
  drawable: boolean;
  /** Mount the Hanzi Writer guide at all (false for the Solo level). */
  showGuide: boolean;
  /** Whether the guide outline is currently visible. */
  guideVisible: boolean;
  /** Continuously animate stroke order (Trace level only). */
  loopAnimation: boolean;
  /** Remount key for the guide (so loopAnimation re-applies on level change). */
  guideKey?: string | number;
  /** Lock drawing while a flash guide is on screen. */
  drawLocked?: boolean;
  /** Strokes to seed the canvas with on mount. */
  initialInk?: Ink;
  onInkChange?: (ink: Ink) => void;
  /** Per-panel verify result (drives the ✓/✗ overlay). */
  result: StageResult;
  /** ✓/✗ icon size (smaller in grid previews). */
  resultIconSize?: number;
  /** Show a small corner spinner (e.g. Level 3's draw lockout while the guide flashes). */
  loading?: boolean;
}

const WritingStage = forwardRef<WritingCanvasHandle, WritingStageProps>(function WritingStage(
  {
    character,
    size,
    drawable,
    showGuide,
    guideVisible,
    loopAnimation,
    guideKey,
    drawLocked = false,
    initialInk,
    onInkChange,
    result,
    resultIconSize = 40,
    loading = false,
  },
  ref,
) {
  return (
    <Box className="writing-stage" sx={{ position: "relative", width: size, height: size }}>
      {loading && (
        <CircularProgress
          className="writing-stage__lock-spinner"
          size={20}
          sx={{ position: "absolute", top: 8, left: 8, color: COLORS.textSecondary, pointerEvents: "none", zIndex: 1 }}
        />
      )}
      {showGuide && (
        <HanziGuide
          key={guideKey}
          character={character}
          size={size}
          outlineVisible={guideVisible}
          loopAnimation={loopAnimation}
        />
      )}
      <Box className="writing-stage__canvas-layer" sx={{ position: "absolute", inset: 0 }}>
        <WritingCanvas
          ref={ref}
          size={size}
          disabled={!drawable || drawLocked}
          initialInk={initialInk}
          onInkChange={onInkChange}
        />
      </Box>

      {result !== "idle" && (
        <Box
          className={`writing-stage__result writing-stage__result--${result}`}
          sx={{
            position: "absolute",
            top: 6,
            right: 6,
            color: result === "correct" ? COLORS.greenMain : COLORS.redMain,
            pointerEvents: "none",
          }}
        >
          {result === "correct" ? (
            <CheckCircle className="writing-stage__result-icon" sx={{ fontSize: resultIconSize }} />
          ) : (
            <Cancel className="writing-stage__result-icon" sx={{ fontSize: resultIconSize }} />
          )}
        </Box>
      )}
    </Box>
  );
});

export default WritingStage;

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
 * Snap (Level 1, `snap`): the stage owns the whole mechanic — it loads the glyph's
 * corpus data, judges each finished stroke against the next expected one
 * (strokeSnap.ts), paints committed strokes as printed shapes (`SnappedStrokes`) in
 * place of pen ink, and cues the next stroke on the guide (`loopStrokeIndex`). Hosts
 * only pass `snap`. If the glyph has no corpus data, Snap falls back to plain ink.
 *
 * Spec: docs/HANDWRITING_RECOGNITION.md ("Practice surface"), docs/PRACTICE_WRITING.md § "Snap".
 */
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Box, CircularProgress } from "@mui/material";
import { CheckCircle, Cancel, Block } from "@mui/icons-material";
import { COLORS, FONTS } from "../../theme";
import HanziGuide from "./HanziGuide";
import WritingCanvas, { type StrokeVerdict } from "./WritingCanvas";
import { loadGlyph, type GlyphData } from "./GlyphSvg";
import { guideToCanvas, medianToStroke, strokeMatchesMedian } from "./strokeSnap";
import type { Ink, Stroke, WritingCanvasHandle } from "./types";

export type StageResult = "idle" | "correct" | "wrong";

interface WritingStageProps {
  character: string;
  /** Logical capture size; ink coords live in this space. */
  size: number;
  /** Whether the canvas accepts input (false = read-only preview, e.g. grid). */
  drawable: boolean;
  /** Whether this level has a guide at all (false for Test / Timed). */
  showGuide: boolean;
  /** Whether the guide outline is currently visible. */
  guideVisible: boolean;
  /** Continuously animate stroke order (Trace level only). */
  loopAnimation: boolean;
  /** Redraws the guide when it changes (fade out → new writer → fade in), so a level's loop / stroke colour never leaks into the next. */
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
  /** Show the red "no writing" badge (⃠) in the corner — Memorize's study-first lock. */
  blocked?: boolean;
  /** Fires when the user presses down to draw while the canvas is locked. */
  onBlockedAttempt?: () => boolean | void;
  /** Fires when a stroke starts (Level 8 starts its clock on the first). */
  onStrokeStart?: () => void;
  /**
   * Snap level: strokes that match the next expected stroke snap into its printed
   * shape; misses turn red and fade. On a read-only stage it only paints the shapes.
   */
  snap?: boolean;
  /** Levels 4/6: clip-path limiting the guide to one region. */
  regionClip?: string;
  /** Fade the guide in when it turns on mid-use (Step Through only). Default: instant. */
  guideFadeIn?: boolean;
  /** Fade the guide out when it turns off (Step Through, Memorize). Default: instant. */
  guideFadeOut?: boolean;
  /** Level 8: this character's running clock (null/absent = not started / not timed). */
  clock?: { remainingMs: number; totalMs: number } | null;
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
    blocked = false,
    onBlockedAttempt,
    onStrokeStart,
    snap = false,
    regionClip,
    guideFadeIn = false,
    guideFadeOut = false,
    clock,
  },
  ref,
) {
  // ── Snap ────────────────────────────────────────────────────────────────────
  // Stroke count drives both the printed shapes and the next-stroke cue. In Snap
  // every committed stroke IS a snapped one (misses never reach the ink), so the
  // ink's length is the number of strokes already written.
  const [inkCount, setInkCount] = useState(initialInk?.length ?? 0);
  const [glyph, setGlyph] = useState<{ char: string; data: GlyphData | null } | null>(null);
  useEffect(() => {
    if (!snap) return;
    let cancelled = false;
    void loadGlyph(character).then((data) => {
      if (!cancelled) setGlyph({ char: character, data });
    });
    return () => {
      cancelled = true;
    };
  }, [snap, character]);
  const glyphData = glyph?.char === character ? glyph.data : null;
  const medians = glyphData?.medians;
  // Only snap once the corpus data is here; until then (or with none) it is plain ink.
  const snapActive = snap && !!glyphData && !!medians && medians.length === glyphData.strokes.length;

  const handleInkChange = useCallback(
    (ink: Ink) => {
      setInkCount(ink.length);
      onInkChange?.(ink);
    },
    [onInkChange],
  );

  const judgeStroke = useCallback(
    (stroke: Stroke, ink: Ink): StrokeVerdict => {
      const next = medians?.[ink.length];
      if (!next) return { kind: "reject" }; // every stroke already written
      return strokeMatchesMedian(stroke, next, size)
        ? { kind: "replace", stroke: medianToStroke(next, size, stroke) }
        : { kind: "reject" };
    },
    [medians, size],
  );

  // The guide mounts the first time this stage needs one and then STAYS mounted, so
  // a level change can hand the same instance a new `resetKey` (and a fading level's
  // guide is never unmounted mid-fade). A stage that never shows a guide never pays for a
  // Hanzi Writer instance. Render-phase latch: idempotent, so safe under StrictMode.
  const guideMountedRef = useRef(false);
  if (showGuide) guideMountedRef.current = true;
  const guideMounted = guideMountedRef.current;

  return (
    <Box className="writing-stage" sx={{ position: "relative", width: size, height: size }}>
      {loading && (
        <CircularProgress
          className="writing-stage__lock-spinner"
          size={20}
          sx={{ position: "absolute", top: 8, left: 8, color: COLORS.textSecondary, pointerEvents: "none", zIndex: 1 }}
        />
      )}
      {blocked && (
        // "No writing" badge: a red circle-with-a-slash in the top-left corner, the
        // visual cue that the canvas is locked during Memorize's study-first phase.
        <Block
          className="writing-stage__blocked-badge"
          sx={{ position: "absolute", top: 8, left: 8, color: COLORS.dangerInk, fontSize: 22, pointerEvents: "none", zIndex: 2 }}
        />
      )}
      {guideMounted && (
        <HanziGuide
          // resetKey (not a React key): a level change fades the old guide out
          // before the new one is drawn, where a remount would pop.
          resetKey={guideKey}
          character={character}
          size={size}
          outlineVisible={showGuide && guideVisible}
          loopAnimation={loopAnimation}
          // The next-stroke cue is an editor affordance: a read-only preview stays still.
          loopStrokeIndex={snapActive && drawable ? inkCount : undefined}
          regionClip={regionClip}
          fadeIn={guideFadeIn}
          fadeOut={guideFadeOut}
        />
      )}
      {snapActive && glyphData && (
        <SnappedStrokes strokes={glyphData.strokes.slice(0, inkCount)} size={size} />
      )}
      <Box className="writing-stage__canvas-layer" sx={{ position: "absolute", inset: 0 }}>
        <WritingCanvas
          ref={ref}
          size={size}
          disabled={!drawable || drawLocked}
          initialInk={initialInk}
          onInkChange={handleInkChange}
          onBlockedAttempt={onBlockedAttempt}
          onStrokeStart={onStrokeStart}
          onStrokeEnd={snapActive && drawable ? judgeStroke : undefined}
          hideCommittedInk={snapActive}
        />
      </Box>

      {clock && <StageClock remainingMs={clock.remainingMs} totalMs={clock.totalMs} />}

      {result !== "idle" && (
        <Box
          className={`writing-stage__result writing-stage__result--${result}`}
          sx={{
            position: "absolute",
            top: 6,
            right: 6,
            color: result === "correct" ? COLORS.successInk : COLORS.dangerInk,
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

/**
 * Snap's printed strokes: the corpus stroke shapes for every stroke written so far,
 * in ink, positioned exactly over the guide (strokeSnap.ts → `guideToCanvas`). Each
 * path is keyed by its index, so only a newly snapped stroke mounts — and fades in.
 */
function SnappedStrokes({ strokes, size }: { strokes: string[]; size: number }) {
  const { svgTransform } = guideToCanvas(size);
  return (
    <Box
      component="svg"
      className="writing-stage__snapped"
      width={size}
      height={size}
      aria-hidden="true"
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        "& .writing-stage__snapped-stroke": { animation: "writing-stage-snap-in 180ms ease-out" },
        "@keyframes writing-stage-snap-in": { from: { opacity: 0 }, to: { opacity: 1 } },
      }}
    >
      <g transform={svgTransform}>
        {strokes.map((d, i) => (
          <path key={i} className="writing-stage__snapped-stroke" d={d} fill={COLORS.onSurface} />
        ))}
      </g>
    </Box>
  );
}

/**
 * Level 8's per-character countdown: a draining bar along the panel's top edge plus
 * the seconds left (mono — fonts.ts reserves it for timers). The bar is the writing
 * skill's hue (`purMk`) and turns `redMk` in the last quarter of the budget.
 */
function StageClock({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const fraction = totalMs > 0 ? remainingMs / totalMs : 0;
  const urgent = fraction <= 0.25;
  return (
    <Box className="writing-stage__clock" sx={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
      <Box className="writing-stage__clock-track" sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, bgcolor: COLORS.card }}>
        <Box
          className="writing-stage__clock-fill"
          sx={{
            height: "100%",
            width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
            bgcolor: urgent ? COLORS.redMk : COLORS.purMk,
            transition: "width 0.1s linear",
          }}
        />
      </Box>
      <Box
        className="writing-stage__clock-label"
        sx={{ position: "absolute", top: 12, left: 10, fontFamily: FONTS.mono, fontSize: 18, color: COLORS.textSecondary }}
      >
        {(remainingMs / 1000).toFixed(1)}s
      </Box>
    </Box>
  );
}

export default WritingStage;

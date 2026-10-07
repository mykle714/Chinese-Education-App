/**
 * WritingCanvas — DIY handwriting capture surface (presentation layer).
 *
 * A transparent canvas that turns Pointer Events into canonical `Ink`. It is the
 * sole capture path for the writing-practice popup; recognition/grading happen
 * elsewhere (the proxy). The canvas is drawn imperatively (not via React state)
 * because a stroke can carry hundreds of points — re-rendering per move would be
 * far too costly. The source of truth is `inkRef`, exposed through an imperative
 * handle so the popup can read/clear it on Verify / Clear / tab-switch.
 *
 * Spec: docs/HANDWRITING_RECOGNITION.md ("Reading in user writing inputs").
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { eraseSweep } from "./inkErase";
import { COLORS } from "../../theme";
import type { Ink, Stroke, WritingCanvasHandle } from "./types";

/**
 * What happens to a just-finished stroke (`onStrokeEnd`): kept as drawn, swapped for
 * another stroke (Snap's printed median), or rejected — painted red, faded out, and
 * never added to the ink.
 */
export type StrokeVerdict =
  | { kind: "keep" }
  | { kind: "replace"; stroke: Stroke }
  | { kind: "reject" };

interface WritingCanvasProps {
  /** Logical (CSS px) size; coords are captured in this space and sent as the writing area. */
  size: number;
  /** When true, drawing is locked (e.g. Tab 3 while the guide is flashing). */
  disabled?: boolean;
  /** Strokes to seed the canvas with on mount (used to restore a preserved draft). */
  initialInk?: Ink;
  /** Fires whenever the stroke set changes (start/finish a stroke, clear). */
  onInkChange?: (ink: Ink) => void;
  /**
   * Fires when the user presses down to draw while `disabled`. Return true to
   * unlock and let this same pointerdown start the stroke (e.g. Memorize's
   * first-stroke-unlocks-writing); return false/undefined to keep it blocked.
   */
  onBlockedAttempt?: () => boolean | void;
  /**
   * Fires when a stroke STARTS (pointerdown accepted). Level 8's per-character clock
   * starts on the first one (useStrokeClock), so it must not wait for the stroke to end.
   */
  onStrokeStart?: () => void;
  /**
   * Judges each finished stroke against the ink so far (Snap). Absent = keep. Called
   * synchronously on pen-up, so it must be cheap.
   */
  onStrokeEnd?: (stroke: Stroke, ink: Ink) => StrokeVerdict;
  /**
   * Don't pen-draw COMMITTED strokes (the in-progress stroke and rejected fades still
   * draw). Snap paints committed strokes as printed shapes under this canvas instead.
   */
  hideCommittedInk?: boolean;
  strokeColor?: string;
  /** Line width (CSS px). Uniform along the stroke — the app draws no speed-varying ink. */
  strokeWidth?: number;
  /**
   * What a drag does. `pen` (default) draws a stroke. `eraser` is the PARTIAL eraser:
   * rubbing through ink cuts that piece out and splits the stroke around it, so the ink
   * stays real strokes (inkErase.ts). Read live — switching tools never rebinds the
   * handlers. Only the Writing Notebook offers it today (docs/WRITING_NOTEBOOK.md).
   */
  tool?: "pen" | "eraser";
  /** The eraser's radius (CSS px). */
  eraserRadius?: number;
}

// Skip points closer than this (CSS px) to the previous one, so a slow pointer
// doesn't pack the stroke with near-duplicate samples. Stroke boundaries are
// never resampled — they are semantic.
const MIN_POINT_DISTANCE = 2;
/** A rejected stroke stays solid red this long, then fades out over REJECT_FADE_MS. */
const REJECT_HOLD_MS = 250;
const REJECT_FADE_MS = 450;

const WritingCanvas = forwardRef<WritingCanvasHandle, WritingCanvasProps>(function WritingCanvas(
  { size, disabled = false, initialInk, onInkChange, onBlockedAttempt, onStrokeStart, onStrokeEnd, hideCommittedInk = false, strokeColor = COLORS.onSurface, strokeWidth = 7, tool = "pen", eraserRadius = 12 },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Completed strokes (source of truth). Current in-progress stroke is separate.
  const inkRef = useRef<Ink>(initialInk ? initialInk.map((s) => ({ ...s })) : []);
  const currentRef = useRef<Stroke | null>(null);
  // Strokes taken off by `undo`, most recent last. Only `redo` reads it; a new
  // stroke or a `clear` empties it, because replaying an undone stroke on top of
  // different ink would resurrect a stroke out of its drawing order.
  const redoRef = useRef<Ink>([]);
  // Rejected strokes still fading out, with the time each was rejected. Drawn only —
  // never part of the ink. A rAF loop repaints while any remain.
  const fadingRef = useRef<{ stroke: Stroke; at: number }[]>([]);
  const fadeFrameRef = useRef<number | null>(null);
  // Stable refs for values the (mount-only) effect's draw helpers need to read live.
  const disabledRef = useRef(disabled);
  const blockedAttemptRef = useRef(onBlockedAttempt);
  const strokeStartRef = useRef(onStrokeStart);
  const strokeEndRef = useRef(onStrokeEnd);
  const styleRef = useRef({ strokeColor, strokeWidth, hideCommittedInk });
  const toolRef = useRef({ tool, eraserRadius });
  // The eraser's live drag: its last sample (the next sweep starts there) and whether this
  // drag has removed anything yet (only then is the change reported, on release).
  const eraserRef = useRef<{ x: number; y: number; changed: boolean } | null>(null);
  disabledRef.current = disabled;
  blockedAttemptRef.current = onBlockedAttempt;
  strokeStartRef.current = onStrokeStart;
  strokeEndRef.current = onStrokeEnd;
  styleRef.current = { strokeColor, strokeWidth, hideCommittedInk };
  toolRef.current = { tool, eraserRadius };

  const notifyChange = () => onInkChange?.(inkRef.current);

  useImperativeHandle(
    ref,
    (): WritingCanvasHandle => ({
      clear: () => {
        inkRef.current = [];
        redoRef.current = [];
        currentRef.current = null;
        redrawAll();
        notifyChange();
      },
      undo: () => {
        // Drop the last completed stroke (LIFO — reverse of draw order).
        if (inkRef.current.length === 0) return;
        redoRef.current = [...redoRef.current, inkRef.current[inkRef.current.length - 1]];
        inkRef.current = inkRef.current.slice(0, -1);
        currentRef.current = null;
        redrawAll();
        notifyChange();
      },
      redo: () => {
        if (redoRef.current.length === 0) return;
        const stroke = redoRef.current[redoRef.current.length - 1];
        redoRef.current = redoRef.current.slice(0, -1);
        inkRef.current = [...inkRef.current, stroke];
        currentRef.current = null;
        redrawAll();
        notifyChange();
      },
      canRedo: () => redoRef.current.length > 0,
      getInk: () => inkRef.current,
      isEmpty: () => inkRef.current.length === 0,
    }),
    // notifyChange/redrawAll are stable enough; ref identity only needs to update
    // when the change callback changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onInkChange],
  );

  /** Repaints the whole canvas from inkRef + the in-progress stroke. */
  const redrawAll = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px, store at device res
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = styleRef.current.strokeColor;
    ctx.lineWidth = styleRef.current.strokeWidth;
    // One stroke() per path, so a translucent draw (the rejected-stroke fade) paints
    // self-overlaps once rather than darkening them.
    const drawStroke = (s: Stroke) => {
      if (s.xs.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(s.xs[0], s.ys[0]);
      for (let i = 1; i < s.xs.length; i++) ctx.lineTo(s.xs[i], s.ys[i]);
      // A single-point tap renders as a dot.
      if (s.xs.length === 1) ctx.lineTo(s.xs[0] + 0.01, s.ys[0]);
      ctx.stroke();
    };
    if (!styleRef.current.hideCommittedInk) for (const s of inkRef.current) drawStroke(s);
    if (currentRef.current) drawStroke(currentRef.current);
    // Rejected strokes: red, holding then fading (see REJECT_HOLD_MS).
    const now = performance.now();
    ctx.strokeStyle = COLORS.redMk;
    for (const f of fadingRef.current) {
      const age = now - f.at;
      ctx.globalAlpha = age <= REJECT_HOLD_MS ? 1 : Math.max(0, 1 - (age - REJECT_HOLD_MS) / REJECT_FADE_MS);
      drawStroke(f.stroke);
    }
    ctx.globalAlpha = 1;
    // The eraser's footprint, while it is down, so the learner sees what it covers.
    if (eraserRef.current) {
      ctx.beginPath();
      ctx.arc(eraserRef.current.x, eraserRef.current.y, toolRef.current.eraserRadius, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.textSecondary;
      ctx.stroke();
    }
  };

  /** Repaint every frame until the last rejected stroke has faded out. */
  const runFade = () => {
    if (fadeFrameRef.current !== null) return;
    const tick = () => {
      const cutoff = performance.now() - REJECT_HOLD_MS - REJECT_FADE_MS;
      fadingRef.current = fadingRef.current.filter((f) => f.at > cutoff);
      redrawAll();
      fadeFrameRef.current = fadingRef.current.length > 0 ? requestAnimationFrame(tick) : null;
    };
    fadeFrameRef.current = requestAnimationFrame(tick);
  };

  // Snap turns committed pen ink off once its glyph data loads (after mount): repaint.
  useEffect(() => {
    redrawAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideCommittedInk]);

  // Mount-only: size the backing store for devicePixelRatio and bind pointer
  // handlers. Re-seeds from initialInk via inkRef (already set above).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    redrawAll();

    const pointFromEvent = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent) => {
      if (disabledRef.current) {
        // Drawing is locked — surface the blocked attempt so the caller can decide
        // whether to unlock (e.g. Memorize: the first stroke itself unlocks writing,
        // so this same pointerdown falls through and starts the stroke below).
        const unlocked = blockedAttemptRef.current?.();
        if (!unlocked) {
          e.preventDefault();
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation(); // keep draw gestures from reaching the flashcard's document-level drag/flip
      canvas.setPointerCapture(e.pointerId); // finish the stroke even if it leaves the canvas
      const { x, y } = pointFromEvent(e);
      if (toolRef.current.tool === "eraser") {
        eraserRef.current = { x, y, changed: false };
        eraseTo(x, y);
        return;
      }
      currentRef.current = { xs: [x], ys: [y], ts: [performance.now()] };
      strokeStartRef.current?.();
      redrawAll();
    };

    /** Sweep the eraser from its last sample to (x, y), then repaint. */
    const eraseTo = (x: number, y: number) => {
      const eraser = eraserRef.current;
      if (!eraser) return;
      const next = eraseSweep(inkRef.current, eraser.x, eraser.y, x, y, toolRef.current.eraserRadius);
      if (next !== inkRef.current) {
        inkRef.current = next;
        eraser.changed = true;
      }
      eraser.x = x;
      eraser.y = y;
      redrawAll();
    };

    const onMove = (e: PointerEvent) => {
      if (eraserRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const { x, y } = pointFromEvent(e);
        eraseTo(x, y);
        return;
      }
      const stroke = currentRef.current;
      if (!stroke) return;
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = pointFromEvent(e);
      const lastX = stroke.xs[stroke.xs.length - 1];
      const lastY = stroke.ys[stroke.ys.length - 1];
      if (Math.hypot(x - lastX, y - lastY) < MIN_POINT_DISTANCE) return;
      stroke.xs.push(x);
      stroke.ys.push(y);
      stroke.ts.push(performance.now());
      redrawAll();
    };

    const finishStroke = (e: PointerEvent) => {
      if (eraserRef.current) {
        e.stopPropagation();
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        const { changed } = eraserRef.current;
        eraserRef.current = null;
        // An erase rewrites history like a fresh stroke does: an undone stroke replayed
        // onto the cut ink would land out of order.
        if (changed) redoRef.current = [];
        redrawAll();
        if (changed) notifyChange();
        return;
      }
      const stroke = currentRef.current;
      if (!stroke) return;
      e.stopPropagation();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const verdict = strokeEndRef.current?.(stroke, inkRef.current) ?? { kind: "keep" };
      if (verdict.kind === "reject") {
        // Not ink: it only fades. The ink (and the redo stack) are untouched.
        currentRef.current = null;
        fadingRef.current = [...fadingRef.current, { stroke, at: performance.now() }];
        runFade();
        return;
      }
      inkRef.current = [...inkRef.current, verdict.kind === "replace" ? verdict.stroke : stroke];
      // A fresh stroke forks the history: whatever was undone is no longer "next".
      redoRef.current = [];
      currentRef.current = null;
      redrawAll();
      notifyChange();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);
    return () => {
      if (fadeFrameRef.current !== null) cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = null;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", finishStroke);
      canvas.removeEventListener("pointercancel", finishStroke);
    };
    // Intentionally mount-only: size is fixed per popup open; disabled/style are
    // read live via refs so handlers never go stale without rebinding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="writing-canvas"
      style={{
        width: size,
        height: size,
        touchAction: "none", // drawing must never scroll or trigger edge-swipe nav
        // A draw gesture must never start a text selection / long-press callout that
        // could extend into whatever sits below the popup (e.g. cpcd pinyin). Pointer
        // events are stopped in JS, but native touch selection is governed by these.
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        cursor: disabled ? "not-allowed" : "crosshair",
        display: "block",
      }}
    />
  );
});

export default WritingCanvas;

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
import { COLORS } from "../../theme";
import type { Ink, Stroke, WritingCanvasHandle } from "./types";

interface WritingCanvasProps {
  /** Logical (CSS px) size; coords are captured in this space and sent as the writing area. */
  size: number;
  /** When true, drawing is locked (e.g. Tab 3 while the guide is flashing). */
  disabled?: boolean;
  /** Strokes to seed the canvas with on mount (used to restore a preserved draft). */
  initialInk?: Ink;
  /** Fires whenever the stroke set changes (start/finish a stroke, clear). */
  onInkChange?: (ink: Ink) => void;
  /** Fires when the user presses down to draw while `disabled` (a blocked attempt). */
  onBlockedAttempt?: () => void;
  strokeColor?: string;
  strokeWidth?: number;
}

// Skip points closer than this (CSS px) to the previous one, so a slow pointer
// doesn't pack the stroke with near-duplicate samples. Stroke boundaries are
// never resampled — they are semantic.
const MIN_POINT_DISTANCE = 2;

const WritingCanvas = forwardRef<WritingCanvasHandle, WritingCanvasProps>(function WritingCanvas(
  { size, disabled = false, initialInk, onInkChange, onBlockedAttempt, strokeColor = COLORS.onSurface, strokeWidth = 6 },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Completed strokes (source of truth). Current in-progress stroke is separate.
  const inkRef = useRef<Ink>(initialInk ? initialInk.map((s) => ({ ...s })) : []);
  const currentRef = useRef<Stroke | null>(null);
  // Stable refs for values the (mount-only) effect's draw helpers need to read live.
  const disabledRef = useRef(disabled);
  const blockedAttemptRef = useRef(onBlockedAttempt);
  const styleRef = useRef({ strokeColor, strokeWidth });
  disabledRef.current = disabled;
  blockedAttemptRef.current = onBlockedAttempt;
  styleRef.current = { strokeColor, strokeWidth };

  const notifyChange = () => onInkChange?.(inkRef.current);

  useImperativeHandle(
    ref,
    (): WritingCanvasHandle => ({
      clear: () => {
        inkRef.current = [];
        currentRef.current = null;
        redrawAll();
        notifyChange();
      },
      undo: () => {
        // Drop the last completed stroke (LIFO — reverse of draw order).
        if (inkRef.current.length === 0) return;
        inkRef.current = inkRef.current.slice(0, -1);
        currentRef.current = null;
        redrawAll();
        notifyChange();
      },
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
    const drawStroke = (s: Stroke) => {
      if (s.xs.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(s.xs[0], s.ys[0]);
      for (let i = 1; i < s.xs.length; i++) ctx.lineTo(s.xs[i], s.ys[i]);
      // A single-point tap renders as a dot.
      if (s.xs.length === 1) ctx.lineTo(s.xs[0] + 0.01, s.ys[0]);
      ctx.stroke();
    };
    for (const s of inkRef.current) drawStroke(s);
    if (currentRef.current) drawStroke(currentRef.current);
  };

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
        // Drawing is locked — surface the blocked attempt so the UI can nudge the
        // user toward the unlock action (e.g. pulse "Start Writing" in Memorize).
        e.preventDefault();
        blockedAttemptRef.current?.();
        return;
      }
      e.preventDefault();
      e.stopPropagation(); // keep draw gestures from reaching the flashcard's document-level drag/flip
      canvas.setPointerCapture(e.pointerId); // finish the stroke even if it leaves the canvas
      const { x, y } = pointFromEvent(e);
      currentRef.current = { xs: [x], ys: [y], ts: [performance.now()] };
      redrawAll();
    };

    const onMove = (e: PointerEvent) => {
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
      const stroke = currentRef.current;
      if (!stroke) return;
      e.stopPropagation();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      inkRef.current = [...inkRef.current, stroke];
      currentRef.current = null;
      redrawAll();
      notifyChange();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);
    return () => {
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

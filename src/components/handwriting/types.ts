/**
 * Canonical stroke format for handwriting capture (client mirror of
 * server/utils/handwritingRecognizer.ts). One internal type mediates capture and
 * every backend, so backend choice is isolated to the proxy/adapter.
 *
 * Spec: docs/HANDWRITING_RECOGNITION.md ("Canonical stroke format").
 */

/** One stroke = parallel arrays of sampled points, in draw order. ts = capture ms. */
export interface Stroke {
  xs: number[];
  ys: number[];
  ts: number[];
}

/** Strokes in the order they were drawn. */
export type Ink = Stroke[];

/** Imperative handle exposed by the capture canvas. */
export interface WritingCanvasHandle {
  /** Empty the canvas (drops all strokes). */
  clear: () => void;
  /** Remove the most recently drawn stroke (LIFO undo). */
  undo: () => void;
  /** Current strokes drawn on the canvas. */
  getInk: () => Ink;
  /** True when no strokes have been drawn. */
  isEmpty: () => boolean;
}

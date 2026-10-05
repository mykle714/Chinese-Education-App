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
  /** Remove the most recently drawn stroke (LIFO undo). It goes onto the redo stack. */
  undo: () => void;
  /**
   * Re-append the most recently undone stroke. The redo stack is dropped by a
   * newly drawn stroke and by `clear()`, so redo only ever replays a straight
   * run of undos.
   */
  redo: () => void;
  /** True when there is an undone stroke to redo. */
  canRedo: () => boolean;
  /** Current strokes drawn on the canvas. */
  getInk: () => Ink;
  /** True when no strokes have been drawn. */
  isEmpty: () => boolean;
}

/**
 * One graded writing attempt, as a surface reports it to its host: the 1-based level
 * it was written at (server/contracts/writingLevels.ts) and each character's top-1
 * result, in word order. The host turns it into per-character Writing marks
 * (docs/WRITING_PRACTICE_REWORK.md § 3a).
 */
export interface WritingAttempt {
  level: number;
  perChar: boolean[];
}

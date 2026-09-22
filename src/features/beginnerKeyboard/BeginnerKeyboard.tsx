/**
 * BeginnerKeyboard — the in-house handwriting IME, in place of the OS keyboard.
 *
 * LAYER: client feature. Owns the layout and the wiring between the composition
 * state machine and the three views; all recognition lives in
 * `src/components/handwriting/`, and no request is made on any interaction path.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6r (layout), § 6t (matcher), § 6u (lookup).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LAYOUT (§ 6r, CONFIRMED)
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ candidate row — MODAL (§ 6r)                 │
 *   ├───────────────────────┬──────────────────────┤
 *   │ submitted components  │                      │
 *   │ tap to remove         │   PERFECT SQUARE     │
 *   │                       │   drawing canvas     │
 *   └───────────────────────┴──────────────────────┘
 *
 * ⚠️ THE CANVAS MUST BE SQUARE, and it is sized from the available HEIGHT rather
 * than being handed a width. Chinese characters are written in a square box, and
 * the geometry that scores them normalizes by the larger box dimension
 * (`normalizeStrokes`) — ink drawn in a wide rectangle is squashed relative to
 * the templates before it is ever scored, so a non-square canvas degrades
 * recognition rather than merely looking wrong.
 *
 * THE CLEAR KEY (added 2026-09-09, revising the original § 6r "no clear button")
 *
 * It clears the CANVAS INK ONLY — never the component buffer. The buffer already
 * has its own per-chip tap-to-remove, so the two controls stay orthogonal and
 * neither can surprise the learner by undoing the other's work.
 *
 * ⚠️ This does NOT relax the matcher's obligation to return a candidate for
 * non-empty ink. The original reasoning for having no clear key was that
 * submitting a candidate was the learner's only exit from a canvas full of ink,
 * so an empty candidate row would trap them. The clear key is a second exit, but
 * it is the WRONG exit for a learner who drew a real glyph: taking it discards
 * the stroke work. An empty row must still not happen.
 *
 * Undo/redo (per-stroke) are still deferred; clear is all-or-nothing.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import WritingCanvas from '../../components/handwriting/WritingCanvas';
import type { WritingCanvasHandle } from '../../components/handwriting/types';
import { COLORS, FONTS, SIZE, WEIGHT } from '../../theme';
import CandidateRow from './CandidateRow';
import ComponentBuffer from './ComponentBuffer';
import { useComposition, type Candidate } from './useComposition';
import { useGlyphAssets } from './useGlyphAssets';
import DebugDumpButton from './DebugDumpButton';

interface BeginnerKeyboardProps {
  /** Fires with the character or word to insert at the caret. */
  onCommit: (text: string) => void;
  /** Total keyboard height in CSS px — the host decides this from the viewport. */
  height: number;
  /** Author-only: show the § 6w recognizer debug-dump button in the footer row. */
  debug?: boolean;
}

/** Padding around the canvas inside its half of the lower region. */
const CANVAS_INSET = 10;

export default function BeginnerKeyboard({ onCommit, height, debug }: BeginnerKeyboardProps) {
  const canvasRef = useRef<WritingCanvasHandle>(null);
  const lowerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(0);

  const assets = useGlyphAssets(true);
  const composition = useComposition(assets);

  // The canvas is a raw <canvas> sized in device pixels at mount, so it needs a
  // resolved number rather than a CSS aspect-ratio. Measured from the lower
  // region's HEIGHT: height is the scarce axis on a keyboard, and squaring off
  // the width instead would either overflow or leave the buffer no room.
  useLayoutEffect(() => {
    const element = lowerRef.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      // Never exceed half the width, or the buffer column collapses on a narrow
      // phone before the canvas stops growing.
      const limit = Math.min(box.height, box.width * 0.6);
      setCanvasSize(Math.max(0, Math.floor(limit) - CANVAS_INSET * 2));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  // Dropping the surface must not leave a half-built character behind for the
  // next field the learner focuses.
  useEffect(() => composition.reset, [composition.reset]);

  const handleSelect = useCallback(
    (candidate: Candidate) => {
      const text = composition.selectCandidate(candidate);
      // The canvas holds its strokes imperatively, so clearing the ink STATE is
      // not enough — the pixels and the ref both live in the canvas. Clearing it
      // also re-notifies with an empty ink, which is harmless and idempotent.
      canvasRef.current?.clear();
      if (text !== null) onCommit(text);
    },
    [composition, onCommit],
  );

  // Clearing the ink is a canvas operation, not a composition one: the strokes
  // live imperatively in the canvas, and its `clear()` re-notifies with an empty
  // ink, which drives the composition's state back to RESULT mode on its own.
  // There is deliberately no `composition` call here — the buffer is untouched.
  const handleClear = useCallback(() => {
    canvasRef.current?.clear();
  }, []);

  return (
    <Box
      className="beginner-keyboard"
      sx={{
        height,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: COLORS.header,
        borderTop: `1px solid ${COLORS.border}`,
        // The keyboard is a fixed surface; only its two inner scrollers move.
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <CandidateRow
        candidates={composition.candidates}
        mode={composition.mode}
        loading={!assets.ready && !assets.error}
        onSelect={handleSelect}
      />

      {assets.error && (
        <Typography
          className="beginner-keyboard__error"
          sx={{ px: 1.5, py: 0.5, fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.redA }}
        >
          Handwriting data could not load. Switch back to the normal keyboard.
        </Typography>
      )}

      <Box
        ref={lowerRef}
        className="beginner-keyboard__lower"
        sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch' }}
      >
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <ComponentBuffer buffer={composition.buffer} onRemove={composition.removeComponent} />
          {/* The utility row: the clear key, and for template authors the § 6w
              debug dump. They live here rather than floating over the keyboard,
              because an overlay covered the very text field the learner is typing
              into — the one thing that must stay visible.

              ⚠️ The two ESCAPES that used to sit here — `ABC` and the close
              chevron — moved up into `KeyboardSwitchBar` (2026-09-21, § 6z-2).
              They belong to the field rather than to this keyboard: reachable
              only from inside our surface, `ABC` was a door that locked behind
              the learner. What is left is the one control that acts on this
              keyboard's own canvas. */}
          <Box
            className="beginner-keyboard__footer"
            sx={{ px: 1.25, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <Box
              component="button"
              type="button"
              className="beginner-keyboard__clear"
              aria-label="Clear the canvas"
              // Same guard as the other footer keys: a tap must never move focus
              // off the field, because the caret is where insertion happens.
              onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
              onClick={handleClear}
              disabled={!composition.hasInk}
              sx={{
                px: 1.25,
                // Matches the `ABC` key it sits beside.
                height: 32,
                flexShrink: 0,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 2,
                backgroundColor: COLORS.white,
                fontFamily: FONTS.sans,
                fontSize: SIZE.caption,
                fontWeight: WEIGHT.semibold,
                color: COLORS.textSecondary,
                // Greyed rather than hidden: a key that appears and disappears as
                // the learner draws is a moving target in the one row they reach
                // for without looking.
                cursor: composition.hasInk ? 'pointer' : 'default',
                opacity: composition.hasInk ? 1 : 0.4,
              }}
            >
              Clear
            </Box>
            {debug && (
                <DebugDumpButton
                  ink={composition.ink}
                  buffer={composition.buffer}
                  mode={composition.mode}
                  canvasSize={canvasSize}
                  templates={assets.templates}
                  index={assets.index}
                  words={assets.words}
                />
            )}
          </Box>
        </Box>

        <Box
          className="beginner-keyboard__canvas-slot"
          sx={{ p: `${CANVAS_INSET}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Box
            className="beginner-keyboard__canvas"
            sx={{
              width: canvasSize,
              height: canvasSize,
              position: 'relative',
              borderRadius: 2,
              backgroundColor: COLORS.white,
              border: `1px solid ${COLORS.border}`,
              // The writing guides: a box with a cross, as a character is taught.
              // Painted as gradients rather than as elements so they cost nothing
              // and cannot intercept a pointer event meant for the canvas.
              backgroundImage: `
                linear-gradient(to right, transparent calc(50% - 0.5px), ${COLORS.rowBorder} calc(50% - 0.5px), ${COLORS.rowBorder} calc(50% + 0.5px), transparent calc(50% + 0.5px)),
                linear-gradient(to bottom, transparent calc(50% - 0.5px), ${COLORS.rowBorder} calc(50% - 0.5px), ${COLORS.rowBorder} calc(50% + 0.5px), transparent calc(50% + 0.5px))
              `,
              overflow: 'hidden',
            }}
          >
            {canvasSize > 0 && (
              <WritingCanvas
                ref={canvasRef}
                size={canvasSize}
                onInkChange={composition.onInkChange}
                strokeWidth={8}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

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
 * THE UNDO AND REDO KEYS (added 2026-09-24) sit right of Clear, in the order
 * Clear · Undo · Redo. Undo drops the last stroke (the canvas handle's LIFO
 * `undo`); Redo re-appends it. Same contract as clear: ink only, never the
 * buffer. A new stroke or a clear drops the redo history.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import WritingCanvas from '../../components/handwriting/WritingCanvas';
import type { Ink, WritingCanvasHandle } from '../../components/handwriting/types';
import { COLORS, FONTS, SIZE, WEIGHT } from '../../theme';
import CandidateRow from './CandidateRow';
import ComponentBuffer from './ComponentBuffer';
import { useComposition, type Candidate } from './useComposition';
import { hintCommit } from './compositionRules';
import type { HintCharacter } from '../../components/handwriting/glyphLookup';
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

/**
 * Chrome shared by the three ink keys (`Clear`, `Undo`, `Redo`). All act only on
 * the canvas, and each is greyed rather than hidden when it has nothing to do: a
 * key that appears and disappears as the learner draws is a moving target in the
 * one row they reach for without looking.
 *
 * The keys split the column's width EQUALLY (`flex: 1`) with tight padding: the
 * left column can be as narrow as ~40% of a phone's width, and three
 * natural-width keys with the old 10px padding did not fit in it.
 */
function inkKeySx(enabled: boolean) {
  return {
    flex: 1,
    minWidth: 0,
    px: 0.5,
    height: 32,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 2,
    backgroundColor: COLORS.white,
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.textSecondary,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.4,
  } as const;
}

/**
 * Every keyboard key swallows `mousedown`: a tap must never move focus off the
 * field, because the caret is where insertion happens.
 */
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

export default function BeginnerKeyboard({ onCommit, height, debug }: BeginnerKeyboardProps) {
  const canvasRef = useRef<WritingCanvasHandle>(null);
  const lowerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(0);
  // Mirrors the canvas's redo stack so the Redo key can grey out. The stack
  // itself lives imperatively in the canvas; every change to it is followed by an
  // ink notification, so re-reading it there is always current.
  const [canRedo, setCanRedo] = useState(false);

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

  // § 6z-4: a hint bubble commits its character — the same path as tapping that
  // character in the result row, so buffer and ink clear exactly as they do there.
  const handleSelectHint = useCallback(
    (hint: HintCharacter) => handleSelect(hintCommit(hint)),
    [handleSelect],
  );

  // Clearing the ink is a canvas operation, not a composition one: the strokes
  // live imperatively in the canvas, and its `clear()` re-notifies with an empty
  // ink, which drives the composition's state back to RESULT mode on its own.
  // There is deliberately no `composition` call here — the buffer is untouched.
  const handleClear = useCallback(() => {
    canvasRef.current?.clear();
  }, []);

  // Undo drops the most recent STROKE (LIFO), through the same imperative path
  // as clear: the canvas re-notifies with the shorter ink and the candidate row
  // re-scores on its own. Like clear it never touches the component buffer —
  // the buffer's chips are an unordered multiset with their own tap-to-remove.
  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  // Redo re-appends the last undone stroke. The canvas drops its redo stack on
  // a new stroke and on clear (which also covers submitting a candidate).
  const handleRedo = useCallback(() => {
    canvasRef.current?.redo();
  }, []);

  // The canvas's ink notification, extended to refresh the Redo key's state.
  const { onInkChange } = composition;
  const handleInkChange = useCallback(
    (ink: Ink) => {
      onInkChange(ink);
      setCanRedo(canvasRef.current?.canRedo() ?? false);
    },
    [onInkChange],
  );

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
        onSelectHint={handleSelectHint}
      />

      {assets.error && (
        <Typography
          className="beginner-keyboard__error"
          sx={{ px: 1.5, py: 0.5, fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.dangerInk }}
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
          {/* The utility rows: the ink keys (clear, undo, redo), and for template
              authors the § 6w debug dump on the row above them. They live here rather than floating over the keyboard,
              because an overlay covered the very text field the learner is typing
              into — the one thing that must stay visible.

              ⚠️ The two ESCAPES that used to sit here — `ABC` and the close
              chevron — moved up into `KeyboardSwitchBar` (2026-09-21, § 6z-2).
              They belong to the field rather than to this keyboard: reachable
              only from inside our surface, `ABC` was a door that locked behind
              the learner. What is left are the controls that act on this
              keyboard's own canvas. */}
          {/* The controls section, set off from the parts (component buffer)
              above by a divider rule. The author-only § 6w debug tools get their
              own row ABOVE the key row, so the learner-facing keys keep a fixed
              position whether or not the account is a template author. */}
          <Box
            className="beginner-keyboard__controls"
            sx={{
              mx: 1.25,
              pt: 0.75,
              pb: 1,
              borderTop: `1px solid ${COLORS.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
            }}
          >
            {debug && (
              <Box
                className="beginner-keyboard__debug-row"
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <DebugDumpButton
                  ink={composition.ink}
                  buffer={composition.buffer}
                  mode={composition.mode}
                  canvasSize={canvasSize}
                  templates={assets.templates}
                  index={assets.index}
                  words={assets.words}
                />
              </Box>
            )}
            <Box
              className="beginner-keyboard__footer"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
            >
              <Box
                component="button"
                type="button"
                className="beginner-keyboard__clear"
                aria-label="Clear the canvas"
                onMouseDown={keepFocus}
                onClick={handleClear}
                disabled={!composition.hasInk}
                sx={inkKeySx(composition.hasInk)}
              >
                Clear
              </Box>
              <Box
                component="button"
                type="button"
                className="beginner-keyboard__undo"
                aria-label="Undo the last stroke"
                onMouseDown={keepFocus}
                onClick={handleUndo}
                disabled={!composition.hasInk}
                sx={inkKeySx(composition.hasInk)}
              >
                Undo
              </Box>
              <Box
                component="button"
                type="button"
                className="beginner-keyboard__redo"
                aria-label="Redo the last undone stroke"
                onMouseDown={keepFocus}
                onClick={handleRedo}
                disabled={!canRedo}
                sx={inkKeySx(canRedo)}
              >
                Redo
              </Box>
            </Box>
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
                onInkChange={handleInkChange}
                strokeWidth={8}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

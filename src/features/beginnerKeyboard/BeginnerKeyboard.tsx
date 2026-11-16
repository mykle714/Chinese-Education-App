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
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import Icon from '../../components/Icon';
import WritingCanvas from '../../components/handwriting/WritingCanvas';
import type { Ink, WritingCanvasHandle } from '../../components/handwriting/types';
import { COLORS, FONTS, SIZE } from '../../theme';
import CandidateRow from './CandidateRow';
import ComponentBuffer from './ComponentBuffer';
import { KEYBOARD_COLORS } from './keyboardColors';
import { CHAR_KEY_FACE, KEY_LIP, whiteKeySx } from './keycapStyle';
import { useComposition, type Candidate } from './useComposition';
import { hintCommit, type CompositionDraft } from './compositionRules';
import type { HintCharacter } from '../../components/handwriting/glyphLookup';
import { useGlyphAssets } from './useGlyphAssets';
import DebugDumpButton from './DebugDumpButton';
import { PARTS_COLUMN_MIN_WIDTH, PARTS_COLUMN_PAD } from './ComponentBuffer';

interface BeginnerKeyboardProps {
  /** Fires with the character or word to insert at the caret. */
  onCommit: (text: string) => void;
  /** Total keyboard height in CSS px — the host decides this from the viewport. */
  height: number;
  /** Feature-tester-only: show the § 6w recognizer debug-dump button in the footer row. */
  debug?: boolean;
  /**
   * § 6z-9: the session's half-built character, held by the provider so it
   * survives this component being remounted for a new field.
   */
  draft?: { current: CompositionDraft };
}

/**
 * The canvas's margin on its top, right and bottom — EQUAL on all three (owner,
 * 2026-11-15). The left side has NO inset: the gap to the parts is the parts column's own
 * padding (ComponentBuffer → PARTS_COLUMN_PAD), so the parts sit as far from the canvas
 * as from the screen's left edge.
 */
const CANVAS_INSET = 10;

/*
 * The canvas's WIDTH cap is the parts column's floor (ComponentBuffer →
 * PARTS_COLUMN_MIN_WIDTH, 152px): the canvas slot takes whatever is left once three part
 * chips fit on one row (owner, 2026-11-15). It replaced CANVAS_MAX_WIDTH_SHARE (0.68 of
 * the width; 0.6 before that), which on a 390px phone left a ~125px column that wrapped
 * the third part. On that phone the canvas is now width-bound at 218px (was up to
 * 245px), so a little spare height collects above it (the bottom-alignment rule keeps
 * its bottom edge fixed). The column floor also gives the three ink keys their full
 * CHAR_KEY_FACE (they need 122px; the controls' PARTS_COLUMN_PAD a side leaves 132).
 * On a phone wide enough that the canvas is height-bound, the extra width goes to the
 * parts column, so the gap to the canvas stays PARTS_COLUMN_PAD there too.
 */

/**
 * The ink keys are SQUARE (owner, 2026-11-15): INK_KEY_SIZE on a side when the column has
 * room, shrinking AS A SQUARE (aspect-ratio) to a 30px floor on a narrow phone. The ā
 * pad's 4px key gap between them. The size is the candidate chips' face (CHAR_KEY_FACE,
 * 38; was 36), so the tool keys and the character keys read as one size (owner,
 * 2026-11-15).
 */
const INK_KEY_SIZE = CHAR_KEY_FACE;
const INK_KEY_GAP = 4;

/**
 * Chrome shared by the three ink keys (`Clear`, `Undo`, `Redo`). All act only on
 * the canvas, and each is greyed rather than hidden when it has nothing to do: a
 * key that appears and disappears as the learner draws is a moving target in the
 * one row they reach for without looking.
 *
 * Raised white keycaps (keycapStyle.ts → whiteKeySx), the same object as the ā pad's
 * ⌫ / ← → keys, and icon-only like them (2026-11-15, owner's choice). The accessible
 * names carry the words.
 *
 * Square keys pushed to the column's RIGHT edge, so they sit against the canvas
 * (owner, 2026-11-15; they used to split the column with `flex: 1`). Three 38px keys
 * + two 4px gaps = 122px, which the parts column's floor (PARTS_COLUMN_MIN_WIDTH, 152px
 * minus the controls' 10px margin) always leaves — so they are full size on every phone;
 * the 30px flex floor is only a backstop.
 * Clear is the `ink_eraser` glyph (the writing notebook's Eraser tool), not ⌫ — ⌫ on
 * the ā pad deletes a character from the field, and clear wipes ink.
 * A disabled key sits flat at rest: the delegate skips it (keycapPressDelegate.ts)
 * and `:active` is cancelled here, so a dead key never moves under the finger.
 */
function inkKeySx(enabled: boolean) {
  const raised = whiteKeySx();
  return {
    ...raised,
    // Square: the width flexes (38px, shrinking toward 30px only if the column were
    // ever narrower than 122px — PARTS_COLUMN_MIN_WIDTH prevents that) and the height
    // follows it.
    flex: `0 1 ${INK_KEY_SIZE}px`,
    minWidth: 30,
    aspectRatio: '1 / 1',
    height: 'auto',
    p: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: KEYBOARD_COLORS.ink2,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.4,
    '&:disabled:active': { transform: raised.transform, boxShadow: raised.boxShadow },
  } as const;
}

/**
 * The ink keys' glyph size — the ā pad's ⌫ is 22. All three are Material Symbols
 * through the app's Icon primitive (`ink_eraser` has no @mui/icons-material twin), so
 * the three glyphs share one stroke weight.
 */
const INK_ICON_PX = 22;

/**
 * Every keyboard key swallows `mousedown`: a tap must never move focus off the
 * field, because the caret is where insertion happens.
 */
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

export default function BeginnerKeyboard({ onCommit, height, debug, draft }: BeginnerKeyboardProps) {
  const canvasRef = useRef<WritingCanvasHandle>(null);
  const lowerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(0);
  // Mirrors the canvas's redo stack so the Redo key can grey out. The stack
  // itself lives imperatively in the canvas; every change to it is followed by an
  // ink notification, so re-reading it there is always current.
  const [canRedo, setCanRedo] = useState(false);

  const assets = useGlyphAssets(true);
  const composition = useComposition({ ...assets, draft });

  // The canvas is a raw <canvas> sized in device pixels at mount, so it needs a
  // resolved number rather than a CSS aspect-ratio. Measured from the lower
  // region's HEIGHT: height is the scarce axis on a keyboard, and squaring off
  // the width instead would either overflow or leave the buffer no room.
  useLayoutEffect(() => {
    const element = lowerRef.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      // Height-driven, so top / right / bottom margins are all CANVAS_INSET; capped so
      // the parts column keeps room for three chips on a row (PARTS_COLUMN_MIN_WIDTH).
      // Vertically the slot insets top + bottom; horizontally only the right (no left
      // inset — the parts column's padding is the gap).
      const limit = Math.min(box.height - CANVAS_INSET * 2, box.width - PARTS_COLUMN_MIN_WIDTH - CANVAS_INSET);
      setCanvasSize(Math.max(0, Math.floor(limit)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

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
        backgroundColor: KEYBOARD_COLORS.ground,
        borderTop: `1px solid ${KEYBOARD_COLORS.outline}`,
        // The keyboard is a fixed surface; only its two inner scrollers move.
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <CandidateRow
        candidates={composition.candidates}
        directCandidate={composition.directCandidate}
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
              position whether or not the account is a feature tester. */}
          {/* No divider above it any more (removed 2026-11-15, owner): the raised keys
              separate themselves from the parts. PARTS_COLUMN_PAD on both sides: the
              canvas slot has no left inset, so this margin IS the gap to the canvas,
              the same as the chips'.

              ⚠️ THE BOTTOM-ALIGNMENT RULE (owner, 2026-11-15): the bottom of the key
              row's LIPS sits on the canvas's bottom edge. Two halves keep it true at any
              keyboard size: the canvas is pinned to the BOTTOM of its slot (canvas-slot
              alignItems: flex-end), so its bottom edge is always CANVAS_INSET above the
              keyboard's; and this row's bottom padding is CANVAS_INSET + KEY_LIP, since
              the lip paints KEY_LIP below the key's box. Change either inset and both
              move together. */}
          <Box
            className="beginner-keyboard__controls"
            sx={{
              // The parts column's padding on BOTH sides (2026-11-15): the canvas slot
              // has no left inset now, so the keys need their own right margin to keep
              // the same gap to the canvas the chips have.
              mx: `${PARTS_COLUMN_PAD}px`,
              pt: 0.75,
              pb: `${CANVAS_INSET + KEY_LIP}px`,
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
              // Right-aligned against the canvas; the ā pad's 4px key gap.
              sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: `${INK_KEY_GAP}px` }}
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
                <Icon name="ink_eraser" size={INK_ICON_PX} />
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
                <Icon name="undo" size={INK_ICON_PX} />
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
                <Icon name="redo" size={INK_ICON_PX} />
              </Box>
            </Box>
          </Box>
        </Box>

        <Box
          className="beginner-keyboard__canvas-slot"
          // Equal inset top / right / bottom; the canvas hangs from the BOTTOM (flex-end) so
          // its bottom edge meets the ink keys' lips (the bottom-alignment rule on
          // .beginner-keyboard__controls). When the width cap binds, the spare height
          // collects ABOVE the canvas instead of splitting around it.
          // No LEFT inset: the parts column's padding is the whole gap (CANVAS_INSET doc).
          sx={{
            p: `${CANVAS_INSET}px`,
            pl: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <Box
            className="beginner-keyboard__canvas"
            sx={{
              width: canvasSize,
              height: canvasSize,
              position: 'relative',
              // 20px (owner, 2026-11-15; was MUI `2` = 16px against the theme's 8px
              // shape unit). Explicit px so it doesn't silently follow a theme change.
              borderRadius: '20px',
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
                // § 6z-9: redraw a half-built character carried over from the
                // previous field. Read on the canvas's mount only.
                initialInk={composition.ink}
                onInkChange={handleInkChange}
                strokeWidth={9}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

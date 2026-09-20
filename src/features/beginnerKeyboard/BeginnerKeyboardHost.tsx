/**
 * BeginnerKeyboardHost — mounts the handwriting keyboard over one focused field.
 *
 * LAYER: client feature. The seam between an ordinary input and the IME; the
 * keyboard itself knows nothing about inputs, carets or the OS.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a (host surface, app-wide).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS THE KEYBOARD — NOT AN OFFER (decided 2026-09-07)
 *
 * An earlier build put a bar above the OS keyboard asking "Don't know the
 * pinyin?" and swapped only if the learner took it. That was wrong: it made the
 * app's own input method a suggestion, and it cost a tap on every single field
 * for a learner who cannot type pinyin at all — which is exactly who this is for.
 *
 * So focusing an eligible field raises THIS keyboard directly. The OS keyboard is
 * suppressed on the way in:
 *
 *   1. `inputMode="none"` on the field  — so the OS keyboard does not come up
 *   2. blur, then refocus               — the only reliable way to make a browser
 *      re-read inputMode and dismiss a keyboard already on screen
 *   3. our surface mounts at the height the OS keyboard would have occupied
 *
 * Step 2 is the fragile one: without the blur, iOS Safari keeps the OS keyboard
 * up and both are on screen at once.
 *
 * ⚠️ THERE IS STILL A WAY TO LATIN TEXT. The `ABC` key hands the field back to
 * the OS keyboard for the rest of that focus — the same escape every IME has. It
 * is inside the keyboard, not a prompt in front of it, so it costs nothing until
 * it is wanted.
 *
 * ⚠️ THE FIELD KEEPS FOCUS THROUGHOUT. Insertion happens at the caret, so the
 * caret must still exist — which is why every control here prevents `mousedown`
 * default (the pointer must never steal focus) and why this is not a dialog.
 *
 * ⚠️ IT SLIDES, AND THAT IS WHY IT OUTLIVES ITS DISMISSAL (2026-09-09, § 6z).
 * The surface transitions in and out rather than appearing and vanishing, so the
 * provider cannot drop `field` the moment the learner closes it — the exit needs
 * a mounted element with a field to animate. `open` drives the transition and
 * `onClosed` fires when it has finished, which is the provider's cue to let go.
 * Reduced-motion accounts get the same states with a zero-length transition.
 *
 * ⚠️ IT PORTALS, AND IT IS `absolute` RATHER THAN `fixed`. On desktop the app
 * runs inside a 402px phone frame; a `position: fixed` surface resolves against
 * the browser window and would span the whole screen — the exact failure
 * `overlayHost.ts` documents. `nearestOverlayHost` finds the box that really
 * bounds the app, and `inset` resolves against it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Slide, useMediaQuery } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { COLORS, FONTS, SIZE, WEIGHT } from '../../theme';
import { nearestOverlayHost } from '../../components/overlayHost';
import BeginnerKeyboard from './BeginnerKeyboard';
import { useKeyboardViewport } from './useKeyboardViewport';
import { insertAtCaret } from './insertAtCaret';
import type { EditableField } from './eligibility';
import { BEGINNER_KEYBOARD_SLIDE_MS } from './transition';

interface BeginnerKeyboardHostProps {
  /** The focused field. The provider only renders this component when there is one. */
  field: EditableField;
  /** Drives the slide transition: true is up, false is on its way out. */
  open: boolean;
  /** The close chevron was pressed. The provider decides what dismissal means. */
  onDismiss: () => void;
  /** The exit transition has finished; the provider may now release the field. */
  onClosed: () => void;
  /** Reports how much bottom screen space this surface occupies, in CSS px. */
  onInsetChange?: (height: number) => void;
  /**
   * Author-only (§ 6w): float the recognizer debug-dump button over the surface.
   * Decided by the provider, which is the layer that holds auth.
   */
  debug?: boolean;
}

/**
 * Last OS keyboard height actually observed, remembered across fields.
 *
 * ⚠️ Module-level on purpose. Because we now suppress the OS keyboard on focus,
 * it may never be on screen long enough to measure — so a per-mount ref would
 * fall back to the default forever. Caching the first real measurement means the
 * keyboard matches the platform's own height from then on, including on later
 * fields that never saw it.
 */
let observedOsHeight: number | null = null;

export default function BeginnerKeyboardHost({
  field,
  open,
  onDismiss,
  onClosed,
  onInsetChange,
  debug,
}: BeginnerKeyboardHostProps) {
  // 'ours' from the moment the field is focused; 'os' only if the learner asks
  // for the system keyboard back. Keyed per field by the provider, so the choice
  // does not follow them to the next input.
  const [source, setSource] = useState<'ours' | 'os'>('ours');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewport = useKeyboardViewport();
  // Honoured rather than assumed: a learner who has asked the OS for less motion
  // still gets both states, just with no travel between them.
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  if (viewport.osKeyboardVisible && viewport.height > 0) observedOsHeight = viewport.height;
  const keyboardHeight = observedOsHeight ?? viewport.height;

  // Where to portal. Computed per field because the right host depends on which
  // page the field is on — a transformed page Surface becomes the containing
  // block for its own positioned descendants.
  const host = useMemo(() => nearestOverlayHost(field), [field]);

  /**
   * Suppress the OS keyboard for as long as ours is up, and restore the field on
   * the way out.
   *
   * ⚠️ The cleanup is not optional. A field left at `inputMode="none"` can never
   * raise a keyboard again — a leak that presents as a permanently dead input,
   * long after the learner has left the page.
   */
  useEffect(() => {
    if (source !== 'ours') return;
    field.inputMode = 'none';
    // Blur-then-refocus makes the browser re-read inputMode and drop a keyboard
    // that is already on screen; setting the property alone does not.
    field.blur();
    const frame = requestAnimationFrame(() => field.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      field.inputMode = '';
    };
  }, [source, field]);

  const useOsKeyboard = useCallback(() => {
    setSource('os');
    field.inputMode = '';
    field.blur();
    requestAnimationFrame(() => field.focus({ preventScroll: true }));
  }, [field]);

  const commit = useCallback((text: string) => insertAtCaret(field, text), [field]);

  // MEASURED rather than computed from the keyboard's nominal height: the
  // surface's real height is the only number that stays correct mid-animation.
  // Reported upward so a page with something pinned to the bottom can reserve
  // the space (§ 7a); pages that scroll ignore it.
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element || !onInsetChange) return;
    const report = () => onInsetChange(element.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      // The surface is going away; whoever reserved space must stop.
      onInsetChange(0);
    };
  }, [onInsetChange, source]);

  // Never let a tap inside the keyboard move focus off the field — the caret is
  // where insertion happens, and losing it silently breaks every commit.
  const keepFocus = useCallback((event: React.MouseEvent) => event.preventDefault(), []);

  // Handed back to the system keyboard: we are out of the way entirely, and
  // report a zero inset so any page that reserved space releases it.
  useEffect(() => {
    if (source === 'os') onInsetChange?.(0);
  }, [source, onInsetChange]);

  if (source === 'os') return null;

  return createPortal(
    <Slide
      direction="up"
      in={open}
      // `appear` so the very first mount slides in too; without it the keyboard
      // would animate away but arrive instantly, which reads as a glitch.
      appear
      timeout={reduceMotion ? 0 : BEGINNER_KEYBOARD_SLIDE_MS}
      onExited={onClosed}
    >
      <Box
        ref={surfaceRef}
        className="beginner-keyboard-host"
        onMouseDown={keepFocus}
        sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1300 }}
      >
        <BeginnerKeyboard
          onCommit={commit}
          height={keyboardHeight}
          debug={debug}
          footer={
            <>
              <Box
                component="button"
                type="button"
                className="beginner-keyboard__abc"
                onClick={useOsKeyboard}
                sx={{
                  px: 1.25,
                  height: 32,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 2,
                  backgroundColor: COLORS.white,
                  cursor: 'pointer',
                  fontFamily: FONTS.sans,
                  fontSize: SIZE.caption,
                  fontWeight: WEIGHT.semibold,
                  color: COLORS.textSecondary,
                }}
              >
                ABC
              </Box>
              {/* The deliberate exit (§ 6z). Since focus no longer binds the
                  keyboard, this is the only control that always closes it, so it
                  sits beside `ABC` — the two together are "type another way" and
                  "stop typing", which is the whole of the escape surface. */}
              <Box
                component="button"
                type="button"
                className="beginner-keyboard__close"
                aria-label="Hide the handwriting keyboard"
                onClick={onDismiss}
                sx={{
                  width: 40,
                  height: 32,
                  p: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 2,
                  backgroundColor: COLORS.white,
                  cursor: 'pointer',
                  color: COLORS.textSecondary,
                }}
              >
                <KeyboardArrowDownIcon sx={{ fontSize: 20 }} />
              </Box>
            </>
          }
        />
      </Box>
    </Slide>,
    host,
  );
}

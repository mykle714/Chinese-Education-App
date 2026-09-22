/**
 * BeginnerKeyboardHost — mounts a keyboard, and the bar that switches between
 * them, over one focused field.
 *
 * LAYER: client feature. The seam between an ordinary input and the IME; the
 * keyboard itself knows nothing about inputs, carets or the OS.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a (host surface, app-wide), § 6z-2 (the
 * switch bar).
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
 * ⚠️ THE SWITCH IS A PROPERTY OF THE FIELD, NOT OF EITHER KEYBOARD (2026-09-21).
 * The way back to Latin text used to be an `ABC` key inside our own footer, which
 * made it a one-way door — once the learner was on the OS keyboard there was no
 * control of ours left on screen to bring ours back. So the switch, and the
 * dismissal beside it, moved OUT of the keyboard into `KeyboardSwitchBar`, which
 * this host keeps up in BOTH states: over our surface, and perched on the OS
 * keyboard's measured top edge. That is why `source === 'os'` no longer renders
 * nothing.
 *
 * ⚠️ THE BAR IS ONLY EVER OVER AN ELIGIBLE FIELD. The provider mounts this host
 * exactly where the handwriting keyboard is allowed (Chinese learners, eligible
 * field, non-authoring route), so a field that declines the keyboard —
 * `data-beginner-keyboard="off"`, the iw dictionary tray — gets the plain OS
 * keyboard with no bar over it. That is the point: there is no second keyboard to
 * switch to there, and advertising one over an English-only field would be a lie.
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
 * Both modes owe that callback: our surface reports it off `Slide`'s `onExited`,
 * and the OS-keyboard mode — which has no `Slide`, because nothing of ours is
 * travelling there but the bar — times it off the bar's own exit.
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
import { nearestOverlayHost } from '../../components/overlayHost';
import BeginnerKeyboard from './BeginnerKeyboard';
import KeyboardSwitchBar, { type KeyboardSource } from './KeyboardSwitchBar';
import { useKeyboardViewport } from './useKeyboardViewport';
import { insertAtCaret } from './insertAtCaret';
import type { EditableField } from './eligibility';
import { BEGINNER_KEYBOARD_SLIDE_MS, KEYBOARD_SWITCH_BAR_SLIDE_MS } from './transition';

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
  const [source, setSource] = useState<KeyboardSource>('ours');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewport = useKeyboardViewport();
  // Honoured rather than assumed: a learner who has asked the OS for less motion
  // still gets both states, just with no travel between them.
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  if (viewport.osKeyboardVisible && viewport.height > 0) observedOsHeight = viewport.height;
  const keyboardHeight = observedOsHeight ?? viewport.height;

  /**
   * How high off the bottom the bar has to sit while the OS keyboard is up.
   *
   * ⚠️ Read from `osKeyboardVisible`, not from `height`, because `height` is a
   * SIZE HINT that falls back to a default so our own surface never collapses on
   * a desktop with a hardware keyboard. Only the boolean means real occlusion —
   * and when there is none (desktop) the bar simply sits at the bottom of the
   * app frame, which is where the field's keyboard would have been.
   *
   * § 7a's warning applies: on the web this is inferred from `visualViewport`
   * and reports nothing until the keyboard has actually opened, so expect a frame
   * or two of the bar being low during the OS keyboard's own animation. That is
   * budgeted for, not a bug; Capacitor's `keyboardWillShow` removes it.
   */
  const osPerch = viewport.osKeyboardVisible ? viewport.height : 0;

  // Where to portal. Computed per field because the right host depends on which
  // page the field is on — a transformed page Surface becomes the containing
  // block for its own positioned descendants.
  const host = useMemo(() => nearestOverlayHost(field), [field]);

  /**
   * Whether the switch bar has cleared its slot.
   *
   * Two frames, not one: the browser needs the parked transform COMMITTED before
   * the change to 0, or there is nothing to transition from and the bar appears
   * instantly. Replays on a source change as well as on open, because swapping
   * keyboards re-parks the bar behind whichever one is arriving.
   */
  const [barUp, setBarUp] = useState(false);
  useEffect(() => {
    if (!open) {
      setBarUp(false);
      return;
    }
    setBarUp(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setBarUp(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open, source]);

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

  // Coming back the other way needs no dance of its own: the effect above owns
  // the whole suppression sequence and re-runs on the source change.
  const useOurKeyboard = useCallback(() => setSource('ours'), []);

  const commit = useCallback((text: string) => insertAtCaret(field, text), [field]);

  /**
   * Report the bottom space our surfaces occupy, so a page with something pinned
   * down there can give it up (§ 7a).
   *
   * MEASURED rather than computed from the keyboard's nominal height: the real
   * height is the only number that stays correct mid-animation. In OS mode the
   * measurement is only the bar, so the perch it is sitting on is added back —
   * what a reserving page needs is the distance from the bottom of the app, and
   * the OS keyboard occludes that band whether or not it is our DOM.
   */
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element || !onInsetChange) return;
    const report = () => onInsetChange(element.getBoundingClientRect().height + osPerch);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      // The surface is going away; whoever reserved space must stop.
      onInsetChange(0);
    };
  }, [onInsetChange, source, osPerch]);

  /**
   * The OS-mode equivalent of `Slide`'s `onExited`.
   *
   * Nothing of ours is sliding here except the bar, so the provider's cue to
   * release the field is the bar's own exit finishing. Without this the host
   * would stay mounted forever after a dismissal taken while the OS keyboard was
   * up, and the field would never be released.
   */
  useEffect(() => {
    if (source !== 'os' || open) return;
    const ms = reduceMotion ? 0 : KEYBOARD_SWITCH_BAR_SLIDE_MS.exit;
    const timer = setTimeout(onClosed, ms);
    return () => clearTimeout(timer);
  }, [source, open, reduceMotion, onClosed]);

  // Never let a tap inside the keyboard move focus off the field — the caret is
  // where insertion happens, and losing it silently breaks every commit.
  const keepFocus = useCallback((event: React.MouseEvent) => event.preventDefault(), []);

  const switchBar = (
    <KeyboardSwitchBar
      source={source}
      up={barUp}
      onUseOurs={useOurKeyboard}
      onUseOs={useOsKeyboard}
      onDismiss={onDismiss}
    />
  );

  // ── The OS keyboard is up: all that is ours is the bar, perched on its top edge.
  if (source === 'os') {
    return createPortal(
      <Box
        ref={surfaceRef}
        className="beginner-keyboard-host"
        onMouseDown={keepFocus}
        sx={{ position: 'absolute', left: 0, right: 0, bottom: osPerch, zIndex: 1300 }}
      >
        {switchBar}
      </Box>,
      host,
    );
  }

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
        {/* Inside the sliding surface rather than beside it, so the bar RIDES the
            keyboard up and its own slot travel is relative to it. Outside, the
            parked bar would have been stranded in mid-air over the page for the
            frames before the keyboard arrived underneath it. */}
        {switchBar}
        <BeginnerKeyboard onCommit={commit} height={keyboardHeight} debug={debug} />
      </Box>
    </Slide>,
    host,
  );
}

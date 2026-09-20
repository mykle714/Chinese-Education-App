/**
 * BeginnerKeyboardProvider — makes the handwriting keyboard available on every
 * text field in the app, without any field having to know about it.
 *
 * LAYER: client feature, mounted once at the app root.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a ("the keyboard is available anywhere a
 * text field is focused"), § 6z (the trigger/dismiss model).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A DOCUMENT LISTENER RATHER THAN A WRAPPER COMPONENT
 *
 * § 7a made this app-wide. Wrapping every input would mean editing scores of call
 * sites and silently missing every input added afterwards — the bar would work
 * where someone remembered and not where they did not, which is worse than not
 * having it. `focusin` bubbles (unlike `focus`), so one listener at the document
 * sees every field in the app, including ones inside portals and dialogs.
 *
 * Eligibility is opt-OUT and lives in eligibility.ts; see that file for why.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ CHINESE LEARNERS ONLY (decided 2026-09-07)
 *
 * The gate is the ACCOUNT's `selectedLanguage`, not the field's content. This is
 * a Chinese handwriting IME: it can only ever produce hanzi, so offering it to a
 * Spanish learner is a bar that covers the screen and cannot help them. The check
 * is here rather than in eligibility.ts because it is about the USER, and mixing
 * it into the per-field policy would make that policy untestable without an auth
 * context.
 *
 * Consequence worth knowing: switching language mid-session removes the bar as
 * soon as `selectedLanguage` changes, because the provider stops rendering the
 * host — no cleanup is needed, the host's own unmount effect restores the field.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ FOCUS IS A TRIGGER, NOT A BINDING (changed 2026-09-09, § 6z)
 *
 * The keyboard used to exist exactly while an eligible field held focus. That
 * coupling was wrong in practice: on desktop a `<button>` takes focus when it is
 * clicked, so tapping the immersive-world send button — or the volume chip, or
 * the helper toggle — tore the keyboard down at the exact moment the learner was
 * using it, mid-sentence.
 *
 * So focusing an eligible field OPENS the keyboard, and after that the keyboard
 * stays up on its own. Dismissal is now its own set of events:
 *
 *   • the close chevron inside the keyboard (the deliberate exit)
 *   • a pointerdown, or a focus move, ANYWHERE that is not kept open
 *   • navigating to another route, or switching learning language
 *   • the target field being removed from the DOM
 *
 * "Kept open" is exactly three things: our own surface, another eligible field
 * (which retargets rather than dismisses), and any element inside a region marked
 * `data-beginner-keyboard="keep"`. Everything else dismisses — an allow-list, so
 * a new control added anywhere in the app fails toward closing the keyboard
 * rather than toward trapping the learner under it.
 *
 * ⚠️ A DISMISSAL LEAVES NO KEYBOARD BEHIND. Closing blurs the field, which keeps
 * its text and simply stops being focused; the OS keyboard is NOT raised in our
 * place. The one way to reach the OS keyboard is the `ABC` key, which is a
 * different action from closing and does not come through here.
 *
 * ⚠️ `field` OUTLIVES `open` BY ONE TRANSITION. The surface slides out rather
 * than vanishing, and it cannot animate against a field it no longer has, so the
 * host is kept mounted until its exit transition reports back through `onClosed`.
 * Read `open` — not `field` — for "is the keyboard up".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import BeginnerKeyboardHost from './BeginnerKeyboardHost';
import {
  asEditableField,
  isEligibleField,
  isKeepOpenTarget,
  isKeyboardDisabledPath,
  type EditableField,
} from './eligibility';
import { BeginnerKeyboardInsetContext, INSET_CSS_VARIABLE } from './insetContext';

/** Marks our own DOM so a tap inside it is never read as leaving the field. */
export const HOST_CLASS = 'beginner-keyboard-host';

/** The only language this keyboard can write. */
const SUPPORTED_LANGUAGE = 'zh';

export default function BeginnerKeyboardProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  // Two gates, both wholesale: the account's language, and the route. A disabled
  // route (the two authoring editors) suppresses the listeners entirely rather
  // than filtering per field, so nothing on those pages can raise the bar —
  // including their portalled dialogs, which sit outside the page's DOM subtree.
  const enabled =
    user?.selectedLanguage === SUPPORTED_LANGUAGE && !isKeyboardDisabledPath(location.pathname);
  // § 6w: the recognizer debug dump rides the same `isTemplateAuthor` grant as
  // the night-market and iw editors. The check is here because this is the only
  // layer in the feature that touches auth — pushing it down would make the
  // keyboard itself untestable without an auth context.
  const debug = !!user?.isTemplateAuthor;

  // The field text is inserted into, and whether the surface is currently up.
  // They are separate because the exit is animated; see the header note.
  const [field, setField] = useState<EditableField | null>(null);
  const [open, setOpen] = useState(false);
  const [inset, setInset] = useState(0);

  // The document listeners are registered once and must not be torn down and
  // rebuilt on every field change, so they read the target through a ref.
  const fieldRef = useRef<EditableField | null>(null);
  fieldRef.current = field;

  /** Slide the keyboard away and leave the field unfocused but intact. */
  const close = useCallback(() => {
    setOpen(false);
    // Not "hand back to the OS keyboard" — just back to the plain state, with
    // the field holding whatever was typed and nothing focused.
    fieldRef.current?.blur();
  }, []);

  /** Drop it immediately, no transition — for when the page it belonged to is gone. */
  const closeNow = useCallback(() => {
    setOpen(false);
    setField(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Nothing to listen for, and any field held from before the switch must go.
      closeNow();
      return;
    }

    /**
     * Does this interaction leave an open keyboard alone?
     *
     * Only our own surface and an explicit `keep` region survive. Note that an
     * eligible field is handled by the callers instead, because it is a
     * RETARGET rather than a survival.
     */
    const keepsOpen = (target: EventTarget | null) =>
      (target instanceof Element && target.closest(`.${HOST_CLASS}`) !== null) || isKeepOpenTarget(target);

    const onFocusIn = (event: FocusEvent) => {
      const candidate = asEditableField(event.target);
      if (candidate && isEligibleField(candidate)) {
        // The trigger. Also the retarget path: moving between two eligible
        // fields swaps the insertion target without an exit/enter flicker,
        // because `open` never goes false.
        setField(candidate);
        setOpen(true);
        return;
      }
      if (keepsOpen(event.target)) return;
      close();
    };

    /**
     * Taps are handled separately from focus because most of them never move
     * focus at all: touch devices do not focus a `<button>`, and a tap on inert
     * page background focuses nothing. Without this, the keyboard could only be
     * dismissed by finding something focusable.
     */
    const onPointerDown = (event: PointerEvent) => {
      if (!fieldRef.current) return;
      const candidate = asEditableField(event.target);
      // The focusin that follows will retarget us; closing here first would
      // play a pointless exit animation in between.
      if (candidate && isEligibleField(candidate)) return;
      if (keepsOpen(event.target)) return;
      close();
    };

    document.addEventListener('focusin', onFocusIn);
    // Capture, so a handler that stops propagation cannot strand the keyboard.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [enabled, close, closeNow]);

  // Navigating away takes the field with it, and animating out over a page that
  // no longer exists is worse than simply being gone.
  useEffect(() => {
    closeNow();
  }, [location.pathname, closeNow]);

  // A field can be unmounted while focused (a dialog closing mid-edit), which
  // would leave us portaling beside a detached node.
  useEffect(() => {
    if (!field) return;
    const observer = new MutationObserver(() => {
      if (!field.isConnected) closeNow();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [field, closeNow]);

  // Publish the occupied height to plain CSS as well as to context, from the one
  // measurement, so the two can never disagree.
  useEffect(() => {
    document.documentElement.style.setProperty(INSET_CSS_VARIABLE, `${inset}px`);
    return () => {
      // Braces matter: `removeProperty` returns a string, and returning it from
      // an effect makes React treat it as the cleanup function.
      document.documentElement.style.removeProperty(INSET_CSS_VARIABLE);
    };
  }, [inset]);

  // Space is released the moment the exit STARTS, not when it finishes, so the
  // page reflows while the keyboard slides down rather than snapping afterwards.
  const handleInset = useCallback((height: number) => setInset(height), []);
  useEffect(() => {
    if (!open) setInset(0);
  }, [open]);

  return (
    <BeginnerKeyboardInsetContext.Provider value={inset}>
      {children}
      {field && (
        <BeginnerKeyboardHost
          key={fieldKey(field)}
          field={field}
          open={open}
          onDismiss={close}
          onClosed={() => setField(null)}
          onInsetChange={handleInset}
          debug={debug}
        />
      )}
    </BeginnerKeyboardInsetContext.Provider>
  );
}

/**
 * Remount the host when the field changes identity.
 *
 * Without a key, React reuses the component across two different fields and its
 * `inputMode` cleanup runs against the new field rather than the old one — the
 * previous field stays stuck at `"none"` and can never raise a keyboard again.
 */
let fieldSequence = 0;
const fieldKeys = new WeakMap<EditableField, number>();
function fieldKey(field: EditableField): number {
  const existing = fieldKeys.get(field);
  if (existing !== undefined) return existing;
  fieldSequence += 1;
  fieldKeys.set(field, fieldSequence);
  return fieldSequence;
}

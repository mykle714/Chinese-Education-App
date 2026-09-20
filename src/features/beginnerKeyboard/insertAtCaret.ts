/**
 * Insert text into a field in a way REACT actually notices.
 *
 * LAYER: client feature DOM util.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY THIS IS NOT `field.setRangeText(...)`
 *
 * Almost every input in this app is a CONTROLLED React component: its value comes
 * from state, and state changes only when React's synthetic `onChange` fires.
 * React installs its own setter on the input's `value` property and tracks the
 * last value it saw, so:
 *
 *   - `setRangeText` / `field.value = …` mutate the DOM but bypass React's
 *     tracker. React re-renders on the next unrelated state change and paints the
 *     OLD value straight back over the insertion, which reads as "the keyboard
 *     typed a character and it vanished".
 *   - Dispatching `input` alone does not help either: React's tracker compares
 *     against its cached value, sees no change, and drops the event.
 *
 * The fix is to write through the NATIVE prototype setter — which updates the DOM
 * without touching React's cache — and then dispatch a bubbling `input` event.
 * React's tracker then sees a value different from the one it cached, and
 * `onChange` fires normally.
 *
 * This is the standard interop shim for driving a controlled input from outside
 * React. If it ever stops working, the symptom will be characters that appear and
 * then disappear, not an error.
 */
import type { EditableField } from './eligibility';

/** Cache the native setters; resolving the descriptor per keystroke is wasteful. */
const nativeSetters = new WeakMap<object, (value: string) => void>();

function nativeValueSetter(field: EditableField): ((value: string) => void) | null {
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const cached = nativeSetters.get(prototype);
  if (cached) return cached;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (!descriptor?.set) return null;
  const setter = descriptor.set as (this: EditableField, value: string) => void;
  const bound = function (this: EditableField, value: string) {
    setter.call(this, value);
  };
  nativeSetters.set(prototype, bound as (value: string) => void);
  return bound as (value: string) => void;
}

/**
 * Replace the current selection (or insert at the caret) with `text`, leaving the
 * caret after what was inserted.
 *
 * Returns the field's new value, or null when the field could not be written.
 */
export function insertAtCaret(field: EditableField, text: string): string | null {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const next = field.value.slice(0, start) + text + field.value.slice(end);

  const setter = nativeValueSetter(field);
  if (!setter) return null;
  setter.call(field, next);

  // Caret placement must come AFTER the write: setting `value` collapses the
  // selection to the end of the field in most browsers.
  const caret = start + text.length;
  try {
    field.setSelectionRange(caret, caret);
  } catch {
    // Some input types refuse selection APIs. The text still landed, and the
    // caret being at the end is a cosmetic loss rather than a broken insert.
  }

  field.dispatchEvent(new Event('input', { bubbles: true }));
  return next;
}

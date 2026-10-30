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

/**
 * Backspace: delete the selection, or the one code point before the caret when the
 * selection is collapsed. Writes through the same React-visible path as
 * `insertAtCaret` (native setter + bubbling `input`), for the same reason.
 *
 * A CODE POINT rather than a UTF-16 unit, so an astral character (a rare CJK
 * extension glyph) is removed whole instead of leaving a lone surrogate behind.
 * Every pinyin tone vowel the ā pad types is a single BMP code point, so a
 * precomposed ǚ goes in one tap and comes out in one tap.
 *
 * Returns the field's new value, or null when there was nothing to delete or the
 * field could not be written.
 *
 * Used by: PinyinToneKeyboard (the ā pad's backspace key).
 */
export function deleteBeforeCaret(field: EditableField): string | null {
  const end = field.selectionEnd ?? field.value.length;
  let start = field.selectionStart ?? end;
  if (start === end) {
    if (start === 0) return null;
    const before = field.value.slice(0, start);
    const lastCodePoint = Array.from(before).pop() ?? '';
    start -= lastCodePoint.length;
  }
  const next = field.value.slice(0, start) + field.value.slice(end);

  const setter = nativeValueSetter(field);
  if (!setter) return null;
  setter.call(field, next);
  try {
    field.setSelectionRange(start, start);
  } catch {
    // See insertAtCaret: selection APIs can be refused; the delete still landed.
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return next;
}

/**
 * Move the caret one code point left (-1) or right (+1), the way an OS keyboard's
 * arrow keys do: a selection collapses to its start (left) or end (right) instead of
 * moving, and a surrogate pair is stepped over whole.
 *
 * Only the selection changes — the value is untouched, so no `input` event is sent
 * and React sees nothing. Returns false when the caret is already at that end of the
 * field, or the field refuses selection APIs (the hold-to-repeat stops on false).
 *
 * Used by: PinyinToneKeyboard (the ā pad's ← → keys).
 */
export function moveCaret(field: EditableField, direction: -1 | 1): boolean {
  const value = field.value;
  const start = field.selectionStart ?? value.length;
  const end = field.selectionEnd ?? start;
  let next: number;
  if (start !== end) {
    next = direction < 0 ? start : end;
  } else if (direction < 0) {
    if (start === 0) return false;
    next = start - (Array.from(value.slice(0, start)).pop() ?? '').length;
  } else {
    if (end >= value.length) return false;
    next = end + (Array.from(value.slice(end))[0] ?? '').length;
  }
  try {
    field.setSelectionRange(next, next);
  } catch {
    return false;
  }
  return true;
}

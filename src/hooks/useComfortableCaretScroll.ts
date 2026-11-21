import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { measureTextareaRange } from '../utils/textareaMirror';

/**
 * useComfortableCaretScroll — while a learner WRITES in a multiline field, keep the line
 * they are writing at a comfortable reading height: clearly clear of the keyboard, with
 * visible empty space below it, and with the text just written still on screen above.
 *
 * LAYER: shared hook (feature-agnostic — docs/FRONTEND_LAYERING.md). Callers:
 *   • src/reading/TextArea.tsx — the Reader's edit mode (the textarea is its own
 *     scroll box). docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Editing.
 *   • src/features/cyoa/PassageEditorPage.tsx — the passage body (an auto-growing
 *     textarea inside the page's scrolling column). docs/CYOA_FEATURE.md § 5.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * The browser's own caret-reveal is minimal: it scrolls only until the caret line touches
 * the bottom edge, so a learner writing a passage types on the last visible line, pressed
 * against the keyboard, with nothing below. Instead, the bottom of the caret's line is
 * held no lower than CARET_COMFORT_LINE of the visible scroll box (measured from its top).
 * Above that line nothing moves: the view never chases the caret upward while it sits in
 * the comfortable band, so re-reading or editing earlier text does not jitter. A caret
 * scrolled out above the top edge is brought back with one line of headroom.
 *
 * ── THE KEYBOARD ────────────────────────────────────────────────────────────
 * This hook never reads the keyboard. Both callers already end their scroll box at the
 * keyboard's top edge (they reserve `useKeyboardInset()` as bottom padding, which unions
 * the beginner keyboard and the OS keyboard), so "the visible scroll box" IS the space
 * above the keyboard. When the keyboard slides in, that box shrinks frame by frame; a
 * ResizeObserver on it re-applies the rule each frame, so the caret line rides up WITH
 * the keyboard rather than being covered and then snapped back.
 *
 * ── ROOM BELOW THE LAST LINE ────────────────────────────────────────────────
 * Scrolling is clamped to the scroll box's range, so writing at the very END of the text
 * only reaches the comfort line if there is something below it to scroll into. The
 * cyoa column has its choices below; the Reader's textarea gives itself a large bottom
 * padding in edit mode (TextArea.tsx → EDIT_TAIL_SPACE). A new caller must do the same.
 *
 * ── WHEN IT RUNS ────────────────────────────────────────────────────────────
 *   1. After the value changes (a layout effect, so the scroll lands before paint, after
 *      MUI's autosize has re-measured the field: child layout effects run first). This
 *      covers the OS keyboard, paste, and the beginner keyboard — its insertAtCaret sets
 *      the caret BEFORE it dispatches the `input` event React turns into `onChange`.
 *   2. When the scroll box resizes (the keyboard arriving or leaving, a rotation), or the
 *      focused field does (it grew).
 *   3. When the caret is PLACED — a tap into a field (`focusin`), a tap that moves the
 *      caret inside it, arrow keys (`selectionchange`). Owner's ask 2026-11-21: "when
 *      tapping on a text box you should scroll to where the author can see the cursor
 *      keeping in mind the keyboard". With the keyboard already up nothing resizes, so
 *      without this a tap on a low line left the caret behind the keyboard. Coalesced to
 *      one settle per frame, which also lets the tap's caret land before it is measured.
 *      If the keyboard is still on its way up, trigger 2 carries the line up with it.
 * All only while the field is focused and the selection is a collapsed caret — a learner
 * selecting text to replace it is not writing yet.
 *
 * ── ONE FIELD, OR EVERY FIELD IN A COLUMN ─────────────────────────────────────
 * With `fieldRef` the hook serves that one textarea (the Reader). Without it, it serves
 * WHICHEVER text field inside `scrollerRef` has focus — textareas and text-like inputs
 * (the passage editor: body, choice labels, ending name). A single-line input has no
 * lines to measure: its whole box stands in for the caret line.
 */

/** The caret line's bottom is held no lower than this fraction of the visible box. */
export const CARET_COMFORT_LINE = 0.6;

/** A field the rule can serve. */
type CaretField = HTMLTextAreaElement | HTMLInputElement;

/** Input types that hold a caret (an email/number input's selection is not readable). */
const CARET_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password']);

type ComfortableCaretScrollOptions = {
    /** The field's (or fields') current value — a change is the "learner just wrote" signal. */
    value: string;
    /** Off = do nothing (e.g. the Reader outside edit mode). */
    enabled: boolean;
} & (
    /** One textarea, optionally inside a scroller (omit it when the textarea scrolls itself). */
    | { fieldRef: RefObject<HTMLTextAreaElement | null>; scrollerRef?: RefObject<HTMLElement | null> }
    /** Every text field inside this scroller — whichever has focus. */
    | { fieldRef?: undefined; scrollerRef: RefObject<HTMLElement | null> }
);

/** The focused field the hook serves, or null (see "ONE FIELD, OR EVERY FIELD"). */
function servedField(fieldRef: RefObject<HTMLTextAreaElement | null> | undefined, scroller: HTMLElement | null): CaretField | null {
    if (fieldRef) return fieldRef.current;
    const active = document.activeElement;
    if (!scroller || !active || !scroller.contains(active)) return null;
    if (active instanceof HTMLTextAreaElement) return active;
    if (active instanceof HTMLInputElement && CARET_INPUT_TYPES.has(active.type)) return active;
    return null;
}

/**
 * Apply THE RULE once. Pure DOM; exported for direct use where a caller has its own
 * trigger. No-op unless `field` is focused with a collapsed caret — or, with `writing`, any
 * selection (measured at its end).
 */
export function settleCaretComfortably(field: CaretField, scroller: HTMLElement | null, writing = false): void {
    if (document.activeElement !== field) return;
    // A selection is a learner choosing text — unless they are writing (see header).
    if (!writing && field.selectionStart !== field.selectionEnd) return;
    const isInput = field instanceof HTMLInputElement;
    if (isInput && !scroller) return; // an input never scrolls itself vertically

    // A single-line input's caret line is the input's own box.
    const caret = isInput
        ? { top: 0, bottom: field.clientHeight, lineHeight: field.clientHeight }
        : measureTextareaRange(field, field.selectionEnd ?? 0, field.selectionEnd ?? 0);
    const box = scroller ?? field;

    // Shift the caret's box from the textarea's content coordinates into `box`'s content
    // coordinates. Self-scrolling: they are the same. Otherwise: where the textarea's top
    // padding edge sits inside the scroller's scrolled content.
    let shift = 0;
    if (scroller) {
        const fieldRect = field.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        shift = (fieldRect.top + field.clientTop - field.scrollTop)
            - (scrollerRect.top + scroller.clientTop)
            + scroller.scrollTop;
    }
    const caretTop = caret.top + shift;
    const caretBottom = caret.bottom + shift;

    const viewTop = box.scrollTop;
    const viewHeight = box.clientHeight;
    // A box too short to hold a few lines (mid-transition, a tiny landscape band) has no
    // meaningful "comfortable" height: leave it to the browser.
    if (viewHeight < caret.lineHeight * 3) return;

    const comfortOffset = viewHeight * CARET_COMFORT_LINE;
    let target: number | null = null;
    if (caretBottom > viewTop + comfortOffset) {
        target = caretBottom - comfortOffset;
    } else if (caretTop < viewTop + caret.lineHeight) {
        target = caretTop - caret.lineHeight;
    }
    if (target === null) return;
    const maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
    const next = Math.round(Math.min(maxScroll, Math.max(0, target)));
    if (next !== box.scrollTop) box.scrollTop = next;
}

export function useComfortableCaretScroll({ fieldRef, scrollerRef, value, enabled }: ComfortableCaretScrollOptions): void {
    // Skip the first run and any render where the value did not change, so mounting the
    // page (or a re-render for an unrelated reason) never moves the view.
    const lastValueRef = useRef(value);

    // Settle whichever field is being served, if any. `writing` = the learner is mid-write
    // (the value just changed, or an IME is composing): a selection then counts as a caret.
    const composingRef = useRef(false);
    const settle = (writing = false) => {
        const scroller = scrollerRef?.current ?? null;
        const field = servedField(fieldRef, scroller);
        if (field) settleCaretComfortably(field, scroller, writing || composingRef.current);
    };
    // The effects below outlive renders; they call the latest `settle` (it reads only refs,
    // but `fieldRef` / `scrollerRef` are props and could in principle be swapped).
    const settleRef = useRef(settle);
    settleRef.current = settle;

    // Trigger 1: the learner just wrote — now, and once more after the frame's layout
    // (see "LATE LAYOUT").
    const writeFrameRef = useRef(0);
    useLayoutEffect(() => {
        if (lastValueRef.current === value) return;
        lastValueRef.current = value;
        if (!enabled) return;
        settleRef.current(true);
        cancelAnimationFrame(writeFrameRef.current);
        writeFrameRef.current = requestAnimationFrame(() => settleRef.current(true));
    }, [value, enabled]);
    useEffect(() => () => cancelAnimationFrame(writeFrameRef.current), []);

    // Trigger 2: the visible box changed size (keyboard in/out, rotation), or the field
    // being written in grew.
    useEffect(() => {
        if (!enabled) return;
        const box = scrollerRef?.current ?? fieldRef?.current;
        if (!box || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => settleRef.current());
        observer.observe(box);
        // The field being written in, observed from when it takes focus (the fields of a
        // column can mount after this effect; observing one twice is a no-op).
        const watchField = () => {
            const field = servedField(fieldRef, scrollerRef?.current ?? null);
            if (field) observer.observe(field);
        };
        watchField();
        box.addEventListener('focusin', watchField);
        return () => {
            box.removeEventListener('focusin', watchField);
            observer.disconnect();
        };
    }, [enabled, fieldRef, scrollerRef]);

    // Trigger 3: the caret was placed (a tap, arrow keys) — one settle per frame. Also
    // tracks IME composition for `writing`.
    useEffect(() => {
        if (!enabled) return;
        let frame = 0;
        const schedule = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                settleRef.current();
            });
        };
        const composing = (on: boolean) => () => {
            composingRef.current = on;
        };
        const onStart = composing(true);
        const onEnd = composing(false);
        const host = scrollerRef?.current ?? fieldRef?.current;
        host?.addEventListener('focusin', schedule);
        host?.addEventListener('compositionstart', onStart);
        host?.addEventListener('compositionend', onEnd);
        host?.addEventListener('focusout', onEnd);
        document.addEventListener('selectionchange', schedule);
        return () => {
            host?.removeEventListener('focusin', schedule);
            host?.removeEventListener('compositionstart', onStart);
            host?.removeEventListener('compositionend', onEnd);
            host?.removeEventListener('focusout', onEnd);
            document.removeEventListener('selectionchange', schedule);
            cancelAnimationFrame(frame);
            composingRef.current = false;
        };
    }, [enabled, fieldRef, scrollerRef]);
}

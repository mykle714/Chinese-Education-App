/**
 * The beginner keyboard — an app-wide Chinese handwriting IME.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md. Mount `BeginnerKeyboardHost` beside any text
 * field; the recognizers underneath it are in `src/components/handwriting/`.
 */
export { default as BeginnerKeyboardProvider } from './BeginnerKeyboardProvider';
export { default as BeginnerKeyboardHost } from './BeginnerKeyboardHost';
export { isEligibleField, asEditableField, isKeepOpenTarget, OPT_OUT_ATTRIBUTE, KEEP_OPEN_VALUE } from './eligibility';
export { insertAtCaret } from './insertAtCaret';
export { default as BeginnerKeyboard } from './BeginnerKeyboard';
export { useKeyboardViewport } from './useKeyboardViewport';
export { useBeginnerKeyboardInset, INSET_CSS_VARIABLE } from './insetContext';
export {
  useBeginnerKeyboardTransition,
  BEGINNER_KEYBOARD_SLIDE_MS,
  BEGINNER_KEYBOARD_EASING,
} from './transition';
export { useGlyphAssets } from './useGlyphAssets';
export { useComposition, CANDIDATE_DISPLAY_LIMIT } from './useComposition';
export type { Candidate, CandidateMode, Composition } from './useComposition';
export { buildDebugSnapshot, formatDebugSnapshot, DEBUG_CANDIDATE_LIMIT } from './debugSnapshot';
export type { DebugSnapshot } from './debugSnapshot';

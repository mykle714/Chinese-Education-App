/**
 * Which keyboard is on screen right now, for pages that behave differently per keyboard.
 *
 * LAYER: client feature context. Published by `BeginnerKeyboardProvider`, read through
 * `useActiveKeyboardSource()`.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-15.
 *
 * The value is the EFFECTIVE source (field lock → field default → session choice), and only
 * while the keyboard is up (`open`, not `field`: the field outlives `open` by one exit
 * transition). `null` means no keyboard is up, the account's language is not zh (the
 * provider is disabled), or the tree has no provider at all.
 *
 * ⚠️ Blind to a field that opts out (`data-beginner-keyboard="off"`): the OS keyboard comes
 * up there without the provider knowing, and this reads `null`.
 *
 * Depended on by: src/features/cyoa/useAbcTypingIsNotActivity.ts.
 */
import { createContext, useContext } from 'react';
import type { KeyboardSource } from './KeyboardSwitchBar';

export const ActiveKeyboardSourceContext = createContext<KeyboardSource | null>(null);

/** The keyboard currently up (`ours` 写 · `pinyin` ā · `os` abc), or null when none is. */
export function useActiveKeyboardSource(): KeyboardSource | null {
  return useContext(ActiveKeyboardSourceContext);
}

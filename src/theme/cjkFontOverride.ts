// DEV-ONLY override of the app-wide Chinese typeface, for /font-lab's "Use app-wide".
//
// NOT the user-facing setting. The real preference is `users."chineseFont"` (migration
// 157), applied by src/hooks/useChineseFont.ts. This module exists so a face can be
// judged on the real pages BEFORE it is offered to anyone — including faces that are
// not `selectable` and could never be stored on an account.
//
// PRECEDENCE: while an override is set, it WINS over the signed-in user's preference.
// `useChineseFont` checks `hasCjkFontOverride()` and stands down rather than fighting
// it, so the two never trade writes to the same custom property. Clearing the override
// lets the next render restore the account's own face.
//
// Nothing here runs in a production build (`src/main.tsx` guards the boot restore with
// `import.meta.env.DEV`), and with the key unset the app renders the account's face
// exactly as if this file did not exist.

import { cjkFontStack, ensureCjkFontLoaded, resolveCjkFont } from "./cjkFontOptions";

/** localStorage key holding the overriding face's CATALOG ID. */
const STORAGE_KEY = "cjkFontOverride";

/**
 * Force `id` as the app-wide Chinese face, loading its stylesheet if needed. Pass
 * `null` to clear the override and hand control back to the account's preference.
 *
 * Takes a catalog id rather than a family name so the stored value survives a face
 * being renamed or re-sourced — the same reason `users."chineseFont"` stores an id.
 */
export function setCjkFontOverride(id: string | null): void {
    const root = document.documentElement;

    if (!id) {
        root.style.removeProperty("--cjk-font");
        localStorage.removeItem(STORAGE_KEY);
        return;
    }

    const option = resolveCjkFont(id);
    ensureCjkFontLoaded(option);
    root.style.setProperty("--cjk-font", cjkFontStack(option));
    localStorage.setItem(STORAGE_KEY, option.id);
}

/** The overriding face's id, or null when no override is active. */
export function getCjkFontOverride(): string | null {
    return localStorage.getItem(STORAGE_KEY);
}

/** Whether a lab override is in force — the signal `useChineseFont` stands down on. */
export function hasCjkFontOverride(): boolean {
    return getCjkFontOverride() !== null;
}

/**
 * Re-apply a previously set override on boot. Called from src/main.tsx behind an
 * `import.meta.env.DEV` guard; a no-op when nothing is overridden.
 */
export function restoreCjkFontOverride(): void {
    const id = getCjkFontOverride();
    if (id) setCjkFontOverride(id);
}

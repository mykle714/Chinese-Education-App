// DEV-ONLY override of the app's INFO TYPE face, for /font-lab's "Use app-wide".
//
// Sets `--label-font` on :root, which `FONTS.label` (src/theme/fonts.ts) resolves
// through — so every `.lab` overline in the app re-faces at once and a candidate can be
// judged on flp, the decks page and the games rather than on specimens.
//
// UNLIKE the Chinese equivalent (src/theme/cjkFontOverride.ts) there is NO user-facing
// setting behind this and no account column: the info type is a single design decision,
// not a preference. This override is the whole mechanism, and the endpoint of the
// experiment is to hardcode the winner as `FONTS.label`'s default stack and delete both
// this file and the lab's Info-type mode.
//
// WHY IT LIVES HERE AND NOT IN src/theme/ (where its Chinese counterpart does): it reads
// the throwaway dev catalog in ./infoTypeCandidates.ts, and `src/theme/` must not import
// from `src/pages/` — that back-edge is exactly what docs/FRONTEND_LAYERING.md forbids.
// The CJK equivalent can sit in theme/ because ITS catalog ships (src/theme/cjkFontOptions.ts).
//
// Nothing here runs in a production build — src/main.tsx guards the boot restore with
// `import.meta.env.DEV`, and with the key unset `FONTS.label` falls back to the shipped
// Public Sans stack.

import { infoFaceStack, loadInfoFace, resolveInfoFace } from "./infoTypeCandidates";

/** localStorage key holding the overriding face's CATALOG ID. */
const STORAGE_KEY = "labelFontOverride";

/**
 * Force `id` as the app-wide info-type face, loading its stylesheet if needed. Pass
 * `null` to clear the override and fall back to the shipped stack.
 *
 * The custom property is set SYNCHRONOUSLY and the stylesheet is fetched behind it, so
 * the first paint uses the tail fallback and swaps in — the same behaviour every
 * `display: swap` webfont in the app already has.
 */
export function setLabelFontOverride(id: string | null): void {
    const root = document.documentElement;

    if (!id) {
        root.style.removeProperty("--label-font");
        localStorage.removeItem(STORAGE_KEY);
        return;
    }

    const option = resolveInfoFace(id);
    void loadInfoFace(option);
    root.style.setProperty("--label-font", infoFaceStack(option));
    localStorage.setItem(STORAGE_KEY, option.id);
}

/** The overriding face's id, or null when no override is active. */
export function getLabelFontOverride(): string | null {
    return localStorage.getItem(STORAGE_KEY);
}

/**
 * Re-apply a previously set override on boot. Called from src/main.tsx behind an
 * `import.meta.env.DEV` guard; a no-op when nothing is overridden.
 */
export function restoreLabelFontOverride(): void {
    const id = getLabelFontOverride();
    if (id) setLabelFontOverride(id);
}

import { useEffect } from "react";
import { useAuth } from "../AuthContext";
import { cjkFontStack, ensureCjkFontLoaded, resolveCjkFont } from "../theme/cjkFontOptions";
import { hasCjkFontOverride } from "../theme/cjkFontOverride";

/**
 * Applies the signed-in account's Chinese typeface preference
 * (`users."chineseFont"`, migration 157) to the whole app.
 *
 * HOW: writes `--cjk-font` on :root. `FONTS.cjk` (src/theme/fonts.ts) resolves to
 * `var(--cjk-font, <default stack>)`, so every one of its call sites — cpcd rows,
 * flashcard faces, reader text, bubbles — re-faces with no component changes and no
 * prop threading.
 *
 * Called ONCE, from src/App.tsx, above the router. Calling it twice would be harmless
 * (the write is idempotent) but pointless.
 *
 * ── Why this keys on `user?.chineseFont`, not on `user` ──────────────────────
 * The access token rotates every ~15 min and `useAuth()` hands back a NEW user object
 * each refresh. Keying the effect on the object identity would re-run it — and
 * re-inject stylesheet links — on every silent refresh. Keying on the primitive
 * preference means it runs only when the choice actually changes. See the
 * "never key on token" rule in docs/TOKEN_EXPIRATION_IMPLEMENTATION.md.
 *
 * ── Signed out ───────────────────────────────────────────────────────────────
 * No user means no stored preference, so the property is cleared and `FONTS.cjk`
 * falls through to the var()'s default stack (Noto Sans SC). Auth screens therefore
 * render in the historical face, which is correct: there is no account to have a
 * preference yet.
 */
export function useChineseFont(): void {
    const { user } = useAuth();
    const fontId = user?.chineseFont;

    useEffect(() => {
        // /font-lab's dev "Use app-wide" outranks the account preference — see
        // src/theme/cjkFontOverride.ts. Standing down here is what stops the two from
        // trading writes to the same property on every auth refresh.
        if (import.meta.env.DEV && hasCjkFontOverride()) return;

        const root = document.documentElement;
        if (!fontId) {
            root.style.removeProperty("--cjk-font");
            return;
        }
        const option = resolveCjkFont(fontId);
        ensureCjkFontLoaded(option);
        root.style.setProperty("--cjk-font", cjkFontStack(option));
    }, [fontId]);
}

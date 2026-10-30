import { useEffect } from "react";
import { useAuth } from "../AuthContext";
import { cjkFontStack, ensureCjkFontLoaded, resolveCjkFont } from "../theme/cjkFontOptions";

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
 * ── This is the ONLY writer of `--cjk-font` at :root ─────────────────────────
 * /font-lab used to carry a dev-only "Use app-wide" override that also wrote this
 * property, and this effect stood down whenever that override was set. It was removed
 * (2026-09-05) because a debugging affordance silently and permanently outranked a
 * real account setting: one stale `cjkFontOverride` localStorage key left the settings
 * picker looking broken, with no signal at either end. The lab now only re-faces its
 * own compare columns. Do not reintroduce a second writer of this property — if a
 * future lab needs to preview a face on the real pages, it should go through the
 * account setting, or announce itself in settings rather than winning silently.
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

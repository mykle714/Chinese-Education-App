import { useEffect } from "react";
import { DEFAULT_CHINESE_FONT_ID } from "../types";
import { cjkFontStack, ensureCjkFontLoaded, resolveCjkFont } from "../theme/cjkFontOptions";

/**
 * Applies the app's one Chinese typeface (`DEFAULT_CHINESE_FONT_ID`, 975 Maru SC) to
 * the whole app, signed in or out.
 *
 * Account choice is DISABLED: `users."chineseFont"` (migration 157) is still stored and
 * still served, but nothing reads it — every account, including those backfilled to
 * Noto Sans SC, renders in the default. See docs/CJK_TYPEFACE_LAB.md § 0 and
 * docs/DEFERRED_WORK.md.
 *
 * HOW: writes `--cjk-font` on :root. `FONTS.cjk` (src/theme/fonts.ts) resolves to
 * `var(--cjk-font, <fallback stack>)`, so every one of its call sites — cpcd rows,
 * flashcard faces, reader text, bubbles — re-faces with no component changes and no
 * prop threading.
 *
 * Called ONCE, from `App` in src/App.tsx, above the router. Calling it twice would be harmless
 * (the write is idempotent) but pointless.
 *
 * ── This is the ONLY writer of `--cjk-font` at :root ─────────────────────────
 * /font-lab used to carry a dev-only "Use app-wide" override that also wrote this
 * property, and this effect stood down whenever that override was set. It was removed
 * (2026-09-05) because a debugging affordance silently and permanently outranked a
 * real account setting. The lab now only re-faces its own compare columns. Do not
 * reintroduce a second writer of this property.
 */
export function useChineseFont(): void {
    useEffect(() => {
        const option = resolveCjkFont(DEFAULT_CHINESE_FONT_ID);
        ensureCjkFontLoaded(option);
        document.documentElement.style.setProperty("--cjk-font", cjkFontStack(option));
    }, []);
}

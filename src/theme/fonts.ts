// Font families — the single source of truth for every typeface in the app.
//
// ⚠️ Webfonts must be loaded in index.html for these to render as intended:
//   - "Inter"        → primary Latin UI font (Google Fonts)
//   - "Noto Sans SC" → Simplified-Chinese glyphs
//   - "Noto Serif SC"→ large hero character on the card-detail page
// If a face is missing the browser silently falls back down the stack.
export const FONTS = {
    // Primary UI font for all Latin text (labels, body, headings, buttons).
    sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',

    // CJK text — characters, foreign words, mixed-script blocks.
    // Merges the three CJK stacks that previously lived inline across the app.
    cjk: '"Noto Sans SC", "Noto Sans JP", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',

    // Serif — reserved for the giant headword character on the card-detail page.
    serif: '"Noto Serif SC", Georgia, serif',

    // Numeric / code / numbered-tone pinyin.
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

// The Chinese typeface catalog — the single source of truth for every face the app can
// render, both the ones users can pick and the exploration-only extras.
//
// TWO AUDIENCES, ONE LIST:
//   • `selectable: true`  → offered in account settings, and a legal value of
//                           `users."chineseFont"` (migration 157). These ids MUST equal
//                           CHINESE_FONT_IDS in server/contracts/wire.ts — asserted by
//                           src/__tests__/chineseFont.test.ts, not synced on trust.
//   • `selectable: false` → visible only in /font-lab, for comparison. Never reaches a
//                           user, never a legal stored value.
//
// Keeping both in ONE array is deliberate: a separate lab list drifted on family names
// and stylesheet URLs the moment either changed, and the family string has to be exact
// (case and spaces) or the face silently falls back.
//
// Consumed by: src/pages/SettingsPage.tsx (the picker), src/hooks/useChineseFont.ts
// (applies the choice), src/pages/fontLab/* (the compare grid).
// See docs/CJK_TYPEFACE_LAB.md.

import { DEFAULT_CHINESE_FONT_ID } from "../../server/contracts/wire";

/** Broad typographic class — the thing you are actually choosing between. */
export type CjkFontKind = "hei" | "song" | "kai" | "round" | "display";

export interface CjkFontOption {
    /** Stable key. This is what `users."chineseFont"` stores. */
    id: string;
    /** Human label. */
    label: string;
    /** Chinese name — these faces are known by it, so it is shown alongside. */
    nativeLabel: string;
    kind: CjkFontKind;
    /** The exact `font-family` the stylesheet declares. Case- and space-sensitive. */
    family: string;
    /** Stylesheet to load on demand; null = already loaded by index.html. */
    href: string | null;
    /** One line on what the face is for. Shown in settings and in the lab. */
    note: string;
    /**
     * Licensing, stated plainly, because it is the constraint most likely to kill a
     * favourite late. Only `ofl`/`apache` faces may ever be `selectable`.
     */
    license: "ofl" | "apache" | "restricted";
    /** Offered to users in account settings. */
    selectable: boolean;
}

/**
 * `cn-fontsource` (github.com/wc-ex/cn-fontsource) republishes Chinese webfonts as
 * unicode-range-sliced @font-face sets — 80–620 slices per face. The browser fetches
 * only the slices a page actually uses, so cost scales with glyph coverage rather than
 * with the (very large) whole font.
 */
const JSDELIVR = (pkg: string) => `https://cdn.jsdelivr.net/npm/cn-fontsource-${pkg}/font.css`;

/**
 * THE DEFAULT FACE COMES FIRST — it leads both the settings picker and the lab, and
 * carries a "Default" badge in settings derived from DEFAULT_CHINESE_FONT_ID (never
 * hardcoded, so the badge follows the constant). `chineseFont.test.ts` asserts this
 * ordering, so a future reshuffle cannot silently bury it.
 *
 * Everything after it reads as a spectrum: the incumbent, then gothic → serif → kai →
 * rounded → display. Selectable faces are not contiguous on purpose — the order is
 * about reading the list, and settings filters rather than slices.
 *
 * NO `license: "restricted"` FACE MAY BE ADDED HERE AS SELECTABLE, and as of
 * 2026-09-04 there are none at all: FZKai-Z03 (方正楷体) was removed outright rather
 * than kept as a lab benchmark, because Founder's grant is non-commercial only and a
 * face nobody may ship is not worth the standing temptation. LXGW WenKai is the free
 * kai to compare against instead. The `restricted` licence value and the test that
 * enforces it are kept for the next candidate that needs them.
 */
export const CJK_FONT_CATALOG: readonly CjkFontOption[] = [
    {
        id: "975-maru",
        label: "975 Maru SC",
        nativeLabel: "975 圆体",
        kind: "round",
        family: "975Maru SC",
        href: JSDELIVR("975-maru-sc-regular"),
        note: "Rounded gothic (圆体). Friendly and game-like, which suits an app that is mostly games.",
        license: "ofl",
        selectable: true,
    },
    {
        id: "noto-sans-sc",
        label: "Noto Sans SC",
        nativeLabel: "思源黑体",
        kind: "hei",
        family: "Noto Sans SC",
        href: null, // index.html
        note: "Neutral gothic with the widest glyph coverage here. The app's original face, and what every account created before the typeface setting still uses.",
        license: "ofl",
        selectable: true,
    },
    {
        id: "lxgw-neo-xihei",
        label: "LXGW Neo XiHei",
        nativeLabel: "霞鹜新晰黑",
        kind: "hei",
        family: "LXGW Neo XiHei",
        href: JSDELIVR("lxgw-neo-xi-hei-regular"),
        note: "A gothic with more stroke contrast and open counters than Noto — reads lighter at small sizes without going spindly.",
        license: "ofl",
        selectable: false,
    },
    {
        id: "noto-serif-sc",
        label: "Noto Serif SC",
        nativeLabel: "思源宋体",
        kind: "song",
        family: "Noto Serif SC",
        href: null, // index.html — FONTS.serif already falls through to it for CJK heroes
        note: "Already loaded for the serif hero character, so it costs no new bytes.",
        license: "ofl",
        selectable: false,
    },
    {
        id: "source-han-serif-sc",
        label: "Source Han Serif SC",
        nativeLabel: "思源宋体 VF",
        kind: "song",
        family: "Source Han Serif SC VF",
        href: JSDELIVR("source-han-serif-sc-vf-regular"),
        note: "The variable-weight cut of the same design as Noto Serif SC. Here to compare weight response, not shape.",
        license: "ofl",
        selectable: false,
    },
    {
        id: "lxgw-neo-zhisong",
        label: "LXGW Neo ZhiSong",
        nativeLabel: "霞鹜致宋",
        kind: "song",
        family: "LXGW Neo ZhiSong CHS",
        href: JSDELIVR("lxgw-neo-zhi-song-chs-regular-lxgw-neo-zhi-song"),
        note: "A lighter, more calligraphic Song. Elegant at hero size; thin strokes thin out badly at caption size.",
        license: "ofl",
        selectable: false,
    },
    {
        id: "lxgw-wenkai",
        label: "LXGW WenKai",
        nativeLabel: "霞鹜文楷",
        kind: "kai",
        family: "LXGW WenKai GB Screen",
        href: JSDELIVR("lxgw-wen-kai-gb-screen"),
        note: "Kai — the brush-derived model form taught in Chinese schools, so its stroke shapes match what you are asked to write. The free stand-in for 方正楷体.",
        license: "ofl",
        selectable: true,
    },
    {
        id: "xiaolai-sc",
        label: "Xiaolai SC",
        nativeLabel: "小赖字体",
        kind: "kai",
        family: "Xiaolai SC",
        href: JSDELIVR("xiaolai-sc-regular"),
        note: "A softer, rounder kai. Warmer and less formal than WenKai, with slightly lower contrast.",
        license: "ofl",
        selectable: true,
    },
    {
        id: "yozai",
        label: "Yozai",
        nativeLabel: "悠哉字体",
        kind: "kai",
        family: "Yozai",
        href: JSDELIVR("yozai-regular"),
        note: "Kai/gothic hybrid derived from Klee One. A handwritten feel with gothic evenness — the middle path between WenKai and Noto Sans.",
        license: "ofl",
        selectable: true,
    },
    {
        id: "maoken-zhuyuan",
        label: "Maoken Zhuyuan",
        nativeLabel: "猫啃珠圆体",
        kind: "round",
        family: "MaokenZhuyuanTi",
        href: JSDELIVR("maoken-zhuyuan-ti-regular"),
        note: "Heavier, bubblier round with a lot of personality. Great on a card face, busy in a long reader paragraph.",
        license: "ofl",
        selectable: true,
    },
    {
        id: "zcool-xiaowei",
        label: "ZCOOL XiaoWei",
        nativeLabel: "站酷小薇",
        kind: "display",
        family: "ZCOOL XiaoWei",
        href: "https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&display=swap",
        note: "Single weight, high contrast, display intent. In the lab to show what an expressive face does to a dense reader paragraph — the answer is usually 'too much'.",
        license: "ofl",
        selectable: false,
    },
    {
        id: "smiley-sans",
        label: "Smiley Sans Oblique",
        nativeLabel: "得意黑",
        kind: "display",
        family: "Smiley Sans Oblique",
        href: JSDELIVR("smiley-sans-oblique-regular"),
        note: "⚠ CONDENSED AND OBLIQUE. Its han advance is narrower than 1em, which shifts every cpcd pinyin column off its character. Here as the demonstration of the metric constraint, not as a candidate.",
        license: "ofl",
        selectable: false,
    },
];

/** The faces offered to users in account settings. */
export const CJK_FONT_OPTIONS: readonly CjkFontOption[] = CJK_FONT_CATALOG.filter((f) => f.selectable);

/**
 * The option for a stored id, falling back to the default face when the id is unknown
 * — a row written before a face was retired, or a client older than the catalog.
 * Never returns undefined, so no call site has to render a missing typeface.
 */
export function resolveCjkFont(id: string | null | undefined): CjkFontOption {
    return (
        CJK_FONT_CATALOG.find((f) => f.id === id) ??
        CJK_FONT_CATALOG.find((f) => f.id === DEFAULT_CHINESE_FONT_ID) ??
        CJK_FONT_CATALOG[0]
    );
}

/**
 * The `font-family` stack for one face. The app's default stack stays on as a TAIL
 * fallback, so a glyph the chosen face lacks degrades per-glyph to Noto Sans SC rather
 * than to the OS font or tofu.
 *
 * This is the ONE place the stack is built; `--cjk-font` is set from it everywhere
 * (the settings picker's previews, the runtime application, and the lab's columns).
 */
export function cjkFontStack(option: CjkFontOption): string {
    return `"${option.family}", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
}

/** Stylesheet <link>s already injected, keyed by option id, so each loads at most once. */
const injected = new Set<string>();

/**
 * Ensure a face's stylesheet is in the document. Idempotent, and safe to call for a
 * face that needs no stylesheet (index.html already carries it).
 *
 * Fire-and-forget: a stylesheet that fails to load leaves the tail fallback rendering,
 * which is a degraded typeface rather than a broken page — so there is nothing useful
 * to do with an error here.
 */
export function ensureCjkFontLoaded(option: CjkFontOption): void {
    if (!option.href || injected.has(option.id)) return;
    injected.add(option.id);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = option.href;
    link.dataset.cjkFont = option.id;
    document.head.appendChild(link);
}

// Central color palette — replaces the nine duplicated `const COLORS = {...}`
// blocks that previously lived in individual pages/components. Every value here
// was already in use; this just unifies them into one source of truth.
//
// Progress-category (bucket) colors also exist as CATEGORY_COLORS in
// utils/categoryColors.ts — use getCategoryColor() when the color is chosen
// *by a card's category*. The main/accent aliases below are for static UI
// (bucket headers, the discover-page buckets) that name a color directly.
import { CATEGORY_COLORS } from "../utils/categoryColors";

export const COLORS = {
    // ── Surfaces (light theme base) ───────────────────────────────
    background: "#FAFAFB",
    header: "#F2F2F4",
    card: "#D8D8DC",
    cardBeige: "#F5EBE0",        // light beige flashcard fill (fie "card" menu; shares the infoCard beige)
    infoCard: "#F5EBE0",
    sectionCard: "#EDE7DC",
    iconBg: "#F1ECE3",

    // ── Text ──────────────────────────────────────────────────────
    onSurface: "#1C1C1E",        // primary text
    textSecondary: "#5C5C66",    // muted / secondary text
    iconColor: "#323232",        // footer / nav icons

    // ── Lines & overlays ──────────────────────────────────────────
    border: "#5C5C66",
    rowBorder: "rgba(0, 0, 0, 0.08)",
    rowHoverBg: "rgba(0, 0, 0, 0.04)",

    // ── Bucket / progress-category colors ─────────────────────────
    redMain: CATEGORY_COLORS.Unfamiliar,    // #EF476F — Unfamiliar
    redAccent: "#F2BAC9",
    yellowMain: CATEGORY_COLORS.Target,     // #FF9E5A — Target
    yellowAccent: "#F2E2BA",
    greenMain: CATEGORY_COLORS.Comfortable, // #05C793 — Comfortable
    greenAccent: "#BAF2D8",
    blueMain: CATEGORY_COLORS.Mastered,     // #779BE7 — Mastered
    blueAccent: "#BAD7F2",
    purpleAccent: "#D8BAF2",                // pastel purple, same accent family (fie "card" fill)
    hskChip: "#779BE7",

    // ── Streak / activity ─────────────────────────────────────────
    fireActive: "#E65100",       // the "active" streak-flame color (MinutePointsFireBadge)
} as const;

export type ColorToken = keyof typeof COLORS;

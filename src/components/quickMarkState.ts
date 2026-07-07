// Quick Mark's 3-state per-card mark (docs/QUICK_MARK.md §3). The string values ARE
// the server bucket ids, so a mark maps straight onto the quick-mark-batch payload
// with no translation ('empty' → delete/no-op; 'library'/'already-learned' → sortCard).
// Kept in its own module (not QuickMarkCard.tsx) so the card file only exports a
// component — otherwise Vite fast-refresh disables HMR for it.
export type QuickMarkState = "empty" | "library" | "already-learned";

// Cycle order: empty → green (Add to Learn Now) → blue M (Mastered) → empty.
export const nextQuickMarkState = (s: QuickMarkState): QuickMarkState =>
    s === "empty" ? "library" : s === "library" ? "already-learned" : "empty";

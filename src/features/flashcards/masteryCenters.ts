import type { MasteryGoals, MasteryBarId } from "../../utils/masteryCompute";
import { COLORS, type RampHue } from "../../theme/colors";
import { MASTERY_BAR_HUES } from "../../utils/categoryColors";

/**
 * masteryCenters.ts — what a Mastery Center IS, shared by the fdp buttons that open
 * one and by the page that renders it.
 *
 * ── What a Center is ──────────────────────────────────────────────────────────
 * A Reading Center and a Writing Center are skill STUDY pages: the things you do to
 * train that one skill (word of the day, a drill grid, the skill's games), with the
 * fdp's decks panel behind the same two pill-raised sheets (Cards / Decks), read
 * through ONE skill bar instead of the core bar — so every figure, ordering, strip and
 * badge in those sheets answers "how is my reading (writing) going" rather than "how
 * well do I know this". See docs/READING_WRITING_CENTERS.md.
 *
 * They exist because the fdp was trying to answer both questions at once. A learner
 * pursuing reading had a Mastered Reading tile wedged into a page whose every other
 * number was core, and no surface anywhere that ordered their library by what they
 * still cannot read. Splitting the skills onto their own pages leaves the fdp to do
 * exactly one thing — recognition and production — and gives each skill a page that
 * does the same for it.
 *
 * ── Gating ────────────────────────────────────────────────────────────────────
 * A Center's fdp button appears only when its GOAL is set (`users.readingGoal` /
 * `writingGoal`), which is the same gate the bars, the Mastered collections and the
 * sort rows already use. Spanish accounts never get the goal toggles (no es card can
 * accrue reading or writing marks — docs/MASTERY_REWORK.md § 1), so they never see a
 * Center button either.
 *
 * ⚠️ The gate is on the BUTTON, not on the route. Reading and writing marks accrue
 * for every account whatever their goals say (migration 143), so a hand-typed
 * `/flashcards/reading` shows a truthful, possibly non-empty page rather than a wall —
 * the same rule `?collection=mastered-reading` follows on the server.
 *
 * Layer: feature module (src/features/flashcards). Pure data.
 * Docs: docs/DECKS_FEATURE.md § "Mastery Centers", docs/READING_WRITING_CENTERS.md.
 */

/** The skill bars that have a Center. Core has no Center — the fdp IS its surface. */
export type MasteryCenterBar = Exclude<MasteryBarId, "core">;

export const MASTERY_CENTER_BARS: readonly MasteryCenterBar[] = ["reading", "writing"] as const;

/** The route each Center lives at. */
export const MASTERY_CENTER_PATHS: Record<MasteryCenterBar, string> = {
    reading: "/flashcards/reading",
    writing: "/flashcards/writing",
};

/** The page title and the fdp button's label — the same words in both places. */
export const MASTERY_CENTER_TITLES: Record<MasteryCenterBar, string> = {
    reading: "Reading Center",
    writing: "Writing Center",
};

/** The fdp button's (shorter) label. The page's own title carries the word "Center". */
export const MASTERY_CENTER_BUTTON_LABELS: Record<MasteryCenterBar, string> = {
    reading: "Reading",
    writing: "Writing",
};

/**
 * Each Center's hue — NOT a second table: it IS the skill's bar hue
 * (`MASTERY_BAR_HUES`), so the fdp rail tile (SURFACE tier), the page ground (`Bg`
 * tier, below), the Mastered tile in the Center's Cards sheet and every skill dot are
 * one colour by construction. Reading green, writing purple since 2026-10-02.
 */
export const MASTERY_CENTER_HUES: Record<MasteryCenterBar, RampHue> = {
    reading: MASTERY_BAR_HUES.reading,
    writing: MASTERY_BAR_HUES.writing,
};

/**
 * The page ground each Center sits on — the design's `--grnBg` / `--purBg`. A literal
 * per Center rather than derived from the hue, because the `Bg` tier exists for these
 * two hues only (theme/colors.ts).
 */
export const MASTERY_CENTER_GROUNDS: Record<MasteryCenterBar, string> = {
    reading: COLORS.grnBg,
    writing: COLORS.purBg,
};

/** The Material Symbols glyph each Center is drawn with (rail tile, sheet tiles). */
export const MASTERY_CENTER_GLYPHS: Record<MasteryCenterBar, string> = {
    reading: "menu_book",
    writing: "draw",
};

/** Which Centers this account has buttons for, in display order. */
export function activeMasteryCenters(goals: MasteryGoals): MasteryCenterBar[] {
    return MASTERY_CENTER_BARS.filter((bar) => goals[bar]);
}

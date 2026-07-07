// Mastery compute (client mirror) — the pbh (progress-bar-height) formula, per-type
// positive counts, and the stacked-bar composition for the cdp progress bar.
//
// Mirror of server/utils/masteryCompute.ts and the SQL compute_utcm_category()
// (migration 101). Keep the three in sync. See docs/MASTERY_REWORK.md.
import { MARK_TYPES } from "../types";
import type { MarkType, ReviewMark, TypedMarkHistory, FlashcardCategory } from "../types";

// Account mastery goals. Recognition + Production are always goals; reading/writing
// are per-account opt-in.
export interface MasteryGoals {
  reading: boolean;
  writing: boolean;
}

// The pbh height at which the bar is full and the card is Mastered.
export const PBH_FULL = 8;

// pbh band boundaries (docs/MASTERY_REWORK.md). A card is Unfamiliar below
// `target`, Target below `comfortable`, Comfortable below PBH_FULL, else Mastered.
// Rendered as benchmark lines on the cdp bar (Mastered's boundary is the bar top).
export const PBH_THRESHOLDS: { label: FlashcardCategory; pbh: number }[] = [
  { label: "Target", pbh: 3 },
  { label: "Comfortable", pbh: 6 },
];

// positive(track): count of isCorrect marks among a type's (<=8) marks.
export function positiveCount(track: ReviewMark[] | undefined): number {
  if (!Array.isArray(track)) return 0;
  let n = 0;
  for (const m of track) if (m?.isCorrect) n++;
  return n;
}

// Positive counts for ALL four types (regardless of goals) — used by the stacked
// bar composition.
export function positivesByType(history: TypedMarkHistory | undefined): Record<MarkType, number> {
  const h = history ?? {};
  return {
    recognition: positiveCount(h.recognition),
    production: positiveCount(h.production),
    reading: positiveCount(h.reading),
    writing: positiveCount(h.writing),
  };
}

export function goalTypes(goals: MasteryGoals): MarkType[] {
  const types: MarkType[] = ["recognition", "production"];
  if (goals.reading) types.push("reading");
  if (goals.writing) types.push("writing");
  return types;
}

/**
 * Progress-bar height: min(6, max positive among goals) + (remaining goals' sum)
 * / ((goalCount - 1) * 3). Range 0 → ~8.67.
 */
export function progressBarHeight(history: TypedMarkHistory | undefined, goals: MasteryGoals): number {
  const h = history ?? {};
  const positives = goalTypes(goals).map((t) => positiveCount(h[t]));
  const goalCount = positives.length;
  const maxVal = Math.max(...positives);
  const sumVal = positives.reduce((a, b) => a + b, 0);
  const firstTerm = Math.min(6, maxVal);
  const secondTerm = goalCount > 1 ? (sumVal - maxVal) / ((goalCount - 1) * 3) : 0;
  return firstTerm + secondTerm;
}

export function categoryForPbh(pbh: number): FlashcardCategory {
  if (pbh < 3) return "Unfamiliar";
  if (pbh < 6) return "Target";
  if (pbh < 8) return "Comfortable";
  return "Mastered";
}

export function computeUtcm(history: TypedMarkHistory | undefined, goals: MasteryGoals): FlashcardCategory {
  return categoryForPbh(progressBarHeight(history, goals));
}

// One stacked-bar segment: a mark type, its positive count, and the fraction of
// the total positives it represents (composition is over ALL types, not just goals).
export interface MasteryBarSegment {
  type: MarkType;
  positive: number;
  /** Fraction of the total positive marks across all types (0..1); 0 when nothing yet. */
  fraction: number;
}

// App light colors per mark type (docs/MASTERY_REWORK.md). NOTE: these currently
// collide with the utcm category colors; to be rectified later.
export const MARK_TYPE_COLORS: Record<MarkType, string> = {
  recognition: "#779BE7", // blue
  production: "#05C793",  // green
  reading: "#EF476F",     // red
  writing: "#FF8E47",     // yellow
};

export const MARK_TYPE_LABELS: Record<MarkType, string> = {
  recognition: "Recognition",
  production: "Production",
  reading: "Reading",
  writing: "Writing",
};

// The cdp stacked-bar model: overall height fraction (pbh / PBH_FULL, clamped to
// 1) plus per-type composition segments.
export interface MasteryBar {
  pbh: number;
  /** 0..1 fill of the track (pbh capped at PBH_FULL). */
  heightFraction: number;
  category: FlashcardCategory;
  segments: MasteryBarSegment[];
}

export function masteryBar(history: TypedMarkHistory | undefined, goals: MasteryGoals): MasteryBar {
  const pbh = progressBarHeight(history, goals);
  const positives = positivesByType(history);
  const totalPositive = MARK_TYPES.reduce((sum, t) => sum + positives[t], 0);
  const segments: MasteryBarSegment[] = MARK_TYPES.map((type) => ({
    type,
    positive: positives[type],
    fraction: totalPositive > 0 ? positives[type] / totalPositive : 0,
  }));
  return {
    pbh,
    heightFraction: Math.min(1, pbh / PBH_FULL),
    category: categoryForPbh(pbh),
    segments,
  };
}

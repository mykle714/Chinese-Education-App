/**
 * mastery.ts — THE pbh (progress-bar-height) formula and utcm banding.
 *
 * This used to exist four times: `src/utils/masteryCompute.ts`,
 * `server/utils/masteryCompute.ts`, the SQL `compute_utcm_category()` (migration
 * 101) and `compute_type_category()` (migration 128). The two TypeScript copies now
 * both re-export this file; the SQL functions remain because the generated
 * `vocabentries_*.category` column depends on them, but they are no longer the
 * definition — see the sync test in `server/__tests__/mastery.test.ts`, which pins
 * the cut points and the blend so a future edit here fails loudly.
 *
 * Contract rules (same as wire.ts): no relative VALUE imports, no enums, no Node or
 * DOM globals. The one `import type ... from './wire.js'` below is erased at compile
 * time and resolves under both tsconfigs.
 *
 * See docs/MASTERY_REWORK.md for the full design.
 */
import type { FlashcardCategory, MarkType, ReviewMark, TypedMarkHistory } from './wire.js';

/**
 * Which mastery goals an account pursues. Recognition + Production are always goals
 * (mandatory); reading/writing are per-account opt-in (migration 101).
 */
export interface MasteryGoals {
  reading: boolean;
  writing: boolean;
}

/** The pbh height at which the bar is full and the card is Mastered. */
export const PBH_FULL = 8;

/**
 * pbh band boundaries. A card is Unfamiliar below `TARGET`, Target below
 * `COMFORTABLE`, Comfortable below `PBH_FULL`, else Mastered. These MUST match the
 * SQL `compute_utcm_category()` cut points (migration 101).
 */
export const PBH_BAND = {
  TARGET: 3,
  COMFORTABLE: 6,
  MASTERED: PBH_FULL,
} as const;

/**
 * Band boundaries as rendered benchmark lines on the cdp bar. Mastered's boundary is
 * the bar top, so it is not listed.
 */
export const PBH_THRESHOLDS: { label: FlashcardCategory; pbh: number }[] = [
  { label: 'Target', pbh: PBH_BAND.TARGET },
  { label: 'Comfortable', pbh: PBH_BAND.COMFORTABLE },
];

/**
 * The first term's cap. No single maxed track can reach Mastered alone: the max-track
 * contribution stops at 6, so the remaining 2 points must come from other goals.
 */
export const PBH_MAX_TERM_CAP = 6;

/**
 * positive(track): count of isCorrect marks among a type's (<=8) marks. Empty window
 * slots count as negative (they simply don't add).
 */
export function positiveCount(track: ReviewMark[] | undefined): number {
  if (!Array.isArray(track)) return 0;
  let n = 0;
  for (const m of track) if (m?.isCorrect) n++;
  return n;
}

/** Positive counts for ALL four types (regardless of goals) — used by the stacked bar. */
export function positivesByType(history: TypedMarkHistory | undefined): Record<MarkType, number> {
  const h = history ?? {};
  return {
    recognition: positiveCount(h.recognition),
    production: positiveCount(h.production),
    reading: positiveCount(h.reading),
    writing: positiveCount(h.writing),
  };
}

/** The set of goal types for the given account flags (order irrelevant). */
export function goalTypes(goals: MasteryGoals): MarkType[] {
  const types: MarkType[] = ['recognition', 'production'];
  if (goals.reading) types.push('reading');
  if (goals.writing) types.push('writing');
  return types;
}

/**
 * Progress-bar height. Blends the goal tracks:
 *   pbh = min(6, max positive among goals)
 *         + (sum of the remaining goals' positives) / ((goalCount - 1) * 3)
 * Range 0 → ~8.67. The first term is capped at 6 so no single maxed track can reach
 * Mastered alone.
 */
export function progressBarHeight(
  history: TypedMarkHistory | undefined,
  goals: MasteryGoals
): number {
  const h = history ?? {};
  const positives = goalTypes(goals).map((t) => positiveCount(h[t]));
  const goalCount = positives.length; // 2..4
  const maxVal = Math.max(...positives);
  const sumVal = positives.reduce((a, b) => a + b, 0);
  const firstTerm = Math.min(PBH_MAX_TERM_CAP, maxVal);
  // Remaining = all goals but a single instance of the max.
  const secondTerm = goalCount > 1 ? (sumVal - maxVal) / ((goalCount - 1) * 3) : 0;
  return firstTerm + secondTerm;
}

/** Band a pbh value into a utcm category. */
export function categoryForPbh(pbh: number): FlashcardCategory {
  if (pbh < PBH_BAND.TARGET) return 'Unfamiliar';
  if (pbh < PBH_BAND.COMFORTABLE) return 'Target';
  if (pbh < PBH_BAND.MASTERED) return 'Comfortable';
  return 'Mastered';
}

/** Full utcm compute from a card's typed history + the account's goals. */
export function computeUtcm(
  history: TypedMarkHistory | undefined,
  goals: MasteryGoals
): FlashcardCategory {
  return categoryForPbh(progressBarHeight(history, goals));
}

/**
 * utcm band for ONE mark type, from that track's raw 0..8 positive count.
 *
 * TS mirror of the SQL compute_type_category() (migration 128). Deliberately reuses
 * categoryForPbh: the per-type bands are the SAME cut points as the pbh bands, just
 * applied to a single track's count rather than the goal-blended height — so a maxed
 * track (8/8) is Mastered FOR THAT TYPE while the card may sit anywhere overall. Used
 * by game pool selection (which exercises exactly one track) and to pick that pool's
 * cooldown window.
 *
 * See docs/MASTERY_REWORK.md § "Games select by their own mark type".
 */
export function computeTypeCategory(
  history: TypedMarkHistory | undefined,
  type: MarkType
): FlashcardCategory {
  return categoryForPbh(positiveCount((history ?? {})[type]));
}

// ─────────────────────────────────────────────────────────────────────────────
// cdp stacked progress bar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One stacked-bar segment: a mark type, its positive count, and the fraction of the
 * total positives it represents (composition is over ALL types, not just goals).
 */
export interface MasteryBarSegment {
  type: MarkType;
  positive: number;
  /** Fraction of the total positive marks across all types (0..1); 0 when nothing yet. */
  fraction: number;
}

/**
 * The cdp stacked-bar model: overall height fraction (pbh / PBH_FULL, clamped to 1)
 * plus per-type composition segments.
 */
export interface MasteryBar {
  pbh: number;
  /** 0..1 fill of the track (pbh capped at PBH_FULL). */
  heightFraction: number;
  category: FlashcardCategory;
  segments: MasteryBarSegment[];
}

/** Mark types in stacked-bar paint order. Local copy of MARK_TYPES — see rule 1 above. */
const BAR_TYPE_ORDER: readonly MarkType[] = [
  'recognition',
  'production',
  'reading',
  'writing',
] as const;

export function masteryBar(
  history: TypedMarkHistory | undefined,
  goals: MasteryGoals
): MasteryBar {
  const pbh = progressBarHeight(history, goals);
  const positives = positivesByType(history);
  const totalPositive = BAR_TYPE_ORDER.reduce((sum, t) => sum + positives[t], 0);
  const segments: MasteryBarSegment[] = BAR_TYPE_ORDER.map((type) => ({
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

// ─────────────────────────────────────────────────────────────────────────────
// Mark-history maintenance (server-side writers)
// ─────────────────────────────────────────────────────────────────────────────

/** How many most-recent marks each type retains. Mirrors MARK_WINDOW_SIZE in wire.ts. */
const WINDOW = 8;

/**
 * Append a mark to one type's stream, keeping only the most recent 8 (MARK_WINDOW_SIZE).
 * Returns a NEW TypedMarkHistory (does not mutate the input).
 */
export function appendTypedMark(
  history: TypedMarkHistory | undefined,
  type: MarkType,
  mark: ReviewMark
): TypedMarkHistory {
  const next: TypedMarkHistory = { ...(history ?? {}) };
  const track = Array.isArray(next[type]) ? next[type]!.slice() : [];
  track.push(mark);
  next[type] = track.slice(-WINDOW);
  return next;
}

/**
 * A perfect all-tracks-maxed history — used to seed an "already learned" card so it
 * resolves to Mastered under ANY goal configuration (all four tracks at 8/8).
 */
export function perfectTypedMarkHistory(timestamp: string): TypedMarkHistory {
  const h: TypedMarkHistory = {};
  for (const t of BAR_TYPE_ORDER) {
    h[t] = Array.from({ length: WINDOW }, () => ({ timestamp, isCorrect: true }));
  }
  return h;
}

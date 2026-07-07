// Mastery compute — the pbh (progress-bar-height) formula and utcm banding.
//
// This is the TypeScript mirror of the SQL functions mastery_positive_count() and
// compute_utcm_category() (migration 101). Keep the three in sync; the client has
// its own copy at src/utils/masteryCompute.ts for the cdp progress bar.
//
// See docs/MASTERY_REWORK.md for the full design.
import { FlashcardCategory, MarkType, ReviewMark, TypedMarkHistory, MARK_TYPES, MARK_WINDOW_SIZE } from '../types/index.js';

// Which mastery goals an account pursues. Recognition + Production are always
// goals (mandatory); reading/writing are per-account opt-in.
export interface MasteryGoals {
  reading: boolean;
  writing: boolean;
}

// positive(track): count of isCorrect marks among the (<=8) marks of one type.
// Empty window slots count as negative (they simply don't add).
export function positiveCount(track: ReviewMark[] | undefined): number {
  if (!Array.isArray(track)) return 0;
  let n = 0;
  for (const m of track) if (m?.isCorrect) n++;
  return n;
}

// The set of goal types for the given account flags (order irrelevant).
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
 * Range 0 → ~8.67. The first term is capped at 6 so no single maxed track can
 * reach Mastered alone.
 */
export function progressBarHeight(history: TypedMarkHistory | undefined, goals: MasteryGoals): number {
  const h = history ?? {};
  const positives = goalTypes(goals).map((t) => positiveCount(h[t]));
  const goalCount = positives.length; // 2..4
  const maxVal = Math.max(...positives);
  const sumVal = positives.reduce((a, b) => a + b, 0);
  const firstTerm = Math.min(6, maxVal);
  // Remaining = all goals but a single instance of the max.
  const secondTerm = goalCount > 1 ? (sumVal - maxVal) / ((goalCount - 1) * 3) : 0;
  return firstTerm + secondTerm;
}

// Band pbh into a utcm category.
export function categoryForPbh(pbh: number): FlashcardCategory {
  if (pbh < 3) return FlashcardCategory.UNFAMILIAR;
  if (pbh < 6) return FlashcardCategory.TARGET;
  if (pbh < 8) return FlashcardCategory.COMFORTABLE;
  return FlashcardCategory.MASTERED;
}

// Full utcm compute from a card's typed history + the account's goals.
export function computeUtcm(history: TypedMarkHistory | undefined, goals: MasteryGoals): FlashcardCategory {
  return categoryForPbh(progressBarHeight(history, goals));
}

/**
 * Append a mark to one type's stream, keeping only the most recent
 * MARK_WINDOW_SIZE (8). Returns a NEW TypedMarkHistory (does not mutate input).
 */
export function appendTypedMark(
  history: TypedMarkHistory | undefined,
  type: MarkType,
  mark: ReviewMark
): TypedMarkHistory {
  const next: TypedMarkHistory = { ...(history ?? {}) };
  const track = Array.isArray(next[type]) ? next[type]!.slice() : [];
  track.push(mark);
  next[type] = track.slice(-MARK_WINDOW_SIZE);
  return next;
}

// A perfect all-tracks-maxed history — used to seed an "already learned" card so
// it resolves to Mastered under ANY goal configuration (all four tracks at 8/8).
export function perfectTypedMarkHistory(timestamp: string): TypedMarkHistory {
  const full: ReviewMark[] = Array.from({ length: MARK_WINDOW_SIZE }, () => ({ timestamp, isCorrect: true }));
  const h: TypedMarkHistory = {};
  for (const t of MARK_TYPES) h[t] = full.map((m) => ({ ...m }));
  return h;
}

/**
 * mastery.ts — THE pbh (progress-bar-height) formula, the three bars, and utcm banding.
 *
 * This used to exist four times: `src/utils/masteryCompute.ts`,
 * `server/utils/masteryCompute.ts`, the SQL `compute_utcm_category()` (migration
 * 101) and `compute_type_category()` (migration 128). The two TypeScript copies now
 * both re-export this file; two SQL functions remain because the selection queries
 * band cards in-query — `compute_core_category()` (migration 143, which superseded
 * `compute_utcm_category()`; migration 147 drops the dead original) and
 * `compute_type_category()` — but they are no longer the definition. See the sync test in
 * `server/__tests__/mastery.test.ts`, which pins the cut points and the blend so a
 * future edit here fails loudly.
 *
 * Since migration 143 a card carries THREE independent bars (core / reading /
 * writing) rather than one goal-blended bar. Start at `activeBars` and `masteryBars`.
 *
 * Contract rules (same as wire.ts): no relative VALUE imports, no enums, no Node or
 * DOM globals. The one `import type ... from './wire.js'` below is erased at compile
 * time and resolves under both tsconfigs.
 *
 * See docs/MASTERY_REWORK.md for the full design.
 */
import type {
  FlashcardCategory,
  MarkType,
  MasteredAtByBar,
  MasteryBarId,
  ReviewMark,
  TypedMarkHistory,
} from './wire.js';

/**
 * Which mastery goals an account pursues (migration 101). Recognition + Production
 * are always pursued and have no flag.
 *
 * Since migration 143 these no longer re-weight anything — they decide which BARS a
 * card shows (`activeBars`). Reading/writing marks accrue either way; the goal is
 * what surfaces the bar, its collection, its sort options and its velocity.
 */
export interface MasteryGoals {
  reading: boolean;
  writing: boolean;
}

/** The pbh height at which the bar is full and the card is Mastered. */
export const PBH_FULL = 8;

/**
 * pbh band boundaries, shared by ALL THREE bars. A bar is Unfamiliar below `TARGET`,
 * Target below `COMFORTABLE`, Comfortable below `PBH_FULL`, else Mastered. These MUST
 * match the cut points in SQL `compute_core_category()` (migration 143) and
 * `compute_type_category()` (migration 128).
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
 * The CORE bar's first-term cap. No single maxed track can master a card alone: the
 * max-track contribution stops at 6, so the remaining 2 points must come from the
 * other core track (which needs 6+ of its own). Does not apply to the single-track
 * reading/writing bars, whose height IS one track.
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

// ─────────────────────────────────────────────────────────────────────────────
// The three bars (migration 143)
// ─────────────────────────────────────────────────────────────────────────────
//
// A card carries up to THREE independent mastery bars, so it can be mastered up to
// three times. Every bar is measured on the SAME 0..PBH_FULL pbh scale and banded by
// the SAME `categoryForPbh` cut points — only the way the height is derived differs:
//
//   core    = the two mandatory tracks blended (the old pbh formula with the goal
//             count pinned at 2, since reading/writing no longer join the blend).
//   reading = the reading track's raw positive count, which is already 0..8.
//   writing = likewise.
//
// The raw count landing on the same 0..8 scale is what lets one banding function and
// one set of benchmark lines serve all three bars.

/** Which mark types feed each bar. Every MarkType appears in exactly one bar. */
export const BAR_MARK_TYPES: Record<MasteryBarId, readonly MarkType[]> = {
  core: ['recognition', 'production'],
  reading: ['reading'],
  writing: ['writing'],
};

/**
 * The bar a mark lands in. Because the mapping is total and disjoint, a single mark
 * can only ever move ONE bar — which is why the mark handler computes a before/after
 * band for just this bar rather than all three.
 */
export function barForMarkType(type: MarkType): MasteryBarId {
  if (type === 'reading') return 'reading';
  if (type === 'writing') return 'writing';
  return 'core';
}

/**
 * The bars this account actually sees, in display order. Core is unconditional;
 * reading/writing appear only when their goal is on.
 *
 * This is the ONE gate for goal-conditional mastery UI — bars, the per-bar Mastered
 * collections, the per-bar sort options and the velocity sum all derive from it, so
 * they cannot disagree about which bars are live.
 */
export function activeBars(goals: MasteryGoals): MasteryBarId[] {
  const bars: MasteryBarId[] = ['core'];
  if (goals.reading) bars.push('reading');
  if (goals.writing) bars.push('writing');
  return bars;
}

/** Whether one bar is live for these goals. `core` is always true. */
export function isBarActive(bar: MasteryBarId, goals: MasteryGoals): boolean {
  return bar === 'core' || (bar === 'reading' ? goals.reading : goals.writing);
}

/**
 * The CORE bar's height — the original pbh blend over recognition + production:
 *   pbh = min(6, max(rec, pro)) + min(rec, pro) / 3
 * Range 0 → 8.67. The first term's cap is what stops a learner who only ever does
 * recognition from mastering a card: reaching PBH_FULL needs the weaker track at 6+.
 *
 * This is the migration-101 formula with goalCount fixed at 2 (the general
 * `(sum - max) / ((goalCount - 1) * 3)` collapses to `min / 3` for two tracks), which
 * is exactly what it evaluated to for an account with no reading/writing goal.
 */
export function coreProgressBarHeight(history: TypedMarkHistory | undefined): number {
  const h = history ?? {};
  const rec = positiveCount(h.recognition);
  const pro = positiveCount(h.production);
  return Math.min(PBH_MAX_TERM_CAP, Math.max(rec, pro)) + Math.min(rec, pro) / 3;
}

/**
 * Any bar's height on the shared 0..PBH_FULL scale. Single-track bars use their raw
 * positive count, so a reading bar is full at a perfect 8/8 window.
 */
export function barProgressBarHeight(
  history: TypedMarkHistory | undefined,
  bar: MasteryBarId
): number {
  if (bar === 'core') return coreProgressBarHeight(history);
  return positiveCount((history ?? {})[bar]);
}

/** Any bar's utcm band. */
export function barCategory(
  history: TypedMarkHistory | undefined,
  bar: MasteryBarId
): FlashcardCategory {
  return categoryForPbh(barProgressBarHeight(history, bar));
}

/** Band a pbh value into a utcm category. */
export function categoryForPbh(pbh: number): FlashcardCategory {
  if (pbh < PBH_BAND.TARGET) return 'Unfamiliar';
  if (pbh < PBH_BAND.COMFORTABLE) return 'Target';
  if (pbh < PBH_BAND.MASTERED) return 'Comfortable';
  return 'Mastered';
}

/**
 * The utcm bands in ascending order. Index = the band's rank, so a promotion's
 * size is `categoryRank(after) - categoryRank(before)`.
 *
 * Local copy of the band names rather than an import — contracts hold no relative
 * VALUE imports (see the header rules). Kept adjacent to categoryForPbh, which is
 * the only producer of these strings.
 */
export const CATEGORY_ORDER: readonly FlashcardCategory[] = [
  'Unfamiliar',
  'Target',
  'Comfortable',
  'Mastered',
] as const;

/** Rank of a utcm band (0..3). Unknown input ranks as 0 rather than throwing. */
export function categoryRank(category: FlashcardCategory | string | undefined): number {
  const i = CATEGORY_ORDER.indexOf(category as FlashcardCategory);
  return i < 0 ? 0 : i;
}

/**
 * How many bands a card climbed between two categories. Positive only: a demotion
 * (or no change) returns 0, because velocity measures upward movement only.
 *
 * A single mark CAN cross two bands — pbh is continuous, so one correct mark that
 * pushes the blend from 2.9 to 6.1 goes Unfamiliar → Comfortable. Velocity counts
 * that as 2. See docs/VELOCITY.md.
 */
export function bandsClimbed(
  before: FlashcardCategory | string | undefined,
  after: FlashcardCategory | string | undefined
): number {
  return Math.max(0, categoryRank(after) - categoryRank(before));
}

/**
 * A card's OVERALL utcm band — the core bar's.
 *
 * "Overall" is deliberately core-only since migration 143. Every whole-card question
 * in the app (deck counts, the Review gate, level estimation, the mini-card chip, the
 * community Learning feed) means "how well do you know this word", which is
 * recognition + production; reading and writing are separate skills with their own
 * bars and their own Mastered collections. Being goal-independent also means toggling
 * a goal no longer re-bands a single card.
 *
 * SQL mirror: compute_core_category() (migration 143).
 */
export function computeCoreCategory(history: TypedMarkHistory | undefined): FlashcardCategory {
  return barCategory(history, 'core');
}

/**
 * utcm band for ONE mark type, from that track's raw 0..8 positive count.
 *
 * TS mirror of the SQL compute_type_category() (migration 128). Deliberately reuses
 * categoryForPbh: the per-type bands are the SAME cut points as the pbh bands, just
 * applied to a single track's count rather than a blend — so a maxed track (8/8) is
 * Mastered FOR THAT TYPE while the card may sit anywhere overall. Used by game pool
 * selection (which exercises exactly one track) and to pick that pool's cooldown
 * window.
 *
 * Distinct from `barCategory` even though the two coincide for reading/writing: this
 * bands ONE TRACK (including recognition or production on their own, which no bar
 * does), while `barCategory('core')` bands the recognition+production blend. Games
 * ask the track question; everything card-level asks the bar question.
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
// Rendered bar model (cdp + mini cards)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One stacked-bar segment: a mark type, its positive count, and the fraction of the
 * BAR'S fill it occupies. Segments are the composition of one bar only, so a
 * single-track bar has exactly one segment at fraction 1.
 */
export interface MasteryBarSegment {
  type: MarkType;
  positive: number;
  /** Fraction of this bar's filled length (0..1); 0 when the bar is empty. */
  fraction: number;
}

/** One rendered bar: its height on the shared pbh scale, its band, its composition. */
export interface MasteryBar {
  id: MasteryBarId;
  pbh: number;
  /** 0..1 fill of the track (pbh capped at PBH_FULL). */
  heightFraction: number;
  category: FlashcardCategory;
  segments: MasteryBarSegment[];
}

/** Mark types in stacked paint order. Local copy of MARK_TYPES — see rule 1 above. */
const BAR_TYPE_ORDER: readonly MarkType[] = [
  'recognition',
  'production',
  'reading',
  'writing',
] as const;

/** Model for ONE bar, whether or not its goal is set. */
export function masteryBar(
  history: TypedMarkHistory | undefined,
  bar: MasteryBarId
): MasteryBar {
  const pbh = barProgressBarHeight(history, bar);
  const positives = positivesByType(history);
  // Composition is over this bar's OWN tracks: the core bar splits its fill between
  // recognition and production in the ratio of their positives, and a single-track
  // bar is one solid segment. (Before migration 143 one bar showed all four types,
  // which is precisely the conflation the three-bar split undoes.)
  const types = BAR_TYPE_ORDER.filter((t) => BAR_MARK_TYPES[bar].includes(t));
  const totalPositive = types.reduce((sum, t) => sum + positives[t], 0);
  const segments: MasteryBarSegment[] = types.map((type) => ({
    type,
    positive: positives[type],
    fraction: totalPositive > 0 ? positives[type] / totalPositive : 0,
  }));
  return {
    id: bar,
    pbh,
    heightFraction: Math.min(1, pbh / PBH_FULL),
    category: categoryForPbh(pbh),
    segments,
  };
}

/** Models for every bar this account sees, in display order (core first). */
export function masteryBars(
  history: TypedMarkHistory | undefined,
  goals: MasteryGoals
): MasteryBar[] {
  return activeBars(goals).map((bar) => masteryBar(history, bar));
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-bar mastery timestamps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When ONE bar of this card was last observed crossing into Mastered, as epoch ms;
 * **0 when that bar has no stamp** — never crossed, or crossed before migration 142
 * backfilled nothing.
 *
 * Per bar rather than "latest across the active bars": the three bars are three
 * separate achievements, so "what did I master most recently" is a different list for
 * each, and collapsing them to a max would let a reading crossing silently reorder a
 * list the learner is reading as their core progress. The sort menu offers one
 * ordering per active bar instead (`src/utils/vocabSort.ts`).
 *
 * 0 is "missing", not "the epoch" — every caller must sink it to the bottom of the
 * list in BOTH directions rather than letting it lead an ascending sort.
 */
export function masteredAtForBar(
  masteredAt: MasteredAtByBar | null | undefined,
  bar: MasteryBarId
): number {
  const raw = masteredAt?.[bar];
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
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
 * Seed history for a card the learner declares they ALREADY KNOW (the discover/sort
 * flows' "I know this" and the authored-pack mastered bucket).
 *
 * Fills the CORE bar's tracks 8/8 and leaves reading and writing at **zero**.
 *
 * Both halves are deliberate:
 *
 * - Core is filled on BOTH its tracks because the pbh formula caps its first term at
 *   6 — one maxed track alone reads Comfortable, so seeding recognition only would
 *   not produce the Mastered the learner asked for.
 * - Reading and writing are left empty because the claim being made is "I know this
 *   word", not "I can read and write it". Those are separate skills with their own
 *   bars now, and granting them would hand the learner a finished Reading bar for a
 *   character they have never once read — exactly the conflation the three-bar split
 *   (migration 143) exists to undo. If they turn on the reading goal later, the bar
 *   starts honestly at 0.
 *
 * Consequence worth knowing: this does NOT fill every bar. A learner with the writing
 * goal who sorts a card as known still sees an empty Write bar on it.
 */
export function coreMasteredTypedMarkHistory(timestamp: string): TypedMarkHistory {
  const h: TypedMarkHistory = {};
  for (const t of BAR_MARK_TYPES.core) {
    h[t] = Array.from({ length: WINDOW }, () => ({ timestamp, isCorrect: true }));
  }
  return h;
}

/**
 * writingLevels.ts — the eight Practice Writing levels, shared by server and client.
 *
 * One ordered table, easiest → hardest. `mode` is the stable identifier the client's
 * behaviour table (`src/components/handwriting/levelBehavior.ts`) keys on. `level` is
 * the number the learner sees ("Level 3") — and, since migration 172, what
 * `writing_practice_completions.level` stores (SMALLINT 1..8): a star belongs to a
 * level POSITION, so reshuffling which mode sits at a level never strands stars.
 *
 * 2026-10-04: `watch` (old Level 2) was removed, Trace moved from 1 to 2, and the new
 * Level 1 `snap` (each stroke that matches the next expected stroke snaps into the
 * printed stroke shape — docs/PRACTICE_WRITING.md § "Snap") took its place.
 *
 * Also owns the two numeric rules every writing surface shares:
 *   - `writingLevelForMastery` — the level a card is practised at in the writing flp,
 *     from its (possibly fractional, averaged) writing mastery;
 *   - `writingMarkCounts` — the anti-farming gate: a writing mark only counts when the
 *     level is above the character's mastery.
 *
 * Pure data — no value imports — so the Node build and the client bundle both load it.
 *
 * Docs: docs/WRITING_PRACTICE_REWORK.md § 1, § 3; docs/PRACTICE_WRITING.md.
 * Referenced by: server/utils/writingPracticeStore.ts (allow-list),
 *   server/services/FlashcardMarkService.ts (farming gate),
 *   server/routes/handwritingRoutes.ts (completion level validation),
 *   src/components/handwriting/levelBehavior.ts, LevelStepper.tsx, the Writing Grid game,
 *   the writing flp face.
 */

export const WRITING_LEVELS = [
  { level: 1, mode: 'snap', name: 'Walk-through' }, // renamed from "Snap" 2026-10-04 (display only)
  { level: 2, mode: 'trace', name: 'Trace' },
  { level: 3, mode: 'walkthrough', name: 'Step-through' }, // was "Step Through" (display only)
  { level: 4, mode: 'quarters', name: 'Quarters' },
  { level: 5, mode: 'memorize', name: 'Memorize' },
  { level: 6, mode: 'sixths', name: 'Sixths' }, // was 'eighths' (8 米 triangles) until 2026-10-06
  { level: 7, mode: 'test', name: 'Blank' }, // renamed from "Test" 2026-10-04 (display only)
  { level: 8, mode: 'timed', name: 'Timed' },
] as const;

export type WritingMode = (typeof WRITING_LEVELS)[number]['mode'];

/** Number of levels (the top level, and the writing track's max positive count). */
export const WRITING_LEVEL_COUNT = WRITING_LEVELS.length;

/** Every mode, in level order. */
export const WRITING_PRACTICE_LEVELS: readonly WritingMode[] = WRITING_LEVELS.map((l) => l.mode);

export function isWritingMode(value: unknown): value is WritingMode {
  return typeof value === 'string' && (WRITING_PRACTICE_LEVELS as readonly string[]).includes(value);
}

/** True for an integer level number 1..WRITING_LEVEL_COUNT — the stored-completion allow-list. */
export function isWritingLevelNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= WRITING_LEVEL_COUNT;
}

/** 1-based level number for a mode. */
export function levelOfMode(mode: WritingMode): number {
  return WRITING_PRACTICE_LEVELS.indexOf(mode) + 1;
}

/** Mode for a 1-based level number (clamped into 1..8). */
export function modeOfLevel(level: number): WritingMode {
  const i = Math.min(Math.max(Math.floor(level), 1), WRITING_LEVEL_COUNT) - 1;
  return WRITING_PRACTICE_LEVELS[i];
}

/**
 * The longest word any writing surface accepts: the practice popup's 2×2 grid and the
 * writing flp card both hold four characters. Enforced on every path — the popup's
 * eligibility (`usePracticeWriting`), the Writing Center word grid's pool
 * (`WritingPracticeGrid`), the writing flp's deal SQL (`WRITING_FLP_WORD_CLAUSE`) and the
 * mark endpoint (`FlashcardMarkService.applyWritingResult`).
 * Referenced by docs/WRITING_PRACTICE_REWORK.md § 3 and docs/PRACTICE_WRITING.md.
 */
export const WRITING_MAX_CHARS = 4;

/** Level 8's time budget: this many ms per stroke of the character. Tune from play data. */
export const TIMED_MS_PER_STROKE = 500;

/**
 * The level a card is practised at, from its writing mastery `m` (0–8; fractional for
 * a multi-character word, whose mastery is the average of its characters').
 * 0 → 1, 1 → 2, … 6 → 7, ≥ 7 → 8. Floor, so a word only steps up a level once its
 * average actually crosses the next whole number.
 */
export function writingLevelForMastery(m: number): number {
  const safe = Number.isFinite(m) ? Math.max(0, m) : 0;
  return Math.min(Math.floor(safe) + 1, WRITING_LEVEL_COUNT);
}

/**
 * Anti-farming gate: a writing mark against a character counts only when the level
 * it was written at is ABOVE that character's writing mastery (its 0–8 positive
 * count). Writing a well-known character at a heavily assisted level earns nothing.
 * Note `writingLevelForMastery(m) > m` always holds, so the flp's own level passes.
 */
export function writingMarkCounts(level: number, characterMastery: number): boolean {
  return level > characterMastery;
}

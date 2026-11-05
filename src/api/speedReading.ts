/**
 * speedReading.ts — the client's calls against /api/games/speedReading/*.
 *
 * Server: `SpeedReadingController.getDistractors` → `SpeedReadingService.getDistractors`.
 *
 * Read by: `useSpeedReadingQueue` (a run's opening load) and the flp break adapter
 * (`src/games/flpBreak/speedReadingBreak.ts`), which prefetches the same pair while the
 * card before the break is on screen. Docs: docs/SPEED_READING_GAME.md § Card selection.
 */
import { apiGet } from './http';
import type { DistractorChar } from '../types';

/**
 * The distractor pool: real characters from the caller's own library, each wrong option's
 * swapped character is drawn from it. Fetched once per run; it never shrinks, so there is
 * no top-up.
 */
export async function fetchSpeedReadingDistractors(): Promise<DistractorChar[]> {
    const res = await apiGet<{ chars: DistractorChar[] }>('/api/games/speedReading/distractors');
    return res.chars;
}

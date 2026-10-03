/**
 * studyMix.ts — the Study Mix band distribution, shared by server and client.
 *
 * The historical 1-2-2-5 shape: out of every ten cards a Study Mix deals, one is
 * Mastered, two Comfortable, two Unfamiliar and five Target. It is the app's default
 * answer to "which bands should a mixed drill draw from, in what proportion".
 *
 * Two readers, so the proportions cannot drift:
 *   - `server/services/OnDeckVocabService.ts` → `DEFAULT_LOOP_CONFIG` — the flp's
 *     Study Mix working loop (as quotas per 10-card loop);
 *   - `src/features/flashcards/centers/wordGridModel.ts` — both Centers' 6×6 word
 *     grids, which sample the learner's cards by the READING / WRITING bar's bands in
 *     the same proportion (as weights; docs/READING_WRITING_CENTERS.md § Phases 2, 5).
 *
 * Pure data — no imports beyond types — so the Node build and the client bundle can
 * both load it.
 */
import type { FlashcardCategory } from './wire.js';

export interface BandQuota {
  category: FlashcardCategory;
  count: number;
}

/** Study Mix: cards per 10-card loop, by utcm band. */
export const STUDY_MIX_QUOTAS: readonly BandQuota[] = [
  { category: 'Mastered', count: 1 },
  { category: 'Comfortable', count: 2 },
  { category: 'Unfamiliar', count: 2 },
  { category: 'Target', count: 5 },
];

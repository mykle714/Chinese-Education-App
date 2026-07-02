/**
 * Sort-pack types.
 * Shared shapes used by the sort_packs DAL, the StarterPacksService supply logic,
 * and the discover/sort-cards controller.
 *
 * A "sort pack" is the on-deck unit of the discover sort flow: up to 3 cards to sort
 * (see docs/SORT_PACKS_IMPLEMENTATION.md, docs/SORT_CARDS_REQUIREMENTS.md §4.5).
 * Authored packs are stored in `sort_packs`; system fallback packs-of-1 are built on
 * the fly by the service and never persisted, so they have no row here.
 */

/** A raw row from the `sort_packs` table: one authored pack. */
export interface SortPackRow {
  id: number;
  /** 'zh' | 'es'. */
  language: string;
  /** 1..6 difficulty band (matches det.difficulty). */
  level: number;
  /** Curation sort key within (language, level); sparse (10, 20, 30…). */
  packOrder: number;
  /** Up to 3 det surrogate ids — the draggable cards, in display order. */
  entryIds: number[];
  /** Denormalized word1 values for entryIds (migration 96), for readability only — not a join key. */
  entryWords: string[];
}

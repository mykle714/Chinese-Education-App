import type { TypedMarkHistory } from '../../types/index.js';

/** A character found in the learner's vet words, with its own single-char row (if any). */
export interface WritingGridCharacterRow {
  char: string;
  /** Tone-marked pinyin (det `pronunciation`). */
  pinyin: string | null;
  /** det `definitions[0]` — the legacy dd fallback (server/utils/definitions.ts → resolveDisplayDefinition). */
  definition: string | null;
  /** det `definitionClusters` (sense clusters; null when unclustered). */
  definitionClusters: unknown[] | null;
  /** The character vet row's sense pick (by cluster label); null when none / no row. */
  selectedSense: string | null;
  /** The character's single-character vet row; null when the learner has none yet. */
  cardId: number | null;
  typedMarkHistory: TypedMarkHistory | null;
}

/**
 * Data access for the Writing Grid game (docs/WRITING_PRACTICE_REWORK.md § 2). zh only.
 */
export interface IWritingGridDAL {
  /**
   * Every distinct Han character in the learner's SORTED vet words (plus the rows in
   * `extraIds` — cards just lent to this board), that has a det row, joined to the
   * character's own single-character vet row when one exists.
   */
  findCandidateCharacters(userId: string, extraIds: number[]): Promise<WritingGridCharacterRow[]>;

  /**
   * Ensure each character has a single-character vet row, creating a hidden
   * 'provisional' row where missing (the lent-card path). Returns char → row id.
   */
  ensureCharacterRows(userId: string, chars: string[]): Promise<Map<string, number>>;
}

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
  /** That row is one of the learner's sorted cards (false: hidden provisional, or no row). */
  ownCard: boolean;
  typedMarkHistory: TypedMarkHistory | null;
}

/** A candidate word for a Superposition board (docs/SUPERPOSITION_GAME.md). */
export interface WritingCandidateWordRow {
  /** The word's vet row. */
  id: number;
  entryKey: string;
  pinyin: string | null;
  definition: string | null;
  definitionClusters: unknown[] | null;
  selectedSense: string | null;
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
   * The learner's SORTED vet words of 1–4 characters, all of them Han, that have a det row
   * (plus the rows in `extraIds`). Superposition's deal keeps words whole, for its hint rows.
   */
  findCandidateWords(userId: string, extraIds: number[]): Promise<WritingCandidateWordRow[]>;

  /** The `entryKey` of each of the learner's vet rows in `ids` (an flp break's seed words). */
  findEntryKeys(userId: string, ids: number[]): Promise<string[]>;

  /**
   * Ensure each character has a single-character vet row, creating a hidden
   * 'provisional' row where missing (the lent-card path). Returns char → row id.
   */
  ensureCharacterRows(userId: string, chars: string[]): Promise<Map<string, number>>;
}

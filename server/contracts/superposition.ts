/**
 * superposition.ts — the Superposition game's shared rules (docs/SUPERPOSITION_GAME.md).
 *
 * A board is exactly SUPERPOSITION_CHAR_COUNT distinct characters, built from any mix of
 * the learner's words of 1–4 characters (one 4-character word, two 2-character words,
 * 2 + 1 + 1, …). Every stroke of every character becomes a tile; the learner stacks them
 * back into their characters.
 *
 * Pure — no value imports — so the server (SuperpositionService) and the client load one
 * definition.
 */

/** Characters on a board, whatever words supply them. */
export const SUPERPOSITION_CHAR_COUNT = 4;

/** One character to build. */
export interface SuperpositionCharacter {
  char: string;
  /** Its single-character vet row (created hidden/provisional when missing) — the row a finished stack marks. */
  cardId: number;
  /** That row is a card the learner holds, not a hidden provisional one. See `WritingGridCharacter.ownCard`. */
  ownCard: boolean;
  /** A focused break's character from outside today's set: it was never on the tower. */
  outsideFocus?: boolean;
  /**
   * Its tile groups (stroke indices per tile), read from its single-character det row
   * (`dictionaryentries_zh."superpositionGroups"`). Sent only while
   * `FEATURE_FLAGS.superpositionStoredGroups` is on and the row has them; absent, the client
   * computes them (server/contracts/superpositionGroups.ts → groupStrokes).
   */
  strokeGroups?: number[][];
}

/** One word of the board — one hint row: its pinyin, dd and audio. */
export interface SuperpositionWord {
  entryKey: string;
  pinyin: string | null;
  definition: string | null;
  characters: SuperpositionCharacter[];
}

/** A candidate word before picking. */
export interface SuperpositionCandidate {
  entryKey: string;
  pinyin: string | null;
  definition: string | null;
  /** Any of its characters is resting on the writing clock, so that mark would be dropped. */
  cooled: boolean;
  /** Draw ahead of the rest: on an flp break, a working-loop word (see `pickSuperpositionWords`). */
  preferred: boolean;
}

/**
 * Every one-stroke character in the stroke corpus. A lone tile IS a finished stack, so one
 * of these would stand green, and earn its mark, before the learner had moved anything.
 */
const SINGLE_STROKE_CHARS = new Set(Array.from('一丨丶丿乙乚乛亅'));

const distinctChars = (word: string): string[] => [...new Set(Array.from(word))];

/** How many shuffles to try for an exact fit before keeping the fullest board seen. */
const PICK_ATTEMPTS = 24;

/**
 * Pick words that together hold exactly `charCount` distinct characters, no character
 * shared between two words: a repeated character would make two identical stacks, and
 * its tiles interchangeable across them.
 *
 * Each attempt walks a shuffled ladder — fresh preferred, fresh, cooled preferred, cooled
 * — taking every word that still fits. A short word can strand the walk (three characters
 * taken, only 2-character words left), which is why it reshuffles; the first exact board
 * wins, else the fullest. `random` is injectable for tests.
 */
export function pickSuperpositionWords(
  candidates: readonly SuperpositionCandidate[],
  charCount: number = SUPERPOSITION_CHAR_COUNT,
  random: () => number = Math.random
): SuperpositionCandidate[] {
  const usable = candidates.filter((c) => {
    const chars = Array.from(c.entryKey);
    // Repeats inside a word (谢谢) are out too: the same two-identical-stacks problem.
    return (
      chars.length >= 1 &&
      chars.length <= charCount &&
      distinctChars(c.entryKey).length === chars.length &&
      !chars.some((char) => SINGLE_STROKE_CHARS.has(char))
    );
  });
  const rung = (c: SuperpositionCandidate) => (c.cooled ? 2 : 0) + (c.preferred ? 0 : 1);

  let best: SuperpositionCandidate[] = [];
  let bestCount = 0;
  for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
    const shuffled = usable
      .map((word) => ({ word, key: rung(word) + random() }))
      .sort((a, b) => a.key - b.key)
      .map(({ word }) => word);
    const used = new Set<string>();
    const picked: SuperpositionCandidate[] = [];
    for (const word of shuffled) {
      const chars = distinctChars(word.entryKey);
      if (used.size + chars.length > charCount || chars.some((c) => used.has(c))) continue;
      picked.push(word);
      chars.forEach((c) => used.add(c));
      if (used.size === charCount) return picked;
    }
    if (used.size > bestCount) {
      best = picked;
      bestCount = used.size;
    }
  }
  return best;
}

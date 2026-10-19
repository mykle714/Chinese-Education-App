import type { Language } from "../../types";

// The generalized 1..6 difficulty scale shared by every language (the server's
// StarterPacksService._levelConfig, migration 79). Used by Sort Cards' level dropdown
// (which adds an "Auto" entry on top) and its expanded Quick Mark panel (concrete
// levels only). One copy, so the two pickers can never offer different ranges.
//
// Referenced by docs/SORT_CARDS_REQUIREMENTS.md § 6 and docs/QUICK_MARK.md.
export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6];
export const MIN_DIFFICULTY_LEVEL = DIFFICULTY_LEVELS[0];
export const MAX_DIFFICULTY_LEVEL = DIFFICULTY_LEVELS[DIFFICULTY_LEVELS.length - 1];

/** A bare level's label: "HSK 3" for zh, "Level 3" otherwise. */
export const difficultyLabel = (language: Language | undefined, level: number): string =>
    language === "zh" ? `HSK ${level}` : `Level ${level}`;

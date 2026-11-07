// The generalized 1..6 difficulty scale shared by every language (the server's
// StarterPacksService._levelConfig, migration 79). Used by Add Cards' level dropdown
// (which adds an "Auto" entry on top) and its expanded Quick Mark panel (concrete
// levels only). One copy, so the two pickers can never offer different ranges.
//
// Both pickers render a level as the six-triangle `DifficultyMeter`
// (src/components/ScoreMeters.tsx), never as text — the "HSK 3" / "Level 3" label
// (`difficultyLabel`) was removed 2026-11-07, because the values are an AI estimate
// and not an HSK-list lookup. `MAX_DIFFICULTY_LEVEL` must equal src/components/scoreMeterScale.ts'
// `DIFFICULTY_UNIT_COUNT`.
//
// Referenced by docs/SORT_CARDS_REQUIREMENTS.md § 6 and docs/QUICK_MARK.md.
export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6];
export const MIN_DIFFICULTY_LEVEL = DIFFICULTY_LEVELS[0];
export const MAX_DIFFICULTY_LEVEL = DIFFICULTY_LEVELS[DIFFICULTY_LEVELS.length - 1];

// The generalized 1..6 difficulty scale shared by every language (the server's
// StarterPacksService.MAX_LEVEL, migration 79). Bounds Add Cards' adaptive level
// (AddCardsPage → `applyPackSignal`). Not shown to the learner: the manual level pill
// that drew it as a six-triangle meter was removed 2026-11-21, along with the meter.
//
// Referenced by docs/SORT_CARDS_REQUIREMENTS.md § 6.
export const MIN_DIFFICULTY_LEVEL = 1;
export const MAX_DIFFICULTY_LEVEL = 6;

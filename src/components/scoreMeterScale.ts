// Scale constants for the unit meters in ./ScoreMeters.tsx. Kept in a separate
// non-component module so ScoreMeters.tsx exports only components (React fast refresh).
// Referenced by: ScoreMeters.tsx, AddCardsPage + QuickMarkPanel (menu-item aria labels).

/** Units in the commonality meter — the 1–5 `frequencyScore` scale. */
export const COMMONALITY_UNIT_COUNT = 5;
/**
 * Units in the difficulty meter — the 1–6 `difficulty` scale. Mirrors
 * `MAX_DIFFICULTY_LEVEL` in src/features/discover/difficultyLevels.ts (a shared
 * component may not import from features/, docs/FRONTEND_LAYERING.md).
 */
export const DIFFICULTY_UNIT_COUNT = 6;

/** Spoken name of a difficulty level — the meter's aria-label, also used on menu items. */
export const difficultyAriaLabel = (level: number): string =>
    `difficulty ${level} of ${DIFFICULTY_UNIT_COUNT}`;

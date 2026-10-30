/**
 * The soft-introduction (si) registry — every si in the app, and when each one graduates.
 * docs/SOFT_INTRODUCTION.md § 2.
 *
 * A soft introduction is a feature styled one way (the INTRO style — usually more
 * explicit: a label, a hint) for a learner's first handful of encounters, and another
 * way (the GRADUATED style — usually quieter) once we believe they understand it. It is
 * for things too minor to put through the tutorial.
 *
 * Graduation needs BOTH thresholds: `minVisits` encounters AND `minDays` since the first
 * one. Either alone is too easy to hit by accident — five visits in one sitting, or one
 * visit and a week away, are not "the learner gets it".
 *
 * Add an entry here to create a new si; consume it with `useSoftIntro(id)`. Keep ids
 * stable: they are the localStorage keys a learner's progress is stored under, so
 * renaming one silently restarts that si for everyone.
 */

export interface SoftIntroSpec {
    /** Encounters (deduped — see `VISIT_DEDUPE_MS`) before the si can graduate. */
    minVisits: number;
    /** Days since the FIRST encounter before the si can graduate. */
    minDays: number;
    /** What is being introduced and how its two styles differ — shown nowhere; for readers. */
    description: string;
}

export const SOFT_INTROS = {
    /**
     * The fdp hand's big numeral (StudyHand, full variant). Intro: a small "cards" under
     * it, so the learner learns the number is a card count. Graduated: the design's ink
     * hairline instead (`.bignum:after`), no word.
     */
    handCardCount: {
        minVisits: 15,
        minDays: 7,
        description: 'fdp hand numeral: "cards" label (intro) → ink hairline (graduated)',
    },
    /**
     * scp's level pill ("Auto" / "HSK 3", SortCardsPage toolbar). Intro: a small
     * "Difficulty" caption under it, so the learner learns what the pill picks. Graduated:
     * the pill alone, as the Tower Tier 2 design draws it.
     */
    sortDifficultyCaption: {
        minVisits: 7,
        minDays: 7,
        description: 'scp level pill: "Difficulty" caption under it (intro) → pill alone (graduated)',
    },
} as const satisfies Record<string, SoftIntroSpec>;

export type SoftIntroId = keyof typeof SOFT_INTROS;

/** Which of its two styles an si is showing. */
export type SoftIntroState = "intro" | "graduated";

/**
 * Two mounts closer together than this count as ONE visit, so hopping between footer
 * tabs (or React StrictMode's double effect run) does not run the count up.
 */
export const VISIT_DEDUPE_MS = 30 * 60 * 1000;

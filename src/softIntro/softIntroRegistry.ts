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
     * acp's level pill ("Auto" / the six-triangle difficulty meter, AddCardsPage toolbar). Intro: a small
     * "DIFFICULTY →" caption left of it, pointing at it, so the learner learns what the pill picks. Graduated:
     * the pill alone, as the Tower Tier 2 design draws it.
     */
    sortDifficultyCaption: {
        minVisits: 7,
        minDays: 7,
        description: 'acp level pill: "DIFFICULTY →" caption left of it (intro) → pill alone (graduated)',
    },
    /**
     * td main world's mini sort platform (DeckTowerPlatform `sortBin`). Intro: "ADD MORE /
     * CARDS →" printed into the floor under it, so the learner learns the white slab is the
     * Add Cards button. Graduated: the slab alone.
     */
    towerSortLabel: {
        minVisits: 70,
        minDays: 14,
        description: 'td sort platform: "Add more cards" floor print under it (intro) → slab alone (graduated)',
    },
    /**
     * td writing world's notebook paper stack (DeckTowerPlatform `notebook`). Intro:
     * "WRITING / NOTEBOOK →" printed into the floor under it. Graduated: the stack alone.
     */
    towerNotebookLabel: {
        minVisits: 70,
        minDays: 14,
        description: 'td notebook stack: "Writing notebook" floor print under it (intro) → stack alone (graduated)',
    },
    /**
     * td settled snow (docs/TOWER_SNOW.md § "Covering text"). Intro: snow leaves every
     * piece of floor and card text readable — the floor plate stays bare, the floor prints and
     * the "0 cards" imprint are drawn over the floor snow, and the top card's snow lies only
     * on its rim. Graduated: snow covers them all. Counted on every td visit, snowy or not.
     */
    towerSnowCover: {
        minVisits: 4,
        minDays: 1,
        description: "td snow: text on the plate, floor prints and top card stays readable (intro) → snow covers it (graduated)",
    },
    /**
     * The hint pawn's "Tap / to / dismiss" cue (PawnHintBody `DismissCue`, flp hint bubble).
     * Intro: the three-line cue in the bubble's bottom-right corner. Graduated: no cue, and it
     * takes no space — the line (text variant) or the cpcd words (cpcd variant) get its
     * width. The bubble stays tappable either way. A visit is one pawn ARRIVAL (one study
     * session — HintPawn `DismissCueSoftIntro`, keyed by `arrival.id`), not a bubble.
     */
    pawnDismissCue: {
        minVisits: 49,
        minDays: 14,
        description: 'flp hint-pawn bubble: "Tap / to / dismiss" cue in its corner (intro) → no cue, no space (graduated)',
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

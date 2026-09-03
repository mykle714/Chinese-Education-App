/**
 * The two stepped explainers on View Challenge (design F20/F21).
 *
 * Content lives here rather than in the component for the reason every other copy
 * module in this feature does: the component draws steps, it does not know what the
 * app's study surfaces are, and a copy change should not be a component change.
 *
 * ⚠️ THE IMAGE IS PART OF THE INSTRUCTION, not decoration. Both explainers teach
 * WHERE something is, and a sentence naming a surface the reader has never opened
 * teaches nothing. `shot` is the filename to drop into `src/assets/challengeHelp/`;
 * a slot with no file yet renders the labelled placeholder frame, which is a legible
 * intermediate state rather than a broken image.
 *
 * Depended on by: ChallengeHelpPopup.
 */

export interface ChallengeHelpStep {
    /** The line over the image — what this step is about. */
    heading: string;
    /** Filename in `src/assets/challengeHelp/`. */
    shot: string;
    /** What the shot should show, used as the placeholder caption until it exists. */
    shotDescription: string;
    /** The instruction under the image. */
    title: string;
    body: string;
}

/**
 * "How to study this deck" (F20).
 *
 * ⚠️ IT TEACHES A FILTER, NOT A FEATURE. The button that opens this does NOT launch
 * play — every surface named here already exists and the learner has used them; what
 * they do not know is how to point one at exactly these nine cards. That is why it is
 * a dismissable overlay rather than its own page, and why each step is a scoping
 * instruction rather than a description of the surface.
 *
 * `{deck}` is substituted with the generated deck's name ("vs Mei Lin").
 */
export const HOW_TO_STUDY_STEPS: readonly ChallengeHelpStep[] = [
    {
        heading: "Study on the shelf",
        shot: "study-shelf.png",
        shotDescription: "flashcards shelf, the challenge deck highlighted in the Challenges row",
        title: "Open the “{deck}” deck",
        body: "Accepting created a deck holding exactly these nine cards. Tap it, then Learn Now — the queue is only the nine, and nothing else can leak in.",
    },
    {
        heading: "Drill the whole set",
        shot: "study-learn.png",
        shotDescription: "the flashcards learn page mid-session, with the deck named in the header",
        title: "Learn Now runs the nine in order",
        body: "Every mark you make counts normally — minute points, streak and your own mastery all move. Studying the set is ordinary study; it is only the words that were chosen for you.",
    },
    {
        heading: "Play against them early",
        shot: "study-games.png",
        shotDescription: "a game's collection selector with the challenge deck picked as the source",
        title: "Point a game at the deck",
        body: "Any game that takes a collection will take this one. That is practice, not the test — the test's rounds are drawn on Friday and are the only ones that score.",
    },
];

/**
 * "How the test works" (F21) — three rules, one per step.
 *
 * These used to sit as fine print under the round list. They moved behind the card's
 * info button because they are read once and then never again, while the round list
 * is read every time; leaving them in place made the card's permanent state a
 * paragraph nobody was still reading.
 */
export const HOW_THE_TEST_WORKS_STEPS: readonly ChallengeHelpStep[] = [
    {
        heading: "Three rounds, fixed",
        shot: "test-sequence.png",
        shotDescription: "the test card with its three rounds, the first playable and the rest locked",
        title: "The same games, in the same order",
        body: "Both of you get an identical sequence at a fixed level and mode — a Bubble Match played on Chill against one played on Torture is not a comparison.",
    },
    {
        heading: "One attempt per round",
        shot: "test-submitted.png",
        shotDescription: "the round scoreboard, with the score banked in place of the Play button",
        title: "Submitting is final",
        body: "A round prints its score where its button was and can never be replayed. The next round stays locked until the one before it is in.",
    },
    {
        heading: "An ordinary board",
        shot: "test-board.png",
        shotDescription: "a game board mid-round, with nothing marking which words are contested",
        title: "Your nine are mixed in",
        body: "The board never marks which words are the challenge's — play the whole board. Only the nine are scored against your opponent; the rest is the game.",
    },
];

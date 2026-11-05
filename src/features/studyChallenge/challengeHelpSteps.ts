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
 * Depended on by: ChallengeDetailPage, which renders these through the shared
 * `SteppedHelpPopup` (src/components).
 */
import { makeShotResolver, type HelpStep } from "../../components/steppedHelp";

/**
 * The step shape is the shared component's. Re-exported under the old name so this
 * feature's own modules keep reading in its vocabulary.
 */
export type ChallengeHelpStep = HelpStep;

/**
 * Every screenshot in `src/assets/challengeHelp/`, resolved at build time.
 *
 * The glob lives HERE rather than in the popup because Vite needs a literal pattern
 * resolved relative to the file it is written in — a shared component cannot glob a
 * feature's assets. Adding a step is a data change in this file plus a dropped file.
 */
const SHOTS = import.meta.glob<{ default: string }>(
    "../../assets/challengeHelp/*.{png,jpg,jpeg,webp}",
    { eager: true }
);

export const resolveChallengeShot = makeShotResolver(SHOTS);

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

/**
 * The arena's three-step explainer (`Arena Flow - Shelf System.html` A16, A17).
 *
 * Content lives here rather than in the page for the same reason every other copy module
 * in the app does: the page draws states, it does not know how to explain a division, and
 * a copy change should not be a page change.
 *
 * ── THREE STEPS, ONE RULE EACH ───────────────────────────────────────────────────────
 * What a division is, what a minute is, and what Sunday does. The artboards draw steps 1
 * and 3; step 2 is written to the same pattern, because the flow's own caption states the
 * set ("what a division is, what a minute is, and what Sunday does") and drawing two of
 * three was an artboard economy rather than a design decision.
 *
 * ⚠️ THE IMAGE IS PART OF THE INSTRUCTION, not decoration. Each step teaches something
 * the learner is looking at, and a sentence naming a surface they have never opened
 * teaches nothing. `shot` is the filename to drop into `src/assets/arenaHelp/`; a slot
 * with no file yet renders the labelled placeholder frame, which is a legible
 * intermediate state rather than a broken image.
 *
 * ── WHEN IT IS SHOWN ────────────────────────────────────────────────────────────────
 * Once, automatically, the first time /arena is opened — over the live page, so the thing
 * being described is already on screen behind the scrim (A16) — and thereafter only from
 * the header's help button (A17). The "already seen" flag is `ArenaPage`'s, not this
 * module's. That auto-open is why the arena's explainer differs from Study Challenge's,
 * which deliberately has no memory at all: the arena's rules are not optional context,
 * they are how the page works.
 *
 * Depended on by: ArenaPage, through the shared `components/SteppedHelpPopup`.
 */
import { makeShotResolver, type HelpStep } from "../../components/steppedHelp";

/**
 * Every screenshot in `src/assets/arenaHelp/`, resolved at build time. The glob must be
 * written here, not in the shared popup — see `makeShotResolver`.
 */
const SHOTS = import.meta.glob<{ default: string }>(
    "../../assets/arenaHelp/*.{png,jpg,jpeg,webp}",
    { eager: true }
);

export const resolveArenaShot = makeShotResolver(SHOTS);

export const ARENA_HELP_STEPS: readonly HelpStep[] = [
    {
        heading: "Twenty-five, one division",
        shot: "arena-board.png",
        shotDescription: "the Steel board, promotion line cutting across the rows",
        title: "You race twenty-four others",
        body: "Everyone here sits in your division and started Tuesday at zero. The line across the board is promotion; the one below it is the drop.",
    },
    {
        heading: "Minutes are the score",
        shot: "arena-minutes.png",
        shotDescription: "the minute-points flame in a page header, ticking up during a study session",
        title: "Every minute you study counts",
        body: "Your score is the minute points you earn while the arena is live — the same ones the flame counts everywhere else. Nothing you studied before Tuesday carries over.",
    },
    {
        heading: "Sunday settles it",
        shot: "arena-results.png",
        shotDescription: "the results card, promoted to Platinum",
        title: "Top five up, bottom five down",
        body: "At 16:00 the board freezes and resolves in the arena's timezone. Nothing you study after that counts toward this week.",
    },
];

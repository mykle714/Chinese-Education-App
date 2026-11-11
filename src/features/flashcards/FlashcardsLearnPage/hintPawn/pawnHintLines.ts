/**
 * pawnHintLines — what the hint pawn says, per kind of hint (docs/HINT_PAWN.md § "The lines").
 *
 * Each kind has a collection of lines — the used-in kind's are phrasings of one idea, the
 * wrong-streak kind's are different tips — said in random order through a Deck Tower
 * visit (hintPawnVisit.ts → `takeHintLineIndex`) so a long session doesn't repeat one
 * sentence on every card. Keep every line short: the bubble shares the band below the
 * card with the pawn, and a cpcd-variant kind's lines must fit on one line
 * (`CPCD_LINE_MAX_CHARS`). A line that leads into content listed under it (the used-in words)
 * ends in a colon (owner, 2026-11-08).
 *
 * KEYWORD MARKUP: wrap a word that names a button in the app in braces — `{More Info}` —
 * and PawnHintBody draws it in `COLORS.keywordInk` (Red Salmon), braces dropped. Never put
 * quote marks round a button name; the colour is what sets it apart (owner, 2026-11-08).
 *
 * Depended on by: hintPawn/pawnHints.ts (both collections), src/__tests__/wrongStreakHint.test.ts.
 */

/**
 * The longest line a cpcd-variant hint may say (pawnHints.ts → `PAWN_BUBBLE_VARIANT`).
 * Its line must sit on ONE line, or the cpcd words under it are pushed off the bubble's
 * bottom (owner, 2026-11-08). The bubble is about 240px of text wide on a 360px phone
 * (the stage and gutters take the rest), and the 12px semibold caption runs about 7px a
 * character, so 33 characters fit with a little margin. PawnHintBody also forbids the wrap
 * and ellipsizes as a safety net; src/__tests__/wrongStreakHint.test.ts enforces this cap.
 */
export const CPCD_LINE_MAX_CHARS = 33;

/**
 * The writing world's used-in hint: the card's single character appears in the words
 * listed under the line. Each line says "character", never "word" (owner's call
 * 2026-11-08): a writing card with a used-in hint is always a single character.
 * A cpcd-variant kind: every line fits `CPCD_LINE_MAX_CHARS` (shortened 2026-11-08).
 */
export const USED_IN_LINES: readonly string[] = [
    "This character is in these words:",
    "This character appears in:",
    "This character shows up in:",
    "Words that use this character:",
    "Words built on this character:",
    "This character hides in:",
    "Words with this character:",
    "This character is part of:",
    "Words containing this character:",
    "Seen this character? It's in:",
];

/** Which card condition a wrong-streak hint needs (checked in pawnHints.ts → `wrongStreakHint`). */
export type WrongStreakCondition =
    /** A multi-character card with breakdown items to look at. */
    | "breakdown"
    /** A card with at least one example sentence. */
    | "examples";

export interface WrongStreakLine {
    /** Stable name, for tests and for talking about one hint. */
    id: "breakdown" | "examples" | "customize" | "compare" | "focus";
    line: string;
    /** Absent = the hint fits any card. */
    requires?: WrongStreakCondition;
}

/**
 * The wrong-streak hints (main + reading worlds): study tips for a card whose last 3 marks
 * in the world were all wrong. Unlike the used-in lines these are DIFFERENT tips rather
 * than phrasings of one idea, but they are picked the same way — one per card from the
 * kind's shuffle bag, skipping any whose `requires` the card fails. Keep at least one
 * unconditional line so every card has something to say.
 *
 * Customize and Compare are on the word-tools rail ABOVE the card in both worlds
 * (FlashcardsLearnPage → WordToolsRail), not in the eip. The breakdown and example hints
 * point into the eip but no longer tell the learner to dismiss the bubble to uncover the
 * More Info pill (suffix removed, owner 2026-11-10). Copy is provisional (owner, 2026-11-08:
 * "use this for now").
 */
export const WRONG_STREAK_LINES: readonly WrongStreakLine[] = [
    {
        id: "breakdown",
        line: `Try learning what each character means on its own. Visit the {Breakdown} tab in the {More Info} button behind this message.`,
        requires: "breakdown",
    },
    {
        id: "examples",
        line: `Why don't you check out some example sentences in the {More Info} button behind this message?`,
        requires: "examples",
    },
    {
        id: "customize",
        line: "Try customizing this card with the {Customize} button above it to build a stronger relationship with it.",
    },
    {
        id: "compare",
        line: "Are you confusing this card with another one? Tap {Compare} above the card to see their subtle differences.",
    },
    {
        id: "focus",
        line: "Try focusing on remembering just this one card. Hold onto the answer until the next time you see it.",
    },
];

/**
 * What the pawn says when it is tapped and doesn't jump (4 taps in 5 — HintPawn →
 * `PAWN_TAP_JUMP_SHARE`): a short "ouch" line in its own little bubble, up and to the right
 * of its head (PawnOuchBubble, docs/HINT_PAWN.md § "Tap reactions"). Not a hint: it says
 * nothing about the card, so it never touches the hint bubble. Said from its own shuffle
 * bag (`takeHintLineIndex(OUCH_LINE_BAG, …)`), so no line repeats back to back.
 * Copy is provisional (drafted 2026-11-08, owner approved drafting). Keep each one a few
 * words: the bubble sizes to its line on one line.
 */
export const OUCH_LINES: readonly string[] = [
    "Ouch!",
    "Hey!",
    "Rude.",
    "Watch it.",
    "Ow ow ow",
    "You're on thin ice.",
    "I'm watching you",
    "Chill.",
    "I hate you.",
    "We're enemies now",
    "Bro..."
];

/** The ouch lines' shuffle-bag key in the td visit store (hintPawnVisit.ts — one bag per key). */
export const OUCH_LINE_BAG = "ouch";

/** One run of a hint line: plain copy, or a button keyword (drawn in COLORS.keywordInk). */
export interface HintLineRun {
    text: string;
    keyword: boolean;
}

/**
 * Split a line's `{keyword}` markup into runs, braces dropped. A line without braces is one
 * plain run, so the used-in lines pass through unchanged. An unclosed `{` is kept as plain
 * text rather than swallowing the rest of the line.
 */
export function splitHintKeywords(line: string): HintLineRun[] {
    const runs: HintLineRun[] = [];
    const pattern = /\{([^{}]+)\}/g;
    let last = 0;
    for (const match of line.matchAll(pattern)) {
        const start = match.index ?? 0;
        if (start > last) runs.push({ text: line.slice(last, start), keyword: false });
        runs.push({ text: match[1], keyword: true });
        last = start + match[0].length;
    }
    if (last < line.length) runs.push({ text: line.slice(last), keyword: false });
    return runs;
}

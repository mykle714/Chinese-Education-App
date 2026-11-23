/**
 * pawnHintLines — what the hint pawn says, per kind of hint (docs/HINT_PAWN.md § "The lines").
 *
 * Each kind has a collection of lines — the wrong-streak kind's are different tips, the
 * deck-review kind's phrasings of one idea — said in random order through a Deck Tower
 * visit (hintPawnVisit.ts → `takeHintLineIndex`) so a long session doesn't repeat one
 * sentence on every card. Keep every line short: the bubble shares the band below the
 * card with the pawn, and a cpcd-variant kind's lines must fit on one line
 * (`CPCD_LINE_MAX_CHARS`). A line that leads into content listed under it ends in a colon
 * (owner, 2026-11-08).
 *
 * KEYWORD MARKUP: wrap a word that names a button in the app in braces — `{More Info}` —
 * and PawnHintBody draws it in `COLORS.keywordInk` (Red Salmon), braces dropped. Never put
 * quote marks round a button name; the colour is what sets it apart (owner, 2026-11-08).
 *
 * BAND MARKUP: wrap a utcm band's name in square brackets — `[Comfortable]` — and
 * PawnHintBody draws it in that band's ink (`BAND_INK`: `COLORS.comfortableInk` /
 * `COLORS.masteredInk`), brackets dropped (owner, 2026-11-21). Only the bands with an ink
 * are recognised; any other bracketed text stays plain, brackets and all.
 *
 * Depended on by: hintPawn/pawnHints.ts (every collection), hintPawn/PawnHintBody.tsx
 * (`splitHintKeywords`), src/__tests__/wrongStreakHint.test.ts.
 */

/**
 * The longest line a cpcd-variant hint may say (pawnHints.ts → `PAWN_BUBBLE_VARIANT`).
 * Its line must sit on ONE line, or the cpcd words under it are pushed off the bubble's
 * bottom (owner, 2026-11-08). The bubble is about 240px of text wide on a 360px phone
 * (the stage and gutters take the rest), and the 12px semibold caption runs about 7px a
 * character, so 33 characters fit with a little margin. PawnHintBody also forbids the wrap
 * and ellipsizes as a safety net.
 *
 * ⚠️ No kind uses the cpcd variant today: its one user, the writing world's used-in hint,
 * was removed on 2026-11-22 when the writing card started naming its source words itself
 * (FlashcardsLearnPage/WritingSourceWords.tsx). Kept for the next kind that lists words.
 */
export const CPCD_LINE_MAX_CHARS = 33;

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
 * in the world were all wrong. These are DIFFERENT tips rather
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
 * The deck-review hint (every world): said once per dive, on its first card, when most of
 * the world's off-cooldown Learning deck is Comfortable or Mastered cards (pawnHints.ts →
 * `isReviewHeavyDeck`). A reassurance rather than a tip — the session will mostly be review.
 * One line for now (owner, 2026-11-21); add phrasings here and the shuffle bag rotates them.
 */
export const DECK_REVIEW_LINES: readonly string[] = [
    "Hey! Most of today's deck is reviewing [Comfortable] & [Mastered] cards. You got this!",
];

/**
 * What the pawn says when it is tapped on the ground (HintPawn → `onPawnTap`): a short "ouch" line in its own little bubble, up and to the right
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

/** The utcm bands a line may name with `[Band]` markup — the ones with an ink (PawnHintBody → `BAND_INK`). */
export type HintBandName = "Comfortable" | "Mastered";
const HINT_BAND_NAMES: readonly string[] = ["Comfortable", "Mastered"] satisfies readonly HintBandName[];

/**
 * One run of a hint line: plain copy, a button keyword (drawn in COLORS.keywordInk), or a
 * band name (`band` set; drawn in that band's ink). `band` is absent on every other run.
 */
export interface HintLineRun {
    text: string;
    keyword: boolean;
    band?: HintBandName;
}

/**
 * Split a line's `{keyword}` and `[Band]` markup into runs, braces/brackets dropped. A line
 * without markup is one plain run, so a plain line passes through unchanged. An unclosed
 * `{` is kept as plain text rather than swallowing the rest of the line, and a bracketed
 * word that is not a known band stays plain with its brackets.
 */
export function splitHintKeywords(line: string): HintLineRun[] {
    const runs: HintLineRun[] = [];
    // Group 1 = a {keyword}, group 2 = a [Band].
    const pattern = /\{([^{}]+)\}|\[([^[\]]+)\]/g;
    let last = 0;
    for (const match of line.matchAll(pattern)) {
        const [whole, keyword, band] = match;
        // An unknown [word] is not markup: leave it in the surrounding plain text.
        if (band !== undefined && !HINT_BAND_NAMES.includes(band)) continue;
        const start = match.index ?? 0;
        if (start > last) runs.push({ text: line.slice(last, start), keyword: false });
        runs.push(keyword !== undefined
            ? { text: keyword, keyword: true }
            : { text: band, keyword: false, band: band as HintBandName });
        last = start + whole.length;
    }
    if (last < line.length) runs.push({ text: line.slice(last), keyword: false });
    return runs;
}

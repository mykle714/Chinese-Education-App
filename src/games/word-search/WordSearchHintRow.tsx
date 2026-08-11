import React from "react";
import { Box } from "@mui/material";
import { SIZE, WEIGHT } from "../../theme/scale";
import { FONTS } from "../../theme/fonts";
import { HINT_ACCENT_COLOR, HINT_LETTER_BLANK } from "./constants";
import { wordToPinyinUnits } from "./pinyinUnits";
import { buildComponentReveals } from "./componentUnits";
import type { PlacedWord } from "./types";

interface WordSearchHintRowProps {
    /** The word currently being hinted, or null if no hint has been used yet
     *  (or the last hinted word was just found). */
    word: PlacedWord | null;
    /** How many hint presses have been spent on `word` so far. On the pinyin
     *  board the first N presses (N = character count) buy each character's
     *  LETTER COUNT in turn, and everything after that buys phonetic units
     *  distributed round-robin across characters (see `buildMask` /
     *  `distributeRevealTiers` below). On the components board it is a plain
     *  count of revealed component glyphs (`distributeComponentReveals` in
     *  componentUnits.ts). */
    revealCount: number;
    /**
     * Which currency this board's hints spend. The Pinyin board reveals phonetic
     * units of the pinyin; the No Pinyin board cannot (that is the thing it hides)
     * and reveals sub-character COMPONENT GLYPHS instead. See componentUnits.ts.
     */
    currency: "pinyin" | "components";
}

/**
 * Distributes `revealCount` units round-robin across syllables instead of
 * filling one island completely before the next: tier 0 is every syllable's
 * 1st unit (in character order), tier 1 is every syllable's 2nd unit, and so
 * on, wrapping until everything is revealed. A syllable with fewer units than
 * the current tier is skipped (nothing left to give it) without consuming a
 * reveal. Returns how many units are revealed per syllable.
 */
function distributeRevealTiers(syllableUnits: string[][], revealCount: number): number[] {
    const revealed = syllableUnits.map(() => 0);
    const maxTiers = syllableUnits.reduce((max, units) => Math.max(max, units.length), 0);
    let remaining = revealCount;
    for (let tier = 0; tier < maxTiers && remaining > 0; tier++) {
        for (let i = 0; i < syllableUnits.length && remaining > 0; i++) {
            if (syllableUnits[i].length > tier) {
                revealed[i] = tier + 1;
                remaining--;
            }
        }
    }
    return revealed;
}

/**
 * Number of blank slots a still-hidden chunk of pinyin occupies: one per
 * LETTER, not per code unit. Normalizing to NFC folds a combining tone mark
 * back onto its vowel ("a" + U+030C → "ǎ") so a tone-marked vowel counts once;
 * the spread then iterates code points rather than UTF-16 units.
 */
function letterCount(text: string): number {
    return [...text.normalize("NFC")].length;
}

/**
 * Build the mask: one "island" per Chinese character (so the island count
 * openly gives away the word's character count — that's intentional), revealed
 * in TWO stages as `revealCount` grows (see docs/WORD_SEARCH_GAME.md §5a):
 *
 *   Stage 1 — LETTER COUNTS, one character per press, left to right. A
 *   character whose length hasn't been bought yet is NOT DRAWN AT ALL — not
 *   even a placeholder — so the mask doesn't leak how many characters are
 *   still to come; each press appends the next island as one
 *   `HINT_LETTER_BLANK` ("_") per hidden letter, i.e. classic hangman spacing
 *   showing that syllable's full length. (The word's character count is
 *   therefore only learned by paying for it, one character at a time.)
 *
 *   Stage 2 — PHONETIC UNITS, only after every island's length is showing.
 *   The leftover presses (`revealCount - syllableCount`) are distributed
 *   round-robin across islands via `distributeRevealTiers` (see above) rather
 *   than filling one island completely before the next, and each reveal
 *   visibly eats the blanks it fills.
 *
 * e.g. 变化 (biàn huà): `____` → `____ ___` → `b___ ___` →
 * `b___ h__` → `bi__ h__` → … → `biàn huà`.
 */
function buildMask(syllableUnits: string[][], revealCount: number): string {
    // Stage 1 consumes one press per character before any phonetic unit is sold.
    const lengthsShown = Math.min(revealCount, syllableUnits.length);
    const unitReveals = Math.max(0, revealCount - syllableUnits.length);
    const revealedPerSyllable = distributeRevealTiers(syllableUnits, unitReveals);
    return syllableUnits
        .slice(0, lengthsShown)
        .map((units, i) => {
            const revealed = revealedPerSyllable[i];
            if (revealed >= units.length) return units.join("");
            const shown = units.slice(0, revealed).join("");
            const hidden = units.slice(revealed).join("");
            return `${shown}${HINT_LETTER_BLANK.repeat(letterCount(hidden))}`;
        })
        .join(" ");
}

/**
 * The letter-hint row, sitting between the English gloss list and the grid.
 * BLANK by default — nothing is shown until the player spends a hint. Pressing
 * the hint button (`WordSearchPage.tsx`'s `useHint`) picks a random still-unfound
 * word and then walks the two-stage ladder in `buildMask` above: first one
 * press per character to buy that character's LETTER COUNT (an unbought
 * character isn't drawn at all, so even the word's character count is paid
 * for one character at a time; a bought one appears as one
 * `HINT_LETTER_BLANK` "_" per hidden letter), then one press per **phonetic
 * unit** (initial / medial
 * glide / final — see `pinyinUnits.ts`), hangman-style. Phonetic units are
 * used instead of raw single Latin letters because pinyin's spelling doesn't
 * map 1:1 to sounds (e.g. "zh" is one initial spelled with two letters) — a
 * strict letter-at-a-time reveal would give away more or less than one
 * meaningful chunk per press depending on the syllable.
 * For a multi-character word, units are revealed ROUND-ROBIN across
 * characters (`distributeRevealTiers`) rather than one character at a time:
 * every character's 1st unit is given out before any character's 2nd, then
 * every 2nd before any 3rd, wrapping until the whole word is spelled out — a
 * character with fewer units than the current tier is simply skipped. Further
 * hints keep revealing units of the SAME word until it's found (the row goes
 * blank again, ready for the next hint to pick a new word) or fully spelled
 * out (further hints then move on to a different unfound word). The
 * mask is rendered in `HINT_ACCENT_COLOR`, the same color `WordSearchWordList`
 * tints the matching English gloss, so the two visually pair up. See
 * docs/WORD_SEARCH_GAME.md §5a.
 */
const WordSearchHintRow: React.FC<WordSearchHintRowProps> = ({ word, revealCount, currency }) => {
    // Pinyin board: one underscore island per syllable, filling with phonetic units.
    const pinyinMask =
        word && currency === "pinyin" ? buildMask(wordToPinyinUnits(word.pinyin), revealCount) : "";

    // No Pinyin board: one island per CHARACTER, filling with component glyphs in a
    // line, then collapsing to the character itself once that character's parts run out.
    const componentReveals =
        word && currency === "components"
            ? buildComponentReveals(word.entryKey, word.charComponents, revealCount)
            : [];

    return (
        <Box
            className="word-search__hint-row"
            sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: "1.5em",
                px: 1.5,
                pb: 0.5,
            }}
        >
            {word && currency === "pinyin" && (
                <Box
                    component="span"
                    className="word-search__hint-row-mask"
                    sx={{
                        fontSize: SIZE.bodyLg,
                        fontWeight: WEIGHT.bold,
                        fontFamily: "monospace",
                        letterSpacing: "2px",
                        color: HINT_ACCENT_COLOR,
                        lineHeight: 1.25,
                        whiteSpace: "nowrap",
                    }}
                >
                    {pinyinMask}
                </Box>
            )}

            {word && currency === "components" && (
                <Box
                    className="word-search__hint-row-components"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        // One gap between characters' islands; the glyphs WITHIN an island
                        // run together so they read as parts of one character.
                        gap: 1.5,
                        whiteSpace: "nowrap",
                    }}
                >
                    {componentReveals.map((reveal, i) => (
                        <Box
                            component="span"
                            // Islands are positional and the word never reorders, so the
                            // index is a stable key here.
                            key={i}
                            className={
                                reveal.isCharacter
                                    ? "word-search__hint-row-character"
                                    : "word-search__hint-row-parts"
                            }
                            sx={{
                                // FONTS.hanziComponents puts the self-hosted subset first so
                                // rare component glyphs (⺮ ⺼ 㐬 …) render in the same face as
                                // the grid instead of tofu. See src/index.css.
                                fontFamily: FONTS.hanziComponents,
                                fontSize: SIZE.bodyLg,
                                fontWeight: WEIGHT.bold,
                                color: HINT_ACCENT_COLOR,
                                lineHeight: 1.25,
                            }}
                        >
                            {reveal.text}
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
};

export default WordSearchHintRow;

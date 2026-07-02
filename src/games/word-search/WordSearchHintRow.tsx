import React from "react";
import { Box } from "@mui/material";
import { SIZE, WEIGHT } from "../../theme/scale";
import { HINT_ACCENT_COLOR, LETTER_HINT_BLANK_WIDTH } from "./constants";
import { wordToPinyinUnits } from "./pinyinUnits";
import type { PlacedWord } from "./types";

interface WordSearchHintRowProps {
    /** The word currently being hinted, or null if no hint has been used yet
     *  (or the last hinted word was just found). */
    word: PlacedWord | null;
    /** How many pinyin units of `word` have been revealed so far in total,
     *  distributed round-robin across syllables (see `distributeRevealTiers`
     *  below), not filled one syllable at a time. */
    revealCount: number;
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
 * Build the hangman-style mask: one "island" of underscores per Chinese
 * character (so the island count openly gives away the word's character
 * count — that's intentional), each island padded to a FIXED
 * `LETTER_HINT_BLANK_WIDTH` (3) underscores regardless of that syllable's
 * real unit count, so a syllable's own length stays hidden until its units
 * are actually revealed. `revealCount` units are distributed round-robin
 * across islands via `distributeRevealTiers` (see above) rather than filling
 * one island completely before the next.
 */
function buildMask(syllableUnits: string[][], revealCount: number): string {
    const revealedPerSyllable = distributeRevealTiers(syllableUnits, revealCount);
    return syllableUnits
        .map((units, i) => {
            const revealed = revealedPerSyllable[i];
            if (revealed >= units.length) return units.join("");
            return `${units.slice(0, revealed).join("")}${"_".repeat(LETTER_HINT_BLANK_WIDTH)}`;
        })
        .join(" ");
}

/**
 * The letter-hint row, sitting between the English gloss list and the grid.
 * BLANK by default — nothing is shown until the player spends a hint. Pressing
 * the hint button (`WordSearchPage.tsx`'s `useHint`) picks a random still-unfound
 * word and reveals its pinyin one **phonetic unit** at a time (initial /
 * medial glide / final — see `pinyinUnits.ts`), hangman-style, via `buildMask`
 * above. These units are used instead of raw single Latin letters because
 * pinyin's spelling doesn't map 1:1 to sounds (e.g. "zh" is one initial
 * spelled with two letters) — a strict letter-at-a-time reveal would give away
 * more or less than one meaningful chunk per press depending on the syllable.
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
const WordSearchHintRow: React.FC<WordSearchHintRowProps> = ({ word, revealCount }) => {
    const syllableUnits = word ? wordToPinyinUnits(word.pinyin) : [];
    const mask = word ? buildMask(syllableUnits, revealCount) : "";

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
            {word && (
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
                    {mask}
                </Box>
            )}
        </Box>
    );
};

export default WordSearchHintRow;

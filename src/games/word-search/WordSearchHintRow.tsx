import React from "react";
import { Box } from "@mui/material";
import { WEIGHT } from "../../theme/scale";
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
     *  board press 1 buys the word's whole SKELETON — every character's letter
     *  count at once — and every press after that buys one phonetic unit,
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
 * Build the mask: one "island" per Chinese character, revealed in TWO stages as
 * `revealCount` grows (see docs/WORD_SEARCH_GAME.md §5a):
 *
 *   Stage 0 — THE SKELETON, bought whole by the first press. Every island
 *   appears at once as one `HINT_LETTER_BLANK` ("_") per hidden letter, so a
 *   single charge buys the word's character count AND every character's letter
 *   count — classic hangman spacing for the entire word.
 *
 *   Stage 1 — PHONETIC UNITS, one per press thereafter. They are distributed
 *   round-robin across islands via `distributeRevealTiers` (see above) rather
 *   than filling one island completely before the next, and each reveal visibly
 *   eats the blanks it fills.
 *
 * e.g. 变化 (biàn huà): `____ ___` → `b___ ___` → `b___ h__` → `bi__ h__` →
 * `bi__ hu_` → `biàn hu_` → `biàn huà`.
 *
 * WHY THE SKELETON IS ONE PRESS (2026-08-29). The ladder has been re-cut three
 * times around one question: how much of the word's SHAPE a single charge buys.
 * It has been (a) the whole skeleton, (b) one character's letter count per
 * press with unbought characters not drawn at all — which meant the first press
 * on a two-character word printed `____`, selling the character count and the
 * first syllable's length together — and (c) a dedicated count-only rung
 * (`— —`) ahead of the per-character lengths. This is (a) again, chosen
 * deliberately: the skeleton is scaffolding, not an answer. It tells the player
 * where to put their attention and keeps the mask's width fixed from the first
 * press, and the reveals that actually cost the puzzle something are the
 * SOUNDS. Spending three or four charges before the mask says a single letter
 * made the early rungs feel like a tax. `HINT_REMAINDER_MARK` is consequently
 * unused on the pinyin board again, and lives on as the No-Pinyin board's
 * `COMPONENT_BLANK` (§5a-ii), where there is no letter count to show.
 */
function buildMask(syllableUnits: string[][], revealCount: number): string {
    // Nothing is drawn until the first press — the row is blank at rest.
    if (revealCount <= 0) return "";
    // Press 1 is the skeleton, so only the presses AFTER it buy phonetic units.
    const revealedPerSyllable = distributeRevealTiers(syllableUnits, revealCount - 1);
    return syllableUnits
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
 * The REVEAL — what a spent hint bought. It fills the right-hand `.rv` slot of the
 * `.hintbar` row (docs/SHELF_REDESIGN.md § 13); it used to be a row of its own between
 * the gloss list and the grid, which cost a whole line of board height to show nothing
 * most of the time.
 *
 * BLANK by default — nothing is shown until the player spends a hint. Pressing
 * the hint button (`WordSearchPage.tsx`'s `useHint`) picks a random still-unfound
 * word and then walks the two-stage ladder in `buildMask` above: the first
 * press buys the word's whole SKELETON (every character's island at once, one
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
 * mask is rendered in `HINT_ACCENT_COLOR`, the same ink the `.hintbar` lightbulb
 * and charge dots use, so the whole hint mechanic reads as one thing. See
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
                justifyContent: "flex-end",
                alignItems: "baseline",
                gap: "7px",
                minWidth: 0,
                // Holds its line open even when empty, so spending the first hint of a
                // run doesn't shove the grid down by a row.
                minHeight: "1.4em",
            }}
        >
            {word && currency === "pinyin" && (
                <Box
                    component="span"
                    className="word-search__hint-row-mask"
                    sx={{
                        // `.rv em` is mono 10.5 muted in the design — but there the
                        // reveal is a caption beside a headword, and here the mask IS
                        // the information the player paid for. It keeps the mono face
                        // (the blanks must sit on a fixed pitch or the word appears to
                        // shuffle as it fills) at a readable size, in the accent the
                        // gloss chip is tinted with so the two visibly pair up.
                        fontFamily: FONTS.mono,
                        fontSize: 13,
                        fontWeight: WEIGHT.bold,
                        letterSpacing: "2px",
                        color: HINT_ACCENT_COLOR,
                        lineHeight: 1.25,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
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
                        minWidth: 0,
                        overflow: "hidden",
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
                                // `.rv b` — cjk 16/700 with the design's letter spacing.
                                fontSize: 16,
                                fontWeight: WEIGHT.bold,
                                letterSpacing: "0.03em",
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

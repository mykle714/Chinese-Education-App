import React from "react";
import { Box } from "@mui/material";
import type { Language } from "../types";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * A keycap GROUP — the four tone marks of one vowel (zh), or a run of related
 * accented letters (es). The group is the unit the design spaces apart: keys
 * inside a group sit 5px apart, groups sit 14px apart, and that gap is the ONLY
 * thing telling a learner that ā á ǎ à are one vowel rather than four letters.
 */
interface KeyGroup {
    keys: string[];
    /** Ramp pastel filling every key in the group. Undefined = no fill (es). */
    fill?: string;
}

// zh: one group per vowel, two groups per row — the design's `.kp` (artboard 7).
// The fills walk the ramp in the order the vowels are taught (a-e-i-o-u-ü) rather
// than by any meaning, so the color is a GROUPING device and nothing more.
//
// The i-row's `#F7F0C6` is oklch(95% 0.055 100), the one keypad fill the design
// specifies inline instead of via a ramp variable: the ramp has no yellow between
// --org (hue 70) and --grn (hue 145), and six vowels need six distinguishable hues.
const ZH_ROWS: KeyGroup[][] = [
    [{ keys: ['ā', 'á', 'ǎ', 'à'], fill: COLORS.red }, { keys: ['ē', 'é', 'ě', 'è'], fill: COLORS.org }],
    [{ keys: ['ī', 'í', 'ǐ', 'ì'], fill: '#F7F0C6' }, { keys: ['ō', 'ó', 'ǒ', 'ò'], fill: COLORS.grn }],
    [{ keys: ['ū', 'ú', 'ǔ', 'ù'], fill: COLORS.blu }, { keys: ['ǖ', 'ǘ', 'ǚ', 'ǜ'], fill: COLORS.pur }],
];

// es: accented vowels then the letters/punctuation Spanish needs that a US keyboard
// lacks. No fills — es has no tone system, so a hue here would imply a distinction
// that does not exist.
const ES_ROWS: KeyGroup[][] = [
    [{ keys: ['á', 'é', 'í', 'ó', 'ú'] }, { keys: ['ñ', 'ü'] }],
    [{ keys: ['¿', '¡'] }],
];

const ROWS_BY_LANGUAGE: Record<Language, KeyGroup[][]> = { zh: ZH_ROWS, es: ES_ROWS };

export interface PinyinKeypadProps {
    language: Language;
    // The text field this keypad inserts into. Used to read cursor position and restore focus
    // after insertion — mirrors the pattern DictionaryPage used before this was extracted.
    inputRef: React.RefObject<HTMLInputElement | null>;
    value: string;
    onChange: (newValue: string) => void;
    className?: string;
}

/**
 * Tone-vowel / accent keypad for typing special characters into a search input without a native
 * IME. Inserts the tapped character at the current cursor position (or appends if the input isn't
 * focused/measurable) and restores focus + cursor placement afterward.
 *
 * Rendered as the design's `.kp` KEYCAPS (docs/SHELF_REDESIGN.md, artboard 7): a flat 30×30
 * square at radius 8 with a ramp pastel ground and ink glyph. It is deliberately NOT a MUI
 * `Button` — a contained Button is a pill with an elevation shadow and a ripple, which read as
 * three separate "this submits something" signals on a control that only types a letter. A
 * keycap has to look like a key, and every key on the pad is equally weighted.
 *
 * Extracted from DictionaryPage (which used to inline this twice — a live mobile copy and a dead
 * desktop copy behind an always-false `!isMobile` branch) so the eip Compare tab's slot-B search
 * (docs/WORD_COMPARE_FEATURE.md) can reuse it.
 */
function PinyinKeypad({ language, inputRef, value, onChange, className }: PinyinKeypadProps) {
    const rows = ROWS_BY_LANGUAGE[language] ?? [];

    const handleClick = (char: string) => {
        const input = inputRef.current;
        if (!input) {
            onChange(value + char);
            return;
        }

        const start = input.selectionStart ?? value.length;
        const end = input.selectionEnd ?? value.length;
        const newValue = value.substring(0, start) + char + value.substring(end);
        onChange(newValue);

        setTimeout(() => {
            const newPosition = start + char.length;
            input.setSelectionRange(newPosition, newPosition);
            input.focus();
        }, 0);
    };

    return (
        <Box
            className={["pinyin-keypad", className].filter(Boolean).join(" ")}
            sx={{ display: "flex", flexDirection: "column", gap: "5px" }}
        >
            {rows.map((groups, rowIndex) => (
                <Box
                    key={rowIndex}
                    className="pinyin-keypad__row"
                    // 14px between groups is the design's `.kp .row` gap; it is what separates
                    // one vowel's four tones from the next vowel's.
                    sx={{ display: "flex", justifyContent: "center", gap: "14px" }}
                >
                    {groups.map((group, groupIndex) => (
                        <Box
                            key={groupIndex}
                            className="pinyin-keypad__group"
                            sx={{ display: "flex", gap: "5px" }}
                        >
                            {group.keys.map((char) => (
                                <Box
                                    key={char}
                                    component="button"
                                    type="button"
                                    className="pinyin-keypad__key"
                                    onClick={() => handleClick(char)}
                                    sx={{
                                        width: "30px",
                                        height: "30px",
                                        flexShrink: 0,
                                        p: 0,
                                        border: "none",
                                        borderRadius: "8px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        // A group with no fill (es) still needs a key-shaped
                                        // footprint, so it falls back to the inert grey surface.
                                        backgroundColor: group.fill ?? COLORS.card,
                                        fontFamily: FONTS.sans,
                                        fontSize: "14px",
                                        fontWeight: 500,
                                        lineHeight: 1,
                                        color: COLORS.onSurface,
                                        cursor: "pointer",
                                        // Press feedback replaces the removed ripple: the key
                                        // darkens under the finger and returns, which is the
                                        // whole of a keycap's interaction vocabulary.
                                        transition: "filter 90ms linear",
                                        "&:active": { filter: "brightness(0.92)" },
                                    }}
                                >
                                    {char}
                                </Box>
                            ))}
                        </Box>
                    ))}
                </Box>
            ))}
        </Box>
    );
}

export default PinyinKeypad;

import React from "react";
import { Box } from "@mui/material";
import type { Language } from "../types";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE } from "../theme/scale";

/**
 * A keycap GROUP — the four tone marks of one vowel (zh), or a run of related
 * accented letters (es). The group is the unit the design spaces apart: keys
 * inside a group sit 5px apart, groups sit 14px apart, and that gap is the ONLY
 * thing telling a learner that ā á ǎ à are one vowel rather than four letters.
 */
interface KeyGroup {
    keys: string[];
    /** Ramp MARK-tier fill for every key in the group. Undefined = no fill (es). */
    fill?: string;
}

// zh: one group per vowel, two groups per row — the design's `.kp` (artboard 7).
// The fills walk the ramp in the order the vowels are taught (a-e-i-o-u-ü) rather
// than by any meaning, so the color is a GROUPING device and nothing more.
//
// v2: the keys are the MARK tier (artboard 7's caption: "Mark: dictionary vowel keys"),
// the fluorescent highlighter, one hue per vowel: a→red, e→org, i→yel, o→grn, u→blu,
// ü→pur. v1 painted them with the pale surfaces and had to borrow an inline yellow for
// the i-row because the ramp had no yellow then; `--yelMk` retires that literal.
const ZH_ROWS: KeyGroup[][] = [
    [{ keys: ['ā', 'á', 'ǎ', 'à'], fill: COLORS.redMk }, { keys: ['ē', 'é', 'ě', 'è'], fill: COLORS.orgMk }],
    [{ keys: ['ī', 'í', 'ǐ', 'ì'], fill: COLORS.yelMk }, { keys: ['ō', 'ó', 'ǒ', 'ò'], fill: COLORS.grnMk }],
    [{ keys: ['ū', 'ú', 'ǔ', 'ù'], fill: COLORS.bluMk }, { keys: ['ǖ', 'ǘ', 'ǚ', 'ǜ'], fill: COLORS.purMk }],
];

// es: accented vowels then the letters/punctuation Spanish needs that a US keyboard
// lacks. No fills — es has no tone system, so a hue here would imply a distinction
// that does not exist.
const ES_ROWS: KeyGroup[][] = [
    [{ keys: ['á', 'é', 'í', 'ó', 'ú'] }, { keys: ['ñ', 'ü'] }],
    [{ keys: ['¿', '¡'] }],
];

const ROWS_BY_LANGUAGE: Record<Language, KeyGroup[][]> = { zh: ZH_ROWS, es: ES_ROWS };

/**
 * Keycap metrics per keypad size.
 *  - `compact` is the artboard's `.kp` keycap (30×30, 14px glyph, 5px in-group / 14px
 *    between-group gaps) — used where the keypad shares a narrow panel (the eip Compare
 *    tab's slot-B search).
 *  - `large` is the Dictionary page's full-width keypad: a 32px key with an 18px glyph,
 *    on a 4px grid — every key size, radius and gap is a whole multiple of 4px so each
 *    keycap lands on whole device pixels and every glyph renders at the same pixel size
 *    (fractional keys like 33.25px made neighbouring keys round to different widths).
 *    Widest row = 8·32 + 6·4 + 16 = 296px, inside the 328px a 360px phone leaves within
 *    the Container's 16px gutters.
 * `keyGap` spaces keys within a group; `rowGap` spaces the rows apart (opened a little wider
 * than `keyGap` on `large` so the rows read as distinct lines); `groupGap` is the
 * between-vowel gap, the design's only signal that ā á ǎ à are one vowel rather than four letters.
 */
type KeypadSize = "compact" | "large";
const KEY_METRICS: Record<KeypadSize, { keySize: string; radius: string; fontSize: string; keyGap: string; groupGap: string; rowGap: string }> = {
    compact: { keySize: "30px", radius: "8px", fontSize: SIZE.body, keyGap: "5px", groupGap: "14px", rowGap: "5px" },
    large: { keySize: "32px", radius: "8px", fontSize: SIZE.subtitle, keyGap: "4px", groupGap: "16px", rowGap: "8px" },
};

export interface PinyinKeypadProps {
    language: Language;
    // The text field this keypad inserts into. Used to read cursor position and restore focus
    // after insertion — mirrors the pattern DictionaryPage used before this was extracted.
    inputRef: React.RefObject<HTMLInputElement | null>;
    value: string;
    onChange: (newValue: string) => void;
    className?: string;
    /** Keycap size; defaults to the artboard's `compact` keycap. See KEY_METRICS. */
    size?: KeypadSize;
}

/**
 * Tone-vowel / accent keypad for typing special characters into a search input without a native
 * IME. Inserts the tapped character at the current cursor position (or appends if the input isn't
 * focused/measurable) and restores focus + cursor placement afterward.
 *
 * Rendered as the design's `.kp` KEYCAPS (docs/SHELF_REDESIGN.md, artboard 7): a flat square
 * keycap (30×30 at radius 8 compact, 32×32 at radius 8 on the Dictionary page — KEY_METRICS) with a ramp MARK-tier ground and ink glyph. It is deliberately NOT a MUI
 * `Button` — a contained Button is a pill with an elevation shadow and a ripple, which read as
 * three separate "this submits something" signals on a control that only types a letter. A
 * keycap has to look like a key, and every key on the pad is equally weighted.
 *
 * Extracted from DictionaryPage (which used to inline this twice — a live mobile copy and a dead
 * desktop copy behind an always-false `!isMobile` branch) so the eip Compare tab's slot-B search
 * (docs/WORD_COMPARE_FEATURE.md) can reuse it.
 */
function PinyinKeypad({ language, inputRef, value, onChange, className, size = "compact" }: PinyinKeypadProps) {
    const rows = ROWS_BY_LANGUAGE[language] ?? [];
    const metrics = KEY_METRICS[size];

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
            sx={{ display: "flex", flexDirection: "column", gap: metrics.rowGap }}
        >
            {rows.map((groups, rowIndex) => (
                <Box
                    key={rowIndex}
                    className="pinyin-keypad__row"
                    // The between-group gap (14px compact) is the design's `.kp .row` gap; it is
                    // what separates one vowel's four tones from the next vowel's.
                    sx={{ display: "flex", justifyContent: "center", gap: metrics.groupGap }}
                >
                    {groups.map((group, groupIndex) => (
                        <Box
                            key={groupIndex}
                            className="pinyin-keypad__group"
                            sx={{ display: "flex", gap: metrics.keyGap }}
                        >
                            {group.keys.map((char) => (
                                <Box
                                    key={char}
                                    component="button"
                                    type="button"
                                    className="pinyin-keypad__key"
                                    onClick={() => handleClick(char)}
                                    sx={{
                                        width: metrics.keySize,
                                        height: metrics.keySize,
                                        flexShrink: 0,
                                        p: 0,
                                        border: "none",
                                        borderRadius: metrics.radius,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        // A group with no fill (es) still needs a key-shaped
                                        // footprint, so it falls back to the inert grey surface.
                                        backgroundColor: group.fill ?? COLORS.card,
                                        fontFamily: FONTS.sans,
                                        fontSize: metrics.fontSize,
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

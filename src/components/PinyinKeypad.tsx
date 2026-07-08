import React from "react";
import { Box, Button } from "@mui/material";
import type { Language } from "../types";

// Special characters offered per language: zh's tone-marked pinyin vowels (for numbered-pinyin-free
// typing), es's accented letters + inverted punctuation. Shared by DictionaryPage and the eip
// Compare tab's slot-B search (docs/WORD_COMPARE_FEATURE.md).
const SPECIAL_CHARACTERS: Record<Language, string[]> = {
    zh: [
        'ā', 'á', 'ǎ', 'à',
        'ē', 'é', 'ě', 'è',
        'ī', 'í', 'ǐ', 'ì',
        'ō', 'ó', 'ǒ', 'ò',
        'ū', 'ú', 'ǔ', 'ù',
        'ǖ', 'ǘ', 'ǚ', 'ǜ',
    ],
    es: ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', '¿', '¡'],
};

// Pastel background per vowel group (zh only) so the four tones of a-e-i-o-u-ü read as a group.
const ZH_VOWEL_COLORS: Record<string, string> = {
    'ā': '#ffebee', 'á': '#ffebee', 'ǎ': '#ffebee', 'à': '#ffebee', // a - light red
    'ē': '#fff3e0', 'é': '#fff3e0', 'ě': '#fff3e0', 'è': '#fff3e0', // e - light orange
    'ī': '#fffde7', 'í': '#fffde7', 'ǐ': '#fffde7', 'ì': '#fffde7', // i - light yellow
    'ō': '#e8f5e9', 'ó': '#e8f5e9', 'ǒ': '#e8f5e9', 'ò': '#e8f5e9', // o - light green
    'ū': '#e3f2fd', 'ú': '#e3f2fd', 'ǔ': '#e3f2fd', 'ù': '#e3f2fd', // u - light blue
    'ǖ': '#f3e5f5', 'ǘ': '#f3e5f5', 'ǚ': '#f3e5f5', 'ǜ': '#f3e5f5', // ü - light purple
};

function getVowelColor(char: string, language: Language): string {
    if (language !== 'zh') return 'transparent';
    return ZH_VOWEL_COLORS[char] || 'transparent';
}

// Square footprint: height matches a MUI small contained button (~30px); width locked to the
// same value with default horizontal padding removed so the single glyph stays centered.
const charButtonSx = (char: string, language: Language) => ({
    width: '30px',
    minWidth: '30px',
    height: '30px',
    p: 0,
    fontFamily: 'inherit',
    textTransform: 'lowercase' as const,
    backgroundColor: getVowelColor(char, language),
    color: '#000000',
    '&:hover': {
        backgroundColor: getVowelColor(char, language),
        filter: 'brightness(0.9)',
    },
});

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
 * Extracted from DictionaryPage (which used to inline this twice — a live mobile copy and a dead
 * desktop copy behind an always-false `!isMobile` branch) so the eip Compare tab's slot-B search
 * (docs/WORD_COMPARE_FEATURE.md) can reuse it.
 */
function PinyinKeypad({ language, inputRef, value, onChange, className }: PinyinKeypadProps) {
    const chars = SPECIAL_CHARACTERS[language] ?? [];

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

    // Chunk into rows of 8 (mirrors the original zh 3-row layout; es's 9 chars spill one row + 1).
    const rows: string[][] = [];
    for (let i = 0; i < chars.length; i += 8) rows.push(chars.slice(i, i + 8));

    return (
        <Box className={["pinyin-keypad", className].filter(Boolean).join(" ")}>
            {rows.map((row, rowIndex) => (
                <Box
                    key={rowIndex}
                    className="pinyin-keypad__row"
                    sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: rowIndex < rows.length - 1 ? 0.5 : 1, justifyContent: 'center' }}
                >
                    {row.map((char, idx) => (
                        <Button
                            key={char}
                            className="pinyin-keypad__char-btn"
                            variant="contained"
                            size="small"
                            onClick={() => handleClick(char)}
                            // Extra left margin on the 5th button splits each row's two vowel
                            // groups (4 + 4) with a gap down the middle.
                            sx={{ ...charButtonSx(char, language), ...(idx === 4 ? { ml: 2 } : {}) }}
                        >
                            {char}
                        </Button>
                    ))}
                </Box>
            ))}
        </Box>
    );
}

export default PinyinKeypad;

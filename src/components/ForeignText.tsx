import React from "react";
import { Box } from "@mui/material";
import CPCDRow, { type CPCDRowItem, type CPCDSize } from "./CPCDRow";
import { useAuth } from "../AuthContext";
import type { Language } from "../types";

// Re-export so call sites can build items without importing CPCDRow directly.
// ForeignText is the public container; CPCDRow is its Chinese-script implementation.
export type { CPCDRowItem, CPCDSize };

interface ForeignTextBaseProps {
    // Language of the text being rendered. When omitted, falls back to the
    // signed-in user's selectedLanguage (defaulting to 'zh' if unknown).
    language?: Language;
    size?: CPCDSize;
    compact?: boolean;
    flexWrap?: "nowrap" | "wrap";
    justifyContent?: string;
    className?: string;
}

interface ForeignTextProps extends ForeignTextBaseProps {
    // High-level API (preferred): pass the raw word/phrase and its pronunciation.
    // ForeignText handles the per-character split + pinyin zip internally so call
    // sites stay language-agnostic.
    text?: string;
    // Space-separated pronunciation syllables, one per character of `text`.
    // Nullable to match the dictionary/vocab data layer (pronunciation is optional).
    pronunciation?: string | null;
    showPinyin?: boolean;
    useToneColor?: boolean;

    // Low-level API (advanced): pre-built per-character items. Use only when a
    // call site needs per-character control the high-level API can't express —
    // e.g. interactivity, selection, or cell measurement (SegmentedSentenceDisplay).
    items?: CPCDRowItem[];
}

// Languages written in Latin script with no per-character pronunciation overlay.
// These render as plain text rather than the character+pinyin (cpcd) layout.
// This is the canonical definition; other components (e.g. SegmentedSentenceDisplay)
// import `isLatinScriptLang` rather than re-declaring the set.
const LATIN_SCRIPT_LANGUAGES: ReadonlySet<Language> = new Set<Language>(["es"]);

/**
 * Whether a language is written in Latin script (space-delimited words, no
 * per-character pronunciation overlay). Accepts an arbitrary string so callers
 * holding a loosely-typed language value (not yet narrowed to `Language`) can use it.
 */
export function isLatinScriptLang(language?: string | null): boolean {
    return !!language && LATIN_SCRIPT_LANGUAGES.has(language as Language);
}

// Plain-text font sizing, mirroring CPCDRow's per-size character font so a
// Spanish word sits at the same visual scale as a Chinese row would.
const PLAIN_CHAR_FONT: Record<CPCDSize, string> = { sm: "26px", md: "2.25rem", lg: "2.4rem" };
const PLAIN_COMPACT_CHAR_FONT: Record<CPCDSize, string> = { sm: "22px", md: "1.875rem", lg: "2.25rem" };

/**
 * Build one CPCDRow item per character, zipping each character with its
 * pronunciation syllable. `showPinyin`/`useToneColor` apply uniformly; CPCDRow
 * still hides the pinyin for any character whose syllable is empty.
 */
function buildCharItems(
    text: string,
    pronunciation: string | null | undefined,
    showPinyin: boolean,
    useToneColor: boolean,
): CPCDRowItem[] {
    const syllables = pronunciation ? pronunciation.trim().split(/\s+/) : [];
    return [...text].map((character, i) => ({
        character,
        pinyin: syllables[i] ?? "",
        showPinyin,
        useToneColor,
    }));
}

/**
 * Language-aware container for displaying a foreign-language word or phrase.
 *
 * - Character-based languages (Chinese, etc.): delegates to CPCDRow, which
 *   renders each character with its tone-colored pinyin overlay.
 * - Latin-script languages (Spanish): renders the text as plain, sized text —
 *   no pinyin row and no per-character coloring.
 *
 * Callers pass either `text` (+ optional `pronunciation`) for the common case,
 * or pre-built `items` for advanced per-character control.
 */
const ForeignText: React.FC<ForeignTextProps> = ({
    language,
    size = "sm",
    compact = false,
    flexWrap = "nowrap",
    justifyContent,
    className,
    text,
    pronunciation,
    showPinyin = true,
    useToneColor = true,
    items,
}) => {
    // Resolve language: explicit prop wins, otherwise the user's selection.
    const { user } = useAuth();
    const resolvedLanguage = language ?? (user?.selectedLanguage ?? "zh");

    if (isLatinScriptLang(resolvedLanguage)) {
        // Spanish (and other Latin-script languages): plain text. Prefer the raw
        // `text`; fall back to reconstructing it from any provided items.
        const plain = text ?? (items ?? []).map((item) => item.character).join("");
        const fontSize = compact ? PLAIN_COMPACT_CHAR_FONT[size] : PLAIN_CHAR_FONT[size];
        return (
            <Box
                className={className}
                sx={{
                    display: "flex",
                    flexWrap,
                    justifyContent: justifyContent ?? "flex-start",
                    fontSize,
                    fontWeight: 400,
                    fontFamily: '"Inter", sans-serif',
                    color: "text.primary",
                    lineHeight: 1.21,
                }}
            >
                <span className="foreign-text__plain">{plain}</span>
            </Box>
        );
    }

    // Character-based languages: defer to the cpcd row implementation. Build
    // items from text/pronunciation unless the caller supplied them directly.
    const resolvedItems = items ?? buildCharItems(text ?? "", pronunciation, showPinyin, useToneColor);
    return (
        <CPCDRow
            items={resolvedItems}
            size={size}
            compact={compact}
            flexWrap={flexWrap}
            justifyContent={justifyContent}
            className={className}
        />
    );
};

export default ForeignText;

import React from "react";
import { Box } from "@mui/material";
import CPCDRow, { type CPCDRowItem, type CPCDSize } from "./CPCDRow";
import CPCDBlock, { type CPCDBlockItem } from "./CPCDBlock";
import { useAuth } from "../AuthContext";
import { useFirstTwoAreSegment } from "../hooks/useFirstTwoAreSegment";
import type { Language } from "../types";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";

// Re-export so call sites can build items without importing CPCDRow/CPCDBlock
// directly. ForeignText is the public container; CPCDRow/CPCDBlock are its
// Chinese-script implementations.
export type { CPCDRowItem, CPCDBlockItem, CPCDSize };

interface ForeignTextBaseProps {
    // Language of the text being rendered. When omitted, falls back to the
    // signed-in user's selectedLanguage (defaulting to 'zh' if unknown).
    language?: Language;
    size?: CPCDSize;
    compact?: boolean;
    // Render the word/characters at bold weight (regular by default). Applies to
    // both the cpcd glyphs and the Latin-script plain-text fallback.
    bold?: boolean;
    flexWrap?: "nowrap" | "wrap";
    justifyContent?: string;
    className?: string;
    // Horizontal long-syllable pinyin nudging (see CPCDRow.pinyinShift). Defaults
    // to true; ignored for Latin-script languages, which render no pinyin overlay.
    pinyinShift?: boolean;
    // Allow text selection / cursor within the rendered word on desktop. Defaults
    // to false; only prose-like surfaces (example sentences) enable it. See
    // CPCDRow.selectable. Ignored for Latin-script plain text, which inherits the
    // app-wide non-selectable default.
    selectable?: boolean;
    // Optional override for the word/character color (the per-card flashcard Contrast
    // setting — see docs/CARD_ICON_LAYOUT.md). Applies to the cpcd glyphs and the
    // Latin-script plain text; the pinyin overlay is never affected. Undefined = theme
    // default.
    characterColor?: string;
    // "row" (default): CPCDRow — characters in a line, per-column pinyin. "block":
    // CPCDBlock — up to 4 characters arranged as a square (2x2 grid, or a 3-char
    // triangle) with one plain pinyin line underneath. Ignored for Latin-script
    // languages, which always render plain text regardless of layout.
    layout?: "row" | "block";
    // Block layout only, and only consulted for a 3-character word: whether the
    // first two characters are one segment (see CPCDBlock's triangle-orientation
    // comment). Leave undefined to let ForeignText auto-detect it (a cached det
    // lookup of the 2-char prefix via useFirstTwoAreSegment); pass an explicit
    // boolean only to override that.
    firstTwoAreSegment?: boolean;
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
const PLAIN_CHAR_FONT: Record<CPCDSize, string> = { xs: "18px", sm: "26px", md: "2.25rem", lg: "2.4rem", xl: "3.2rem" };
const PLAIN_COMPACT_CHAR_FONT: Record<CPCDSize, string> = { xs: "16px", sm: "22px", md: "1.875rem", lg: "2.25rem", xl: "2.8rem" };

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
    bold = false,
    flexWrap = "nowrap",
    justifyContent,
    className,
    text,
    pronunciation,
    showPinyin = true,
    useToneColor = true,
    items,
    pinyinShift = true,
    selectable = false,
    characterColor,
    layout = "row",
    firstTwoAreSegment,
}) => {
    // Resolve language: explicit prop wins, otherwise the user's selection.
    const { user } = useAuth();
    const resolvedLanguage = language ?? (user?.selectedLanguage ?? "zh");

    // For a 3-char block, auto-detect whether the first two chars form a word
    // (drives the triangle orientation) unless the caller passed an explicit
    // firstTwoAreSegment. Gated to layout="block" (pass null otherwise) so this
    // fires no lookup for the common row layout. The word comes from `text`, or
    // is reconstructed from `items` for the advanced API.
    const blockWord = text ?? (items ? items.map((it) => it.character).join("") : "");
    const autoFirstTwoAreSegment = useFirstTwoAreSegment(
        layout === "block" ? blockWord : null,
        resolvedLanguage,
    );
    const effectiveFirstTwoAreSegment = firstTwoAreSegment ?? autoFirstTwoAreSegment;

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
                    fontWeight: bold ? WEIGHT.bold : WEIGHT.regular,
                    fontFamily: FONTS.sans,
                    // Per-card Contrast override (docs/CARD_ICON_LAYOUT.md); theme default otherwise.
                    color: characterColor ?? "text.primary",
                    lineHeight: 1.21,
                }}
            >
                <span className="foreign-text__plain">{plain}</span>
            </Box>
        );
    }

    // Character-based languages: defer to the cpcd implementation. Build items
    // from text/pronunciation unless the caller supplied them directly.
    const resolvedItems = items ?? buildCharItems(text ?? "", pronunciation, showPinyin, useToneColor);

    // CPCDBlock only lays out up to 4 characters; a longer word (idioms, etc.)
    // falls back to the row layout rather than being silently truncated.
    if (layout === "block" && resolvedItems.length <= 4) {
        return (
            <CPCDBlock
                items={resolvedItems as CPCDBlockItem[]}
                size={size}
                firstTwoAreSegment={effectiveFirstTwoAreSegment}
                bold={bold}
                className={className}
                characterColor={characterColor}
            />
        );
    }

    return (
        <CPCDRow
            items={resolvedItems}
            size={size}
            compact={compact}
            bold={bold}
            flexWrap={flexWrap}
            justifyContent={justifyContent}
            className={className}
            pinyinShift={pinyinShift}
            selectable={selectable}
            characterColor={characterColor}
        />
    );
};

export default ForeignText;

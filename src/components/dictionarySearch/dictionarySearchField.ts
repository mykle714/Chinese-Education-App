/**
 * dictionarySearchField — the dictionary SEARCH FIELD's look and placeholder, shared by every
 * dictionary search box: the Dictionary page and the mini search (DictionaryWordSearch — the
 * Compare panel, the Writing Notebook picker). Moved here from features/dictionary/
 * DictionaryPage.tsx on 2026-11-21 so the two read as one search.
 *
 * LAYER: shared client styling (src/components/dictionarySearch). Pure; no React.
 * Depended on by: features/dictionary/DictionaryPage.tsx, components/DictionaryWordSearch.tsx.
 * Docs: docs/SHELF_REDESIGN.md § Part B entry 7 (Dictionary); docs/WORD_COMPARE_FEATURE.md § The search.
 */
import type { Language } from '../../types';
import type { Tier2Look } from '../../timeOfDay/tier2Look';

// The search field as drawn in the 2026-10-29 redesign (artboard "Dictionary · search +
// results", `.field`): a 50px well with a 14px corner, and a 2px INK ring while focused
// instead of MUI's blue primary outline. Unfocused it keeps the app's 1px input outline
// (CLAUDE.md § Buttons & cards). Coloured by the host's look: on the Dictionary page that
// is the time of day (white by day, slate at night — src/timeOfDay/tier2Look.ts).
export const dictionarySearchFieldSx = (look: Tier2Look) => ({
    '& .MuiOutlinedInput-root': {
        height: 50,
        borderRadius: '14px',
        backgroundColor: look.surface,
        color: look.ink,
        fontSize: '17px',
        '& fieldset': { borderColor: look.outline },
        '&:hover fieldset': { borderColor: look.outline },
        '&.Mui-focused fieldset': { borderColor: look.ink, borderWidth: 2 },
        // The search glyph and the clear ✕.
        '& .MuiSvgIcon-root': { color: look.muted },
        '& input::placeholder': { color: look.muted, opacity: 1 },
    },
});

// The dictionary search accepts several shapes of query (see DictionaryDAL ->
// searchByWord1): the headword itself, pinyin — tone-marked, plain, or numbered, spaced or
// spaceless (zh only) — and English definition text. Nothing else on the page says so, so the
// empty-state placeholder spells the formats out with one word written each accepted way; the
// numbered form in particular is otherwise undiscoverable.
const SEARCH_PLACEHOLDERS: Partial<Record<Language, string>> = {
    zh: '你好   ·   nǐ hǎo   ·   ni3 hao3', // middle-dot separators with triple-space gaps; input placeholders render whitespace verbatim
    es: 'hola, hello',
};
export const dictionarySearchPlaceholderFor = (language: Language): string =>
    SEARCH_PLACEHOLDERS[language] ?? `Search ${language.toUpperCase()} dictionary...`;

/**
 * Whether the accent keypad (PinyinKeypad) sits above the field. Zh learners type tone vowels
 * on the beginner keyboard's ā pad (写 · ā · ABC), so the inline keypad is Spanish-only
 * (á é í ó ú ñ ü ¿ ¡ — es has no beginner keyboard).
 */
export const showsInlineKeypad = (language: Language): boolean => language !== 'zh';

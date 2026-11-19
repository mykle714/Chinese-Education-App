import { applyYiBuSandhi } from "../../utils/toneSandhi";
import { syllableToNumberedPinyin } from "../../utils/textUtils";
import type { SegmentSpan } from "./documentSegmentation";

/**
 * READER FIND-IN-DOCUMENT — the pure matching half of the Reader's search bar
 * (ReaderSearchBar, driven by useReaderSearch). No React, no DOM.
 *
 * A match is a half-open range of CONTENT offsets (UTF-16 indices into `text.content`,
 * the same coordinates as the reading textarea's selection and the gsa spans), so the
 * page can hand a match straight to `selectRange` and both display modes can paint it.
 *
 * Two matchers, merged in pinyin mode:
 *   1. TEXT — the query as typed, found literally in the content. Case-insensitive for
 *      Latin letters (as a browser's find is); characters must match exactly.
 *   2. PINYIN (Pinyin display mode only, see `findPinyinMatches`) — the query read as
 *      pinyin against the reading SHOWN under each character (with 一/不 sandhi
 *      applied, exactly as ReaderCpcdView draws it). Tones are optional:
 *        hao    → hǎo, hào, háo …      (toneless letters match any tone)
 *        hǎo    → hǎo only              (a tone mark pins its syllable's tone)
 *        hao3   → hǎo only              (so does a trailing digit; 5 = neutral)
 *        nihao  → nǐ hǎo                (spaces and apostrophes are ignored)
 *      A pinyin match must START at a syllable's start (so "an" does not light up inside
 *      "huān"), but may end mid-syllable, so the highlight follows the learner as they
 *      type ("h" → "ha" → "hao"). It never crosses a non-Chinese character (punctuation,
 *      a space, a Latin word, a line break).
 *
 * Layer: feature util (src/features/reader). Depends on utils/toneSandhi.ts
 * (`applyYiBuSandhi`) and utils/textUtils.ts (`syllableToNumberedPinyin`).
 * Used by: useReaderSearch.ts. Tests: __tests__/readerSearch.test.ts.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Search".
 */

export interface ReaderSearchMatch {
    start: number;
    end: number;
}

const HAN_REGEX = /\p{Script=Han}/u;
// The non-syllable stand-in for the sandhi pass (same role as ReaderCpcdView's
// SANDHI_BREAK): a 一/不 before it is phrase-final.
const SANDHI_BREAK = "\uFFFC";

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Literal, case-insensitive, non-overlapping occurrences of `query` in `content`.
 * A RegExp (not `toLowerCase` + indexOf) so offsets stay exact even for the few
 * characters whose lowercase form has a different length.
 */
export function findTextMatches(content: string, query: string): ReaderSearchMatch[] {
    if (!query || !query.trim()) return [];
    const pattern = new RegExp(escapeRegExp(query), "giu");
    const matches: ReaderSearchMatch[] = [];
    for (const found of content.matchAll(pattern)) {
        const start = found.index ?? 0;
        matches.push({ start, end: start + found[0].length });
    }
    return matches;
}

/**
 * The reading shown under each character, indexed by CONTENT offset: `syllables[i]` is
 * the surface syllable of the Chinese character starting at offset `i`, or "" for every
 * other offset (non-Han characters, a surrogate pair's second half, a word whose
 * pronunciation is missing or does not split one syllable per character).
 *
 * Mirrors ReaderCpcdView → buildParagraphs: a word's pronunciation is zipped onto its
 * characters, then 一/不 sandhi runs once per newline-delimited paragraph with every
 * non-Han character as a break — so the searchable reading IS the drawn reading.
 */
export function buildDocumentSyllables(
    content: string,
    spans: SegmentSpan[],
    pronunciations: Map<string, string>,
): string[] {
    const syllables: string[] = new Array(content.length).fill("");
    for (const span of spans) {
        if (!HAN_REGEX.test(span.text)) continue;
        const reading = pronunciations.get(span.text);
        if (!reading) continue;
        const parts = reading.trim().split(/\s+/);
        const characters = [...span.text];
        // A reading that doesn't line up one-per-character would shift every syllable
        // after the gap onto the wrong character; leave the word unsearchable instead.
        if (parts.length !== characters.length) continue;
        let offset = span.start;
        characters.forEach((character, i) => {
            syllables[offset] = parts[i];
            offset += character.length;
        });
    }

    // 一/不 sandhi, one pass per paragraph (see the header).
    let paragraphStart = 0;
    const flushParagraph = (end: number) => {
        const chars: string[] = [];
        const readings: string[] = [];
        const offsets: number[] = [];
        for (let i = paragraphStart; i < end; i++) {
            const codePoint = content.codePointAt(i) ?? 0;
            const character = String.fromCodePoint(codePoint);
            chars.push(syllables[i] ? character : SANDHI_BREAK);
            readings.push(syllables[i]);
            offsets.push(i);
            if (character.length === 2) i++; // skip the surrogate pair's second half
        }
        const surface = applyYiBuSandhi(chars.join(""), readings);
        surface.forEach((syllable, k) => {
            if (syllable) syllables[offsets[k]] = syllable;
        });
    };
    for (let i = 0; i < content.length; i++) {
        if (content[i] === "\n") {
            flushParagraph(i);
            paragraphStart = i + 1;
        }
    }
    flushParagraph(content.length);
    return syllables;
}

// ── Pinyin matching ─────────────────────────────────────────────────────────────

// One letter of the document's toneless pinyin stream (see `buildLetterStream`).
interface StreamLetter {
    // Content offset + UTF-16 length of the character this letter's syllable belongs to.
    offset: number;
    length: number;
    // The syllable's tone, 1–4, or 0 for neutral.
    tone: number;
    // True for the first letter of its syllable.
    syllableStart: boolean;
}

// A tone constraint the query places on the syllable covering one of its letters.
interface ToneConstraint {
    letterIndex: number;
    tone: number;
    // A trailing digit also says the syllable ENDS after this letter ("ha3" ≠ hǎo).
    endsSyllable: boolean;
}

/** ü and v are one letter in pinyin input; fold both (and the CC-CEDICT `u:`) to `v`. */
function foldPinyinLetters(text: string): string {
    return text.toLowerCase().replace(/u:/g, "v").replace(/ü/g, "v");
}

/**
 * The document's readings as one lowercase toneless letter string, plus per-letter
 * bookkeeping. A `|` separates syllables that are not adjacent Chinese characters
 * (punctuation, spaces, Latin, line breaks between them), so no match crosses one.
 * `content` gives each character's UTF-16 length (2 for the CJK extension planes).
 */
function buildLetterStream(content: string, syllables: string[]): { letters: string; meta: Array<StreamLetter | null> } {
    let letters = "";
    const meta: Array<StreamLetter | null> = [];
    let previousEnd = -1;
    for (let offset = 0; offset < syllables.length; offset++) {
        const syllable = syllables[offset];
        if (!syllable) continue;
        const numbered = syllableToNumberedPinyin(syllable.trim());
        const parsed = numbered.match(/^([a-zA-ZüÜ:]+)([0-5])?$/);
        if (!parsed) continue;
        const base = foldPinyinLetters(parsed[1]);
        const tone = parsed[2] ? parseInt(parsed[2], 10) % 5 : 0;
        if (previousEnd !== -1 && previousEnd !== offset) {
            letters += "|";
            meta.push(null);
        }
        const length = String.fromCodePoint(content.codePointAt(offset) ?? 0).length;
        for (let k = 0; k < base.length; k++) {
            letters += base[k];
            meta.push({ offset, length, tone, syllableStart: k === 0 });
        }
        previousEnd = offset + length;
    }
    return { letters, meta };
}

/**
 * Parse a query as pinyin: its toneless letters plus the tone constraints its marks and
 * digits place. Null when the query is not pinyin (any character other than letters,
 * tone-marked vowels, tone digits, spaces and apostrophes).
 */
function parsePinyinQuery(query: string): { letters: string; constraints: ToneConstraint[] } | null {
    let letters = "";
    const constraints: ToneConstraint[] = [];
    for (const raw of foldPinyinLetters(query.replace(/u:/gi, "ü"))) {
        if (/\s|'|’/.test(raw)) continue;
        if (/[1-5]/.test(raw)) {
            // A digit tones the syllable that ends just before it.
            if (!letters) return null;
            constraints.push({ letterIndex: letters.length - 1, tone: parseInt(raw, 10) % 5, endsSyllable: true });
            continue;
        }
        if (/[a-z]/.test(raw)) {
            letters += raw;
            continue;
        }
        // A tone-marked vowel: its base letter, and its tone pinned.
        const numbered = syllableToNumberedPinyin(raw);
        const marked = numbered.match(/^([a-zü])([1-4])$/);
        if (!marked) return null;
        letters += foldPinyinLetters(marked[1]);
        constraints.push({ letterIndex: letters.length - 1, tone: parseInt(marked[2], 10), endsSyllable: false });
    }
    return letters ? { letters, constraints } : null;
}

/**
 * Pinyin occurrences of `query` in the document whose per-offset readings are
 * `syllables` (buildDocumentSyllables). See the file header for the rules.
 */
export function findPinyinMatches(content: string, syllables: string[], query: string): ReaderSearchMatch[] {
    const parsed = parsePinyinQuery(query);
    if (!parsed) return [];
    const { letters, meta } = buildLetterStream(content, syllables);
    const matches: ReaderSearchMatch[] = [];
    let from = 0;
    while (from <= letters.length - parsed.letters.length) {
        const at = letters.indexOf(parsed.letters, from);
        if (at === -1) break;
        const first = meta[at];
        const ok = !!first && first.syllableStart && parsed.constraints.every(({ letterIndex, tone, endsSyllable }) => {
            const letter = meta[at + letterIndex];
            if (!letter || letter.tone !== tone) return false;
            if (!endsSyllable) return true;
            const next = meta[at + letterIndex + 1];
            return !next || next.syllableStart;
        });
        if (!ok) {
            from = at + 1;
            continue;
        }
        const last = meta[at + parsed.letters.length - 1]!;
        matches.push({ start: first!.offset, end: last.offset + last.length });
        from = at + parsed.letters.length; // non-overlapping, like a browser's find
    }
    return matches;
}

/**
 * Every match for `query`: text matches, plus pinyin matches when `syllables` is given
 * (Pinyin display mode). Sorted by position; where a text and a pinyin match overlap,
 * the earlier one wins, so the count and the ˄/˅ order never visit one spot twice.
 */
export function findReaderMatches(content: string, query: string, syllables: string[] | null): ReaderSearchMatch[] {
    const text = findTextMatches(content, query);
    if (!syllables) return text;
    const all = [...text, ...findPinyinMatches(content, syllables, query)]
        .sort((a, b) => a.start - b.start || b.end - a.end);
    const merged: ReaderSearchMatch[] = [];
    for (const match of all) {
        const previous = merged[merged.length - 1];
        if (previous && match.start < previous.end) continue;
        merged.push(match);
    }
    return merged;
}

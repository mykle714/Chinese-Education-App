/**
 * READER SENTENCES — where a Reader document's sentences begin and end, for the sentence
 * highlight (the second-tier long-press / desktop double-click) and its Explain
 * (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain").
 *
 * Pure (no React, no DOM), unit-tested in src/__tests__/readerSentences.test.ts.
 * Callers: useTextSelection → `selectSentenceAtOffset`.
 *
 * The rules are the SENTENCE subset of the read-aloud clause rules
 * (readAloudClauses.ts → "Where a clause ends"): a clause also breaks on commas, colons and
 * semicolons, a sentence only on its end marks — so the two never disagree about where a
 * sentence stops, only about how finely it is cut.
 *
 * Layer: shared util (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4).
 */

/** [start, end) into the document string. */
export interface SentenceRange {
    start: number;
    end: number;
}

// Always end a sentence (full-width and ASCII forms). The ellipsis …… and the dash ——
// deliberately do not: in Chinese prose they trail off mid-sentence far more often than
// they end one.
const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "．", "｡"]);
// ASCII "." ends a sentence only before whitespace, a closer or the end of the text, so
// 3.5 and file.txt stay whole. (An abbreviation like "Mr. Li" still splits — accepted.)
const PERIOD = ".";
// Closing quotes/brackets travel with the sentence they close (他说：“好。”).
const CLOSERS = new Set(["”", "’", "」", "』", "）", ")", "】", "》", "〉", "\"", "'", "]"]);
const WHITESPACE = /\s/u;

function isSentenceEndAt(content: string, i: number): boolean {
    const ch = content[i];
    if (SENTENCE_END.has(ch)) return true;
    if (ch !== PERIOD) return false;
    const next = content[i + 1];
    return next === undefined || WHITESPACE.test(next) || CLOSERS.has(next);
}

/**
 * Every sentence of `content`, in order, each trimmed of surrounding whitespace (empty
 * ones dropped). A newline always ends a sentence — a title line or a list item with no
 * end mark is its own sentence. A run of end marks and closers stays with the sentence it
 * ends ("真的吗？！”" is one ending).
 */
export function splitSentences(content: string): SentenceRange[] {
    const ranges: SentenceRange[] = [];
    const push = (rawStart: number, rawEnd: number) => {
        let start = rawStart;
        let end = rawEnd;
        while (start < end && WHITESPACE.test(content[start])) start++;
        while (end > start && WHITESPACE.test(content[end - 1])) end--;
        if (end > start) ranges.push({ start, end });
    };

    let start = 0;
    let i = 0;
    while (i < content.length) {
        if (content[i] === "\n") {
            push(start, i);
            start = i + 1;
            i++;
            continue;
        }
        if (isSentenceEndAt(content, i)) {
            let j = i + 1;
            while (j < content.length && (SENTENCE_END.has(content[j]) || CLOSERS.has(content[j]))) j++;
            push(start, j);
            start = j;
            i = j;
            continue;
        }
        i++;
    }
    push(start, content.length);
    return ranges;
}

/**
 * The sentence containing the character at `offset`, or null when the offset falls between
 * sentences (whitespace, a blank line) or outside the text.
 */
export function sentenceRangeAt(content: string, offset: number): SentenceRange | null {
    if (offset < 0 || offset >= content.length) return null;
    return splitSentences(content).find((range) => offset >= range.start && offset < range.end) ?? null;
}

import type { SegmentSpan } from "./documentSegmentation";

/**
 * READ-ALOUD CLAUSES — splits a Reader document into the pieces the read-aloud speaks one
 * clip at a time, and works out WHEN inside each clip each word is heard.
 *
 * Pure (no React, no DOM), so it is unit-tested on its own
 * (src/__tests__/readAloudClauses.test.ts). Its one caller is useReaderReadAloud.
 *
 * Why one clip per clause rather than one per document: the page cannot follow a single
 * long clip accurately (the app has no word-timing data from the TTS engine), but it CAN
 * follow a sequence of short clips exactly — a clip only ends when its audio ends. So the
 * clause the audio is on is always known; only the word INSIDE the clause is estimated,
 * and that estimate resets at every clause boundary instead of drifting over the page.
 *
 * ENGLISH RUNS (zh documents only): a clause that mixes Chinese and English words is cut
 * further into VOICE RUNS, so the English words are read by the English voice instead of
 * the Chinese one with its accent ("我昨天买了 iPhone 15，" → "我昨天买了" · "iPhone 15，").
 * Each run is its own clip, so to the hook a run is just another clause, marked with
 * `voice: "english"`. See `classifySpanVoices` for which words count as English.
 *
 * Layer: feature util (src/features/reader). Depends on documentSegmentation's SegmentSpan.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Read aloud".
 */

export type ReadAloudVoice = "document" | "english";

export interface ReadAloudClause {
    /** [start, end) into the document string. */
    start: number;
    end: number;
    /** The text sent to TTS (whitespace collapsed and trimmed). A run of breaks stays with
     *  the clause before it, so "行\n\n。。" is one clause. */
    text: string;
    /**
     * Which voice reads the clip: "document" = the document's own language (the default);
     * "english" = an English voice, for a run of English words inside a Chinese document.
     */
    voice: ReadAloudVoice;
    /**
     * A SEAM: this clip and the one before (joinsPrevious) / after (joinsNext) are two voice
     * runs of ONE clause with no punctuation between them (我昨天买了 | iPhone). The player
     * trims the synthesized silence on that edge so the voice switch is not heard as a
     * pause (TTSRequest.trimSilence). Always false at a real clause break, and at a run
     * boundary that carries punctuation ("iPhone 15，" | 很好用), whose pause is meant.
     */
    joinsPrevious: boolean;
    joinsNext: boolean;
    /** The gsa word spans inside the clause, in order — what the highlight steps through. */
    spans: SegmentSpan[];
    /**
     * For each span, the fraction (0–1) of the clause's spoken length that has passed when
     * that word begins. spanStartFractions[0] is usually 0.
     */
    spanStartFractions: number[];
    /** Total spoken weight (≈ syllables) — the fallback pacing multiplies this by a rate. */
    totalWeight: number;
    /**
     * Space-separated pinyin hint for cloud TTS (one det pronunciation per Han-bearing
     * span), or undefined when any Han word lacks one — a partial hint would misalign every
     * syllable after the gap (same rule as utils/sentencePronunciation.ts).
     */
    pronunciation?: string;
}

// ── Where a clause ends ─────────────────────────────────────────────────────────────
// Always a break: sentence ends, commas, colons, semicolons (CJK full-width forms) and
// newlines. The enumeration comma 、, dashes —— and ellipses … deliberately do NOT break
// (owner's call 2026-11-17): a list like 苹果、香蕉、橘子 reads as one phrase, not three clips.
const ALWAYS_BREAK = new Set(["。", "！", "？", "，", "：", "；", "!", "?", ";", "\n", "．", "｡"]);
// ASCII . , : break only when followed by whitespace or the end, so 3.5, 1,000 and 10:30
// stay whole.
const BREAK_BEFORE_SPACE = new Set([".", ",", ":"]);
// Closing quotes/brackets that belong to the clause they close (他说：“好。”).
const CLOSERS = new Set(["”", "’", "」", "』", "）", ")", "】", "》", "〉", "\"", "'", "]"]);

/**
 * Clip-length cap, in characters. The server rejects TTS text over 200 characters
 * (TTSController.synthesize); a long clause without punctuation is cut at a word boundary
 * well under that, which also keeps the first clip's synth latency short.
 */
export const MAX_CLAUSE_CHARS = 120;

const HAN = /\p{Script=Han}/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const WHITESPACE = /\s/u;
const LATIN = /\p{Script=Latin}/u;
const ALL_DIGITS = /^\p{Nd}+$/u;
// A clip text that ends on a letter or digit (no trailing punctuation) — see `joinsNext`.
const WORD_END = /[\p{L}\p{N}]$/u;

/**
 * How much speaking time one character takes, in "syllable" units. A Han character is one
 * syllable; a Latin letter about a third of one; a digit is read as a syllable in Chinese;
 * punctuation stands for a short pause. Rough on purpose — it only distributes a clip's
 * KNOWN length across its words, so an error is bounded by one clause.
 */
function charWeight(ch: string): number {
    if (HAN.test(ch)) return 1;
    if (DIGIT.test(ch)) return 1;
    if (LETTER.test(ch)) return 1 / 3;
    if (WHITESPACE.test(ch)) return 0;
    return 0.5; // punctuation → a pause
}

function isBreakAt(content: string, i: number): boolean {
    const ch = content[i];
    if (ALWAYS_BREAK.has(ch)) return true;
    if (BREAK_BEFORE_SPACE.has(ch)) {
        const next = content[i + 1];
        return next === undefined || WHITESPACE.test(next) || CLOSERS.has(next);
    }
    return false;
}

/** Raw [start, end) clause ranges from `from` to the end of the document. */
function clauseRanges(content: string, from: number): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let clauseStart = from;
    let i = from;
    while (i < content.length) {
        if (isBreakAt(content, i)) {
            let end = i + 1;
            // Swallow a run of breaks and closers: "？！", "。”", ".\n".
            while (end < content.length && (isBreakAt(content, end) || CLOSERS.has(content[end]))) end++;
            ranges.push([clauseStart, end]);
            clauseStart = end;
            i = end;
        } else {
            i++;
        }
    }
    if (clauseStart < content.length) ranges.push([clauseStart, content.length]);
    return ranges;
}

/** Cut an over-long clause at span boundaries so no piece exceeds MAX_CLAUSE_CHARS. */
function splitLongRange(start: number, end: number, spans: SegmentSpan[]): Array<[number, number]> {
    if (end - start <= MAX_CLAUSE_CHARS) return [[start, end]];
    const pieces: Array<[number, number]> = [];
    let pieceStart = start;
    for (const span of spans) {
        // This word would push the piece past the cap: end the piece just before it.
        if (span.end - pieceStart > MAX_CLAUSE_CHARS && span.start > pieceStart) {
            pieces.push([pieceStart, span.start]);
            pieceStart = span.start;
        }
    }
    pieces.push([pieceStart, end]);
    return pieces;
}

function buildPronunciation(spans: SegmentSpan[], pronunciations: Map<string, string>): string | undefined {
    const parts: string[] = [];
    for (const span of spans) {
        if (!HAN.test(span.text)) continue;
        const p = pronunciations.get(span.text);
        if (!p) return undefined;
        parts.push(p);
    }
    return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildClause(
    content: string,
    start: number,
    end: number,
    spans: SegmentSpan[],
    pronunciations: Map<string, string> | null,
    voice: ReadAloudVoice,
): ReadAloudClause | null {
    if (spans.length === 0) return null; // punctuation / blank line only — nothing to say
    let totalWeight = 0;
    const weightBefore: number[] = []; // cumulative weight at each offset (relative to start)
    for (let i = start; i < end; i++) {
        weightBefore.push(totalWeight);
        totalWeight += charWeight(content[i]);
    }
    const spanStartFractions = spans.map((span) =>
        totalWeight > 0 ? weightBefore[span.start - start] / totalWeight : 0,
    );
    return {
        start,
        end,
        voice,
        // Set by buildReadAloudClauses once the clause's neighbours are known.
        joinsPrevious: false,
        joinsNext: false,
        // Whitespace runs (a swallowed "\n\n") collapse to one space for TTS.
        text: content.slice(start, end).replace(/\s+/gu, " ").trim(),
        spans,
        spanStartFractions,
        totalWeight,
        // An English run has no Han words, so it never gets a pinyin hint.
        pronunciation: pronunciations && voice === "document" ? buildPronunciation(spans, pronunciations) : undefined,
    };
}

/**
 * Latin words this short that touch a Han character with no space between (T恤, A股,
 * 卡拉OK, B超, X光) are letters inside a Chinese word, so the Chinese voice keeps them.
 * Longer glued words (我用iPhone拍照) are still English.
 */
const GLUED_LETTERS_MAX = 2;

/**
 * Which voice reads each word of a zh document. Segmentation never mixes scripts in one
 * span (documentSegmentation → computeSegmentSpans: Han runs go to gsa, everything else
 * splits on letters/digits), so each span is classified on its own:
 *  - Latin letters → "english" ("iPhone", "email"), except a short one glued to a Han
 *    character (GLUED_LETTERS_MAX);
 *  - a bare number → "english" only straight after an English word ("iPhone 15"), so
 *    3个 and 2024年 are still read in Chinese;
 *  - anything else (Han) → "document".
 */
function classifySpanVoices(content: string, spans: SegmentSpan[]): ReadAloudVoice[] {
    const voices: ReadAloudVoice[] = [];
    spans.forEach((span, i) => {
        if (LATIN.test(span.text)) {
            const glued = HAN.test(content[span.start - 1] ?? "") || HAN.test(content[span.end] ?? "");
            voices.push(glued && span.text.length <= GLUED_LETTERS_MAX ? "document" : "english");
        } else if (ALL_DIGITS.test(span.text) && i > 0 && voices[i - 1] === "english") {
            voices.push("english");
        } else {
            voices.push("document");
        }
    });
    return voices;
}

/**
 * Cut one clause range into voice runs (consecutive words read by the same voice). A run
 * ends where the next run's first word begins, so the punctuation and spaces between two
 * runs stay with the run before ("iPhone 15，" keeps its comma and the pause it implies).
 */
function splitVoiceRuns(
    content: string,
    start: number,
    end: number,
    spans: SegmentSpan[],
): Array<{ start: number; end: number; spans: SegmentSpan[]; voice: ReadAloudVoice }> {
    if (spans.length === 0) return [{ start, end, spans, voice: "document" }];
    const voices = classifySpanVoices(content, spans);
    const runs: Array<{ start: number; end: number; spans: SegmentSpan[]; voice: ReadAloudVoice }> = [];
    let runStart = start;
    let runFirstSpan = 0;
    for (let i = 1; i <= spans.length; i++) {
        if (i < spans.length && voices[i] === voices[runFirstSpan]) continue;
        const runEnd = i < spans.length ? spans[i].start : end;
        runs.push({ start: runStart, end: runEnd, spans: spans.slice(runFirstSpan, i), voice: voices[runFirstSpan] });
        runStart = runEnd;
        runFirstSpan = i;
    }
    return runs;
}

/**
 * Every clause from `fromPos` to the end of the document, skipping clauses with no words.
 * Reading starts AT `fromPos` (the caret's word), not at the start of its clause.
 *
 * `pronunciations` is the Pinyin display mode's word → pinyin map; pass null for a
 * language without a pinyin hint (anything but zh).
 *
 * `splitEnglishRuns` turns on the English voice runs (see the file doc). Pass true only for
 * a zh document: in a Latin-script language every word would count as "English".
 */
export function buildReadAloudClauses(
    content: string,
    spans: SegmentSpan[],
    fromPos: number,
    pronunciations: Map<string, string> | null,
    splitEnglishRuns = false,
): ReadAloudClause[] {
    const clauses: ReadAloudClause[] = [];
    // Spans are sorted; walk them alongside the clause ranges.
    let spanIdx = 0;
    while (spanIdx < spans.length && spans[spanIdx].end <= fromPos) spanIdx++;
    // Begin at the caret's word itself when the caret sits inside one.
    const begin = spanIdx < spans.length ? Math.min(fromPos, spans[spanIdx].start) : fromPos;

    for (const [rangeStart, rangeEnd] of clauseRanges(content, begin)) {
        const rangeSpans: SegmentSpan[] = [];
        while (spanIdx < spans.length && spans[spanIdx].start < rangeEnd) {
            if (spans[spanIdx].start >= rangeStart) rangeSpans.push(spans[spanIdx]);
            spanIdx++;
        }
        for (const [start, end] of splitLongRange(rangeStart, rangeEnd, rangeSpans)) {
            const pieceSpans = rangeSpans.filter((s) => s.start >= start && s.end <= end);
            const runs = splitEnglishRuns
                ? splitVoiceRuns(content, start, end, pieceSpans)
                : [{ start, end, spans: pieceSpans, voice: "document" as const }];
            let previousRun: ReadAloudClause | null = null;
            for (const run of runs) {
                const clause = buildClause(content, run.start, run.end, run.spans, pronunciations, run.voice);
                if (!clause) continue;
                // A seam: the previous run of this same piece ends on a word, not punctuation.
                if (previousRun && WORD_END.test(previousRun.text)) {
                    previousRun.joinsNext = true;
                    clause.joinsPrevious = true;
                }
                clauses.push(clause);
                previousRun = clause;
            }
        }
    }
    return clauses;
}

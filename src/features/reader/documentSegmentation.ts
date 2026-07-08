/**
 * Document segmentation for the Reader's word-by-word tap navigation.
 *
 * CLIENT-SIDE PORT of the greedy segmentation algorithm (gsa). The canonical
 * implementation lives in `server/dal/shared/segmentString.ts` (segmentWithDict,
 * buildDictMap, buildExcludeSet) where it powers example-sentence enrichment.
 * If you change the scoring/tie-break rules THERE, mirror them HERE (and vice
 * versa) so reader tap-words stay aligned with est segments.
 *
 * Intentional divergences from the server gsa (do not "fix" during a sync):
 *   - No `prioritySegments` pass — that exists to force an est's headword into
 *     its own sentence; a reader document has no headword.
 *   - No `classifierTokens` pass — classifier boundaries come from the
 *     example-sentence tagging pass (partOfSpeechDict), which documents lack.
 *
 * Data flow: useVocabularyProcessing already fetches det rows for every
 * 1–4-char substring of the document (POST /api/vocabEntries/by-tokens →
 * DICTIONARY_COLUMNS includes vernacularScore + matchException), so the gsa
 * runs entirely on data the reader has in memory — no extra requests.
 *
 * Docs: docs/READER_SEGMENTATION.md (feature doc, depends on this file);
 *       docs/USER_DOCUMENT_FEATURE_SUMMARY.md (parent reader doc).
 */

import type { DictionaryEntry, VocabEntry } from "../../types";
import { scrollSelectionIntoView } from "./textSelectionUtils";

/**
 * One tappable word in the document. `start`/`end` are UTF-16 code-unit offsets
 * into the raw document string — exactly what textarea.setSelectionRange takes.
 * Spans are non-overlapping and sorted by `start`; whitespace and punctuation
 * produce no span (they are skipped by navigation).
 */
export interface SegmentSpan {
    start: number;
    end: number;
    text: string;
}

/** The single piece of per-word data the gsa scoring reads. */
interface ReaderSegmentMeta {
    vernacularScore: number | null;
}

/**
 * Build the word1 → meta lookup the gsa scores against.
 * Port of server buildDictMap slimmed to segmentation's needs (vernacularScore);
 * first det entry per word1 wins, matching the server's behavior.
 *
 * Personal vocab entryKeys are merged in afterwards (score 0) so user-created
 * words are segmentable/tappable even if absent from det. Personal cards are
 * normally a subset of det, so this rarely changes segmentation.
 */
export function buildReaderDictMap(
    dictCards: DictionaryEntry[],
    personalCards: VocabEntry[]
): Map<string, ReaderSegmentMeta> {
    const map = new Map<string, ReaderSegmentMeta>();

    for (const entry of dictCards) {
        if (!map.has(entry.word1)) {
            map.set(entry.word1, { vernacularScore: entry.vernacularScore ?? null });
        }
    }

    for (const card of personalCards) {
        if (card.entryKey && !map.has(card.entryKey)) {
            map.set(card.entryKey, { vernacularScore: null });
        }
    }

    return map;
}

/**
 * Collect matchException tokens from det entries into one exclusion set.
 * Port of server buildExcludeSet (segmentString.ts). Multi-char tokens listed
 * here are never matched by the gsa; single chars are never excluded (they are
 * the last-resort fallback).
 */
export function buildExcludeSet(dictCards: DictionaryEntry[]): Set<string> {
    const excluded = new Set<string>();
    for (const entry of dictCards) {
        if (Array.isArray(entry.matchException)) {
            for (const token of entry.matchException) {
                excluded.add(token);
            }
        }
    }
    return excluded;
}

/**
 * Best-score segmentation of a Han run using the pre-built dictionary map.
 * Port of server segmentWithDict's core (see file header for the omitted
 * passes): tries substring lengths 4→1; within a length tier every matching
 * substring is scored by vernacularScore (null = 0) and the best one wins,
 * tiebreaking on later position (higher startIdx). The winner is extracted and
 * the left/right remainders recurse. Falls back to single characters when
 * nothing matches at any length.
 */
export function segmentWithDict(
    str: string,
    dictMap: Map<string, ReaderSegmentMeta>,
    excludeTokens?: Set<string>
): string[] {
    if (!str) return [];

    const chars = [...str];

    for (let length = Math.min(4, chars.length); length >= 1; length--) {
        let bestIdx = -1;
        let bestScore = -Infinity;

        for (let startIdx = 0; startIdx <= chars.length - length; startIdx++) {
            const substring = chars.slice(startIdx, startIdx + length).join("");
            if (!dictMap.has(substring)) continue;
            // Multi-char matchException tokens are suppressed; single chars never are
            if (length > 1 && excludeTokens?.has(substring)) continue;

            const score = dictMap.get(substring)!.vernacularScore ?? 0;
            if (score > bestScore || (score === bestScore && startIdx > bestIdx)) {
                bestScore = score;
                bestIdx = startIdx;
            }
        }

        if (bestIdx !== -1) {
            const winner = chars.slice(bestIdx, bestIdx + length).join("");
            const left = chars.slice(0, bestIdx).join("");
            const right = chars.slice(bestIdx + length).join("");
            return [
                ...segmentWithDict(left, dictMap, excludeTokens),
                winner,
                ...segmentWithDict(right, dictMap, excludeTokens),
            ];
        }
    }

    // No dictionary match at any length — per-character fallback
    return chars;
}

// A maximal run of Han ideographs. Unlike the server's FOREIGN_RUN_REGEX
// (which pulls CJK punctuation into the run for cpcd rendering), navigation
// wants punctuation OUT of spans, so only true Han characters enter the gsa;
// everything else goes through the Intl.Segmenter word pass below.
const HAN_RUN_REGEX = /\p{Script=Han}+/gu;

// Lazily-constructed word segmenter for non-Han stretches. Locale is
// intentionally unspecified: ICU picks word breaks from script detection, so
// Latin (es/en), Vietnamese, and kana/hangul stretches all segment correctly.
// IMPORTANT: this is applied to a WHOLE run at once — never pairwise. The old
// isWordBoundary(char, nextChar) fed the segmenter 2 chars at a time, which
// breaks on non-local boundaries (the bug this module replaces).
let wordSegmenter: Intl.Segmenter | null | undefined;
function getWordSegmenter(): Intl.Segmenter | null {
    if (wordSegmenter !== undefined) return wordSegmenter;
    try {
        wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    } catch {
        wordSegmenter = null; // ancient engine — regex fallback below
    }
    return wordSegmenter;
}

/**
 * Emit word spans for a non-Han stretch of the document, offset by `base`.
 * Uses one whole-run Intl.Segmenter pass keeping only isWordLike segments;
 * falls back to letter/number-run regex when Segmenter is unavailable.
 */
function pushNonHanSpans(stretch: string, base: number, out: SegmentSpan[]): void {
    if (!stretch) return;

    const segmenter = getWordSegmenter();
    if (segmenter) {
        for (const seg of segmenter.segment(stretch)) {
            if (!seg.isWordLike) continue; // skip whitespace/punctuation
            out.push({
                start: base + seg.index,
                end: base + seg.index + seg.segment.length,
                text: seg.segment,
            });
        }
        return;
    }

    // Fallback: maximal letter/number runs are words
    for (const match of stretch.matchAll(/[\p{L}\p{N}]+/gu)) {
        const idx = match.index ?? 0;
        out.push({ start: base + idx, end: base + idx + match[0].length, text: match[0] });
    }
}

/**
 * Segment a whole document into ordered, non-overlapping word spans.
 *   - Han runs → gsa (segmentWithDict) against the reader dict map.
 *   - Everything else → whole-run Intl.Segmenter word pass.
 * Before the det fetch resolves, dictMap is empty and Han runs degrade to
 * per-character spans; the ReaderPage memo recomputes once entries arrive.
 */
export function computeSegmentSpans(
    text: string,
    dictMap: Map<string, ReaderSegmentMeta>,
    excludeTokens?: Set<string>
): SegmentSpan[] {
    const spans: SegmentSpan[] = [];
    if (!text) return spans;

    let lastIndex = 0;
    for (const match of text.matchAll(HAN_RUN_REGEX)) {
        const runStart = match.index ?? 0;

        // Non-Han stretch before this run
        pushNonHanSpans(text.slice(lastIndex, runStart), lastIndex, spans);

        // gsa the Han run, mapping each segment back to absolute offsets.
        // Han chars are BMP so segment.length is safe as a UTF-16 offset delta.
        let offset = runStart;
        for (const segment of segmentWithDict(match[0], dictMap, excludeTokens)) {
            spans.push({ start: offset, end: offset + segment.length, text: segment });
            offset += segment.length;
        }

        lastIndex = runStart + match[0].length;
    }

    // Trailing non-Han stretch
    pushNonHanSpans(text.slice(lastIndex), lastIndex, spans);

    return spans;
}

// ---------------------------------------------------------------------------
// Span navigation (consumed by TextArea arrow keys / ReaderTapOverlay taps and
// useTextSelection's auto word select)
// ---------------------------------------------------------------------------

/** Binary search: index of the first span with start >= pos (spans.length if none). */
function firstSpanIndexAtOrAfter(spans: SegmentSpan[], pos: number): number {
    let lo = 0;
    let hi = spans.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (spans[mid].start >= pos) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

/** The span containing pos (start <= pos < end), or null. */
export function spanContaining(spans: SegmentSpan[], pos: number): SegmentSpan | null {
    const idx = firstSpanIndexAtOrAfter(spans, pos);
    // Candidate is the span just before the insertion point (its start <= pos)
    if (idx > 0 && spans[idx - 1].end > pos) return spans[idx - 1];
    // Exact-start hit: spans[idx].start === pos
    if (idx < spans.length && spans[idx].start === pos) return spans[idx];
    return null;
}

/** The first span starting at or after pos, or null. */
export function spanAfter(spans: SegmentSpan[], pos: number): SegmentSpan | null {
    const idx = firstSpanIndexAtOrAfter(spans, pos);
    return idx < spans.length ? spans[idx] : null;
}

/** The last span ending at or before pos, or null. */
export function spanBefore(spans: SegmentSpan[], pos: number): SegmentSpan | null {
    // Walk back from the insertion point until a span ends at/before pos.
    // Spans are non-overlapping, so at most one step is ever needed.
    for (let idx = firstSpanIndexAtOrAfter(spans, pos) - 1; idx >= 0; idx--) {
        if (spans[idx].end <= pos) return spans[idx];
    }
    return null;
}

/**
 * Unified forward/back word navigation for the reader textarea. Replaces the
 * legacy selectNextWord/selectPreviousWord/moveCursor* quartet.
 *
 *   next: a collapsed caret inside a word selects THAT word (better than the
 *         legacy caret-to-word-end partial selection); otherwise the first
 *         span after the selection end is selected.
 *   prev: the last span ending at or before the selection start (a collapsed
 *         caret inside a word steps to the previous word, matching legacy).
 *
 * No-ops at the document edges (nothing to select). Scrolls the selection
 * into view, mirroring the legacy helpers.
 */
export function selectRelativeSpan(
    textarea: HTMLTextAreaElement,
    spans: SegmentSpan[],
    direction: "next" | "prev"
): void {
    if (spans.length === 0) return;

    const { selectionStart, selectionEnd } = textarea;
    let target: SegmentSpan | null;

    if (direction === "next") {
        const collapsed = selectionStart === selectionEnd;
        const containing = collapsed ? spanContaining(spans, selectionStart) : null;
        // A caret sitting exactly on a word's start "contains" it but should
        // still be treated as at-rest on that word, not skip past it.
        target = containing ?? spanAfter(spans, selectionEnd);
    } else {
        target = spanBefore(spans, selectionStart);
    }

    if (!target) return;

    textarea.setSelectionRange(target.start, target.end);
    scrollSelectionIntoView(textarea);
}

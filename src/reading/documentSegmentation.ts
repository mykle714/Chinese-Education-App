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
 *   - TIEBREAK ALTERNATIVES (client-only output, scoring unchanged): when a length
 *     tier's winner beat an OVERLAPPING same-length word on frequencyScore, the
 *     losers are recorded on the winning span (`SegmentSpan.alternatives`) so the
 *     Pinyin view can offer them (docs/READER_SEGMENTATION.md § "Tiebreak
 *     alternatives"). The server's est segments have no use for them.
 *   - FORCED SPANS (`computeSegmentSpans` → `forcedSpans`): the learner's switches
 *     to an alternative are placed first and the rest of the run re-segments around
 *     them — the same idea as the server's `prioritySegments`, driven by the learner
 *     instead of an est headword.
 *
 * Data flow: useVocabularyProcessing already fetches det rows for every
 * 1–4-char substring of the document (POST /api/vocabEntries/byTokens →
 * DICTIONARY_COLUMNS includes frequencyScore + matchException), so the gsa
 * runs entirely on data the reader has in memory — no extra requests.
 *
 * Docs: docs/READER_SEGMENTATION.md (feature doc, depends on this file);
 *       docs/USER_DOCUMENT_FEATURE_SUMMARY.md (parent reader doc).
 */

import type { DictionaryEntry, VocabEntry } from "../types";
import { scrollSelectionIntoView } from "./textSelectionUtils";

/**
 * One tappable word in the document. `start`/`end` are UTF-16 code-unit offsets
 * into the raw document string — exactly what textarea.setSelectionRange takes.
 * Spans are non-overlapping and sorted by `start`; whitespace and punctuation
 * produce no span (they are skipped by navigation).
 */
export interface SpanRange {
    start: number;
    end: number;
    text: string;
}

/**
 * A gsa word plus, when it won its length tier on a frequencyScore tiebreak, the
 * same-length words it beat that OVERLAP it (`alternatives`: at most one on each
 * side — the best-scoring loser per side, so a chain AB|BC|CD yields AB and CD
 * around a BC winner). A forced span (the learner switched to it) carries the
 * original winner(s) it displaced instead, so the switch can be undone.
 * Absent on spans that faced no overlapping competitor.
 */
export interface SegmentSpan extends SpanRange {
    alternatives?: SpanRange[];
}

/** The single piece of per-word data the gsa scoring reads. */
interface ReaderSegmentMeta {
    frequencyScore: number | null;
}

/**
 * Build the word1 → meta lookup the gsa scores against.
 * Port of server buildDictMap slimmed to segmentation's needs (frequencyScore);
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
            map.set(entry.word1, { frequencyScore: entry.frequencyScore ?? null });
        }
    }

    for (const card of personalCards) {
        if (card.entryKey && !map.has(card.entryKey)) {
            map.set(card.entryKey, { frequencyScore: null });
        }
    }

    return map;
}

/**
 * Build the word → pronunciation lookup the Pinyin display mode reads
 * (ReaderCpcdView). Same entry-picking rule as the keycap's card lookup
 * (textSelection.ts → findDictionaryMatch): the FIRST det row whose word1 — or,
 * failing that, word2 — matches, so the pinyin under a word always agrees with the
 * entry the keycap shows when that word is selected. Personal cards fill gaps only
 * (a user-created word with no det row).
 */
export function buildReaderPronunciationMap(
    dictCards: DictionaryEntry[],
    personalCards: VocabEntry[]
): Map<string, string> {
    const map = new Map<string, string>();
    // word1 first, as its own pass, so a word2 alias can never shadow a headword.
    for (const entry of dictCards) {
        if (entry.pronunciation && !map.has(entry.word1)) map.set(entry.word1, entry.pronunciation);
    }
    for (const entry of dictCards) {
        if (entry.pronunciation && entry.word2 && !map.has(entry.word2)) map.set(entry.word2, entry.pronunciation);
    }
    for (const card of personalCards) {
        if (card.pronunciation && card.entryKey && !map.has(card.entryKey)) map.set(card.entryKey, card.pronunciation);
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
 * One gsa piece of a Han run, in CHARACTER indices relative to the run (Han chars
 * are BMP, so a character index is also a UTF-16 offset delta). `alternatives`
 * are the overlapping same-length losers of the tier this piece won.
 */
interface RunPiece {
    start: number;
    length: number;
    alternatives?: Array<{ start: number; length: number }>;
}

/**
 * The gsa core over `chars[from, to)`, appending pieces to `out` in order.
 * Tries substring lengths 4→1; within a length tier every matching substring is
 * scored by frequencyScore (null = 0) and the best one wins, tiebreaking on later
 * position (higher startIdx). The winner is extracted and the left/right
 * remainders recurse. Falls back to single characters when nothing matches.
 *
 * Tiebreak alternatives: a same-tier candidate that OVERLAPS the winner is a real
 * loser — it can no longer be a word once the winner is extracted. (A candidate
 * that does not overlap is not a loser: the remainder recursion still finds it.)
 * The best-scoring overlapping loser on each side of the winner is recorded,
 * using the same score-then-later-position rule as the winner.
 */
function segmentRange(
    chars: string[],
    from: number,
    to: number,
    dictMap: Map<string, ReaderSegmentMeta>,
    excludeTokens: Set<string> | undefined,
    out: RunPiece[]
): void {
    if (from >= to) return;

    for (let length = Math.min(4, to - from); length >= 1; length--) {
        const candidates: Array<{ start: number; score: number }> = [];

        for (let startIdx = from; startIdx <= to - length; startIdx++) {
            const substring = chars.slice(startIdx, startIdx + length).join("");
            if (!dictMap.has(substring)) continue;
            // Multi-char matchException tokens are suppressed; single chars never are
            if (length > 1 && excludeTokens?.has(substring)) continue;
            candidates.push({ start: startIdx, score: dictMap.get(substring)!.frequencyScore ?? 0 });
        }
        if (candidates.length === 0) continue;

        // Higher score wins; equal scores go to the later position.
        const beats = (a: { start: number; score: number }, b: { start: number; score: number } | null) =>
            !b || a.score > b.score || (a.score === b.score && a.start > b.start);

        let winner: { start: number; score: number } | null = null;
        for (const candidate of candidates) if (beats(candidate, winner)) winner = candidate;
        const best = winner!;

        // Overlapping losers, best one per side of the winner.
        let leftLoser: { start: number; score: number } | null = null;
        let rightLoser: { start: number; score: number } | null = null;
        for (const candidate of candidates) {
            if (candidate.start === best.start || Math.abs(candidate.start - best.start) >= length) continue;
            if (candidate.start < best.start) {
                if (beats(candidate, leftLoser)) leftLoser = candidate;
            } else if (beats(candidate, rightLoser)) {
                rightLoser = candidate;
            }
        }
        // Single characters never compete for a boundary (length-1 candidates can't overlap).
        const alternatives = [leftLoser, rightLoser]
            .filter((loser): loser is { start: number; score: number } => loser !== null)
            .map((loser) => ({ start: loser.start, length }));

        segmentRange(chars, from, best.start, dictMap, excludeTokens, out);
        out.push({ start: best.start, length, ...(alternatives.length > 0 && { alternatives }) });
        segmentRange(chars, best.start + length, to, dictMap, excludeTokens, out);
        return;
    }

    // No dictionary match at any length — per-character fallback
    for (let i = from; i < to; i++) out.push({ start: i, length: 1 });
}

/**
 * Best-score segmentation of a Han run using the pre-built dictionary map.
 * Port of server segmentWithDict's core (see file header for the omitted
 * passes); the algorithm itself is `segmentRange` above. Returns the words only —
 * `computeSegmentSpans` reads the pieces directly for their tiebreak alternatives.
 */
export function segmentWithDict(
    str: string,
    dictMap: Map<string, ReaderSegmentMeta>,
    excludeTokens?: Set<string>
): string[] {
    if (!str) return [];
    const chars = [...str];
    const pieces: RunPiece[] = [];
    segmentRange(chars, 0, chars.length, dictMap, excludeTokens, pieces);
    return pieces.map((piece) => chars.slice(piece.start, piece.start + piece.length).join(""));
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
 *   - Han runs → gsa (segmentRange) against the reader dict map.
 *   - Everything else → whole-run Intl.Segmenter word pass.
 * Before the det fetch resolves, dictMap is empty and Han runs degrade to
 * per-character spans; the ReaderPage memo recomputes once entries arrive.
 *
 * `forcedSpans` — the learner's switches to a tiebreak alternative (ReaderDocumentPage
 * → `segmentOverrides`). Each one lying wholly inside a Han run is emitted as its own
 * span and the run re-segments around it; one that doesn't fit (stale after an edit,
 * or overlapping an earlier forced span) is ignored. A forced span's `alternatives`
 * are the unforced winner(s) whose alternative it was, so the switch can be undone.
 */
export function computeSegmentSpans(
    text: string,
    dictMap: Map<string, ReaderSegmentMeta>,
    excludeTokens?: Set<string>,
    forcedSpans: SpanRange[] = []
): SegmentSpan[] {
    const spans = segmentDocument(text, dictMap, excludeTokens, forcedSpans);
    if (forcedSpans.length === 0) return spans;

    // Switch-back: point each forced span at the unforced winner(s) that listed it.
    const baseSpans = segmentDocument(text, dictMap, excludeTokens, []);
    return spans.map((span) => {
        if (!forcedSpans.some((f) => f.start === span.start && f.end === span.end)) return span;
        const displaced = baseSpans
            .filter((base) => base.alternatives?.some((alt) => alt.start === span.start && alt.end === span.end))
            .map(({ start, end, text: baseText }) => ({ start, end, text: baseText }));
        return displaced.length > 0 ? { ...span, alternatives: displaced } : span;
    });
}

/** `computeSegmentSpans` without the switch-back pass. */
function segmentDocument(
    text: string,
    dictMap: Map<string, ReaderSegmentMeta>,
    excludeTokens: Set<string> | undefined,
    forcedSpans: SpanRange[]
): SegmentSpan[] {
    const spans: SegmentSpan[] = [];
    if (!text) return spans;

    const forcedSorted = [...forcedSpans].sort((a, b) => a.start - b.start);

    let lastIndex = 0;
    for (const match of text.matchAll(HAN_RUN_REGEX)) {
        const runStart = match.index ?? 0;
        const run = match[0];
        const chars = [...run];

        // Non-Han stretch before this run
        pushNonHanSpans(text.slice(lastIndex, runStart), lastIndex, spans);

        // The forced spans inside this run (run-relative), non-overlapping, in order.
        const forcedHere: Array<{ start: number; length: number }> = [];
        for (const forced of forcedSorted) {
            const start = forced.start - runStart;
            const length = forced.end - forced.start;
            if (start < 0 || start + length > chars.length) continue;
            if (run.slice(start, start + length) !== forced.text) continue; // stale
            const previous = forcedHere[forcedHere.length - 1];
            if (previous && start < previous.start + previous.length) continue;
            forcedHere.push({ start, length });
        }

        // gsa between the forced spans, then map pieces back to absolute offsets.
        const pieces: RunPiece[] = [];
        let cursor = 0;
        for (const forced of forcedHere) {
            segmentRange(chars, cursor, forced.start, dictMap, excludeTokens, pieces);
            pieces.push({ start: forced.start, length: forced.length });
            cursor = forced.start + forced.length;
        }
        segmentRange(chars, cursor, chars.length, dictMap, excludeTokens, pieces);

        const toSpan = (start: number, length: number): SpanRange => ({
            start: runStart + start,
            end: runStart + start + length,
            text: chars.slice(start, start + length).join(""),
        });
        for (const piece of pieces) {
            const span: SegmentSpan = toSpan(piece.start, piece.length);
            if (piece.alternatives) span.alternatives = piece.alternatives.map((alt) => toSpan(alt.start, alt.length));
            spans.push(span);
        }

        lastIndex = runStart + run.length;
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

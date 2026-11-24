/**
 * READER DRILL — a tap INSIDE the Reader's current selection narrows it to the piece under
 * the finger (docs/READER_SEGMENTATION.md § "Phrase stepping" → "Tap inside the selection").
 *
 *   太多的   ← a phrase (Phrase pill on)
 *   多       ← tap 多: the gsa word under the finger
 *   (stays)  ← tap 多 again: a single character is the floor — the tap does nothing
 *
 * Each tap picks the WIDEST of these that is strictly narrower than the selection, lies
 * inside it and covers the tapped character (the est's tap-to-drill rule — longest rung
 * first, src/utils/segmentDrill.ts — so 中华人民共和国 → 人民 → 民):
 *   1. the step unit (phrase or word, whichever the pill steps by) containing the tap;
 *   2. the gsa word containing it;
 *   3. the longest dictionary headword inside the selection containing it (leftmost on a tie);
 *   4. the tapped character.
 * Unlike the est, the chain does NOT end in a cancel (owner's call 2026-11-23: "another
 * tap on char does nothing"): the Reader always has a selection to read from.
 * Forward / back taps after a drill step by the pill's unit as usual (spanAfter /
 * spanBefore from the drilled range), so they land on the next phrase, not inside the old one.
 *
 * Layer: pure client util (src/reading). Depended on by useReadingText.ts.
 * Tests: src/__tests__/phraseChunking.test.ts (§ drillAt).
 */
import type { SpanRange } from "./documentSegmentation";

/** What a tap inside the selection does. */
export type DrillResult =
    /** The tap was not inside the selection: let the zone step run. */
    | { kind: "outside" }
    /** Inside, but nothing narrower (a single character): swallow the tap, change nothing. */
    | { kind: "floor" }
    /** Inside: select this narrower range. */
    | { kind: "narrow"; start: number; end: number };

interface DrillInput {
    content: string;
    selection: { start: number; end: number };
    /** The character offset under the finger. */
    offset: number;
    /** The step units (phrases with the pill on, else the gsa words). */
    stepSpans: SpanRange[];
    /** The gsa words. */
    wordSpans: SpanRange[];
    /** Whether a string is a headword the keycap can answer for (det / personal vocab). */
    isHeadword: (text: string) => boolean;
}

// Matches the gsa's longest headword (documentSegmentation.ts → segmentWithDict tiers).
const MAX_HEADWORD_CHARS = 4;

/** The character [start, end) at `offset` (a surrogate pair counts as one character). */
function characterAt(content: string, offset: number): { start: number; end: number } {
    const code = content.charCodeAt(offset);
    if (code >= 0xdc00 && code <= 0xdfff && offset > 0) return { start: offset - 1, end: offset + 1 };
    if (code >= 0xd800 && code <= 0xdbff) return { start: offset, end: offset + 2 };
    return { start: offset, end: offset + 1 };
}

export function drillAt({ content, selection, offset, stepSpans, wordSpans, isHeadword }: DrillInput): DrillResult {
    const { start, end } = selection;
    if (end <= start || offset < start || offset >= end) return { kind: "outside" };
    const width = end - start;
    // A candidate qualifies when it is inside the selection, strictly narrower, and covers the tap.
    const fits = (s: number, e: number) => s >= start && e <= end && e - s < width && s <= offset && offset < e;
    const containing = (spans: SpanRange[]) => spans.find((span) => span.start <= offset && offset < span.end);

    for (const span of [containing(stepSpans), containing(wordSpans)]) {
        if (span && fits(span.start, span.end)) return { kind: "narrow", start: span.start, end: span.end };
    }

    // Longest headword inside the selection that covers the tap; leftmost wins a tie.
    const char = characterAt(content, offset);
    for (let length = Math.min(MAX_HEADWORD_CHARS, width - 1); length >= 2; length--) {
        for (let s = Math.max(start, char.end - length); s <= char.start && s + length <= end; s++) {
            if (isHeadword(content.slice(s, s + length))) return { kind: "narrow", start: s, end: s + length };
        }
    }
    // (Lengths are in code units; a surrogate-pair character simply never forms a headword
    // here, and falls through to the character below.)

    return fits(char.start, char.end) ? { kind: "narrow", start: char.start, end: char.end } : { kind: "floor" };
}

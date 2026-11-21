import { useCallback, useState } from "react";
import type { SpanRange } from "./documentSegmentation";

// The shared "no tiebreak switches" value, so the span memo keeps its identity.
const NO_SEGMENT_OVERRIDES: SpanRange[] = [];

/**
 * useSegmentOverrides — TIEBREAK SWITCHES (docs/READER_SEGMENTATION.md § "Tiebreak
 * alternatives"): the alternatives the learner switched to in the Pinyin view
 * (ReaderCpcdView's yellow boxes), forced into the gsa via useReadingText `overrides`.
 *
 * Page-session only, and tagged with the content they were made against, so an edit (or
 * another document / passage) drops them rather than forcing stale offsets.
 *
 * `switchToAlternative(alternative)` — two cases, told apart by whether the alternative
 * overlaps a switch already made:
 *   - it does → it is the original winner shown on a forced span: undo that switch;
 *   - it doesn't → it lost a tiebreak: force it (forced spans split the run, so a loser
 *     can never straddle an existing switch).
 * Then it selects it through `selectRange` (handed in late via the callback's argument,
 * since the selection comes out of useReadingText, which needs `overrides` first).
 * selectRange never auto-expands, so selecting against this render's spans is safe.
 *
 * Lifted out of ReaderDocumentPage (2026-11-21). Layer: shared client state (src/reading).
 * Depended on by ReaderDocumentPage, StoryPlayPage.
 */
export function useSegmentOverrides(content: string | null | undefined) {
    const [state, setState] = useState<{ content: string; ranges: SpanRange[] }>({ content: "", ranges: [] });
    const overrides = content && state.content === content ? state.ranges : NO_SEGMENT_OVERRIDES;

    const switchToAlternative = useCallback((
        alternative: SpanRange,
        selectRange: (start: number, end: number) => void,
    ) => {
        if (!content) return;
        setState((previous) => {
            const ranges = previous.content === content ? previous.ranges : [];
            const overlapping = ranges.filter((r) => r.start < alternative.end && alternative.start < r.end);
            const next = overlapping.length > 0
                ? ranges.filter((r) => !overlapping.includes(r))
                : [...ranges, { start: alternative.start, end: alternative.end, text: alternative.text }];
            return { content, ranges: next };
        });
        selectRange(alternative.start, alternative.end);
    }, [content]);

    return { overrides, switchToAlternative };
}

// Tap-to-drill: narrowing a segment selection one headword at a time.
//
// THE GESTURE. Every surface that highlights a segment — example sentences, the
// embedded Chinese inside a long definition, and a found word on the Word Search
// board — used to treat a second tap on an already-selected segment as a DESELECT.
// It now means "go narrower": each repeat tap replaces the selection with the
// longest dictionary headword that (a) sits strictly inside the current selection
// and (b) still covers the character the finger is on. When nothing narrower is
// left — which is always the case once the selection is a single character — the
// tap cancels the selection, so the old deselect is still the end of the chain
// rather than something that disappeared.
//
//   中华人民共和国   ← tap 民 → whole segment
//     人民           ← tap 民 again
//     民             ← tap 民 again
//     (cancelled)    ← tap 民 again
//
// THE PICK RULE. Longest wins, because the intermediate steps are what teach the
// word — jumping from the whole compound straight to a bare character would skip
// 人民, which is the piece a learner most needs named. Ties (two headwords of the
// same length both covering the tapped character) break LEFTMOST, arbitrarily but
// deterministically: a wobbling pick would make the chain feel unreliable, and
// repeated taps must always terminate.
//
// TERMINATION. Every rung is strictly shorter than the one before it, so the chain
// is bounded by the length of the first selection and cannot loop.
//
// Rungs themselves are computed server-side (`buildDrillRungs` in
// server/dal/shared/segmentString.ts); this module only chooses among them. The
// candidates arrive with offsets relative to their parent segment, so callers pass
// the parent's absolute start and get an absolute range back — the same coordinate
// space the highlight already uses.
//
// Referenced by:
//   - src/components/SegmentedSentenceDisplay.tsx (est + long definition)
//   - src/games/word-search/WordSearchGrid.tsx (found-word review popup)
//   - docs/SEGMENT_DRILL_DOWN.md
import type { SegmentDrillRung } from "../types";

/** A chosen rung, resolved into the caller's absolute index space. */
export interface DrillRange {
  /** Absolute index of the rung's first character. */
  start: number;
  /** Absolute index of the rung's last character (inclusive). */
  end: number;
  /** The rung's text — a det headword, so it can drill into the eip. */
  text: string;
  definition: string;
  pronunciation?: string;
}

/** An index range, inclusive on both ends — the shape both callers' selections use. */
export interface IndexRange {
  start: number;
  end: number;
}

/** Inclusive length of a range. */
const rangeLength = (range: IndexRange): number => range.end - range.start + 1;

/**
 * Choose the next (narrower) rung for a drill tap, or null when the chain has run out
 * and the caller should cancel the selection.
 *
 * @param rungs - the parent segment's drill candidates, offsets relative to the parent
 * @param segmentStart - absolute index of the parent segment's first character
 * @param current - the selection being narrowed, in absolute indices
 * @param tappedIndex - absolute index of the character under the finger
 *
 * Null is returned for every "nothing to do" case, and they all mean the same thing to
 * the caller (cancel): a single-character selection, an absent/empty rung list, a tap
 * outside the current selection, or a selection no shorter headword fits inside.
 */
export function pickDrillRung(
  rungs: SegmentDrillRung[] | undefined,
  segmentStart: number,
  current: IndexRange,
  tappedIndex: number
): DrillRange | null {
  if (!rungs?.length) return null;
  // A single character is already the floor of the chain; nothing can be strictly
  // shorter than it.
  const currentLength = rangeLength(current);
  if (currentLength <= 1) return null;
  if (tappedIndex < current.start || tappedIndex > current.end) return null;

  let best: DrillRange | null = null;
  for (const rung of rungs) {
    const length = [...rung.text].length;
    // Strictly narrower — equal-length rungs would let the chain sit still forever.
    if (length >= currentLength) continue;

    const start = segmentStart + rung.offset;
    const end = start + length - 1;
    // Must contain the tapped character (that is what makes the drill feel aimed
    // rather than arbitrary) and must not escape the current selection.
    if (tappedIndex < start || tappedIndex > end) continue;
    if (start < current.start || end > current.end) continue;

    // Longest wins; leftmost breaks a tie. The server already emits longest-first, but
    // the comparison is written out so the pick does not silently depend on that order.
    const bestLength = best ? rangeLength(best) : -1;
    if (length > bestLength || (length === bestLength && best !== null && start < best.start)) {
      best = {
        start,
        end,
        text: rung.text,
        definition: rung.definition,
        ...(rung.pronunciation ? { pronunciation: rung.pronunciation } : {}),
      };
    }
  }

  return best;
}

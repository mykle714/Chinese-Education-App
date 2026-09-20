/**
 * lineReveal — reconciling a typewriter reveal with a segment list (§ 5.3b).
 *
 * LAYER: feature helper, pure. Deliberately NOT in `src/engine/iw/`: `revealSchedule.ts`
 * decides WHEN each glyph is due and knows nothing about dictionaries, while this knows what
 * a GSA segment is. Keeping them apart is what lets a bubble with no segmentation use the
 * schedule unchanged.
 *
 * Referenced by: src/features/immersiveworld/play/IWSpeechBubbles.tsx;
 * docs/IMMERSIVE_WORLD.md § 5.3b.
 */

/**
 * Truncate a segment list to cover exactly the first `length` characters of its line.
 *
 * `SegmentedSentenceDisplay` walks a cursor across `[...foreignText]`, consuming each
 * segment's character length in order — so a partially revealed line must be handed a
 * partially truncated segment list, or the final segment claims characters that have not
 * been revealed and the highlight rect its popup anchors to is measured against them.
 *
 * ⚠️ **A SEGMENT STRADDLING THE BOUNDARY IS CUT, NOT DROPPED.** The visible half stays
 * tappable and keeps the whole word's gloss, because `segmentMetadata` is keyed by segment
 * TEXT and the cut piece no longer matches its key. That is the intended trade: a word
 * half-out of the speaker's mouth is inert for the fraction of a second before the rest of it
 * arrives, rather than flickering in and out of the layout as the reveal crosses it.
 *
 * Counts by CODE POINT, matching the display's `[...text]` spread — a surrogate pair is one
 * cell there, and would be two under `.length`.
 */
export function clipSegmentsToLength(segments: readonly string[], length: number): string[] {
  if (length <= 0) return [];
  const out: string[] = [];
  let taken = 0;
  for (const segment of segments) {
    const chars = [...segment];
    if (taken + chars.length <= length) {
      out.push(segment);
      taken += chars.length;
      if (taken === length) break;
      continue;
    }
    // Straddles the reveal boundary: keep the revealed half only.
    const remaining = length - taken;
    if (remaining > 0) out.push(chars.slice(0, remaining).join(''));
    break;
  }
  return out;
}

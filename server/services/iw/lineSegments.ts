import type { LongDefinitionPart } from '../../contracts/wire.js';
import type { IWLineSegments, IWScene } from '../../contracts/iw.js';
import type { SegmentMetadata } from '../../contracts/wire.js';

/**
 * lineSegments — making a spoken line tappable (§ 5.3b).
 *
 * LAYER: service helper, and PURE apart from nothing — it does no I/O at all. The dictionary
 * round trip belongs to `DictionaryDAL.segmentTexts`; everything here is reshaping.
 *
 * ⚠️ **IW DOES NOT SEGMENT ANYTHING ITSELF.** Every segment boundary and every gloss comes
 * from the est's pipeline (`segmentString.ts` → `DictionaryDAL.segmentTexts`), because a
 * second segmenter is a second set of answers: the learner would tap 不好意思 in an example
 * sentence and get one word, tap it in a bubble and get three. The only thing iw contributes
 * is WHICH strings to segment.
 *
 * ⚠️ **THE PARTITION IS THE CONTRACT.** `SegmentedSentenceDisplay` walks a cursor across
 * `[...foreignText]`, consuming each segment's character length in order — so the segment
 * list must cover the line exactly once, with no gap and no overlap. The DAL returns ordered
 * PARTS (English prose between Chinese runs), and a naive concatenation of just the Chinese
 * runs' segments would leave every popup after the first non-Chinese stretch pointing at the
 * wrong characters. {@link partsToLineSegments} is what keeps that from happening.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.3b, § 12 phase 2; docs/EXAMPLE_SENTENCES.md.
 */

/**
 * Flatten the DAL's ordered parts into one line the bubble can render.
 *
 * Returns null when there is nothing to look up — a line with no target-language run at all,
 * where a segmented display would only add tap targets that answer nothing.
 */
export function partsToLineSegments(
  text: string,
  parts: LongDefinitionPart[] | null,
): IWLineSegments | null {
  if (!parts || parts.length === 0) return null;

  const segments: string[] = [];
  const segmentMetadata: SegmentMetadata = {};
  let sawForeign = false;

  for (const part of parts) {
    if (part.type === 'text') {
      // Prose between the target-language runs. Emitted one CHARACTER at a time rather than
      // as one long segment: the cursor only needs the lengths to line up, and a per-char
      // segment with no metadata is inert — it renders, it never highlights, it never opens
      // a popup. A single multi-character segment would instead be one big tappable block
      // that has nothing to say.
      for (const ch of part.value) segments.push(ch);
      continue;
    }

    sawForeign = true;
    const runSegments = part._segments?.length ? part._segments : [...part.foreignText];
    for (const segment of runSegments) segments.push(segment);

    // Merged across runs. Keys are segment TEXT, so two runs containing the same word share
    // one entry — which is correct: it is the same headword with the same gloss either way.
    for (const [segment, meta] of Object.entries(part.segmentMetadata ?? {})) {
      segmentMetadata[segment] = meta;
    }
  }

  if (!sawForeign) return null;
  return { foreignText: text, segments, segmentMetadata };
}

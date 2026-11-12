/**
 * Segment-wise sense/POS tagger for stored Chinese example sentences.
 *
 * LAYER: data-enrichment (backfill) utility layer.
 *
 * Extracted from chinese/backfill-example-sentences.js so that a second writer of
 * `senseDict` / `segmentOccurrenceTags` — chinese/reconcile-sentence-senses.js, which
 * repairs labels orphaned by re-clustering — tags with the EXACT same prompt and the same
 * fallback rules as the generator's tagging pass. The prompt text is byte-identical to
 * the pre-extraction copy, so oracle prompt hashes (run-log.js, keyed on model + system +
 * messages) and previously authored oracle answers stay valid.
 *
 * Referenced by: chinese/backfill-example-sentences.js (tagSentenceSegments,
 * runRetagSegment), chinese/reconcile-sentence-senses.js,
 * docs/EXAMPLE_SENTENCES.md § "Stale sense labels".
 */

import { ALLOWED_POS_TAGS } from '../../shared/lib/posTags.js';
import { parseModelJson } from '../../shared/lib/json.js';
import { cachedSystem } from '../../run-log.js';

export const TAGGER_MODEL = 'claude-sonnet-4-6';

const ALLOWED_TENSES = new Set(['past', 'present', 'future']);
const ALLOWED_NUMBERS = new Set(['singular', 'plural']);
export const ALLOWED_POS_TAG_SET = new Set(ALLOWED_POS_TAGS);
const ALLOWED_POS_LINE = ALLOWED_POS_TAGS.join(', ');

export const HAN_REGEX = /\p{Script=Han}/u;
export const codePointLength = (text) => [...text].length;

export const SEGMENT_TAGGER_SYSTEM = `You label the segments of a Chinese sentence with grammatical metadata for a language-learning app. You are given the sentence, its English translation, and its FIXED segmentation — use exactly the segments provided, in the given order; never re-split, merge, or add segments.

A segment that appears MORE THAN ONCE in the sentence is listed once per occurrence, keyed "<segment>#<n>" (n counts its occurrences left to right) and shown in context with that occurrence wrapped in 【】. Label each occurrence on its own — the same characters can do different jobs in one sentence (e.g. in 听了老师的解释，我心中了然, the first 了 is an aspect particle and the second means "to understand").

For EACH listed key return:
- "pos": the segment's part of speech IN THIS sentence — one of: ${ALLOWED_POS_LINE}. If a verb segment is used nominally (gerund / subject / object), tag it "noun".
- "sense": ONLY for keys shown with a "candidate senses" list — copy verbatim the ONE listed label that matches how the segment is used here, character-for-character. Never invent, translate, paraphrase, shorten, or combine labels. Omit "sense" for keys with no candidate list.
- "number": ONLY for segments you tag "noun" — "singular" or "plural", judged from the English translation. Omit for non-nouns.
- "tense": ONLY for segments you tag "verb" or "auxiliary verb" — "past", "present", or "future", judged from THAT verb's own temporal meaning in this sentence (a sentence may contain verbs in different tenses; label each on its own). Reason from meaning, not just grammatical markers (了 can mark a present state change; progressive aspect can appear in past or future contexts). Omit for non-verbs.

Respond with ONLY a JSON object mapping each key, exactly as listed, to its metadata:
{"<key>": {"pos": "<pos_tag>", "sense": "<label>", "number": "singular|plural", "tense": "past|present|future"}}`;

/**
 * Split a segmentation into tagging items: one per UNIQUE Han segment, except that a
 * segment string occurring more than once gets one item PER OCCURRENCE (key
 * "<segment>#<n>", plus a 【】-marked context line), so its occurrences can be labelled
 * independently. Punctuation is never tagged.
 *
 * `vocabCharIndex` (when set) picks out the one occurrence of the headword the sentence
 * demonstrates; only that occurrence is the "target" whose sense/POS are fixed by
 * generation. Without it (legacy rows, split words) every occurrence of the headword is
 * treated as the target — the pre-v8 behaviour.
 */
export function buildTagItems(foreignText, segments, targetWord, vocabCharIndex) {
  const occurrences = [];
  let charStart = 0;
  segments.forEach((seg, index) => {
    if (HAN_REGEX.test(seg)) occurrences.push({ seg, index, charStart });
    charStart += codePointLength(seg);
  });

  const totalBySeg = new Map();
  for (const o of occurrences) totalBySeg.set(o.seg, (totalBySeg.get(o.seg) ?? 0) + 1);

  const targetSegIndex = Number.isInteger(vocabCharIndex)
    ? occurrences.find(o => o.seg === targetWord && o.charStart === vocabCharIndex)?.index ?? null
    : null;

  const chars = [...foreignText];
  const seenBySeg = new Map();
  return occurrences.map(o => {
    const nth = (seenBySeg.get(o.seg) ?? 0) + 1;
    seenBySeg.set(o.seg, nth);
    const repeated = totalBySeg.get(o.seg) > 1;
    const segLength = codePointLength(o.seg);
    return {
      ...o,
      repeated,
      key: repeated ? `${o.seg}#${nth}` : o.seg,
      context: repeated
        ? `${chars.slice(0, o.charStart).join('')}【${o.seg}】${chars.slice(o.charStart + segLength).join('')}`
        : null,
      isTarget: !!targetWord && o.seg === targetWord && (targetSegIndex === null || o.index === targetSegIndex),
    };
  });
}

/**
 * Build the tagger call bound to one Anthropic client (the caller's, so run-log's usage
 * accounting and the oracle wrapper both see it).
 *
 * The returned `callSegmentTagger(sentence, items, clustersBySeg)` makes ONE model call per
 * sentence → Map<item key, { pos?, sense?, number?, tense? }>. It fails OPEN (empty map) so a
 * flaky/unparseable response never blocks storage: the caller still auto-fills
 * single-cluster + target senses and falls back to the dictionary POS.
 */
export function createSegmentTagger({ anthropic }) {
  return async function callSegmentTagger(sentence, items, clustersBySeg) {
    const result = new Map();
    if (items.length === 0) return result;

    const segLines = items.map((item, i) => {
      const clusters = clustersBySeg.get(item.seg) ?? [];
      // Offer sense candidates only for multi-sense NON-target occurrences: the target
      // occurrence's sense is already fixed (generation-validated), and single-sense
      // segments are auto-filled by the caller without spending the model on them.
      const candidates = clusters.length > 1 && !item.isTarget
        ? ` — candidate senses: ${clusters.map(c => `"${c.sense}"`).join('; ')}`
        : '';
      const context = item.context ? ` — this occurrence: ${item.context}` : '';
      return `${i + 1}. "${item.key}"${candidates}${context}`;
    }).join('\n');

    const userText = `Chinese: ${sentence.foreignText}
English: ${sentence.english}

Segments (label every one, keyed by the exact key shown):
${segLines}`;

    try {
      const response = await anthropic.messages.create({
        model: TAGGER_MODEL,
        max_tokens: Math.max(500, 120 * items.length),
        temperature: 0.1,
        system: cachedSystem(SEGMENT_TAGGER_SYSTEM),
        messages: [{ role: 'user', content: userText }],
      });
      const parsed = parseModelJson(response.content[0].text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, meta] of Object.entries(parsed)) {
          if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
            result.set(key, {
              pos: typeof meta.pos === 'string' ? meta.pos : undefined,
              sense: typeof meta.sense === 'string' ? meta.sense : undefined,
              number: typeof meta.number === 'string' ? meta.number : undefined,
              tense: typeof meta.tense === 'string' ? meta.tense : undefined,
            });
          }
        }
      }
    } catch (err) {
      // An oracle export capture is a control-flow signal, not a tagger failure — it must
      // propagate so the round can author the tag prompt. Swallowing it (the old bare
      // `catch {}`) silently produced empty numberDict/tenseDict on every stamped row.
      if (err?.oracleExport) throw err;
      // swallow — see fail-open note above
    }
    return result;
  };
}

/**
 * Resolve one tagging item's final labels from the model's raw tag, applying the
 * fallbacks. Returns only the fields that resolved.
 */
export function resolveItemTag(item, rawTag, sentence, clusters, dictPos) {
  const tag = rawTag ?? {};
  const out = {};

  // POS — the target occurrence reuses the generation-validated targetPos; others take
  // the model's tag, falling back to the dictionary's primary POS.
  if (item.isTarget && ALLOWED_POS_TAG_SET.has(sentence.targetPos)) out.pos = sentence.targetPos;
  else if (ALLOWED_POS_TAG_SET.has(tag.pos)) out.pos = tag.pos;
  else {
    const fallback = dictPos.find(p => ALLOWED_POS_TAG_SET.has(p));
    if (fallback) out.pos = fallback;
  }

  // Sense — target: the fixed generation sense; single-cluster: that cluster;
  // multi-cluster: the model's pick if it is one of this segment's own labels.
  if (item.isTarget && sentence.sense) out.sense = sentence.sense;
  else if (clusters.length === 1) out.sense = clusters[0].sense;
  else if (clusters.length > 1 && typeof tag.sense === 'string' && clusters.some(c => c.sense === tag.sense)) {
    out.sense = tag.sense;
  }

  // Number — only for noun segments with a valid value.
  if (out.pos === 'noun' && ALLOWED_NUMBERS.has(tag.number)) out.number = tag.number;

  // Tense — only for verb segments with a valid value. Per-verb (not per-sentence)
  // so a sentence mixing tenses inflects each verb's popup gloss independently.
  if ((out.pos === 'verb' || out.pos === 'auxiliary verb') && ALLOWED_TENSES.has(tag.tense)) out.tense = tag.tense;

  return out;
}

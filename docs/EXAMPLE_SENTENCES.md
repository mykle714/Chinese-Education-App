# Example Sentences (est)

Umbrella reference for the **example sentence tab (est)** in the extra info card:
AI-generated sentences that show a vocabulary word used in context, rendered as
tappable segments with per-segment definition popups.

## Concept overview

Each dictionary entry carries an `exampleSentences` array (jsonb). Per sentence the
data holds the foreign text, an English translation, a `translatedVocab` pointer,
and the context signals used for rendering (`tense`, `partOfSpeechDict`,
`numberDict`, `segmentGloss`). At read time the DAL runs greedy segmentation and
attaches per-segment metadata; the client renders each segment as **cpcd** with a
hover/tap popup.

| Layer | Where | Role |
|---|---|---|
| Generation | `server/scripts/backfill/chinese/backfill-example-sentences.js` | Multi-agent pipeline (generator → validator → Opus repair) that produces the sentences + context signals |
| Read/enrichment | `server/dal/implementations/DictionaryDAL.ts` (`enrichExampleSentencesMetadataBatch`) + `server/dal/shared/segmentString.ts` (`buildSegmentMetadata`) | Greedy-segments each sentence and attaches per-segment pronunciation/definition/wordForms; passes context signals through |
| Presentation | `src/components/SegmentedSentenceDisplay.tsx` | Renders segments as cpcd; hover/tap shows the segment popup |

> Scope note: the rich pipeline above is **Chinese (`zh`)**. The Spanish path
> (`enrichSpanishExampleSentencesMetadataBatch`) attaches only a base per-token
> `definition` — no segmentation, pronunciation, or form modification.

## Sub-documents

| Concept | Doc | One-liner |
|---|---|---|
| **Form modification** | [EXAMPLE_SENTENCE_FORM_MODIFICATION.md](./EXAMPLE_SENTENCE_FORM_MODIFICATION.md) | The segment popup shows the contextually inflected English gloss (right tense / number / POS form for *this* sentence) via the per-headword `wordForms` inventory + per-sentence `tense`/`partOfSpeechDict`/`numberDict` signals, selected at runtime by `resolveWordForm`. |

## Related

- **Greedy segmentation** — [greedySegmentation.md](./greedySegmentation.md) (how the foreign text is split into segments)
- **cpcd rendering** — example sentences render through cpcd; long pinyin spacing is covered in [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md)

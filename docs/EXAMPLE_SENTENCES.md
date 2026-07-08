# Example Sentences (est)

Umbrella reference for the **example sentence tab (est)** in the extra info card:
AI-generated sentences that show a vocabulary word used in context, rendered as
tappable segments with per-segment definition popups.

## Concept overview

Each dictionary entry carries an `exampleSentences` array (jsonb). Per sentence the
data holds the foreign text, an English translation, a `translatedVocab` pointer,
a `sense` (the exact `definitionClusters` sense label the **target word**
carries in that sentence), the authoritative GSA **`segments`**, and four
**segment-keyed** dicts — `partOfSpeechDict`, `numberDict`, `tenseDict`, and
`senseDict`. At read time the DAL renders the stored `segments` (falling back to a
live greedy segmentation for pre-tagging rows) and attaches per-segment metadata;
the client renders each segment as **cpcd** with a hover/tap popup.

### Two-phase generation (generation → segment-wise tagging)

Sentence text and the render-time per-segment data are produced by **two separate
steps** in `backfill-example-sentences.js`:

1. **Generation** (Sonnet, Opus repair) emits only the sentence text +
   `translatedVocab` + `sense` (target, multi-sense) + `targetPos` (the
   target word's POS — a *coverage-steering signal only*, **not stored**).
2. **Tagging pass** (`tagSentenceSegments`, Sonnet) runs the **same GSA the read path
   uses** on the final text, then one model call tags **each GSA segment** with its
   contextual `pos`, `sense` (from *that segment's own* `definitionClusters`),
   `number` (nouns), and `tense` (verbs). The segmentation is persisted (`segments`)
   and the four dicts are keyed by the GSA segment string, so read-time lookups align
   exactly. `tense` is **per-verb**, not per-sentence, so a sentence mixing tenses
   (`I bought books, will return them tomorrow`) inflects each verb's popup gloss on
   its own tag.

This replaced the earlier design where generation emitted an **AI-token-keyed**
`partOfSpeechDict`/`numberDict` that could silently misalign with the read-time GSA
segments. Classifiers are **not** force-split anymore: a classifier GSA absorbs into
a longer word is simply tagged as that whole word (with its own sense/definition).

### `sense` (which meaning the sentence demonstrates)

`sense` is a per-sentence string equal, verbatim, to one of the entry's
`definitionClusters[].sense` labels (see [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md)).
Generation therefore **depends on clustering having run first** — the generator
reads the sense list and:

- **Multi-sense entry** → the model must pick one label per sentence; the pick is
  validated against the cluster list (an off-list value is rejected and re-rolled).
  Sense diversity is enforced by a **three-part mechanism** (all in
  `backfill-example-sentences.js`), so a spread of senses is structural, not left to
  the model's discretion:
  1. **Required sense set** — `selectCoverageSenses(clusters, budget)` ranks senses by
     `vernacularScore` (**free forms before bound forms** on ties), then requires every
     register-≥-4 sense **plus** enough top-ranked senses to fill the sentence budget
     (`Math.max(3, coverablePos count)`). This replaced a fixed register-≥-4 filter that
     silently produced an *empty* required set — and thus **zero** diversity steering —
     for any word whose senses all sit in the compressed 1–3 band (e.g. 节, five senses
     topping out at 3), the classic "two near-identical sentences" failure.
  2. **Soft per-slot assignment** — `buildSlotAssignmentBlock` renders the required set
     as one *suggested* sense per sentence slot in the batch user-message (deviate only
     when a sense can't form a natural sentence), so the batch itself emits one sentence
     per distinct sense instead of the model distributing a flat "cover these" list.
  3. **Bound-only POS exclusion** — `coverablePosSet` drops any POS the word carries
     *only* in a bound form (e.g. 节's "verb", living solely in 节约/节省) from the POS
     coverage targets, so the coverage re-roll can't fabricate a redundant off-target
     sentence chasing an unsentenceable role.

  A backstop batch-prompt rule (`COVERAGE_MULTI`) still forbids repeating a sense while
  any listed sense is unshown, and the code-side coverage re-roll patches any residual gap.
- **Single-sense entry** → a different prompt is used that never mentions senses
  (nothing to disambiguate); the one label is auto-filled server-side.

Entries that are **not yet clustered** (`definitionClusters IS NULL`) are **skipped**
by the backfill, so every generated sentence is guaranteed a validated `sense`.

### `senseDict` (which meaning *each segment* carries)

`sense` labels only the **target word**. `senseDict` generalizes it to **every
segment**: a `Record<segment, senseLabel>` where each label is one of *that
segment's own* `definitionClusters[].sense` labels, written by the tagging pass
(`tagSentenceSegments`). Resolution per segment:

- **target segment** → the already-validated `sense` (not re-asked);
- **single-cluster segment** → that one cluster's label (auto-filled, no model);
- **multi-cluster segment** → the tagger picks one of that segment's labels,
  validated against its cluster list (off-list → omitted, read path falls back).

**Read-time consumption.** `senseDict` *is* consumed: in `buildSegmentMetadata`
(`server/dal/shared/segmentString.ts`), when a segment's `senseDict` label matches
one of its `definitionClusters`, the segment's displayed definition (**dd**) is
`ddt(matchedCluster)` — the cluster's stripped lead gloss (`server/utils/definitions.ts`
`ddt`) — instead of the legacy translation string-match
(`pickDefinitionForTranslatedSentence`). Un-tagged / un-clustered segments keep the
string-match fallback. (`ddt` = `stripParentheses(cluster.glosses[0])`; the client
twin lives in `src/utils/definitionUtils.ts`.)

> Replaces the former `segmentGloss` field (an AI-written per-segment "broken
> English" reading) removed in `SCRIPT_VERSION 4`. `segmentGloss` bundled two jobs —
> *sense selection* and *form inflection*; those are now `senseDict` (per-segment
> sense → cluster dd) and the `wordForms` form modification, respectively.

| Layer | Where | Role |
|---|---|---|
| Generation | `server/scripts/backfill/chinese/backfill-example-sentences.js` (generator/validator/repair) | Produces the sentence text + `translatedVocab`/`sense`/`targetPos` (target-word coverage signal only) |
| Tagging pass | same file (`tagSentenceSegments` + `callSegmentTagger`) | Runs the read-path GSA on the final text, then tags each segment with `pos`/`sense`/`number`/`tense`; persists `segments` + the four segment-keyed dicts |
| Read/enrichment | `server/dal/implementations/DictionaryDAL.ts` (`enrichExampleSentencesMetadataBatch`) + `server/dal/shared/segmentString.ts` (`buildSegmentMetadata`) | Renders stored `segments` (live GSA fallback); attaches per-segment pronunciation/definition/wordForms, resolving dd from `senseDict` → `ddt(cluster)` |
| Presentation (one sentence) | `src/components/SegmentedSentenceDisplay.tsx` | Renders one sentence's segments as cpcd; hover/tap shows the segment popup; draws the headword underline (`vocabWord`) |
| Presentation (est block) | `src/features/flashcards/ExampleSentenceList.tsx` | **Single source of truth for the est UI** — maps the sentence list into per-sentence cards (speaker button + `SegmentedSentenceDisplay` + English gloss). See below. |

## The est block is one shared component (`ExampleSentenceList`)

Both card surfaces render the **same** `ExampleSentenceList`, so an est feature can
never be present on one surface and missing on the other (the historical cause of
parity bugs — headword underline, English-gloss underline, and the per-sentence
speaker button had each drifted onto only the eip):

- **eip Examples tab** — `InfoCardPanelBody.tsx` (`effectiveTab === 1`).
- **cdp** (read-only dictionary cdp + saved-card cdp) — `VocabCardDetailBody.tsx`
  (`VocabCardSections`), threaded from `pages/DictionaryCardDetailPage.tsx` and
  `features/flashcards/VocabCardDetailPage.tsx`.

Each per-sentence card carries: a top-right `SpeakerButton` (gated on
`onSpeakSentence`; both cdp parents pass a slow-rate-aware wrapper honoring
`slowExampleSentences`, matching the flp), the `SegmentedSentenceDisplay` (with
`vocabWord`/`language` so the headword is underlined), and the English translation
rendered through `renderEnglishWithVocabUnderline` (`exampleSentenceText.tsx`, shared)
which underlines the `translatedVocab` substring. The only surface difference is the
`compact` prop (cdp passes it for denser stacking); every functional feature is shared.

### AI-generated vs human-approved styling

Every sentence arrives with a server-computed `humanApproved` flag (attached in
`enrichExampleSentencesMetadataBatch`, both zh + es branches): TRUE iff a
`validations` row with the approval stamp (`action = 'approve'`) matches the
sentence's **current** raw det object (docs/DATA_VALIDATION_SYSTEM.md).
Sentences without a valid approval render in the shared AI-generated treatment —
orange `COLORS.yellowMain` border, ~8% tint, and an `AutoAwesome` "AI GENERATED"
badge (`src/theme/aiGeneratedStyling.ts` + `src/components/AiGeneratedBadge.tsx`,
same treatment as the dictionary
AI-fallback card). Approved sentences keep the quiet `flashcard.subtleBg`
background. Because the flag is computed at read time, a data deploy or backfill
that changes a sentence's text automatically demotes it back to AI-generated.

## Segment popup → eip drill-in

The per-segment definition popup (`SegmentedSentenceDisplay.tsx`, the `Popper` at the
bottom of the file) is **tappable**: tapping it opens the extra-info panel (eip) for the
tapped segment's headword.

- **Affordance.** When the popup is interactive it renders `cursor: pointer`, an `:active`
  press tint, and a trailing drill-in chevron (`›`) — the same glyph the breakdown/used-in
  rows use, so "chevron = open the eip for this word" is one consistent gesture. Styling is
  gated on `isPopupInteractive` (`onSegmentOpen` wired **and** a concrete `selectedRange.segment`).
- **Wiring.** New prop `onSegmentOpen?(segment)` on `SegmentedSentenceDisplay`. It is threaded
  through the est call site only (`InfoCardPanelBody.tsx` Examples tab, prop
  `onExampleSegmentClick`) → `InfoCardSection`/`InfoCardPopup` → the two consumers
  (`FlashcardsLearnPage.tsx`, `DictionaryPage.tsx`), each passing
  `(segment) => eip.openForEntryKey(segment)`. The expansion-tab `SegmentedSentenceDisplay`
  omits `onSegmentOpen`, so that popup stays a passive tooltip.
- **Tap absorption.** The popup renders through a Popper portal but is still a **React child
  of the row Box**, so React events bubble to the row's `onPointerDown` (which clears the
  selection). The interactive popup therefore opens on `onPointerUp` and calls
  `stopPropagation()` + `preventDefault()` on both `pointerdown` and `pointerup`:
  `stopPropagation` keeps the row from clearing the selection; `preventDefault` on
  `pointerdown` suppresses the touch compatibility-click, which otherwise fires after the
  popup closes and lands on whatever is behind it (the "tap registers behind the popup" bug).
  The native capture-phase outside-tap dismiss handler additionally whitelists `popupRef`.

> Popup placement: the definition popup is a MUI `Popper` portal anchored to a
> viewport-space virtual element (so it escapes ancestor overflow clipping). Popper
> measures the popup once on open; a `ResizeObserver` on the popup box (`popupRef`)
> calls the popper instance's `update()` on every reflow so late size changes —
> notably the definition's web font loading on the first-ever open — reposition the
> box against its true width instead of leaving it mis-sized until reopened.

> Scope note: the rich pipeline above is **Chinese (`zh`)**. The Spanish path
> (`enrichSpanishExampleSentencesMetadataBatch`) attaches only a base per-token
> `definition` — no segmentation, pronunciation, or form modification.

## Sub-documents

| Concept | Doc | One-liner |
|---|---|---|
| **Form modification** | [EXAMPLE_SENTENCE_FORM_MODIFICATION.md](./EXAMPLE_SENTENCE_FORM_MODIFICATION.md) | The segment popup shows the contextually inflected English gloss (right tense / number / POS form for *this* sentence) via the per-headword `wordForms` inventory + the per-segment `partOfSpeechDict`/`numberDict`/`tenseDict` signals, selected at runtime by `resolveWordForm`. |

## Related

- **Greedy segmentation** — [greedySegmentation.md](./greedySegmentation.md) (how the foreign text is split into segments)
- **cpcd rendering** — example sentences render through cpcd; long pinyin spacing is covered in [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md)

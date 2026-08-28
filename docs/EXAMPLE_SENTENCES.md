# Example Sentences (est)

Umbrella reference for the **example sentence tab (est)** in the extra info card:
AI-generated sentences that show a vocabulary word used in context, rendered as
tappable segments with per-segment definition popups.

## Concept overview

Each dictionary entry carries an `exampleSentences` array (jsonb). Per sentence the
data holds the foreign text, an English translation, a `translatedVocab` pointer,
a `sense` (the exact `definitionClusters` sense label the **target word**
carries in that sentence), the authoritative GSA **`segments`**, any
**`segmentExceptions`** the segmentation audit found, and four
**segment-keyed** dicts — `partOfSpeechDict`, `numberDict`, `tenseDict`, and
`senseDict`. At read time the DAL renders the stored `segments` (falling back to a
live greedy segmentation for pre-tagging rows) and attaches per-segment metadata;
the client renders each segment as **cpcd** with a hover/tap popup.

### Three-phase generation (generation → segmentation audit → segment-wise tagging)

Sentence text and the render-time per-segment data are produced by **three separate
steps** in `backfill-example-sentences.js`:

1. **Generation** (Sonnet, Opus repair) emits only the sentence text +
   `translatedVocab` + `sense` (target, multi-sense) + `targetPos` (the
   target word's POS — a *coverage-steering signal only*, **not stored**).
2. **Segmentation audit** (`auditSegmentation`, Sonnet) runs the **same GSA the read
   path uses** on the final text, then one model call names the multi-character
   segments that are *not one word in this sentence*. Those become the sentence's
   `segmentExceptions` and the text is **re-segmented** with them excluded. See
   [Segmentation audit](#segmentation-audit-per-sentence-segmentexceptions) below.
3. **Tagging pass** (`tagSentenceSegments`, Sonnet) tags **each surviving segment** with its
   contextual `pos`, `sense` (from *that segment's own* `definitionClusters`),
   `number` (nouns), and `tense` (verbs). The segmentation is persisted (`segments`)
   and the four dicts are keyed by the GSA segment string, so read-time lookups align
   exactly. `tense` is **per-verb**, not per-sentence, so a sentence mixing tenses
   (`I bought books, will return them tomorrow`) inflects each verb's popup gloss on
   its own tag.

Step 2 **must** precede step 3: the four dicts are keyed by the segment strings, so
tagging a segmentation the audit is about to change would leave every key pointing at
a segment that no longer exists.

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
     `frequencyScore` (**free forms before bound forms** on ties), then requires every
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
one of its `definitionClusters`, **that one cluster supplies both halves of the
segment's popup** — its displayed definition (**dd**) *and* its pronunciation:

| Half | With a matched cluster | Fallback (un-tagged / un-clustered / stale label) |
|---|---|---|
| dd | `ddt(matchedCluster)` — the cluster's stripped lead gloss (`server/utils/definitions.ts` `ddt`) | translation string-match (`pickDefinitionForTranslatedSentence`) |
| pronunciation | `numberedToTonedPinyin(matchedCluster.reading)` | the entry-level `pronunciation` column |

A manual `exampleSentenceDefinitionPronunciationOverride` still wins over both.
(`ddt` = `stripParentheses(cluster.glosses[0])`; the client twin lives in
`src/utils/definitionUtils.ts`.)

### Segmentation audit (per-sentence `segmentExceptions`)

The GSA is **context-free**: at each length tier it takes the highest-scoring
dictionary match, so a real headword that merely *happens* to span two adjacent
characters wins even when those characters are doing separate jobs. The canonical
case is 真是 — a genuine word ("indeed") — inside 他**真是**个行家, where 真 is an adverb
and 是 is the copula. Segmenting them together mislabels the clause and hands the
learner a popup for a word that isn't in the sentence.

Only a reader who understands the sentence can tell the two apart, so one model call
per sentence (`auditSegmentation`, `backfill-example-sentences.js`) reviews the
emitted segmentation and returns the multi-character segments that should be split:

```
Chinese: 他真是个行家。          →  ["真是"]
Segmentation produced: "他" "真是" "个" "行家" "。"
```

The result is stored on the sentence as **`segmentExceptions: string[]`** (a key in
the existing `exampleSentences` jsonb — **no migration**) and passed straight back
into `segmentWithDict` as exclude tokens, **unioned with** the entry-wide
`matchException` set rather than replacing it. Single characters are never
excludable (they are the GSA's last-resort fallback), so a rejected 真是 falls apart
into 真 + 是 for free.

**Why per-sentence and not `matchException`.** The `matchException` column is
entry-wide and shared with the Reader — listing 真是 there would suppress it in every
other sentence and in every user document, where it *is* the right segmentation. The
exception is a fact about **this sentence**, so it lives on this sentence.

Three guards on what the model returns (`auditSegmentation`):

| Guard | Why |
|---|---|
| Token must be **one of the segments actually emitted** | a hallucinated token is a silent no-op in `segmentWithDict`; storing it would leave a misleading record on the row |
| Token must be **≥ 2 characters** | single chars cannot be excluded at all |
| Token is **never the target headword** | the sentence exists to demonstrate it, and the tagging pass forces it to win segmentation (`prioritySegments`); excluding it would strip the target's own popup and underline |

The call **fails open** — an unparseable or errored response yields `[]` and the
sentence keeps the raw GSA segmentation, which is exactly what every row shipped
before this pass existed. (An `err.oracleExport` throw still propagates; it is a
control-flow signal, not a failure.) `segmentExceptions` is **omitted when empty**,
the common case, so the corpus does not grow an empty array per sentence.

**Read-time role.** Because the corrected segmentation is persisted on `segments`,
the stored list is *not* what fixes the render — it is the durable record of *why*
that segmentation looks the way it does. It still does two live jobs in
`enrichExampleSentencesMetadataBatch`: it feeds the **live-GSA fallback** for rows
written before the tagging pass existed, and it is unioned into the `excludeTokens`
handed to `buildSegmentMetadata`, so an audited token can never come back as a
**drill rung** either ([SEGMENT_DRILL_DOWN.md](./SEGMENT_DRILL_DOWN.md)).

Shipped in `SCRIPT_VERSION 7`, so `--stale` regenerates every previously-stamped
entry through the new pass.

### Sense-aware pinyin (heteronyms)

The pronunciation half exists because a heteronym's reading **is** a function of its
sense: `reading` is a hard cluster boundary (docs/DEFINITION_CLUSTERS.md), so the
entry-level `pronunciation` column is only correct for the entry's *primary* sense.
Before this, 会 in the "to reckon accounts" sense rendered **huì** in the cpcd row and
narrated as huì; it now renders **kuài**, and tone coloring follows for free (cpcd
derives tone from the diacritic). The same value is the pinyin hint passed to cloud
TTS by tap-to-speak, so narration is fixed by the same change.

Two conversions/guards live in `senseReading` (`segmentString.ts`):

- cluster readings are **numbered** (`kuai4 ji4`) while the column is **tone-marked**
  (`huì jì`), so the reading is converted by `numberedToTonedPinyin`
  (`server/utils/pinyinTones.ts` — the **server twin** of the pair in `src/utils/textUtils.ts`;
  keep them in lockstep);
- the reading is **rejected** unless its syllable count equals the segment's character
  count, and unless the segment is all-Han. cpcd pairs syllables to characters
  positionally (`SegmentedSentenceDisplay` only renders per-char pinyin when
  `syllables.length === segmentLength`), so a clusterer slip that dropped a syllable
  would shift the entire pinyin row one character; the aligned column value is kept
  instead.

Covered by `server/__tests__/segmentString.test.ts`
(`buildSegmentMetadata — sense-aware pronunciation`).

> Replaces the former `segmentGloss` field (an AI-written per-segment "broken
> English" reading) removed in `SCRIPT_VERSION 4`. `segmentGloss` bundled two jobs —
> *sense selection* and *form inflection*; those are now `senseDict` (per-segment
> sense → cluster dd) and the `wordForms` form modification, respectively.

| Layer | Where | Role |
|---|---|---|
| Generation | `server/scripts/backfill/chinese/backfill-example-sentences.js` (generator/validator/repair) | Produces the sentence text + `translatedVocab`/`sense`/`targetPos` (target-word coverage signal only) |
| Segmentation audit | same file (`auditSegmentation`) | Runs the read-path GSA on the final text, then names the multi-char segments that aren't one word here; persists `segmentExceptions` and re-segments with them excluded |
| Tagging pass | same file (`tagSentenceSegments` + `callSegmentTagger`) | Tags each surviving segment with `pos`/`sense`/`number`/`tense`; persists `segments` + the four segment-keyed dicts |
| Read/enrichment | `server/dal/implementations/DictionaryDAL.ts` (`enrichExampleSentencesMetadataBatch`) + `server/dal/shared/segmentString.ts` (`buildSegmentMetadata`, `senseReading`) | Renders stored `segments` (live GSA fallback, honoring `segmentExceptions`); attaches per-segment pronunciation/definition/wordForms, resolving **both** dd and pronunciation from `senseDict` → `ddt(cluster)` / `cluster.reading` |
| Presentation (one sentence) | `src/components/SegmentedSentenceDisplay.tsx` | Renders one sentence's segments as cpcd; hover/tap shows the segment popup; draws the headword underline (`vocabWord`) |
| Presentation (est block) | `src/features/flashcards/ExampleSentenceList.tsx` | **Single source of truth for the est UI** — maps the sentence list into per-sentence cards (speaker button + `SegmentedSentenceDisplay` + English gloss). See below. |

## The est block is one shared component (`ExampleSentenceList`)

Both card surfaces render the **same** `ExampleSentenceList`, so an est feature can
never be present on one surface and missing on the other (the historical cause of
parity bugs — headword underline, English-gloss underline, and the per-sentence
speaker button had each drifted onto only the eip):

- **eip Examples tab** — `InfoCardTabContent.tsx` (`tabIndex === 1`), mounted by
  `InfoCardPanelBody`. This covers the flp, scp **and the saved-card cdp**, which since
  2026-08-24 raises the eip itself rather than its own copy of the sections
  (`VocabCardDetailPage` → `InfoCardSection`).
- **Read-only dictionary cdp** — `VocabCardDetailBody.tsx` (`VocabCardSections`),
  threaded from `features/dictionary/DictionaryCardDetailPage.tsx`.

Each per-sentence card carries: a top-right `SpeakerButton` (gated on
`onSpeakSentence`; all three surfaces pass `useTTS`'s `speakSentence` directly —
the MANUAL variant, so a speaker press speaks in every narration mode, including
`Off`. See [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md) § 4), the
`SegmentedSentenceDisplay` (with
`vocabWord`/`language` so the headword is underlined), and the English translation
rendered through `renderEnglishWithVocabUnderline` (`exampleSentenceText.tsx`, shared)
which underlines the `translatedVocab` substring.

**The two surfaces are now formatting-identical.** There is no surface-specific
prop left: the cdp used to pass `compact` (smaller glyph/pinyin for denser
stacking) and to omit `showSegmentSpaces`; both were removed so a sentence renders
byte-for-byte the same in the eip's Examples tab and in the cdp's
`vocab-card-detail__examples` `SectionCard`. The only remaining difference is the
chrome *around* the block — the cdp wraps it in a `SectionCard` with an
"EXAMPLE SENTENCES" `SectionLabel`, while the eip heads the tab with a `.shelfhd`
caption (2026-08-24, artboard 24) naming **which sense** the sentences illustrate
("sense 1 · the past") and how many there are.

That caption is not decoration. The sentence set CHANGES with the sense pick, and the
pick is made from a chip in the panel header directly above; without the caption a
learner who has just switched senses has no way to tell whether they are looking at the
new set or the old one. It lives in `InfoCardTabContent`, not in `ExampleSentenceList`,
precisely so the cdp — which has no sense strip over its box — does not inherit it.
(`SegmentedSentenceDisplay`/`CPCDRow` still accept `compact`; other cdp sections
use it. `ExampleSentenceList` just never passes it.)

### Word spacing is an account setting

`showSegmentSpaces` — "Show spaces between words", which makes
`SegmentedSentenceDisplay` render each segment as its own `CPCDRow` separated by
`SEGMENT_GAP_BY_SIZE` instead of one continuous row — is **account-level**:
`users."showSegmentSpaces"` (boolean NOT NULL DEFAULT false, migration
`129-add-show-segment-spaces-to-users.sql`).

| Layer | Where |
|---|---|
| Column | `users."showSegmentSpaces"` (migration 129) |
| Read path | `UserDAL.findById` select list (`server/dal/implementations/UserDAL.ts`); `User` / `UserUpdateData` in `server/types/index.ts` |
| Write path | `PUT /api/users/displaySettings` → `UserController.updateDisplaySettings` → `UserService.updateDisplaySettings` (`server/routes/userRoutes.ts`) |
| Client state | `AuthContext` `User.showSegmentSpaces` + `updateDisplaySettings()` (`src/AuthContext.tsx`) |
| Toggle UI | Settings page → **Display** section (`settings-page__display-section` / `settings-page__segment-spaces-row`, `src/pages/SettingsPage.tsx`), a `Paper` + `Switch` row matching the Narration section. **Chinese only** — rendered when `(user.selectedLanguage ?? 'zh') === 'zh'`, because Latin-script sentences always render spaced (`SegmentedSentenceDisplay`'s `isLatin` branch) so the switch would be a no-op for Spanish. `selectedLanguage` is nullable with a `'zh'` DB default, hence the `??`. |
| Consumer | `ExampleSentenceList` reads `useAuth().user?.showSegmentSpaces` directly |

It was previously a device-local flp toggle in
`useFlashcardLearnSettings` (localStorage `flashcard.learn-settings`) threaded down
`FlashcardsLearnPage → InfoCardSection → InfoCardPanelBody →
ExampleSentenceList`. The cdp had no way to reach that chain and so always rendered
un-spaced. `ExampleSentenceList` now reads the account value itself and **the prop
no longer exists on any of those components** — no caller can forget to thread it.
The flp settings sheet deliberately no longer listed the row — and that sheet is
itself gone as of 2026-08-28, when the last of its settings moved out.

### AI-generated vs human-approved styling

Every sentence arrives with a server-computed `humanApproved` flag (attached in
`enrichExampleSentencesMetadataBatch`, both zh + es branches): TRUE iff a
`validations` row with the approval stamp (`action = 'approve'`) matches the
sentence's **current** raw det object (docs/DATA_VALIDATION_SYSTEM.md).
Sentences without a valid approval render in the shared AI-generated treatment —
orange `COLORS.aiGenerated` border, ~8% tint, and an `AutoAwesome` "AI GENERATED"
badge (`src/theme/aiGeneratedStyling.ts` + `src/components/AiGeneratedBadge.tsx`,
same treatment as the dictionary
AI-fallback card). Approved sentences keep the quiet `flashcard.subtleBg`
background **and a transparent border of the same width as the AI one** — without it the
two states are different sizes and the whole list reflows as sentences get approved. Because the flag is computed at read time, a data deploy or backfill
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
  `onExampleSegmentClick`) → `InfoCardSection` → the two consumers
  (`FlashcardsLearnPage.tsx`, `SortCardsPage.tsx`), each passing
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

## Tap-to-drill (repeat tap narrows the selection)

A tap landing **inside the live selection** narrows it to the longest dictionary
headword still under the finger, instead of dismissing it: 中华人民共和国 → 人民 → 民 →
cancelled. Cancelling is now the *end* of that chain rather than the whole of it, so a
one-character segment still behaves exactly as before (tap to select, tap to dismiss) —
it reaches the floor of the chain immediately.

Full rule, the server-side rung construction and the other two surfaces that share it:
**[SEGMENT_DRILL_DOWN.md](./SEGMENT_DRILL_DOWN.md)**.

- **Where.** `toggleFromIndex` routes an inside-the-selection tap to `drillFromIndex`
  (`SegmentedSentenceDisplay.tsx`); any other tap starts a fresh selection. The picker
  itself is `pickDrillRung` (`src/utils/segmentDrill.ts`), shared with Word Search.
- **Data.** `segmentMetadata[segment].drill` — shorter det headwords inside the segment
  with their offsets, built at read time by `buildDrillRungs`. No stored column.
- **Whole-run citations** (long definition / compare) gain one rung above the segment:
  the phrase first, then the tapped GSA segment, then that segment's rungs. The popup is
  passive while the phrase is selected and becomes eip-tappable once the drill reaches a
  real headword.
- **Highlight and popup** need no special handling: both are computed from the
  selection's character range, so narrowing repaints for free.

## Tap-to-speak (single segment)

Tapping a segment **selects it and narrates it**.

> A companion **drag-scrub** gesture (a horizontal drag walked the selection word by
> word and narrated each one) was **removed on 2026-08-28** along with its
> `src/utils/segmentScrubLock.ts` claim, its `onScrubStart` prop, and the `"none"`
> axis it forced on the eip's tab swipe. Tap-to-speak is now the only per-word
> narration path, and horizontal gestures belong to the eip tab swipe unconditionally.

- **Where.** `toggleFromIndex` in `SegmentedSentenceDisplay.tsx` (the handler behind
  `CPCDRow`'s `onTapToggle` → cell `onTouchEnd`). It fires
  `onSegmentSpeak(segment, segmentMetadata[segment]?.pronunciation)` — the identical call
  so tap narration inherits the pinyin-hinted TTS cache key for free. Pronunciation comes from the selection
  itself (`SelectedRange.pronunciation`), falling back to
  `segmentMetadata[segment].pronunciation` — a drill rung is **not** a key in that map,
  only top-level segments are, so the rung carries its own pinyin hint.
- **Gating.** Narration only happens where `onSegmentSpeak` is wired, i.e. est
  (`ExampleSentenceList.tsx`). Long-definition, expansion-tab and citation displays pass no
  narration callback and stay silent on tap. Whole-run (citation) mode resolves an empty
  `segment`, so it is silent as well.
- **Select-only.** A tap that *cancels* the selection does not speak; every tap that
  lands on a segment or a drill rung does, including each rung of a drill-down (see
  Tap-to-drill above). `toggleFromIndex` therefore resolves the next range against
  `selectedRangeRef.current` and advances the ref synchronously instead of using a
  `setSelectedRange` updater — a side effect must not live inside an updater (StrictMode
  double-invokes them), and the synchronous ref write keeps a fast second tap correct.
- **Autoplay.** The call runs inside the `touchend` gesture, which by itself satisfies
  mobile autoplay policy — no separate `tts.cloud.unlock()` priming is needed.
- **Desktop.** Character cells select on hover (`onMouseEnter`) and only toggle on
  `onTouchEnd`, so tap-to-speak is a touch-path behavior; hovering never narrates.

## One selection at a time (cross-sentence deselect)

**Invariant: at most one segment selection exists in the app at any moment.** Selecting
a segment in one sentence clears the selection in every other mounted
`SegmentedSentenceDisplay`.

- **Why it needs enforcing.** Each sentence renders its own display with its own
  `selectedRange` state, and a display's tap-to-dismiss rule cannot tell its own
  characters from a sibling's — the capture-phase `pointerdown` rule
  (`rowRef.contains(target)`) treats a tap on *another* sentence's word as "not an
  outside tap". Left alone, tapping a word in sentence B leaves sentence A's word
  selected, and two popups are open at once.
- **Mechanism.** `src/utils/segmentSelectionOwner.ts` — a module-level registry of
  `{ token, clear }` owners, deliberately not React context (the displays are siblings
  under call sites with no shared state to lift into, and the claim must land
  synchronously inside a touch handler). Each display registers on mount with a stable
  identity token (`useRef({})`) and unregisters on unmount.
- **Claim points.** `selectFromIndex` (desktop hover) and `toggleFromIndex` (touch tap)
  call `claimSegmentSelection(token)` before writing their own state; the claim clears
  *other* owners only, so that ordering is safe. Every tap that resolves to a selection
  claims, drill rungs included; a tap that cancels does not — nobody else holds a
  selection to clear.
- **`clear` drops the ref too**, not just the state: `toggleFromIndex` reads
  `selectedRangeRef` to decide drill-vs-fresh-select, and a stale range there would make
  the next tap read as a drill into a selection this display no longer owns.
- **Scope is global, not per-est-block** — a selection in the long-definition or compare
  display is cleared by an est tap and vice versa, which is what "one popup on screen"
  should mean.

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
| **Tap-to-drill** | [SEGMENT_DRILL_DOWN.md](./SEGMENT_DRILL_DOWN.md) | A repeat tap narrows the selection to the longest headword still under the finger, down to a single character and then cancel. Shared with the long-definition display and the Word Search found-word review; rungs (`segmentMetadata[...].drill`) are built at read time from substrings the segmenter already loaded. |
| **Form modification** | [EXAMPLE_SENTENCE_FORM_MODIFICATION.md](./EXAMPLE_SENTENCE_FORM_MODIFICATION.md) | The segment popup shows the contextually inflected English gloss (right tense / number / POS form for *this* sentence) via the per-headword `wordForms` inventory + the per-segment `partOfSpeechDict`/`numberDict`/`tenseDict` signals, selected at runtime by `resolveWordForm`. |

## Consumers outside the est

The est tab is the main surface, but `exampleSentences` also ships on **game pool
cards** (`DICT_COLS` in `server/dal/shared/dictJoin.ts`, enriched by
`OnDeckVocabService.enrichEntriesPipeline`), and one game reads it:

| Surface | What it uses | Where |
|---|---|---|
| **Speed Reading finale** (rounds 19–20 of a run) | `foreignText` (both options are that sentence, one character apart), `english` (the prompt's translation line), and `_segments` + `segmentMetadata` via `buildSentencePronunciation` (the prompt's pinyin line **and** the TTS pinyin hint) | [SPEED_READING_GAME.md § The last two rounds are sentences](./SPEED_READING_GAME.md#the-last-two-rounds-are-sentences), `src/games/speed-reading/buildRound.ts`, `src/games/speed-reading/roundPrompt.ts` |

Two consequences for this pipeline: a sentence is only usable there if it
**literally contains its entry's headword** (the round alters one character of the
headword *in situ*), and `buildSentencePronunciation` — now at
`src/utils/sentencePronunciation.ts`, shared with the est list — returns
`undefined` unless every **Han-bearing** segment carries a `pronunciation`, in which
case both the prompt's pinyin line and the TTS hint are dropped for that round.

### Punctuation is skipped, not a missing pronunciation

Punctuation segments (`，`, `。`) have no det row and so never carry a
`pronunciation`. `buildSentencePronunciation` **skips** any segment with no Han
character rather than bailing on it. Until 2026-08-28 it bailed, which meant it
returned `undefined` for effectively every example sentence — they all end in `。` —
so the est speaker button and the Speed Reading sentence round both silently shipped
*no* pinyin hint to TTS and the provider guessed each reading. That was audible:
行家 was narrated *xíng jiā* inside a sentence while the cpcd above it read *háng jiā*.

The server half of the same fix is `buildPinyinSsml` (`server/services/TTSService.ts`),
which now aligns the hint's syllables to the text's **Han characters only** and passes
punctuation through as plain SSML text between the `<phoneme>` tags. Both halves are
required: the client must omit punctuation syllables and the server must expect them
omitted. A misaligned count (syllables ≠ Han characters) still bails to the plain-text
path, because one extra syllable shifts every reading after it.

## Related

- **Greedy segmentation** — [greedySegmentation.md](./greedySegmentation.md) (how the foreign text is split into segments)
- **cpcd rendering** — example sentences render through cpcd; long pinyin spacing is covered in [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md)

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
| Presentation (one sentence) | `src/components/SegmentedSentenceDisplay.tsx` | Renders one sentence's segments as cpcd; hover/tap shows the segment popup; draws the headword underline (`vocabWord`); hosts the drag-scrub gesture (see below) |
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
which underlines the `translatedVocab` substring.

**The two surfaces are now formatting-identical.** There is no surface-specific
prop left: the cdp used to pass `compact` (smaller glyph/pinyin for denser
stacking) and to omit `showSegmentSpaces`; both were removed so a sentence renders
byte-for-byte the same in the eip's Examples tab and in the cdp's
`vocab-card-detail__examples` `SectionCard`. The only remaining difference is the
chrome *around* the block — the cdp wraps it in a `SectionCard` with an
"EXAMPLE SENTENCES" `SectionLabel`, the eip renders it bare in the tab panel.
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
| Read path | `UserDAL.findById` select list (`server/dal/implementations/UserDAL.ts:91`); `User` / `UserUpdateData` in `server/types/index.ts` |
| Write path | `PUT /api/users/display-settings` → `UserController.updateDisplaySettings` → `UserService.updateDisplaySettings` (`server/routes/userRoutes.ts`) |
| Client state | `AuthContext` `User.showSegmentSpaces` + `updateDisplaySettings()` (`src/AuthContext.tsx`) |
| Toggle UI | Settings page → **Display** section (`settings-page__display-section` / `settings-page__segment-spaces-row`, `src/pages/SettingsPage.tsx`), a `Paper` + `Switch` row matching the Narration section. **Chinese only** — rendered when `(user.selectedLanguage ?? 'zh') === 'zh'`, because Latin-script sentences always render spaced (`SegmentedSentenceDisplay`'s `isLatin` branch) so the switch would be a no-op for Spanish. `selectedLanguage` is nullable with a `'zh'` DB default, hence the `??`. |
| Consumer | `ExampleSentenceList` reads `useAuth().user?.showSegmentSpaces` directly |

It was previously a device-local flp toggle in
`useFlashcardLearnSettings` (localStorage `flashcard.learn-settings`) threaded down
`FlashcardsLearnPage → InfoCardSection/InfoCardPopup → InfoCardPanelBody →
ExampleSentenceList`. The cdp had no way to reach that chain and so always rendered
un-spaced. `ExampleSentenceList` now reads the account value itself and **the prop
no longer exists on any of those components** — no caller can forget to thread it.
The flp settings sheet (`SettingsPanelBody`) deliberately no longer lists the row.

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

## Tap-to-speak (single segment)

Tapping a segment **selects it and narrates it** — the same per-segment narration the
drag-scrub uses, just for one word instead of a walked sequence.

- **Where.** `toggleFromIndex` in `SegmentedSentenceDisplay.tsx` (the handler behind
  `CPCDRow`'s `onTapToggle` → cell `onTouchEnd`). It fires
  `onSegmentSpeak(segment, segmentMetadata[segment]?.pronunciation)` — the identical call
  `step()` makes during a scrub, so tap narration inherits the parent's slow-rate wrapper
  (`slowExampleSentences`) and the pinyin-hinted TTS cache key for free.
- **Gating.** Narration only happens where `onSegmentSpeak` is wired, i.e. est
  (`ExampleSentenceList.tsx`). Long-definition, expansion-tab and citation displays pass no
  narration callback and stay silent on tap. Whole-run (citation) mode resolves an empty
  `segment`, so it is silent as well.
- **Select-only.** A tap that *deselects* (re-tapping the selected word, dismissing the
  popup) does not speak. `toggleFromIndex` therefore resolves the next range against
  `selectedRangeRef.current` and advances the ref synchronously instead of using a
  `setSelectedRange` updater — a side effect must not live inside an updater (StrictMode
  double-invokes them), and the synchronous ref write keeps a fast second tap correct.
- **Autoplay.** The call runs inside the `touchend` gesture, which by itself satisfies
  mobile autoplay policy — no separate `tts.cloud.unlock()` priming is needed on this path
  (unlike the scrub, whose audio starts from `pointermove`).
- **Desktop.** Character cells select on hover (`onMouseEnter`) and only toggle on
  `onTouchEnd`, so tap-to-speak is a touch-path behavior; hovering never narrates.

## One selection at a time (cross-sentence deselect)

**Invariant: at most one segment selection exists in the app at any moment.** Selecting
a segment in one sentence clears the selection in every other mounted
`SegmentedSentenceDisplay`.

- **Why it needs enforcing.** Each sentence renders its own display with its own
  `selectedRange` state, and a display's tap-to-dismiss rule cannot tell its own
  characters from a sibling's — both the scrub-enabled `pointerup` rule
  (`target.closest('.cpcd-row__char-cell')`) and the non-scrub capture-phase
  `pointerdown` rule (`rowRef.contains(target)`) treat a tap on *another* sentence's
  word as "not an outside tap". Left alone, tapping a word in sentence B leaves
  sentence A's word selected: two popups open at once, and two competing
  `claimHorizontalGesture()` claims, so the drag-scrub is ambiguous about which
  sentence it should walk.
- **Mechanism.** `src/utils/segmentSelectionOwner.ts` — a module-level registry of
  `{ token, clear }` owners, deliberately not React context (the displays are siblings
  under call sites with no shared state to lift into, and the claim must land
  synchronously inside a touch handler). Each display registers on mount with a stable
  identity token (`useRef({})`) and unregisters on unmount.
- **Claim points.** `selectFromIndex` (desktop hover) and `toggleFromIndex` (touch tap)
  call `claimSegmentSelection(token)` before writing their own state; the claim clears
  *other* owners only, so that ordering is safe. A deselecting tap does not claim —
  nobody else holds a selection to clear.
- **`clear` drops the ref too**, not just the state: the scrub's document-level
  listeners read `selectedRangeRef`, and a stale range there would let a drag resurrect
  a selection the display no longer owns.
- **Scope is global, not per-est-block** — a selection in the long-definition or compare
  display is cleared by an est tap and vice versa, which is what "one popup on screen"
  should mean.

## Drag-scrub (walk the selection word-by-word with audio)

While a segment is selected, a **horizontal drag started anywhere on screen** walks
the selection through that sentence one segment at a time and **narrates each word**
it lands on. This makes "read this sentence word by word" a single continuous
gesture instead of a tap-per-word.

- **Where.** `SegmentedSentenceDisplay.tsx` (the `SCRUB_*` constants + the drag-scrub
  `useEffect`). It is **opt-in per call site** via the `onSegmentSpeak` prop, wired only
  by `ExampleSentenceList` — long-definition/citation displays stay tap-only, and
  whole-run mode (`runTranslation`) is excluded since it has no word-by-word selection.
- **Only the sentence holding the selection reacts.** The document listeners are
  installed only while *that* instance has a `selectedRange`, so sibling sentences
  and other displays ignore the same drag.
- **Gesture.** `pointerdown` arms and remembers the origin → `pointermove` commits to a
  scrub once horizontal travel passes `SCRUB_LOCK_PX` (12px) **and dominates vertical**
  travel; vertical-dominant travel past `SCRUB_VERTICAL_ABORT_PX` disarms the gesture so
  the panel scrolls normally → thereafter every `SCRUB_STEP_PX` of travel ratchets the
  selection one segment and fires `onSegmentSpeak`. Listeners are
  `capture: true, passive: true` — the scrub never `preventDefault`s.
- **Tuning.** `SCRUB_STEP_PX` (currently **28px per word**) is the gesture's one knob;
  lower = more sensitive. The ratchet measures from the gesture's ORIGIN, not from where
  the axis locked, so the first word lands at exactly one step of travel rather than at
  lock distance + a full step.
- **The selection owns horizontal gestures.** While a segment is selected, the eip's
  swipe-to-change-tab **stands down** — otherwise one drag would both walk the words and
  slide the panel. The user deselects (tap off a word) to side-swipe the eip again.
  Mechanism: `src/utils/segmentScrubLock.ts`, a ref-counted module-level claim
  (`claimHorizontalGesture` / `isHorizontalGestureClaimed`) held for as long as a
  scrub-enabled selection exists. `InfoCardPanelBody`'s axis lock resolves horizontal
  intent to a new `"none"` axis when the claim is held: it `stopPropagation`s (keeping
  SheetPanel's vertical resize/dismiss listener out of the gesture) but leaves the track
  untouched and does **not** `preventDefault`, so the scrub's pointer events flow
  normally. **Vertical scrolling is never affected.** A plain module flag rather than
  context because both sides are raw non-React listeners needing a synchronous answer
  mid-gesture, with no re-render.
- **Ends of the sentence clamp** — no wrap, no hand-off to the neighboring sentence. On
  a clamp the ratchet re-bases to the current X so reversing direction responds
  immediately instead of first repaying the overshoot.
- **Steppable segments** = one entry per segment head, punctuation excluded (`scrubSegments`),
  matching what taps can select.
- **Tap/selection interactions** (the fiddly parts):
  - Tap-to-dismiss moved from `pointerdown` to `pointerup` **when scrub is enabled** (both
    the document handler and the row's own background handler): a scrub may start outside
    the row, and clearing on pointerdown would destroy the very selection the drag moves.
    On a no-scrub pointerup, anything that is not a `.cpcd-row__char-cell` and not the
    popup clears the selection — the previous behavior, one event later.
  - `suppressTapRef` blocks `selectFromIndex`/`toggleFromIndex` from the moment a scrub
    locks until `SCRUB_TAP_SUPPRESS_MS` (300ms) after it ends. Character cells select on
    `touchend`, and **touchend targets the element the touch started on**, so without this
    the drag's release would re-select the word it began over and undo the last step.
  - Gesture state lives in a **ref** (`gestureRef`), not the effect closure, because
    narration flips the parent's `speakingKey` mid-drag; closure state would reset the
    drag on that re-render. The callback props are likewise read through refs and kept
    out of the effect deps for the same reason.
  - `selectedRangeRef` is updated **synchronously** inside the step, since one fast
    pointermove can cross several step widths before React commits.
  - The scrub sets `document.body.style.userSelect = "none"` while locked (desktop mouse
    drags would otherwise paint a text selection across the page) and restores it on
    pointerup/cancel/unmount.
- **Audio.** `ExampleSentenceList` passes the existing `onSpeakSentence` callback as
  `onSegmentSpeak` — same `(text, pronunciation)` signature — so word narration inherits
  the parent's slow-rate wrapper and is absent whenever narration is off. Pronunciation
  comes from `segmentMetadata[segment].pronunciation` (the pinyin hint the cloud TTS
  cache keys on). `onScrubStart` fires on the gesture's `pointerdown` and calls
  `tts.cloud.unlock()` — the narration itself starts from `pointermove`, which mobile
  autoplay policy will not accept as the unlocking gesture (see `useTTS.unlockAudio`).
- **Scrub narration is debounced** by `SCRUB_AUDIO_DELAY_MS` (300ms): each step replaces
  the previous word's pending play (`queueSegmentNarration`), so sweeping across a
  sentence speaks only the word the drag comes to rest on instead of machine-gunning
  every word it crossed. A deliberate word-by-word drag is unaffected — each step
  outlasts the delay. The pending play is dropped when a tap supersedes it, when the
  selection is dismissed, when another display claims the selection, and on unmount, so
  audio can never arrive for a word that is no longer selected.
  **Tap-to-narrate is NOT debounced** — it is a single deliberate act, and it must fire
  inside the touch gesture to satisfy mobile autoplay policy. (Playing from a timer is
  fine for the scrub only because `onScrubStart` already unlocked the context on that
  gesture's pointerdown.)

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

# Reader Word Segmentation & Tap Navigation (gsa)

The Reader (`/reader`) navigates documents **word by word**: on mobile, a tap on the
right two-thirds of the screen advances the selection to the next word, the left third
steps back, and a caret placed anywhere auto-expands to the word containing it. The tap
region is the **whole screen below the display strip** (edge to edge, down to the bottom),
not just the reading box (`ReaderDocumentPage.tsx` → `.reader-page-tap-region`, which
mounts `ReaderTapOverlay`; `ReaderTapOverlay.tsx` → `TAP_LEFT_ZONE_FRACTION`).
"Word" here means a **gsa segment** — the same dictionary-aware greedy
segmentation used for example-sentence enrichment — so the tapped unit is
always something the dictionary (or the user's own vocab) can answer for.

Parent doc: [USER_DOCUMENT_FEATURE_SUMMARY.md](./USER_DOCUMENT_FEATURE_SUMMARY.md)
(document CRUD, validation docs). This doc covers only segmentation + navigation.

## Layering

| Layer | Piece |
|---|---|
| Client util (pure) | `src/reading/documentSegmentation.ts` — gsa port, span computation, navigation |
| Client util (pure) | `src/reading/phraseChunking.ts` (phrase rules), `wordRoles.ts` (one role per word), `phrasePick.ts` (the split keycap's pick-2), `readerDrill.ts` (tap inside the selection) — § "Phrase stepping" |
| Client state | `src/reading/useReadingText.ts` (`phrases`, `stepSpans`, `drillAtOffset`), `useReaderStepMode.ts` (the Phrase pill's per-device setting) |
| Client feature | `ReaderDocumentPage.tsx` (span memo) → `TextArea.tsx` (arrow keys) / `useTextSelection.ts` (auto select) / `ReaderTapOverlay.tsx` (tap gestures) / `ReaderCpcdView.tsx` (Pinyin display mode: renders the same spans as cpcd words and highlights the textarea's selected span — see USER_DOCUMENT_FEATURE_SUMMARY.md § Display modes) |
| Server (canonical algorithm) | `server/dal/shared/segmentString.ts` — `segmentWithDict` et al. (est enrichment) |
| Server (data source) | `POST /api/vocabEntries/byTokens` (`VocabEntryController.getEntriesByTokens`) |

There is **no segmentation API call**: segmentation runs entirely client-side on
data the reader already loads.

## Data flow

1. On document open, `useVocabularyProcessing` (`src/hooks/useVocabularyProcessing.ts`)
   extracts **every 1–4-character substring** of the document
   (`processDocumentForTokens`, `src/utils/tokenUtils.ts` — the client mirror of the
   server's `getAllSubstrings(maxLen=4)`) and fetches matching rows via
   `POST /api/vocabEntries/byTokens` → `loadedDictionaryCards` (det rows incl.
   `frequencyScore` + `matchException`) and `loadedPersonalCards` (vet rows).
2. `ReaderDocumentPage.tsx` memoizes the segmentation
   (`segmentSpans` `useMemo`, keyed on `selectedText?.content` + the two card
   arrays — **never on `token`**, per the silent-token-refresh rule in CLAUDE.md):
   - `buildReaderDictMap(dictCards, personalCards)` — word1 → `{frequencyScore}`;
     personal `entryKey`s are merged in (score 0) so user-created words are
     tappable. They are normally a subset of det, so segmentation is unaffected.
   - `buildExcludeSet(dictCards)` — `matchException` tokens suppressed from matching.
   - `computeSegmentSpans(content, dictMap, excludeSet)` → `SegmentSpan[]`.
3. Before the fetch resolves, the dict map is empty and Han runs degrade to
   per-character spans; the memo recomputes when the card arrays land and the
   spans upgrade to dictionary words. Document edits change `content` and
   recompute likewise (`processDocumentVocabularyIncremental` tops up the cards).

## The span model

```ts
interface SegmentSpan { start: number; end: number; text: string }
```

- Offsets are **UTF-16 code units** into the raw document string — directly
  consumable by `textarea.setSelectionRange`.
- Spans are sorted, non-overlapping, and cover **words only**: whitespace and
  punctuation produce no span and are skipped by navigation.
- `computeSegmentSpans` walks the document:
  - **Han runs** (`\p{Script=Han}+`) → the ported `segmentWithDict` (gsa).
    Unlike the server's `FOREIGN_RUN_REGEX`, CJK punctuation is *excluded* from
    runs (it should not be tappable).
  - **Everything else** → one whole-run `Intl.Segmenter(undefined, {granularity:'word'})`
    pass keeping `isWordLike` segments (Latin/es, Vietnamese, kana/hangul), with
    a letter/number-run regex fallback for engines without `Intl.Segmenter`.
    Whole-run matters: the pre-gsa implementation fed the segmenter two chars at
    a time, which mis-detects non-local boundaries (e.g. glued 借了|一本).

## The gsa port

`documentSegmentation.ts` `segmentWithDict` is a port of
`server/dal/shared/segmentString.ts:segmentWithDict`. **Keep the scoring rules in
sync when editing either side** (both files' headers cross-reference each other):
length tiers 4→1; per tier the highest `frequencyScore` wins (null = 0),
tiebreak later position; winner extracted, remainders recurse; per-char fallback.

Intentional divergences from the server version (not drift):
- **No `prioritySegments` pass** — that forces an est's headword; documents have
  no headword.
- **No `classifierTokens` pass** — classifier boundaries come from the
  example-sentence tagging pass (`partOfSpeechDict`), which documents lack.
- **Tiebreak alternatives** (extra output; scoring is identical) and **forced spans**
  (the learner's switches) — see § "Tiebreak alternatives" below.

## Tiebreak alternatives

The gsa can pick the wrong word when two **same-length** words overlap and
`frequencyScore` decides between them. Example: in 都怪我没治愈我的伤, 没治 (score 3)
beats 治愈 (null → 0, not yet processed by the backfill), which leaves 愈 stranded.
The Pinyin view lets the learner fix this in place.

**What counts as a tiebreak loser.** A candidate from the winner's length tier that
**overlaps** the winner. A same-tier candidate that does *not* overlap is not a loser,
because the remainder recursion still finds it. For each side of the winner, the
best-scoring overlapping loser is kept (same score-then-later-position rule as the
winner), so a chain AB | BC | CD with a BC winner yields **both** AB and CD.

**Data.** `SegmentSpan.alternatives?: SpanRange[]` on the winning span.

**Display (Pinyin mode only).** Only while the selected word is a tiebreak winner, each
loser is painted with the search-match wash (`readerSearchColors(...).match`, joined
into one box like a search match). The box covers the **whole** loser, including the
character it shares with the selected word: with 没治 selected, 治愈 is boxed, and on 治
the translucent yellow lies over the blue selection. The Text mode draws nothing.

**Switching.** A tap anywhere inside the yellow box (glyph, pinyin band, or the shared
cell) makes that word the selection. It is the only tap that overrides the Reader's
left/right zone step. Hit-testing is geometric (`readerAlternatives.ts` → `findAlternativeCellAt`
checks the bounding box of each `[data-reader-alternative]` cell), because the pinyin is not
inside its cell's DOM subtree:
- mobile: `ReaderTapOverlay` → `handlePointerUp` runs the check **before** the zone step
  and clicks the cell;
- desktop: `ReaderCpcdView`'s scroll box catches the click in the capture phase, so the
  word group's own onClick never runs.

Both paths call `src/reading/useSegmentOverrides.ts` → `switchToAlternative` (through the page: `ReaderDocumentPage`, or the cyoa `StoryPlayPage` for a passage). That adds the loser to
`segmentOverrides`, which reaches `computeSegmentSpans(…, forcedSpans)`. The forced word
is placed first and the rest of its Han run re-segments around it (没 | 治愈). The shared
span list then follows the switch in both modes and in navigation.

**Undo.** A forced span carries, as its `alternatives`, the unforced winner(s) that
listed it. In the example, 没治 is boxed while 治愈 is selected, and tapping it removes
the override (an alternative that overlaps an existing override means "undo"; a loser
can never straddle a forced span, because forced spans split the run).

**Lifetime.** Page session only, with no persistence. Overrides are tagged with the
content they were made against, so an edit or another document drops them. A forced span
that no longer fits its run (offsets or text changed) is ignored.

Code: `src/reading/documentSegmentation.ts` → `segmentRange` (losers),
`computeSegmentSpans` / `segmentDocument` (forced spans, switch-back);
`src/reading/useSegmentOverrides.ts` → `useSegmentOverrides`; `src/features/reader/ReaderDocumentPage.tsx` → `switchToAlternative`;
`src/reading/readerAlternatives.ts` → `ALTERNATIVE_CELL_ATTR`, `findAlternativeCellAt`;
`src/reading/ReaderCpcdView.tsx` → `paragraphAlternatives`,
`handleAlternativeClickCapture`, `ReaderCpcdParagraph` (`items` memo);
`src/reading/ReaderTapOverlay.tsx` → `handlePointerUp`;
`src/components/CPCDRow.tsx` → `CPCDRowItem.attrs`.
Tests: `src/__tests__/documentSegmentation.test.ts`.

## Navigation behavior

Helpers in `documentSegmentation.ts` (binary search over the sorted spans):

- `spanContaining(spans, pos)` — span with `start <= pos < end` (a caret exactly
  on a span's start counts as inside it).
- `spanAfter(spans, pos)` / `spanBefore(spans, pos)` — first span starting at/after
  pos, last span ending at/before pos.
- `selectRelativeSpan(textarea, spans, 'next' | 'prev')` — the single entry point
  for arrows and taps:
  - **next**: collapsed caret inside a word selects **that word**; otherwise the
    first span after the selection end. (The legacy code selected caret→word-end,
    a partial word; whole-word is deliberate.)
  - **prev**: last span ending at/before the selection start.
  - No-op at document edges; calls `scrollSelectionIntoView`
    (`textSelectionUtils.ts` — textarea geometry only (mirror div): scroll-into-view and
    `textareaOffsetAtPoint`; boundary logic removed).

Event wiring (one code path for keyboard and touch):

- `TextArea.tsx` `onKeyDown`: ArrowLeft/ArrowRight (when `autoSelectEnabled`) →
  `selectRelativeSpan`.
- `ReaderTapOverlay.tsx`: forward/back taps dispatch **synthetic
  ArrowRight/ArrowLeft keydown+keyup** into the textarea — the keyup makes
  React's onSelect polyfill fire `handleTextSelectionChange` (card lookup), which
  is why the overlay does not call `selectRelativeSpan` directly. Its long-press
  (WORD JUMP) selects the span under the finger through `useTextSelection` →
  `selectSpanAtOffset` (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Display modes).
- `useTextSelection.ts` `handleAutoWordSelect`: a collapsed caret (native tap /
  restored focus) expands to `spanContaining(spans, caret)`; drag selections are
  never clobbered.
- Card lookup is unchanged (`textSelection.ts` `findExactMatch` /
  `findDictionaryMatch`): selections are now gsa segments, so det/vet matches are
  the common case rather than the lucky one.

## Keyboards: reading mode vs edit mode

The reading box is a focused `<textarea>` (focus drives the caret, the word
highlight and arrow navigation, and `useTextSelection` → `handleTextAreaBlur`
re-asserts focus whenever it is lost), but it is **not for typing**. So in reading
mode it declines **both** keyboards:

- `inputMode="none"` — no OS soft keyboard.
- `data-beginner-keyboard="off"` — no app handwriting keyboard
  (docs/BEGINNER_KEYBOARD.md § 7a's opt-out). Without it, the provider's `focusin`
  trigger raised the keyboard on every one of the box's refocuses.

Edit mode (`useReaderContentEditor`, `ReaderEditToolbar`) drops both overrides, so
the learner's chosen keyboard comes up there and only there.

⚠️ **Each mode gets its own `<textarea>`** (`key` on the `TextField` in
`TextArea.tsx`). The beginner keyboard resets its field's `inputMode` to `''` when
it closes, and that cleanup lands after the exit-edit re-render; on a shared element
it stripped reading mode's `inputMode="none"` and the OS keyboard came back.
Remounting leaves that cleanup on the detached edit element. The cost is that
scroll offset and caret must be handed across the swap: `TextArea` snapshots them
from the outgoing element on the render where `editMode` flips, then focuses the
incoming edit element with them restored. That focus also matters for the keyboard:
a tap on an already-focused field fires no `focusin`, so without it nothing would
open until the learner tapped away and back.

Code: `src/reading/TextArea.tsx` → `TextArea` (`inputProps`, the `key`,
the read ⇄ edit hand-off effect); `src/features/beginnerKeyboard/eligibility.ts` →
`OPT_OUT_ATTRIBUTE`; `src/features/beginnerKeyboard/BeginnerKeyboardHost.tsx`
(the `inputMode` cleanup).

## Code / doc dependencies

- `src/reading/documentSegmentation.ts` — everything above; header notes
  the server cross-reference and the intentional divergences.
- `src/reading/ReaderCpcdView.tsx`, `ReaderTapOverlay.tsx`,
  `readerAlternatives.ts`, `ReaderDocumentPage.tsx` — tiebreak alternatives (§ "Tiebreak alternatives").
- `src/reading/TextArea.tsx` — reading/edit keyboard suppression and the
  per-mode textarea (§ "Keyboards: reading mode vs edit mode").
- `src/types.ts` `DictionaryEntry.matchException` — declared for the client
  because the gsa exclude set reads it (the API always sent it).
- `server/dal/shared/segmentString.ts` — canonical gsa; header points back here.
- CLAUDE.md § "Never reload/reset a page on a silent token refresh" — the span
  memo's dependency list is bound by this rule.

## Phrase stepping

Built 2026-11-23, no migration. A **Phrase** pill (`src/reading/ReaderPhraseToggle.tsx`), just
left of the Pinyin pill on the Reader's display strip and the cyoa story toolbar, makes one
forward / back tap select a whole **phrase** instead of one gsa word: 太多的 in one tap, not
three. Chinese texts only (the pill is not drawn for other languages). Per device
(`useReaderStepMode`, localStorage `reader.stepMode`), shared by the Reader and cyoa.

### Phrases come from grammar rules

The gsa can only pick dictionary headwords, and most phrases are not headwords (dev has no
det row for 太多 or 太多的). So something has to decide which neighbouring words belong
together. `phraseChunking.ts` → `chunkPhrases` does it with nine Chinese patterns over
**adjacent** words (no gap between them, so punctuation, spaces and line breaks always end a
phrase). At each word the longest matching rule wins; a word that matches nothing is a
one-word phrase. Verb phrases nest (below); otherwise rules do not chain.

| # | Rule | Examples |
|---|---|---|
| 1 | degree adverb (`DEGREE_ADVERBS`: 太 很 好 真 最 更 多 稍微 极其 …; 多 = the exclamative "how") + adjective [+ 的 / 了 / 地] | 太多的 · 很漂亮 · 多荒唐 |
| 2 | [第 \| determiner (`MEASURE_DETERMINERS`: 这 那 哪 每 几 某 各 上 下 好几 …)] [number, one or more words] + measure word (det lists `classifier` anywhere, or `MEASURE_WORDS`: pct's classifiers + time / measurement units); needs the determiner or a number | 三本 · 这个 · 这三个 · 三十五个 · 第二次 |
| 3 | **verb phrase**: [去 / 来 (`SERIAL_LEADS`) +] verb [+ complement: directional (`DIRECTIONAL_COMPLEMENTS`: 起 来 去 上 下 出 到 … 起来 出来 …) or resultative (`RESULT_COMPLEMENTS`: 完 好 见 懂 住 掉 错 清楚 …)] [+ 了 / 过 / 着]; also adjective + 了 | 吃了 · 收起 · 吃完了 · 去想 · 累了 |
| 4 | noun / pronoun / adjective / **verb phrase** + 的 (incl. 的 written for 得) | 我的 · 漂亮的 · 说的 · 收起的 |
| 5 | [scope adverb (`LEAD_ADVERBS`: 都 也 还 就 才 根本 千万 …) \| time adverb (`VERB_ADVERBS`)] + `NEGATORS` (不 没 没有 别 甭 不要 不用 从没 绝不 …) [+ adjective / **verb phrase** [+ 的]]; a bare negator needs the predicate, an adverb + negator does not | 不好 · 没去过 · 没想的 · 没去想 · 从没去想 · 都没有 |
| 6 | one-character verb / adjective doubled: X X · X 一 X · X 了 X | 看看 · 看一看 |
| 7 | time / frequency / manner adverb (`VERB_ADVERBS`: 再 又 已经 正在 马上 一起 重新 …) + **verb phrase** | 再争辩 · 已经吃了 · 马上去看 |
| 8 | [scope adverb] + pivot verb (`PIVOT_VERBS`: 请 让 叫 使 帮 教 麻烦 拜托 任 由 随 任凭 …) or preposition (`PERSON_PREPOSITIONS`: 为 给 对 跟 和 向 替 被 把 比 从 在 …) + person (`PERSON_PRONOUNS`: 你 您 我 他 … 大家 自己 别人). The person is required; 要 is left out (要我的书 is "want", rule 4) | 请你 · 就请你 · 任你 · 为你 · 给我 |
| 9 | noun / pronoun + localizer (`LOCALIZERS`: 上 下 里 中 外 前 后 … 上面 里面 旁边 之间 以后 … 这儿 那里) | 心上 · 家里 · 门外 · 我这儿 |

**Phrases nest.** Rules 4, 5 and 7 take a whole verb phrase (rule 3), not one verb, so the
joins compose: 去想 (go to think) → 没去想 (didn't go to think) → 从没去想 (never went to
think). `phraseChunking.ts` → `verbPhrase` / `predicate` build the inner phrase; the outer
rule wraps it. Outside the verb phrase, rules still do not chain (一个 | 很好的 stay two).

**Word lists, not special cases.** Every rule is a grammar pattern over word CLASSES. Where
det's part of speech is too coarse to name the class, the class is a closed list of
function words (det tags 太, 都 and 再 all "adverb", but only 太 is a degree adverb, only 都
a scope adverb that leads a whole predicate, only 再 a time adverb that joins its verb). No
rule names a particular sentence or a particular content word. One list per class, shared
by every rule that uses the class (`LEAD_ADVERBS` serves rules 5 and 8). Each list was
filled out as completely as its class allows (2026-11-23; the measure words start from the
pct table's classifiers). A word may sit in two classes when it really does both jobs (多:
degree "how" and manner "more", 多吃). A listed function word never stands in for an
unprocessed content word (`FUNCTION_WORDS`), even before its own det row is enriched.

`MEASURE_WORDS` covers common measure words whose LEAD part of speech is something else
(只 leads with "adverb"). It is only consulted right after a number or determiner.

### One role per word

`wordRoles.ts` → `wordRole`: the det row's **lead** part of speech (`partsOfSpeech[0]`).
"Lists X anywhere" would be wrong, because 多 lists `numeral` and 一 lists `adjective`.
`ROLE_OVERRIDES` pins a few closed-class function words whose lead part of speech is a role
they rarely play in running text: 在 / 给 / 比 / 对 / 跟 / 把 → preposition, 和 → conjunction,
得 / 地 / 过 / 着 / 了 → particle. ⚠️ Owner sign-off on this map is pending (2026-11-23). A
word with no det row, or with no part of speech yet (the backfill has not reached it), has
no role (`isUnprocessed`). It counts as whichever **content word** a rule wants (the
adjective, verb or noun a rule wants): next to those grammar words that is by far the
likeliest reading, and without it every unprocessed word breaks its phrase (太残忍的,
没纠缠, 放弃的 on dev). Rule 6 and the measure rule stay strict.

### Step units vs words

`useReadingText` returns **`spans`**, the gsa words, which are still what is drawn, read
aloud, searched and listed in the split keycap. It also returns **`stepSpans`**, which is
the phrases with the pill on and the words with it off. Everything
that *selects* walks `stepSpans`:
- `TextArea` arrow keys and the overlay's synthetic arrows (pages pass
  `segmentSpans={stepSpans}`);
- `useTextSelection`: auto-select of a placed caret, and the long-press WORD JUMP
  (`selectSpanAtOffset`);
- `ReaderCpcdView` clicks, through its `stepSpans` prop. The long-press WORD JUMP in Pinyin
  mode clicks a word, which then selects that word's phrase.

### Tap inside the selection

A short tap **on a character of the current selection** narrows it instead of stepping:
phrase → the gsa word under the finger → the longest headword inside it covering the tap →
the character. A tap on a single character does nothing; unlike the est's tap-to-drill
(SEGMENT_DRILL_DOWN.md), the chain never cancels the selection. It works the same with the
pill off (word → sub-word → character). After a drill, the next forward or back tap steps by
the pill's unit from the drilled range, so it lands on the next phrase rather than on the
rest of the old one. Sentence mode never drills: a tap there still steps out of the sentence.

Code: `readerDrill.ts` → `drillAt` (pure); `useReadingText` → `drillAtOffset`;
`ReaderTapOverlay` → `onTapInsideSelection` (mobile, checked after the tiebreak-alternative
hit test and before the zone step). The offset under the finger comes from
`textareaOffsetAtPoint` in text mode and from the cpcd cell's `data-reader-offset`
(`readerAlternatives.ts` → `READER_OFFSET_ATTR`, `findOffsetAt`) in Pinyin mode.
Desktop: the Pinyin view's click-capture (`ReaderCpcdView` → `handleDrillClickCapture`). The
desktop **Text** mode has no drill yet: a native click inside a selection collapses the
caret, and auto-select re-expands it to the step unit.

### What a phrase selection shows

- **Highlight.** Text mode: the textarea's own selection. Pinyin mode: any selection that is
  not exactly one word (a phrase, a drilled character) is painted cell by cell and joined
  into one box, like a sentence (`ReaderCpcdView` → `rangeSelection`, `paintedRange`).
- **The keycap splits into two halves** (USER_DOCUMENT_FEATURE_SUMMARY.md § "Split-screen
  keycap"). The two words come from `phrasePick.ts` → `pickPhraseWords`.
- **Tap-to-hear speaks the whole phrase** as one clip (owner's call 2026-11-23):
  `useReadingKeycap` → `phraseSpeech` → `useTTS` → `surfaceAutoSpeakText`. The words'
  readings are joined when every word has one.

⚠️ Known gaps: tap-to-hear **preloading** (`useReaderAudioPreload`) still prefetches word
clips, so a phrase's first play is a cold synthesis. The rules have not been tuned against
real documents.

Tests: `src/__tests__/phraseChunking.test.ts` (rules, `wordsCoveringRange`,
`pickPhraseWords`, `drillAt`).


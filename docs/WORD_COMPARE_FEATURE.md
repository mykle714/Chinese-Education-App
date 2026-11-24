# Word Compare Feature — the Compare panel

> Status: **BUILT.** Design questions were resolved with the user on 2026-07-07 and
> 2026-07-26 (see [Resolved decisions](#resolved-decisions)). The surface was reworked twice:
> on **2026-09-04** the standalone `/compare` page became a sheet, and on **2026-11-21** the
> eip's Compare crumb was removed so Compare is **one standalone panel everywhere**, laid out
> as the eip's tinted band + white shelf (see [Added 2026-11-21](#added-2026-11-21)).

A learner looking at a word often wants to know how it differs from a near-synonym (高兴 vs
开心, ser vs estar). Compare lets them pick a second word, then fetches an AI-generated
explanation of the difference (server-cached, so each distinct pair is billed at most once)
and displays it.

---

## One surface: the Compare panel

There is exactly one Compare surface, the **Compare panel**: `CompareSheet`
(`src/features/flashcards/compare/CompareSheet.tsx`), raised through `useCompareSheet`
(`compare/useCompareSheet.tsx`). It is a modal `SheetPanel` of its own, never a tab or crumb
inside the eip.

| Host | Entry point | When an eip is open |
|---|---|---|
| flp (`FlashcardsLearnPage`) | the `Compare` tower plate on `WordToolsRail` above the card (flips the card to the answer first — `revealAnswer`) | `closeEip()`, then `openCompare(word)` |
| td's card view (`deckTower/cardView/TowerCardView`; replaced the routed saved-card cdp 2026-11-23) | the `Compare` tower plate on the flp-style rail above the hero card (Compare + Customize only) | `setInfoOpen(false)`, then `openCompare(word)` |
| Dictionary page and Reader (`EipSheet` with `showWordTools`) | the `Compare` pill at the bottom of the eip's definition tab | the pill is INSIDE the eip, so it closes it (`onClose()`) and opens the panel at the eip's own `depth` |

**Compare never stacks over the eip** (owner's call 2026-11-21). The eip closes first, and the
panel slides up on its own. Because `EipSheet` owns the panel (`useCompareSheet` lives there,
outside the eip's `open` guard), the panel outlives the eip it was opened from. On the Dictionary
page and in the Reader the rail sits under whichever word the eip is showing, so a word the
learner DRILLED INTO can be compared too. On the flp and td's card view the rail acts on the card's word.

acp mounts `EipSheet` without `showWordTools`, so it has no Compare entry point.

Slot A is seeded with the calling word. Every entry point starts from a word, so there is no
cold open (the "Compare Words" hub tile went with the `/compare` page, 2026-09-04).

### State resets on every open

Decided 2026-09-04. `useCompareSheet` keys the mounted panel on a session id, so each open mounts a
fresh component, and slot A is the INITIAL value of its state hook (never an effect, which
would re-seed on every identity change of the entry object). Closing discards everything.
Re-comparing a pair costs no extra AI call, because `word_comparison_cache` serves it.

### Compare earns minute points

The panel has no route, so it accrues through its HOST: the flp and td's card view (both
study surfaces claimed by `DeckTowerPage` through `useClaimStudySurface`,
`src/minutePoints/studySurface.ts`) and the Dictionary page (`MINUTE_POINTS_ELIGIBLE_PAGES`,
`src/constants.ts`).
The learner reading a comparison earns for as long as they keep interacting (the 15-second
activity window still applies). The panel itself draws **no** flame (2026-10-06: pull-up
dictionary flows never show the counter). Earning is unaffected, because it rides the host
page's header, which stays mounted under the sheet.
⚠️ A future surface that raises the panel from a non-earning page would silently stop Compare
earning there. See [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)
§ "The cdp, the dictionary, and Compare all earn".

References: `src/features/flashcards/compare/useCompareSheet.tsx` → `useCompareSheet`;
`FlashcardsLearnPage.tsx` → `handleCompare`; `deckTower/cardView/TowerCardView.tsx` → `handleCompare`;
`EipSheet.tsx` → `handleCompare`; `src/components/WordToolsRail.tsx` (the `Compare` pill).

---

<a id="layout"></a>
## Layout: the eip's band + shelf

The panel uses the eip's own two-panel chrome and palette. That keeps the two sheets
recognisably the same object, and it follows the app theme the same way (`useEipPalette`,
cornflower band in light themes, slate in Dark).

```
┌──────────────────────────────────────┐   UPPER — tinted `ground` (EipUpperPanel)
│  ⌄                Compare            │   title row: telescopes in toward max only
│     ┌──────────┐  vs  ┌──────────┐   │
│     │ gāo xìng │      │          │   │   CompareSlots: two equal raised SQUARE keys —
│     │  高 兴   │      │    ＋    │   │   a word (lg cpcd block) or a "+";
│     └──────────┘      └──────────┘   │   2-state: up, or DOWN (sunk) while searching
│     ▔▔▔▔▔▔▔▔▔▔▔▔      ▔▔▔▔▔▔▔▔▔▔▔▔   │
╭───────────────── ═══ ────────────────╮   LOWER — white shelf (EipShelf) + its grabber
│ [ 你好 · nǐ hǎo · ni3 hao3        ]   │   CompareShelfBody:
│ english “happy”                      │     SEARCH  the Dictionary page's search
│ ┌──────────────────────────────────┐ │             (field, labelled slabs, ∞ scroll)
│ │ 开心  kāixīn   happy; joyful     │ │     RESULT  the AI comparison paragraph
│ │ 快乐  kuàilè   happy; cheerful   │ │
╰──────────────────────────────────────╯
```

| Part | Component | Notes |
|---|---|---|
| Sheet | `CompareSheet` → `SheetPanel` | the eip's options: `showClose={false}`, `showGrabber={false}`, `edgePadding={false}`, `squeezeOnOverstretch`, `surface={palette.ground}`, a `telescopeRef`. Opens at **0.8** of the frame (`COMPARE_OPEN_HEIGHT_RATIO`), taller than the eip's 0.6 — chosen when the shelf opened straight onto a search; under review now that it opens on the hint. |
| Upper band | `EipUpperPanel` (shared with the eip) | `title="Compare"`, no trail, no speaker, no Add key; `header` = `CompareSlots`. The down caret closes the panel (`dismiss`). The trail row still exists, holding only the caret. Its leading cluster keeps its width with no speaker, so the band's geometry matches the eip's. |
| Word keycaps | `compare/CompareSlots.tsx` | the eip headword tile's recipe (`EipEntryHeader`): palette `face` on a 4px `edge` lip, 1px outline, the rounded edge (`theme/roundedEdge.ts`), `keycapPressSx`. Both keys are the same fixed 140px square, filled or empty (`SLOT_SIZE`), and the word renders at cpcd `lg` (`SLOT_CPCD_SIZE`) so the largest slot content — a four-character 2×2 block, ≈ 124px — fits; at `xl` it would not, and two squares must fit the 393px band beside the "vs". **Two states**: up, or DOWN while its search is open — the press held (`restY` = the lip, lip shadow dropped), as EipAddKey's "Added!" rests low; no highlight ring. A muted "vs" sits between them. |
| Shelf | `EipShelf` (extracted from `InfoCardSection` 2026-11-21, shared with the eip) | rounded white shelf, 3px `edge` lip, own grabber (a resize handle) |
| Shelf body | `compare/CompareShelfBody.tsx` | the panel's ONE scroller, the `{root, scroll}` handle SheetPanel binds to; `touch-action: pan-y` |

### The slots and the search

Which slot the shelf's search fills is a pure rule: `compareState.ts` → `activeSearchSlot(state, requested)`.

- **Search mode is always the learner's choice** (owner's call 2026-11-21, revised the same
  day from an auto-opening search). With nothing tapped, the shelf shows the comparison, or —
  while a slot is empty — the hint "Tap the + to pick a word to compare."
- **A keycap is a 2-state latch** (`requestedSlot` in `CompareSheet`). Tapping an up key presses
  it down and opens the search for that slot (fill or replace), releasing the other key if it
  was down. Tapping the down key pops it up and puts the search away.
- **Picking a row** fills the down key's slot, clears the cached paragraph (it described the old
  pair), and releases the key. The shelf then shows the hint (other slot still empty) or fires
  the new comparison.
- **There is no delete.** A word is replaced, never cleared. The old tap-to-arm /
  tap-again-to-delete gesture (`WordSlot`'s red ring) was retired with the eip tab.
- The search is keyed on the slot, so switching slots starts a fresh query.

### The search

`src/components/DictionaryWordSearch.tsx` is shared with the Writing Notebook's word picker.
Since 2026-11-21 it is the **Dictionary page's search** minus what only a lookup page needs:

| Taken from the Dictionary page | Shared module |
|---|---|
| 50px field, 14px corner, 2px ink focus ring; the format placeholder (`你好 · nǐ hǎo · ni3 hao3`); opens on the OS keyboard; return key labelled "Search" | `src/components/dictionarySearch/dictionarySearchField.ts` → `dictionarySearchFieldSx`, `dictionarySearchPlaceholderFor` |
| Accent keypad above the field for **es only**. Zh types tone vowels on the beginner keyboard's ā pad. | `dictionarySearchField.ts` → `showsInlineKeypad`; `src/components/PinyinKeypad.tsx` |
| Labelled white slabs: segment groups, or one slab per match kind (English “…”, Pinyin “…”, starts with …, Other) | `src/components/dictionarySearch/DictionarySearchResults.tsx`, `DictionaryResultParts.tsx`, `dictionaryMatchSections.ts` |
| Infinite scroll, 50 rows a page | `DictionaryResultParts.tsx` → `DictionaryLoadMore` (`scrollRootSelector` = the host's scroller: `.compare-shelf-body` / `.notebook-word-picker`) |
| The recessed "Nothing for “…”" well | `DictionaryResultParts.tsx` → `DictionaryNoResultsWell` |

**Left out on purpose** (owner's call 2026-11-21): **Ask AI**, because an AI answer is not a det
row, so it could not be picked or used to ground a comparison; and **search history**.

Colours come from a `Tier2Look`, the dictionary pieces' colour contract. The Dictionary page
passes its time-of-day look. The Compare panel passes `eipShelfLook(palette)`
(`FlashcardsLearnPage/eipPalette.ts`), which follows the app theme like the rest of the panel.
The notebook picker's sheet is white in every theme, so it passes the light shelf look.

The pickable filter (`compareState.ts` → `isPickableFor`) offers words of up to four characters
(an xl cpcd block, `COMPARE_MAX_CHARS`) and drops the word already in the OTHER slot (the server
refuses a word compared with itself). A query whose only hits are filtered out shows the
no-results well.

Focusing the field maximizes the sheet as the keyboard rises (`data-sheet-maximize-on-focus` on
the field's wrapper; [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § "Keyboard and popups").
Both slots are language-locked to slot A's language, and the search hook is scoped to the
learner's selected language, which matches.

### The result

`CompareShelfBody` owns `useWordComparison` (the in-flight request). It fires once both slots
are filled and no paragraph is cached for the pair, and it hands the result back through
`onResult`. `CompareSheet`'s `state.comparison` stays the source of truth. The body is
mounted for the panel's whole life, so a comparison already running keeps running while the
learner opens the search to look at a replacement. States: "Comparing…", the daily-limit note,
a tap-to-retry error, then the paragraph. It renders through `LongDefinitionDisplay`, always with
the AI-generated treatment. Embedded Chinese renders as inline cpcd with a **passive** definition
popup (no `onSegmentOpen`): the eip closed when Compare opened, so there is nothing to drill into.

### Client state rules

- Per the token-refresh rule, any load effect keys on stable auth identity, never `token`; the
  compare fetch builds headers via `authHeader()` (see CLAUDE.md ⛔ rule /
  [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md)).
- The `xl` `CPCDSize` was added for the slots (`COLUMN_WIDTH`, `CHAR_FONT_SIZE`,
  `PINYIN_RESERVED_HEIGHT` in `cpcdLayout.ts`; `PLAIN_CHAR_FONT` / `PLAIN_COMPACT_CHAR_FONT` in
  ForeignText). Since 2026-11-21 the slots render at `lg` (their fixed square cannot hold an xl
  2×2 block), leaving Speed Reading's option glyphs (`src/games/speed-reading/constants.ts` →
  `OPTION_GLYPH_SIZE`) as xl's only user.

---

## Server flow

New endpoint (auth required): **`POST /api/dictionary/compare`** — body
`{ wordA, wordB, language, tz }`.

```
1. Guard        both words non-empty, same supported language ('zh' | 'es'), wordA ≠ wordB.
2. Canonicalize sort the pair (codepoint order) — (高兴, 开心) and (开心, 高兴) share one row.
3. Cache read   SELECT from word_comparison_cache by (wordA, wordB, language).
                Hit → return it (free — never consumes a daily-limit slot).
4. Limit gate   on a miss, check the caller's count in dictionary_ai_usage for their local
                streak-day (streakDateOf + tz); at DICTIONARY_AI_DAILY_LIMIT → RateLimitError
                → HTTP 429. SHARED budget with dictionary AI lookups (decided).
5. AI call      DICT_AI_API_KEY (shared key — decided), claude-sonnet-4-6, cache_control
                static system block + tiny volatile user message. Both words' det definitions
                (+ partsOfSpeech) are inlined as grounding so the model explains THESE senses.
                No web-search tool (both words are known) — cheaper/faster than the fallback.
                Returns a { paragraph, citations } envelope (see below), max_tokens 1200.
6. Count        increment dictionary_ai_usage once the model call completes (billed = counted).
7. Cache write  upsert the paragraph AND its citations into word_comparison_cache; return them.
```

- Mirrors the dictionary AI-fallback pipeline
  ([DICTIONARY_AI_FALLBACK_SEARCH.md](./DICTIONARY_AI_FALLBACK_SEARCH.md)): same lazy Anthropic
  client pattern, prompt-caching shape, `RateLimitError` → 429 mapping, and streak-day bounding.
- **Response shape: a `{ paragraph, citations }` JSON envelope** (2026-07-26; superseded the
  original bare-prose contract). `paragraph` is unchanged — one concise paragraph (~3–5
  sentences) contrasting the two words, register, typical contexts, one short inline example
  each, plain text, no markdown. `citations` is one `{ zh, en }` per maximal Chinese run
  quoted in the paragraph, copied verbatim so it joins back to the rendered run.
  **Why in the same call** rather than a follow-up translation pass: Compare is a live path on
  a shared daily budget, and the budget is sized around ONE call per pair.
- **Parsing degrades, never throws** (`parseComparisonResponse`, exported from
  `DictionaryService.ts`): strict `JSON.parse` first; then a field-level salvage that pulls
  `paragraph` and each well-formed `{zh, en}` out positionally — the observed failure is a
  model writing an unescaped `"` inside the paragraph, which is valid English and invalid
  JSON; then, failing everything, the whole response is treated as the paragraph with no
  citations, i.e. exactly the pre-2026-07-26 behavior. The prompt separately asks the model
  not to use double quotes inside string values.
- **Chinese only.** The es prompt asks for an empty `citations` array: Spanish comparison text
  embeds no Han runs, so the parts splitter produces nothing to attach a translation to.
- A model/parse failure returns an error **without caching** (transient), matching the fallback's
  behavior; the client shows a retryable error note.

---

## Data model — `word_comparison_cache` (migration 105, **confirmed 2026-07-07**)

```sql
CREATE TABLE word_comparison_cache (
  id           serial PRIMARY KEY,
  "wordA"      varchar     NOT NULL,   -- canonically-ordered pair: wordA < wordB (codepoint order)
  "wordB"      varchar     NOT NULL,
  language     varchar(8)  NOT NULL,   -- 'zh' | 'es'; both words are in this language
  comparison   text        NOT NULL,   -- the AI paragraph (free text — decided)
  citations    jsonb,                  -- migration 127: [{zh, en}] translations of the Chinese runs quoted in `comparison`
  model        varchar,                -- model id that produced it (regeneration bookkeeping)
  "queriedAt"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("wordA", "wordB", language)
);
```

- **Cache key = unordered pair + language** (decided): the service sorts the two words before
  both read and write, so A/B and B/A directions share one row and one model call. The prompt
  is symmetric, so direction carries no meaning.
- Unlike `ai_dictionary_cache` there is no "empty result" state — the model always produces a
  comparison — so no NULL-marker/staleness machinery. `queriedAt` supports manual
  invalidation/regeneration later.
- The `UNIQUE` constraint doubles as the read-path index.
- **`citations` (migration 127)** — same `{ zh, en }` shape as
  `dictionaryentries_zh."longDefinitionCitations"` (migration 126,
  [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) form #5b), because both feed the same
  renderer: `DictionaryService.withComparisonParts` hands them to
  `enrichLongDefinitionMetadataBatch`, which sets `translation` on the matching `foreign` part,
  and `LongDefinitionDisplay` then renders that run as ONE tappable unit — tap anywhere in the
  Chinese and the whole run highlights with its English translation, instead of glossing the
  tapped word. A translated run is not drillable (a quoted phrase is not a headword).
- **Cached citations are a SUPERSET of what renders.** The model cites the two compared
  headwords (and other real words) constantly, but the read path applies a citation **only to
  a run that has no `dictionaryentries_zh` row** — a dictionary word keeps its per-segment
  popup and its eip drill-in, which whole-run mode would remove (see
  [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) form #5b). In practice only the paragraph's
  example *sentences* render translated. The filter lives at read time, in
  `segmentLongDefinitionTexts`, rather than pruning at write time: the generator cannot know
  det's contents, and a stored citation must stop rendering by itself once its phrase is later
  added to det. Nothing is filtered on the way into the cache.
- **Rows cached before migration 127 keep `citations` NULL and are NOT invalidated** (decided
  2026-07-26): they serve exactly as they always have, with per-segment popups, and only gain
  citations if that pair is ever regenerated. No bulk regeneration — an old pair isn't worth an
  AI call nobody asked for.

---

## Layers

| Layer | File | Responsibility |
|---|---|---|
| Migration | `database/migrations/105-create-word-comparison-cache.sql` (**new**) | the cache table |
| Migration | `database/migrations/127-add-citations-to-word-comparison-cache.sql` | `citations jsonb` — run translations (nullable; old rows keep NULL) |
| DAL | `server/dal/implementations/DictionaryDAL.ts` | `getComparison(wordA, wordB, language)`, `upsertComparison(..., citations)`; `buildCitationMap` + `segmentLongDefinitionTexts(texts, language, citationsByText)` attach `translation` to each `foreign` part; reuses `getAiUsageCount` / `incrementAiUsage` |
| DAL iface | `server/dal/interfaces/IDictionaryDAL.ts` | new method signatures |
| Service | `server/services/DictionaryService.ts` | `compareWords(...)` — canonical ordering, cache, shared limit gate, `{paragraph, citations}` prompt build with det-definition grounding, upsert; `parseComparisonResponse` (exported, degrading parser); `withComparisonParts(comparison, language, citations)` |
| Controller | `server/controllers/DictionaryController.ts` | `compare` handler (`tz` → `usageDate`; `RateLimitError` → 429) |
| Routes | `server/routes/dictionaryRoutes.ts` | `POST /api/dictionary/compare` |
| Types | `server/types/*`, `src/types.ts` | compare request/response types |
| Client hook | `src/hooks/useWordComparison.ts` (**new**) | fires the compare request; loading / error / `limitReached` states |
| Client state | `src/features/flashcards/compare/compareState.ts` (**new** 2026-11-21) | `CompareState`, `EMPTY_COMPARE_STATE`, `activeSearchSlot` (which slot the search fills), `isPickableFor` (the search filter), `COMPARE_MAX_CHARS`; tested in `compare/__tests__/compareState.test.ts` |
| Client UI | `src/features/flashcards/compare/CompareSheet.tsx` (**new** 2026-11-21; replaced `src/components/CompareSheet.tsx`) | the panel: `SheetPanel` + `EipUpperPanel` (slots in the header row) + `EipShelf` + `CompareShelfBody`; owns `CompareState` + `requestedSlot`, reset per open |
| Client hook | `src/features/flashcards/compare/useCompareSheet.tsx` | `useCompareSheet` → `openCompare` / `closeCompare` / `compareSheet` wiring for a host (session-keyed remount; `depth` read at open time) |
| Client UI | `src/features/flashcards/compare/CompareSlots.tsx` | the two raised word keycaps + "vs" in the tinted band; two equal 140px squares; 2-state (down while searching) |
| Client UI | `src/features/flashcards/compare/CompareShelfBody.tsx` (replaced `src/components/CompareWorkspace.tsx`) | the shelf: the mini search or the comparison; owns `useWordComparison`; `{root, scroll}` handle |
| Client UI | `src/features/flashcards/FlashcardsLearnPage/EipUpperPanel.tsx`, `EipShelf.tsx`, `EipPaletteContext.tsx`, `useEipPalette.ts`, `eipPalette.ts` → `eipShelfLook` | the eip chrome and palette the panel reuses |
| Client UI | `src/components/sheet/SheetPanel.tsx`, `src/components/sheet/sheetStyled.ts` | the maximizable bottom-sheet primitive |
| Route / nav | — | **Nothing.** `/compare`, `ComparePage.tsx`, the `routeMeta`/`registry` rows and the hub's "Compare Words" tile were all deleted 2026-09-04; Compare has no route |
| Hosts | `FlashcardsLearnPage.tsx`, `deckTower/cardView/TowerCardView.tsx`, `FlashcardsLearnPage/EipSheet.tsx` (Dictionary page, Reader) | each → `handleCompare`: close the eip, `openCompare(word)` |
| Shared util | `src/utils/dictEntryAdapter.ts` | `dictionaryEntryToVocabEntry` — a picked search row → the slot's `VocabEntry`; also `src/api/dictionary.ts` |
| Client UI | `src/components/LongDefinitionDisplay.tsx`, `src/components/SegmentedSentenceDisplay.tsx` | shared renderer; `runTranslation` puts a translated run into whole-run (passive) mode |
| Client UI | `src/components/WordToolsRail.tsx` | the `Compare` pill: above the card on the flp and td's card view (`TowerCardView`); at the bottom of the eip's definition tab on `EipSheet` hosts with `showWordTools` (Dictionary page, Reader). Self-hides when `onCompare` is omitted |
| Client UI | `src/components/DictionaryWordSearch.tsx` | the mini search (shared with the Writing Notebook picker) — see [The search](#the-search) |
| Client UI | `src/components/dictionarySearch/` (**new** 2026-11-21) | `DictionarySearchResults.tsx`, `DictionaryResultParts.tsx`, `dictionaryMatchSections.ts`, `dictionarySearchField.ts` — the Dictionary page's result layout and field, shared with the mini search |
| Client UI | `src/components/PinyinKeypad.tsx` | shared tone-vowel / accent keypad (es only above the dictionary fields) |
| Client UI | `src/components/CPCDRow.tsx`, `src/components/ForeignText.tsx`, `src/components/CPCDBlock.tsx` | the slots' `lg` cpcd block (the `"xl"` size added for them is now unused here) |
| Deleted 2026-11-21 | `src/components/CompareWorkspace.tsx`, `src/components/CompareSheet.tsx`, `src/components/WordSlot.tsx`; `useEipTabs`' `CompareEipTab` / `openCompareTab` / `setCompareSlot` / `setCompareResult` and the `EipTab.kind` discriminator; `InfoCardSection`'s `compareTab` / `onSetCompareSlot` / `onCompareResult` props | — |
---

## Cost & rate limiting

Per uncached compare: one model call, no web search → roughly the base-call cost of the
dictionary fallback's no-search path. The pair space over det words is n² — the cache alone
doesn't bound spend — so the **shared per-user daily cap** (`DICTIONARY_AI_DAILY_LIMIT` via
`dictionary_ai_usage`, decided) is the real bound, same reasoning as the fallback's
English-query space. Cache hits are always free and don't consume a slot.

---

<a id="resolved-decisions"></a>
## Resolved decisions (2026-07-07)

1. **New table `word_comparison_cache` (migration 105)** — confirmed as proposed.
2. **Cache key** — unordered (canonically sorted) pair; both directions share one row.
3. ~~**Tab placement** — Compare is a singleton tab in the **entry-tab strip** (`useEipTabs`).~~
   Superseded 2026-11-21: Compare is its own panel. Entering from a word still auto-populates slot A.
4. ~~**Re-entry with a Compare tab already open** — refill slot A, clear slot B.~~ Superseded
   2026-11-21: every open is a fresh panel.
5. **Slot-B search scope** — full dictionary (any det row), via `useDictionarySearch` unchanged.
6. **Response shape** — one free-text paragraph (`comparison text` column). *(Superseded
   2026-07-26: the model now returns `{ paragraph, citations }`; the `comparison` column still
   stores only the paragraph, and the citations go to the new `citations` column.)*
7. **Keypad** — visible only while the search is open. *(Since 2026-11-21 only for es, as on
   the Dictionary page; zh uses the beginner keyboard's ā pad.)*
8. **AI budget & key** — share `dictionary_ai_usage` (one combined daily cap) and
   `DICT_AI_API_KEY` with the dictionary AI fallback.
9. **CLAUDE.md** — one-line link added under 📚 Features.

### Added 2026-07-26 — the standalone `/compare` page (superseded 2026-09-04)

10. ~~**Second entry point** — a "Compare Words" row in the **Home hub** (`/`), not Discover.~~
    Reverted: the tile and the page are deleted, and Compare always starts from a word.
11. **Shared, not copied** — `CompareTabBody` was moved out of
    `features/flashcards/FlashcardsLearnPage/` to `src/components/CompareWorkspace.tsx` and
    decoupled from `CompareEipTab` (it now takes a plain `CompareState`, which the eip tab
    extends). Two surfaces consume it ⇒ it is shared code, per the shared-vs-feature rule.
    `dictEntryAdapter.ts` moved to `src/utils/` for the same reason. **This one held** — the
    sheet inherited the page's role as the second consumer, and `SheetPanel` moved up for the
    same reason in 2026-09-04.
12. **Word taps outside the eip** — passive definition popup only; the sheet (like the deleted
    page) does not mount the eip and does not navigate away.

### Added 2026-09-04 — page → sheet

13. **Compare is a sheet, not a destination** — `/compare`, `ComparePage.tsx` and the Home hub
    tile are deleted; both cdps raise `CompareSheet` instead. Maximizing is SheetPanel's
    existing drag-to-full-height merge chrome, so no new UI was built for it.
14. ~~**The flp/acp keep the eip TAB**~~ — superseded 2026-11-21 (the tab is gone).
15. **State resets on every open** — keyed remount in `useCompareSheet`, no cross-navigation
    persistence, no clear-on-close effect.
16. ~~**The eip header gets a Compare button**~~ — removed the same day; `WordToolsRail` is the
    only Compare affordance.
17. **`CompareWorkspace.layout` is deleted** (and `CompareWorkspace` itself on 2026-11-21) — the `"page"` mode had exactly one user. While
    removing it, the sheet branch's `touchAction` was corrected from `none` to `pan-y`, the
    same correction `InfoCardPanelBody` carries: with `none` the browser refuses the native
    pan SheetPanel hands it, so a long comparison paragraph could not be scrolled once the
    sheet was dragged to full height.

<a id="added-2026-11-21"></a>
### Added 2026-11-21 — one standalone panel, band + shelf

18. **Compare leaves the eip.** The Compare crumb, `CompareEipTab` and its `useEipTabs` plumbing
    are deleted. Every `Compare` pill raises the Compare panel.
19. **Pressing Compare closes the eip first.** This includes the pill inside the Dictionary /
    Reader eip. Compare never stacks over the eip.
20. **The slots move into the tinted upper band, as raised white keycaps.** The search and the
    response sit in the white shelf. The panel reuses `EipUpperPanel` and the newly extracted
    `EipShelf`.
21. **The learner opens the search.** Each keycap is 2-state — down while its search is open, no
    highlight ring — and an empty keycap is a square "+" key. Tapping a filled keycap replaces its
    word. There is no delete gesture. *(Revised the same day: a first cut opened the search on its
    own for an empty slot and ringed the searched slot in ink.)*
22. **The mini search becomes the Dictionary page's search**: field, placeholder, es-only keypad,
    labelled slabs, infinite scroll, no-results well. The Writing Notebook picker shares it.
    **No Ask AI and no search history** in it.
23. **Embedded Chinese in the paragraph is a passive popup everywhere.** Before, the eip tab
    drilled into a word crumb. The panel has no eip under it now.

## Dependencies / cross-references

- AI + cache pipeline this mirrors: [DICTIONARY_AI_FALLBACK_SEARCH.md](./DICTIONARY_AI_FALLBACK_SEARCH.md)
  (`DictionaryService.generateAiEntry`, `ai_dictionary_cache` migrations 97–98, daily-limit
  migrations 99–100, `streakDateOf`).
- eip chrome the panel reuses: [EIP_SHEET_GESTURES.md](./EIP_SHEET_GESTURES.md) § Telescope
  (`EipUpperPanel`), § "Light / dark theme" (`eipPalette.ts`); the shelf is `EipShelf.tsx`.
  Entry point: `src/components/WordToolsRail.tsx`.
- Search reuse: `src/components/DictionaryWordSearch.tsx` (shared with the Writing Notebook,
  [WRITING_NOTEBOOK.md § Word picker](./WRITING_NOTEBOOK.md)) over `src/hooks/useDictionarySearch.ts`
  and `src/components/dictionarySearch/` (the Dictionary page's layout, docs/SHELF_REDESIGN.md § Part B entry 7).
- cpcd sizing (new `"xl"`): `src/components/CPCDRow.tsx`, `src/components/ForeignText.tsx`.
- Token-refresh client rule (load effects must not key on `token`):
  [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md).

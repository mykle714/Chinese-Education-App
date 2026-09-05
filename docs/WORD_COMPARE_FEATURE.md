# Word Compare Feature — the eip "Compare" tab + the compare sheet

> Status: **BUILT.** Design questions were resolved with the user on 2026-07-07 and
> 2026-07-26 (see [Resolved decisions](#resolved-decisions-2026-07-07)); the surface split was
> reworked on **2026-09-04**, when the standalone `/compare` page was deleted in favour of a
> sheet (see [Two surfaces, one component](#two-surfaces-one-component)).

A learner viewing a word in the eip (Extra Info Panel) often wants to know how it differs from a
near-synonym (高兴 vs 开心, ser vs estar). This feature adds a **Compare** surface: pick a second
word, and an AI-generated explanation of the difference between the two words is fetched
(server-cached, so each distinct pair is billed at most once) and displayed.

---

## Two surfaces, one component

Compare is reachable from **two** kinds of surface, and both render the exact same component —
`src/components/CompareWorkspace.tsx` (shared, NOT under `features/`, because more than one
feature consumes it):

| Surface | Hosts | Entry points | Where the state lives | Slot A on open |
|---|---|---|---|---|
| **eip Compare tab** | flp, scp — the two pages with an entry-tab strip | the `Compare` pill on `WordToolsRail`; the **Compare button in the eip entry header** | the singleton Compare tab object in `useEipTabs` | the rail's pill fills it with the card's word; the header button fills it with the word the **panel** is showing, drilled-into words included |
| **compare sheet** (`src/components/CompareSheet.tsx`) | both cdps — `VocabCardDetailPage`, `DictionaryCardDetailPage`, neither of which has a strip | the same two: the rail's `Compare` pill, and the eip header button on the fc cdp | `useState` inside `CompareSheet`, **discarded on close** | the calling word |

The contract between them is the `CompareState` interface exported by `CompareWorkspace`
(`{ slotA, slotB, comparison, comparisonParts }`). `CompareEipTab extends CompareState`, so the
tab object IS a valid workspace state and there is one shape, not two. The workspace itself owns
no slot state — it is presentational plus the in-flight request (`useWordComparison`), and hands
every result back through `onResult` for the owner to persist.

Surface differences are now exactly one prop: **`onSegmentOpen`**. The eip tab passes its drill-in
handler so tapping embedded Chinese opens a word tab; the sheet **omits it** (passive definition
popup only — decided 2026-07-26), because a cdp has no eip to drill into and a segment tap would
have to navigate, which is the thing the sheet exists to avoid.

### Why a sheet and not a page (2026-09-04)

The standalone `/compare` **node page is deleted**, along with `ComparePage.tsx`, its
`routeMeta`/`registry` rows and the Home hub's "Compare Words" tile.

Comparing is something you do *while looking at a word*, so it is modal to the word rather than a
destination. As a page it took the card being compared FROM off the screen and made returning a
history pop. As a sheet it rises over whatever you were reading, drags to full height — where
`SheetPanel`'s merge chrome grows a real `PageHeader` in and flattens the corners, which is the
"maximize" — and drags away leaving the page beneath untouched.

Three consequences worth knowing:

| | |
|---|---|
| **Cold open is gone** | With the hub tile removed there is no way to open Compare with *both* slots empty; every entry point starts from a word. The empty-slot-B search is unchanged, so comparing an arbitrary pair still works — it just starts from one of the two words. |
| **State resets on every open** | Decided 2026-09-04. `useCompareSheet` keys the mounted sheet on a session id, so each open mounts a fresh component and the seed does the resetting — there is no clear-on-close effect. Re-comparing a pair costs no extra AI call: `word_comparison_cache` serves it. |
| **The eip tab was NOT replaced** | flp and scp keep the Compare TAB (decided 2026-09-04). Where a tab strip exists, a tab keeps the comparison *beside* the word trail it came from instead of on top of it — and the sheet would have to stack on the eip that is already up. So there are two Compare hosts by design, but only one Compare body. |

### Compare earns minute points

Both hosts of the compare sheet — the saved-card cdp and the dictionary cdp (the latter as
part of the whole `/dictionary` prefix, search page included) — became **study surfaces** on
2026-09-04 (`MINUTE_POINTS_ELIGIBLE_PAGES`, `src/constants.ts`), and the eip tab's hosts
(flp, scp) already were. Since the sheet has no route of its own, that
host eligibility IS how Compare accrues: the learner reading a comparison is on an earning
page for as long as they keep interacting (the 15-second activity window still applies).
⚠️ A future surface that raises the compare sheet from a non-earning page would silently
stop Compare earning there — see
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) § "Both cdps earn, and so does Compare".

### The header: permanent, not merge chrome

The page-style `PageHeader` (title + the ✕ in its right slot) is there from the moment the
sheet opens; maximizing changes only the corners, the shadow and the top padding. The
grabber still sits above the header, so the resize affordance is unchanged.

This sheet is where that behaviour started: its body's first row is two word slots, so
nothing in it said what the surface was or offered a close other than a downward drag, and
it opted in with `headerMode="always"` while every other panel grew its header only at full
height. **Every `SheetPanel` behaves this way now** and the prop is gone (2026-09-05) — see
[EIP_SHEET_GESTURES.md § The panel header](./EIP_SHEET_GESTURES.md).

> ⚠️ A sheet header is a **real `PageHeader`**, and `PageHeader` renders the minute-points
> flame unconditionally, calling `useMinutePoints` (a 1-second tick) internally. So an open
> sheet with a title mounts a SECOND accrual tick on top of its page's own header. This is
> pre-existing — every titled sheet has done it since the header landed — and it does
> not over-credit: `UserMinutePointsService.incrementMinutePoints` claims a 59-second
> cooldown atomically (`UserDAL.claimMinutePointIncrement`), so the loser's POST is
> rejected. It does mean two independent client-side timers on an earning page. See
> `PageHeader`'s "exactly one PageHeader" warning.

### The shared sheet primitive

`SheetPanel` moved from `src/features/flashcards/FlashcardsLearnPage/` to
`src/components/sheet/SheetPanel.tsx` in the same pass, taking its four styled surfaces
(`EicScrim`, `InfoSheetContainer`, `InfoSheetGrabber`, `SheetHeaderSlot`) with it into
`src/components/sheet/sheetStyled.ts`. It had to: a shared `CompareSheet` consumed by the
dictionary feature may not reach into the flashcards feature's folder
([FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) — "a feature folder owns what only it uses").
Its consumers are now the flp eip, the /decks sheet, the scp, both cdps and the compare sheet.
The `Eic`/`InfoSheet` names were kept verbatim — renaming them is a separate pass from moving
them.

## Where Compare lives: a singleton **entry tab** (decided)

Compare is **not** a 4th inner sub-tab (Definition / Examples / Breakdown) and is **not attached
to any individual card**. It is a tab in the eip's **entry-tab strip** — the same
`EipTabStrip` / `useEipTabs` system that breakdown-word links use to open additional word tabs.

- **Singleton**: at most one Compare tab exists in the strip at a time.
- **Entry point (2026-08-24)**: the **`Compare` pill on `WordToolsRail`**, the rail that sits
  on the PAGE above the card and outside its boundary (`src/components/WordToolsRail.tsx`,
  artboards 18–25). Comparing is something you do with the WORD, not an operation on the
  card, which is the whole split that rail encodes. Two kinds of host, two destinations:
  - **flp / scp** — have a tab strip, so the pill opens Compare as an eip TAB beside the word
    (`openEicSheet()` then `eip.openCompareTab(entry)`).
  - **cdp — both of them** (the saved-card `VocabCardDetailPage` and the read-only
    `DictionaryCardDetailPage`) — neither has a strip, so each raises the compare SHEET
    (`useCompareSheet().openCompare(entry)`), seeding slot A as the INITIAL value of the
    sheet's state hook, never in an effect — an effect would re-seed on every identity change
    and silently undo a clear the learner had just made.

  Tapping it pushes the Compare tab (or focuses the existing one) and **auto-populates
  slot A** with the word the user navigated from.

- **The eip entry header is NOT an entry point.** A `compare_arrows` button briefly lived
  there (2026-09-04) beside `SpeakerButton` and "+ Add to Learn Now", acting on the word the
  header was showing; it was **removed the same day**. `WordToolsRail` is the only Compare
  affordance, so a word the learner has DRILLED INTO (a breakdown row, an example segment)
  must be opened as its own page before it can be compared — that is the Compare half of
  [DEFERRED_WORK.md](./DEFERRED_WORK.md) § 11, deferred again. `InfoCardPanelBody` /
  `InfoCardSection` no longer take an `onCompare` prop at all; do not re-add one without
  re-opening that decision.

  > One earlier home, also gone: a labelled "Compare To…" button in `InfoCardActionBar` at
  > the end of the eip definition tab. That bar is **deleted** — artboards 20–25 make the
  > panel body information-only.
- **Re-entry from a different word** (Compare tab already open): focus it, **refill slot A**
  with the new source word, and **clear slot B** back to the `+` placeholder (decided — the old
  pair is no longer what the user asked about).
- **Tab shape**: `useEipTabs`' `EipTab` currently assumes `entry: VocabEntry`; the Compare tab
  is a second variant (discriminated union, e.g. `kind: 'entry' | 'compare'`) with its own state
  (slot A entry, slot B entry | null, search text, comparison result/loading/error). When the
  Compare tab is active, the panel renders `CompareWorkspace` **instead of** the normal
  `InfoCardPanelBody` content (no entry header, no inner sub-tab strip).
- Closing the Compare tab (the strip's X button) discards its state entirely.

References: `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` (`EipTab`,
`measureTabWidth`, overflow fitting — the "Compare" label goes through the same width
measurement), `EipTabStrip.tsx`, `src/components/WordToolsRail.tsx` (the `Compare` pill — the sole entry
point), `FlashcardsLearnPage.tsx` (mounts the eip wrapper).

The eip has a single wrapper — the bottom-sheet `InfoCardSection` (`SheetPanel` +
`InfoCardPanelBody`). The centered `InfoCardPopup` variant that used to sit alongside
it was deleted (commit `70dc441`), so there is one code path to keep Compare working
in. `InfoCardSection` is mounted by `FlashcardsLearnPage.tsx` (flp) and
`SortCardsPage.tsx` (scp); both get Compare for free since they share the tab system
and panel body.

---

## Compare tab layout (top → bottom)

```
┌──────────────────────────────────────┐
│  ┌─ slot A ─────┐  ┌─ slot B ──────┐ │
│  │ 高兴 (xl cpcd)│  │      ＋       │ │  ← source word auto-fills A; B is a tappable + placeholder
│  └──────────────┘  └───────────────┘ │
├──────────────────────────────────────┤
│  (below-slots area — three modes)    │
│   idle:   hint text                  │
│   search: [ā á ǎ à] [ē é ě è] …      │  ← special-char keypad, ONLY while search is open
│           [ mini search bar      🔍 ] │
│           tappable dictionary        │
│           result cards               │
│   result: the AI comparison text     │
└──────────────────────────────────────┘
```

- **Slot A / Slot B**: two side-by-side cards each holding an **xl** `ForeignText` (cpcd row).
  Slot A auto-fills from the source word (`entryKey` + `pronunciation`). Slot B starts empty
  with a `+` indicator.
  - `CPCDSize` gained an **`"xl"` size** for this feature — entries in `COLUMN_WIDTH`,
    `CHAR_FONT_SIZE`, `PINYIN_RESERVED_HEIGHT` (CPCDRow) and `PLAIN_CHAR_FONT` /
    `PLAIN_COMPACT_CHAR_FONT` (ForeignText). **Shipped**: `"xl"` is in `CPCDSize` today.
- **Slot B tap → mini search bar**: tapping the empty (or filled) slot B opens a compact search
  input in the below-slots area, with the **special-character keypad above it** (keypad is
  visible **only while the search bar is open** — decided). The area below lists **dictionary
  result rows** (`DictionaryEntryRow`, the shelf system's `.dr` since 2026-08-24 — flat and
  hairline-separated, not cards; pass `inset` to match the panel's own padding) driven by the
  existing `useDictionarySearch` hook —
  same debounce, segment mode, and language scoping as the dictionary page. Search scope is the
  **full dictionary** (any det row — decided).
- **Keypad**: the tone-marked vowel buttons currently inlined (twice — mobile + desktop
  variants) in `src/features/dictionary/DictionaryPage.tsx` (`SPECIAL_CHARACTERS`, `getVowelColor`,
  `specialCharButtonSx`, `handleSpecialCharClick`) are **extracted into a shared
  `src/components/PinyinKeypad.tsx`** and reused here; DictionaryPage's two inline copies are
  replaced by the shared component (dedup cleanup). For `es` the same component renders the
  accent row (`á é í ó ú ñ ü ¿ ¡`).
- **Result card tap → selection**: closes the search bar + keypad, renders the selection as the
  xl cpcd in slot B, and immediately fires the compare request.
- **Comparison display**: the below-slots area shows a spinner, then the comparison paragraph
  (or the daily-limit / error note). Slot B stays tappable to re-open search and pick a
  different word, firing a new compare.
- Both slots are language-locked to the source word's language — a zh word is only comparable
  to another zh word (the search hook is already language-scoped by the user's selected
  language, which matches the eip's content).

### Client state rules

- Compare-tab state lives in the tab object inside `useEipTabs` state, so switching to a word
  tab and back preserves an in-flight/displayed comparison.
- Per the token-refresh rule, any load effect keys on stable auth identity, never `token`; the
  compare fetch builds headers via `authHeader()` (see CLAUDE.md ⛔ rule /
  [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md)).

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
| Client state | `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` | `EipTab` discriminated union (`kind: 'entry' \| 'compare'`); `CompareEipTab extends CompareState`; singleton push/focus/refill semantics |
| Client UI | `src/components/CompareWorkspace.tsx` (**shared**) | the whole compare surface — slots + search mode (keypad + bar + result cards) + comparison display; exports `CompareState` / `CompareWorkspaceHandle`. Owns no slot state; both surfaces drive it. |
| Client UI | `src/components/CompareSheet.tsx` (**new** 2026-09-04) | `CompareSheet` (SheetPanel + CompareWorkspace, owns a `CompareState` that resets per open) and `useCompareSheet` (`openCompare` / `compareSheet` wiring for a host page) |
| Client UI | `src/components/sheet/SheetPanel.tsx`, `src/components/sheet/sheetStyled.ts` (**moved** 2026-09-04 out of `features/flashcards/FlashcardsLearnPage/`) | the maximizable bottom-sheet primitive the compare sheet and the eip share |
| Route / nav | — | **Nothing.** `/compare`, `ComparePage.tsx`, the `routeMeta`/`registry` rows and the Home hub's "Compare Words" tile were all deleted 2026-09-04; Compare has no route |
| Shared util | `src/utils/dictEntryAdapter.ts` (**moved** out of `features/flashcards/FlashcardsLearnPage/`) | `dictionaryEntryToVocabEntry` — now consumed by the shared workspace, the eip, and the dictionary cdp |
| Client UI | `src/components/LongDefinitionDisplay.tsx`, `src/components/SegmentedSentenceDisplay.tsx` | shared renderer; `runTranslation` puts a translated run into whole-run (passive) mode |
| Client UI | `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`, `InfoCardSection.tsx` | Hosts the Compare TAB body only. The entry-header Compare button and its `onCompare` prop were **removed 2026-09-04**; the header's action grid is Speaker · Add-to-Learn-Now |
| Client UI | `src/components/WordToolsRail.tsx` | The `Compare` pill above the card, on the flp and **both** cdps — `VocabCardDetailPage` and `DictionaryCardDetailPage` (2026-08-24; replaced the deleted `InfoCardActionBar`). The pill self-hides on any surface that omits `onCompare`. |
| Client UI | `src/components/PinyinKeypad.tsx` (**new**, extracted) | shared tone-vowel / accent keypad; replaces DictionaryPage's two inline copies |
| Client UI | `src/components/CPCDRow.tsx`, `src/components/ForeignText.tsx` | new `"xl"` `CPCDSize` |
| Reused | `src/hooks/useDictionarySearch.ts`, `src/components/DictionaryEntryRow.tsx` | slot-B search + result rows (`.dr`) |

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
3. **Tab placement** — Compare is a singleton tab in the **entry-tab strip** (`useEipTabs`),
   the same system breakdown-word links use; it is not attached to any card. Entering from a
   card auto-populates slot A.
4. **Re-entry with a Compare tab already open** — refill slot A with the new source word,
   **clear slot B**.
5. **Slot-B search scope** — full dictionary (any det row), via `useDictionarySearch` unchanged.
6. **Response shape** — one free-text paragraph (`comparison text` column). *(Superseded
   2026-07-26: the model now returns `{ paragraph, citations }`; the `comparison` column still
   stores only the paragraph, and the citations go to the new `citations` column.)*
7. **Keypad** — visible only while the slot-B search bar is open.
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
14. **The flp/scp keep the eip TAB** — a strip-bearing host puts Compare beside the word trail.
15. **State resets on every open** — keyed remount in `useCompareSheet`, no cross-navigation
    persistence, no clear-on-close effect.
16. **The eip header gets a Compare button** — so a drilled-into word can be compared without
    leaving the panel (DEFERRED_WORK § 11, Compare half).
17. **`CompareWorkspace.layout` is deleted** — the `"page"` mode had exactly one user. While
    removing it, the sheet branch's `touchAction` was corrected from `none` to `pan-y`, the
    same correction `InfoCardPanelBody` carries: with `none` the browser refuses the native
    pan SheetPanel hands it, so a long comparison paragraph could not be scrolled once the
    sheet was dragged to full height.

## Dependencies / cross-references

- AI + cache pipeline this mirrors: [DICTIONARY_AI_FALLBACK_SEARCH.md](./DICTIONARY_AI_FALLBACK_SEARCH.md)
  (`DictionaryService.generateAiEntry`, `ai_dictionary_cache` migrations 97–98, daily-limit
  migrations 99–100, `streakDateOf`).
- eip entry-tab system this extends: `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts`,
  `EipTabStrip.tsx`; panel body + header actions: `InfoCardPanelBody.tsx`; definition-tab
  word-tools rail (the Compare entry point): `src/components/WordToolsRail.tsx`.
- Keypad source being extracted: `src/features/dictionary/DictionaryPage.tsx` (`SPECIAL_CHARACTERS`,
  `getVowelColor`, `specialCharButtonSx`).
- Search reuse: `src/hooks/useDictionarySearch.ts`, `src/components/DictionaryEntryRow.tsx`
  (the `.dr` row — see docs/SHELF_REDESIGN.md § Part B entry 7).
- cpcd sizing (new `"xl"`): `src/components/CPCDRow.tsx`, `src/components/ForeignText.tsx`.
- Token-refresh client rule (load effects must not key on `token`):
  [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md).

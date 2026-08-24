# Word Compare Feature — eip "Compare" tab + the `/compare` page

> Status: **DESIGN — decided, not yet implemented.** All open questions below were resolved with
> the user on 2026-07-07; see [Resolved decisions](#resolved-decisions).

A learner viewing a word in the eip (Extra Info Panel) often wants to know how it differs from a
near-synonym (高兴 vs 开心, ser vs estar). This feature adds a **Compare** surface to the eip:
pick a second word, and an AI-generated explanation of the difference between the two words is
fetched (server-cached, so each distinct pair is billed at most once) and displayed.

---

## Two surfaces, one component

Compare is reachable from **two** places, and both render the exact same component —
`src/components/CompareWorkspace.tsx` (shared, NOT under `features/`, because two surfaces
consume it):

| Surface | Entry point | Where the state lives | Slot A on open |
|---|---|---|---|
| **eip Compare tab** (flp) | "Compare To…" button in the action bar at the end of the eip definition tab | the singleton Compare tab object in `useEipTabs` | pre-filled with the word the user came from |
| **`/compare` page** (hp) | "Compare Words" row in the Home hub menu | `useState` in `src/features/dictionary/ComparePage.tsx` | empty (the user arrives without a source word) |

The contract between them is the `CompareState` interface exported by `CompareWorkspace`
(`{ slotA, slotB, comparison, comparisonParts }`). `CompareEipTab extends CompareState`, so the
tab object IS a valid workspace state and there is one shape, not two. The workspace itself owns
no slot state — it is presentational plus the in-flight request (`useWordComparison`), and hands
every result back through `onResult` for the owner to persist.

Surface differences are exactly three props:
- `onSegmentOpen` — the eip passes its drill-in handler so tapping embedded Chinese opens a word
  tab; the page **omits it** (passive definition popup only — decided 2026-07-26), since it has no
  eip mounted.
- `scrollTouchAction` — `"none"` in the eip (SheetPanel drives scrolling/resizing from its own
  gesture handlers), `"pan-y"` on the page so the region scrolls natively. See the app-wide
  touch rule in [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).
- the forwarded `{root, scroll}` ref — used by SheetPanel in the eip, ignored by the page.

### The `/compare` page

A **node** page (keeps the footer, left arrow, slides in from the right — see
[LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)), matching the other Home-hub destinations
(Dictionary, Reader, Games). A new node page must be registered in **four** places — miss one and
the page half-works rather than erroring:

| File | Registry | Symptom if missed |
|---|---|---|
| `src/App.tsx` | the `<Route>` | 404 |
| `src/components/Layout.tsx` | `MOBILE_DEMO_PATHS` | renders OUTSIDE the phone frame: no footer at all, and `NodePage`'s `position:absolute` slide surface has nothing to be clipped by |
| `src/utils/pageTransition.ts` | `NODE_ROUTES` | no slide-in-from-right; falls back to a plain route swap |
| `src/components/FooterPresenter.tsx` | `FOOTER_ROUTES` | footer bar slides away on arrival (route reads as footerless) |

`ProtectedRoute` uses **`allowPublic`**, like every other Home-hub page. Without it, public/demo
accounts are bounced to `/` by the `user?.isPublic && !allowPublic` branch, so the hub button
silently does nothing for them (every seeded local test user is public). The compare request is
still auth-gated and rate-limited server-side.

Like the cdp it forces `showPinyin` on regardless of the flp toggle
(the two slots are the reference material), and reads `showPinyinColor` from
`useFlashcardLearnSettings`.

---

## Where Compare lives: a singleton **entry tab** (decided)

Compare is **not** a 4th inner sub-tab (Definition / Examples / Breakdown) and is **not attached
to any individual card**. It is a tab in the eip's **entry-tab strip** — the same
`EipTabStrip` / `useEipTabs` system that breakdown-word links use to open additional word tabs.

- **Singleton**: at most one Compare tab exists in the strip at a time.
- **Entry point (2026-08-24)**: the **`Compare` pill on `WordToolsRail`**, the rail that sits
  on the PAGE above the card and outside its boundary (`src/components/WordToolsRail.tsx`,
  artboards 18–25). Comparing is something you do with the WORD, not an operation on the
  card, which is the whole split that rail encodes. Two hosts, two destinations:
  - **flp** — has a tab strip, so it opens Compare as an eip TAB beside the word
    (`openEicSheet()` then `eip.openCompareTab(entry)`).
  - **cdp** — has no strip, so it hands the word to the standalone `/compare` page,
    pre-filling slot A through **route state** (`navigate("/compare", { state: { slotA } })`;
    `ComparePage` seeds it as the INITIAL value of its state hook, never in an effect — an
    effect would re-seed on every identity change and silently undo a clear the learner had
    just made). Route state rather than a URL param because what is handed over is a whole
    `VocabEntry` the caller already fetched; putting the word in the path would mean
    re-looking it up and letting the two copies disagree about the selected sense.

  Tapping it pushes the Compare tab (or focuses the existing one) and **auto-populates
  slot A** with the word the user navigated from.

  > Two earlier homes, both gone: a bare icon in the eip header's action grid (which now
  > keeps only the entry-level actions, `SpeakerButton` and "+ Add to Learn Now"), and
  > then a labelled "Compare To…" button in `InfoCardActionBar` at the end of the eip
  > definition tab. That bar is **deleted** — artboards 20–25 make the panel
  > information-only. ⚠️ One consequence: a word DRILLED INTO inside the panel can no
  > longer be compared from there, because the rail acts on the card's word. The path is
  > to open that word's own page. Tracked in [DEFERRED_WORK.md](./DEFERRED_WORK.md) § 11.
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
measurement), `EipTabStrip.tsx`, `src/components/WordToolsRail.tsx` (the
`mobile-demo-definition-action-bar` Box), `FlashcardsLearnPage.tsx` (mounts the eip wrapper).

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
  - `CPCDSize` currently tops out at `"lg"` (`src/components/CPCDRow.tsx`); this feature adds an
    **`"xl"` size** — new entries in `COLUMN_WIDTH`, `CHAR_FONT_SIZE`, `PINYIN_RESERVED_HEIGHT`
    (CPCDRow) and `PLAIN_CHAR_FONT` / `PLAIN_COMPACT_CHAR_FONT` (ForeignText).
- **Slot B tap → mini search bar**: tapping the empty (or filled) slot B opens a compact search
  input in the below-slots area, with the **special-character keypad above it** (keypad is
  visible **only while the search bar is open** — decided). The area below lists **dictionary
  result cards** (`DictionaryEntryRow`) driven by the existing `useDictionarySearch` hook —
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
| Client page | `src/features/dictionary/ComparePage.tsx` (**new**) | `/compare` node page: owns a `CompareState` `useState` and renders `CompareWorkspace` |
| Route / nav | `src/App.tsx`, `src/components/Layout.tsx` (`MOBILE_DEMO_PATHS`), `src/utils/pageTransition.ts` (`NODE_ROUTES`), `src/components/FooterPresenter.tsx` (`FOOTER_ROUTES`), `src/pages/HomePage.tsx` | the `/compare` route, its phone-frame membership, its right-slide direction, its footer (Home tab), and the "Compare Words" hub row |
| Shared util | `src/utils/dictEntryAdapter.ts` (**moved** out of `features/flashcards/FlashcardsLearnPage/`) | `dictionaryEntryToVocabEntry` — now consumed by the shared workspace, the eip, and the dictionary cdp |
| Client UI | `src/components/LongDefinitionDisplay.tsx`, `src/components/SegmentedSentenceDisplay.tsx` | shared renderer; `runTranslation` puts a translated run into whole-run (passive) mode |
| Client UI | `src/components/WordToolsRail.tsx` | The `Compare` pill above the card, on both the flp and the cdp (2026-08-24; replaced the deleted `InfoCardActionBar`) |
| Client UI | `src/components/PinyinKeypad.tsx` (**new**, extracted) | shared tone-vowel / accent keypad; replaces DictionaryPage's two inline copies |
| Client UI | `src/components/CPCDRow.tsx`, `src/components/ForeignText.tsx` | new `"xl"` `CPCDSize` |
| Reused | `src/hooks/useDictionarySearch.ts`, `src/components/DictionaryEntryRow.tsx` | slot-B search + result cards |

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

### Added 2026-07-26 — the standalone `/compare` page

10. **Second entry point** — a "Compare Words" row in the **Home hub** (`/`), not Discover.
11. **Shared, not copied** — `CompareTabBody` was moved out of
    `features/flashcards/FlashcardsLearnPage/` to `src/components/CompareWorkspace.tsx` and
    decoupled from `CompareEipTab` (it now takes a plain `CompareState`, which the eip tab
    extends). Two surfaces consume it ⇒ it is shared code, per the shared-vs-feature rule.
    `dictEntryAdapter.ts` moved to `src/utils/` for the same reason.
12. **Word taps on the page** — passive definition popup only; the page does not mount the eip
    and does not navigate away.

## Dependencies / cross-references

- AI + cache pipeline this mirrors: [DICTIONARY_AI_FALLBACK_SEARCH.md](./DICTIONARY_AI_FALLBACK_SEARCH.md)
  (`DictionaryService.generateAiEntry`, `ai_dictionary_cache` migrations 97–98, daily-limit
  migrations 99–100, `streakDateOf`).
- eip entry-tab system this extends: `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts`,
  `EipTabStrip.tsx`; panel body + header actions: `InfoCardPanelBody.tsx`; definition-tab
  word-tools rail (the Compare entry point): `src/components/WordToolsRail.tsx`.
- Keypad source being extracted: `src/features/dictionary/DictionaryPage.tsx` (`SPECIAL_CHARACTERS`,
  `getVowelColor`, `specialCharButtonSx`).
- Search reuse: `src/hooks/useDictionarySearch.ts`, `src/components/DictionaryEntryRow.tsx`.
- cpcd sizing (new `"xl"`): `src/components/CPCDRow.tsx`, `src/components/ForeignText.tsx`.
- Token-refresh client rule (load effects must not key on `token`):
  [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md).

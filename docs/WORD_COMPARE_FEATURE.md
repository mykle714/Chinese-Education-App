# Word Compare Feature — eip "Compare" tab

> Status: **DESIGN — decided, not yet implemented.** All open questions below were resolved with
> the user on 2026-07-07; see [Resolved decisions](#resolved-decisions).

A learner viewing a word in the eip (Extra Info Panel) often wants to know how it differs from a
near-synonym (高兴 vs 开心, ser vs estar). This feature adds a **Compare** surface to the eip:
pick a second word, and an AI-generated explanation of the difference between the two words is
fetched (server-cached, so each distinct pair is billed at most once) and displayed.

---

## Where Compare lives: a singleton **entry tab** (decided)

Compare is **not** a 4th inner sub-tab (Definition / Examples / Breakdown) and is **not attached
to any individual card**. It is a tab in the eip's **entry-tab strip** — the same
`EipTabStrip` / `useEipTabs` system that breakdown-word links use to open additional word tabs.

- **Singleton**: at most one Compare tab exists in the strip at a time.
- **Entry point**: a Compare icon button in the eip entry header's 2×2 action grid (alongside
  `PracticeWritingButton`, `SpeakerButton`, and the "+ Add to Learn Now" button — reading order
  Practice / Speaker · Compare / Add). Tapping it pushes the Compare tab (or focuses the
  existing one) and **auto-populates slot A** with the word the user navigated from.
- **Re-entry from a different word** (Compare tab already open): focus it, **refill slot A**
  with the new source word, and **clear slot B** back to the `+` placeholder (decided — the old
  pair is no longer what the user asked about).
- **Tab shape**: `useEipTabs`' `EipTab` currently assumes `entry: VocabEntry`; the Compare tab
  is a second variant (discriminated union, e.g. `kind: 'entry' | 'compare'`) with its own state
  (slot A entry, slot B entry | null, search text, comparison result/loading/error). When the
  Compare tab is active, the panel renders `CompareTabBody` **instead of** the normal
  `InfoCardPanelBody` content (no entry header, no inner sub-tab strip).
- Closing the Compare tab (the strip's X button) discards its state entirely.

References: `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` (`EipTab`,
`measureTabWidth`, overflow fitting — the "Compare" label goes through the same width
measurement), `EipTabStrip.tsx`, `InfoCardPanelBody.tsx` (header 2×2 action grid, the
`mobile-demo-eic-actions` Box), `FlashcardsLearnPage.tsx` (mounts both eip wrappers).

The eip renders on flp only (bottom-sheet `InfoCardSection` + centered `InfoCardPopup`); both
wrappers get Compare for free since they share the tab system and panel body.

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
  variants) in `src/pages/DictionaryPage.tsx` (`SPECIAL_CHARACTERS`, `getVowelColor`,
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
6. Count        increment dictionary_ai_usage once the model call completes (billed = counted).
7. Cache write  upsert the paragraph into word_comparison_cache; return it.
```

- Mirrors the dictionary AI-fallback pipeline
  ([DICTIONARY_AI_FALLBACK_SEARCH.md](./DICTIONARY_AI_FALLBACK_SEARCH.md)): same lazy Anthropic
  client pattern, prompt-caching shape, `RateLimitError` → 429 mapping, and streak-day bounding.
- **Response shape: one free-text paragraph** (decided). The prompt asks for a single concise
  paragraph (~3–5 sentences) contrasting the two words — register, typical contexts, one short
  inline example each — plain text, no markdown/JSON.
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

---

## Layers

| Layer | File | Responsibility |
|---|---|---|
| Migration | `database/migrations/105-create-word-comparison-cache.sql` (**new**) | the cache table |
| DAL | `server/dal/implementations/DictionaryDAL.ts` | `getComparison(wordA, wordB, language)`, `upsertComparison(...)`; reuses `getAiUsageCount` / `incrementAiUsage` |
| DAL iface | `server/dal/interfaces/IDictionaryDAL.ts` | new method signatures |
| Service | `server/services/DictionaryService.ts` | `compareWords(wordA, wordB, language, userId, usageDate)` — canonical ordering, cache, shared limit gate, prompt build with det-definition grounding, upsert |
| Controller | `server/controllers/DictionaryController.ts` | `compare` handler (`tz` → `usageDate`; `RateLimitError` → 429) |
| Routes | `server/routes/dictionaryRoutes.ts` | `POST /api/dictionary/compare` |
| Types | `server/types/*`, `src/types.ts` | compare request/response types |
| Client hook | `src/hooks/useWordComparison.ts` (**new**) | fires the compare request; loading / error / `limitReached` states |
| Client state | `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` | `EipTab` discriminated union (`kind: 'entry' \| 'compare'`); singleton push/focus/refill semantics |
| Client UI | `src/features/flashcards/FlashcardsLearnPage/CompareTabBody.tsx` (**new**) | slots + search mode (keypad + bar + result cards) + comparison display |
| Client UI | `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx` | Compare icon button in the header 2×2 action grid |
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
6. **Response shape** — one free-text paragraph (`comparison text` column).
7. **Keypad** — visible only while the slot-B search bar is open.
8. **AI budget & key** — share `dictionary_ai_usage` (one combined daily cap) and
   `DICT_AI_API_KEY` with the dictionary AI fallback.
9. **CLAUDE.md** — one-line link added under 📚 Features.

## Dependencies / cross-references

- AI + cache pipeline this mirrors: [DICTIONARY_AI_FALLBACK_SEARCH.md](./DICTIONARY_AI_FALLBACK_SEARCH.md)
  (`DictionaryService.generateAiEntry`, `ai_dictionary_cache` migrations 97–98, daily-limit
  migrations 99–100, `streakDateOf`).
- eip entry-tab system this extends: `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts`,
  `EipTabStrip.tsx`; panel body + header actions: `InfoCardPanelBody.tsx`.
- Keypad source being extracted: `src/pages/DictionaryPage.tsx` (`SPECIAL_CHARACTERS`,
  `getVowelColor`, `specialCharButtonSx`).
- Search reuse: `src/hooks/useDictionarySearch.ts`, `src/components/DictionaryEntryRow.tsx`.
- cpcd sizing (new `"xl"`): `src/components/CPCDRow.tsx`, `src/components/ForeignText.tsx`.
- Token-refresh client rule (load effects must not key on `token`):
  [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md).

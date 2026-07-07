# Dictionary Search — Spaceless-Pinyin + AI Synthetic-Entry Fallback

> Status: **implemented** (migrations 97–99; 99 = per-user daily AI-lookup cap). Extends `GET /api/dictionary/search`
> (the shared search used by the dictionary page and the Community search bar — see
> [DICTIONARY_NUMBERED_PINYIN_SEARCH.md](./DICTIONARY_NUMBERED_PINYIN_SEARCH.md) and
> [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md)).
>
> **Languages.** The AI synthetic-entry fallback now serves **both `zh` and `es`**:
> - **zh** — a query in **pinyin** (→ Chinese word), **Chinese characters** (segment "no complete
>   match"), or **English** (→ Chinese translation).
> - **es** — a query in **English** (→ Spanish translation) or **Spanish** (a headword missing from
>   `dictionaryentries_es`).
>
> The spaceless-/synthetic-**pinyin** machinery (stage 2, `isAllPinyin`, `segmentPinyin`) is still
> Chinese-only — it is meaningless for `es`. See [Per-language search routing](#per-language-search-routing)
> for the `searchByWord1` table/column fix that made `es` search return real rows at all.

## Motivation

Today `searchByWord1` matches `word1` / `pronunciation` / `definitions` / numbered-pinyin
(spaced). Two gaps remain:

1. A learner who types pinyin **without spaces** (`jianshen`, `jian4shen1`) gets nothing —
   the numbered-pinyin matcher requires space-separated syllables.
2. A learner who types a *real* pinyin word that simply isn't in `dictionaryentries_zh`
   (rare/colloquial/new) gets nothing, with no recourse.

This feature adds a **three-stage fallback chain** on top of the existing search, plus an
AI-synthesized entry (behind an explicit button) cached in a new table.

## The fallback chain

Given a search term, results are resolved in this order; the first stage that yields rows wins:

```
1. Normal search        word1 ILIKE / pronunciation ~ / definitions ~* / numbered-pinyin (spaced)
   │  (0 rows)
2. Spaceless pinyin      segment the term into pinyin syllables (tone digits allowed) — enumerate
   │                     ALL valid tilings, not just one — and re-run the numbered-pinyin match on
   │                     each re-spaced form. Real det rows, rendered normally.
   │  (0 rows)
3. AI cache lookup       exact-match the term against ai_dictionary_cache (see below).
   │                     · non-empty hit  → render the orange synthetic card (unclickable)
   │                     · empty hit, fresh (<3 mo) → aiNoMatch: show the "couldn't find a match"
   │                                                   note (no button — the AI already checked)
   │                     · empty hit, stale (>3 mo) → treat as a miss (offer the AI button again)
   │                     · miss           → if the term is valid pinyin, offer the "AI" button
   └─ AI button tap →    POST /api/dictionary/ai-entry → Sonnet → write cache → render orange card
                         (a network/server failure surfaces `aiError` — the button stays for retry)
```

Stages 1–2 return **real `dictionaryentries_zh` rows**. Stage 3 is the only one that produces a
**synthetic, unclickable** entry.

## Stage 2 — spaceless pinyin segmentation

A new server util **`server/utils/pinyinSegment.ts`**:

- `segmentPinyin(input: string): string[][]` — enumerate **all valid tilings** of the input over a
  canonical **toneless pinyin syllable inventory** (the ~410 legal Mandarin syllables) via a
  backtracking segmenter. Each syllable may carry a **trailing tone digit `0–5`** (numbers are
  supported: `jian4shen1` tiles to `["jian4","shen1"]`; the digit binds to the syllable it
  follows). Returns every ordered syllable list that tiles the whole string; `[]` if none.
  - **Why all tilings, not greedy max-munch:** some syllables double as *starter* segments that a
    previous syllable could also have absorbed — e.g. `an` in `xian` (`["xian"]` vs `["xi","an"]`),
    `ang`, `en`, `er`, `ou`. A single greedy choice would silently drop the alternative real word,
    so we return both parses and search each. (This is the pinyin analogue of the `xi'an` vs `xian`
    apostrophe ambiguity, resolved here by trying every branch.)
- `isAllPinyin(input: string): boolean` — true iff `segmentPinyin` returns at least one tiling;
  this is the **gate** for offering the "AI" button (stage 3), computed server-side and returned to
  the client (so the syllable inventory isn't duplicated on the front end).

`searchByWord1` calls `segmentPinyin` only when stage 1 produced 0 rows; for **each** returned
tiling it rebuilds a space-separated term and reuses the **existing** `buildNumberedPinyinPattern`
path (OR-ing the tilings' patterns together, deduping rows) — no new SQL shape.

## Stage 3 — AI synthetic entry

### Trigger (decided: explicit "AI" pill button)

The AI call is **never** automatic. The client shows an **"AI"** button (which calls the endpoint
on tap) whenever the cache has no usable row (miss, or stale-empty) **and** the query qualifies. The
qualification is language-aware (`DictionaryService.qualifiesForAiFallback` for the `/search` path,
`resolveChineseAiFallback` for the `/segment` path):

- **`/search` path** (non-CJK input) — stages 1–2 returned 0 rows and the trimmed query is **≥2
  chars** in a supported language. **No** pinyin gate any more (previously `isAllPinyin`): any
  Latin query qualifies, because the query may be English rather than pinyin. Per language:
  - **zh** — pinyin (`jianshen`) **or** an English word/phrase (`serendipity`) → one Chinese word.
  - **es** — an English word/phrase (`serendipity`) **or** a Spanish headword missing from the det.
- **Chinese `/segment` path** — a CJK segment-mode query whose full typed string has **no
  complete-word match** (only breakdown / prefix matches came back). `hasCompleteMatch` = some
  segment group for the whole trimmed input has an exact entry; when false, the button is offered.

Rationale for the button (vs. inline): an automatic call would add ~1–3 s latency and an API charge
to every novel zero-result query.

The prompt (`DictionaryService.buildAiSystemPrompt(language)`) is **per language** but always asks
for the **same flat JSON shape** (`{word1, pinyin, definition}`) so the cache row, client type, and
orange card stay language-agnostic. The query may arrive in the target language **or in English**;
the model infers which and always resolves to a single **target-language** headword + English gloss.
For `es`, `pinyin` is returned empty (Spanish has no such field) and the orange card renders the
Latin headword in the Latin UI font (`AiDictionaryEntryCard` picks the font from the word's script).

The zh prompt **trusts the query as written**: it is told to assume the pinyin is spelled correctly and
must NOT correct apparent typos or substitute a similar-sounding / similar-looking word — if nothing
matches the query exactly, it returns an empty result rather than a near-miss. It accepts Chinese
characters too, and **returns a result for anything that maps to a valid concept** — ordinary words,
expressions, and proper nouns.

For proper nouns it is told to **identify the real-world referent** (a notable person/place/brand/
work — e.g. 周杰伦 → "Jay Chou, Taiwanese pop singer…"), falling back to a generic name description
(personal name + character meanings) only when even a search can't identify a specific entity, and
never fabricating biographical facts. Empty (`{"word1": null}`) is reserved for a meaningless
character jumble.

**Web search.** The generation call is given Anthropic's `web_search_20250305` tool (`max_uses: 3`)
so it can identify current/obscure referents beyond `claude-sonnet-4-6`'s training cutoff (e.g. a
recent singer 王翊恩 → "Chinese male singer from Heilongjiang"). It is **not gated** — the model
itself decides when to search, so ordinary words/pinyin answer from its own knowledge with no search
(~1–2 s), while an unfamiliar proper noun triggers one (~4–5 s). A search-heavy turn can be paused
(`stop_reason: 'pause_turn'`); `generateAiEntry` loops, echoing the assistant content back to
continue. Cost: **$0.01 per search** + the search-result input tokens (see
[cost note below](#cost)); every result is cached forever, so each distinct query is paid for **at
most once**. If web search is disabled for the org the call errors out and the ask simply yields no
card.

**Placement/style (dictionary page):** the "AI" button lives in the **Results Info** row, *inline
with and styled identically to* the existing results-count `Chip` (an outlined MUI `Chip`), but
**orange** and clickable (`onClick` → `askAi()`). In the same change the results-count pill itself
is updated: **drop the "N segments ·" prefix** from the segment-mode label (show just
`"M results for \"…\""`) and set the pill **blue** (`color="primary"`) in both segment and regular
modes. Net: a blue results pill, optionally followed by an orange **AI** pill.

### Endpoint

`POST /api/dictionary/ai-entry` (auth required) — body `{ term, language, tz }`:

1. Guard: `term` ≥2 chars and a supported language — `zh` (pinyin / Han / English), or `es`
   (non-CJK English / Spanish). Else return null.
2. Re-check the cache (a fresh non-empty or fresh-empty row short-circuits — no model call). A cache
   hit is **free** — it returns before the daily-limit check below, so it never consumes a slot.
2b. **Daily-limit gate** (a cache MISS is about to bill a model call): read the caller's completed-call
   count for their local streak-day from `dictionary_ai_usage` and, if it's already
   `>= DICTIONARY_AI_DAILY_LIMIT` (`server/constants.ts`, default 10), throw `RateLimitError` — the
   controller maps it to **HTTP 429** with a user-facing message. See [Daily limit](#daily-limit).
3. Call Sonnet (`claude-sonnet-4-6`) with a `cache_control: ephemeral` **static system block** (the
   instructions) and a tiny volatile user message (`Query: <term>`), plus the **`web_search`** tool
   (`max_uses: 3`). Loop on `stop_reason: 'pause_turn'`, echoing the assistant content back to
   continue a paused search turn (bounded to a few iterations).
4. Parse the JSON out of the final turn's text blocks (ignoring `server_tool_use` /
   `web_search_tool_result` blocks). The flat object is `{ "word1", "pinyin", "definition" }`, or
   `{ "word1": null }` when nothing maps to a concept. Constraints in the prompt:
   - `word1` = the Han characters; `pinyin` = tone-marked (diacritics), `definition` = **one short,
     complete gloss** — the prompt asks for a single phrase/clause (~12 words) that stops at the core
     meaning and never trails off. The column is unbounded `text` (migration 98) so an occasional
     longer answer isn't truncated, but the prompt steers toward concise glosses.
   - Trust the query as written (no pinyin-typo reconciliation); identify real referents (searching
     when needed); return null only for a meaningless jumble.
5. Once a model call **completes** (before parsing, regardless of word/empty/unparseable outcome),
   **increment `dictionary_ai_usage`** for the caller's streak-day — the call was billed, so it counts.
   A model call that throws (network error) never reaches this and does not count.
6. Validate (`word1` non-empty when present), **upsert into `ai_dictionary_cache`** (empty result
   stored as `word1 = NULL`, `queriedAt = now()`) and return the entry (or an empty marker). A parse
   failure returns null **without** caching (transient).

<a id="daily-limit"></a>
### Daily limit (per-user abuse cap, migration 99)

Each user may make **`DICTIONARY_AI_DAILY_LIMIT` completed model calls per day** (default 10, override
via env; `server/constants.ts`). "Per day" is the same **4 AM-bounded local streak-day** used by
streaks/minute points (`streakDateOf` + the client-supplied `tz`), so the allowance resets at 4 AM
local time. Only **cache misses that reach the model** count — re-viewing a cached answer or any
auto-rendered orange card is always free.

State lives in `dictionary_ai_usage` (`"userId"`, `"usageDate"`, `count`; migration 99). The service
reads the count before the model call and increments after it completes. When the cap is hit the
endpoint returns **HTTP 429** `{ error, code: 'ERR_RATE_LIMIT' }`; the client hook surfaces this as a
dedicated `aiLimitReached` state (distinct from a retryable network error) and `DictionaryPage`
renders the server's message in place of the "AI" pill.

> Why this exists even though migration 97 said rate limiting "isn't needed": that reasoning assumed a
> **finite pinyin space** the cache saturates. The fallback now also accepts **arbitrary Chinese-character
> queries + up to 3 web searches per tap**, so a single user can drive unbounded billed calls — hence the cap.

<a id="cost"></a>
### Cost

Per uncached tap: the base model call, **plus** web search only if the model chooses to search —
**$0.01 per search** (`max_uses: 3` caps it) + the search-result **input tokens** pulled into
context (roughly a few thousand tokens). Ballpark **≈ $0.02–0.05** for a tap that searches; ordinary
words don't search. Because every non-empty result is cached forever (empty results for 3 months),
each distinct query is billed **at most once**, and the pinyin/Chinese query space is finite, so
total spend saturates.

### Synthetic entry shape

The synthetic entry is adapted to the `DictionaryEntry` client type but flagged `source: 'ai'`,
with **no id / no metadata** — it is **display-only**:
- not clickable (no cdp navigation),
- not add-to-library-able,
- rendered in the app's **orange** (`COLORS.yellowMain` = `#FF8E47`, the "Target" hue) so it's
  visually distinct from real dictionary rows.

<a id="per-language-search-routing"></a>
## Per-language search routing (`searchByWord1`) — prerequisite for the es fallback

Enabling the AI fallback for `es` exposed that `GET /api/dictionary/search` **never returned real
Spanish rows at all** — two bugs in `DictionaryDAL.searchByWord1`, both fixed here:

1. **Wrong table.** The method was hard-coded to `FROM dictionaryentries_zh` and filtered
   `WHERE language = $1`. Spanish data lives only in `dictionaryentries_es`, so an `es` search
   matched **0 rows**. Now it routes the table via `dictTableForLanguage(language)`
   (`server/dal/shared/dictTable.ts`), same whitelist helper the segment/starter-pack paths use.
2. **Pronunciation filter dropped every es row.** The clause `AND NOT (pronunciation ~ $4)` (a
   zh pinyin quirk excluding `...g` runs) evaluates to `NOT NULL` = **excluded** for Spanish rows
   (pronunciation is NULL for all `es`). The pronunciation match (`pronunciation ~ $3`), the
   `numberedPinyin` clause, this exclusion, and the stage-2 spaceless-pinyin fallback are now all
   gated behind `isZh` — `es` matches on **`word1` prefix + first-definition** only.

Also, the shared `DICTIONARY_COLUMNS` SELECT list references `definitionClusters`, a **Chinese-only**
enrichment (migration 90; its per-cluster reading is pinyin) that `dictionaryentries_es` **does not
have**. `dictionaryColumns(language)` selects a `NULL::jsonb AS "definitionClusters"` placeholder for
`es` so the row shape / `mapRowToEntity` stay uniform without adding a dead column to the es table.

> **Scope note:** only `searchByWord1` is language-routed here. Other `DictionaryDAL` methods
> (`findByWord1`, `findMultipleByWord1`, the expansion helpers) still hard-code `this.tableName`
> (`dictionaryentries_zh`) and remain zh-only — see [Noted limitations](#noted-limitations).

## Data model — new table `ai_dictionary_cache` (migration 97)

```sql
CREATE TABLE ai_dictionary_cache (
  id         serial PRIMARY KEY,
  "queryKey" varchar     NOT NULL,   -- exact trimmed raw user input (see Cache key)
  language   varchar(8)  NOT NULL,   -- 'zh' or 'es' (part of the cache identity)
  word1      varchar,                -- NULL ⇒ empty result (AI found no likely meaning)
  pinyin     varchar,                -- tone-marked
  definition text,                   -- one concise, complete gloss (no length cap; widened from varchar(100) in migration 98)
  "queriedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("queryKey", language)
);
```

- **Empty result** is represented by `word1 IS NULL` (no separate flag column).
- **`queriedAt`** drives the staleness rule: an empty row older than **3 months** is treated as a
  cache miss so the button reappears and the model is re-prompted on the next tap. (Non-empty rows
  never expire.)
- **Cache key = raw trimmed query text** (decided). `jian4shen1` and `jian4 shen1` are *separate*
  rows / separate AI calls. Simple and exact; no normalization surprises. (Trade-off: lower hit
  rate across spacing variants — noted in Open questions.)

The table is queried on **every** dictionary search (stage 3 lookup), so the `UNIQUE (queryKey,
language)` index also serves the read path.

## API key config (decided: dedicated env var)

This feature uses its **own** key, `DICT_AI_API_KEY`, separate from the `ANTHROPIC_API_KEY` that
the definition-expansion / long-definition helpers use — so this feature's usage/billing is
isolated. Same lazy-client pattern as `DictionaryService` (`server/services/DictionaryService.ts`
`getAnthropicClient`): missing key ⇒ the AI endpoint returns a "disabled" response and the button
is simply never offered. Set it in `server/.env` / `server/.env.docker` / `server/.env.production`.

## Client integration

All logic lives in the shared **`src/hooks/useDictionarySearch.ts`** so both consumers get it:

- New returned fields: `aiEntry` (the synthetic entry or null), `canAskAi` (server-computed gate),
  `askingAi` (loading), and `askAi()` (fires `POST /api/dictionary/ai-entry`, then surfaces the
  result).
- The server `GET /api/dictionary/search` response gains `canAskAi: boolean` and an optional
  `aiCacheEntry` (a fresh non-empty cache hit, auto-shown without a button).
- **`DictionaryPage.tsx`** renders the orange unclickable card **at the top of the results** (above
  the breakdown / regular result cards) so a just-generated answer is immediately visible without
  scrolling — for a cache hit or after an AI tap. The inline orange **"AI"** pill sits next to the
  blue results pill when `canAskAi`; tapping it shows an "Asking AI…" spinner (also at the top), then
  the card, or a "couldn't find a likely match" note if the model returned empty (`aiNoMatch`). The
  same `aiNoMatch` note also shows **without a tap** when the search hits a fresh cached-empty row
  (the AI was already asked). If the ask itself fails (network/server), `aiError` shows a short
  "request didn't go through — tap AI to try again" note and keeps the button, so a transient failure
  is never silent. These four states are mutually exclusive and suppress the generic "No results" copy.
- The Chinese no-complete-match trigger flows through the **`/segment`** response (which now also
  returns `canAskAi` + `aiEntry`), read by the hook's segment-mode branch — so the AI pill/card
  appears above/below the breakdown groups just as it does in the pinyin path.
- **`CommunitySearchBar.tsx`**: **no AI** here (decided). Designs don't exist for a synthetic word,
  so it never renders the AI card/pill and keeps its existing "No results" state. The hook still
  exposes the data; the community bar simply ignores `aiEntry`/`canAskAi`.

## Layers

| Layer | File | Responsibility |
|---|---|---|
| Migration | `database/migrations/97-create-ai-dictionary-cache.sql` | the cache table |
| Migration | `database/migrations/100-create-dictionary-ai-usage.sql` | the per-user daily-usage counter table |
| Constant | `server/constants.ts` | `DICTIONARY_AI_DAILY_LIMIT` (default 10, env-overridable) |
| Error | `server/types/dal.ts` | `RateLimitError` (HTTP 429, `code: 'ERR_RATE_LIMIT'`) |
| Util | `server/utils/pinyinSegment.ts` (**new**) | `segmentPinyin`, `isAllPinyin` (syllable inventory + max-munch) |
| Util | `server/utils/streakDate.ts` | `resolveTimezone`, `streakDateOf` — reused to bound the daily limit to the local streak-day |
| DAL | `server/dal/implementations/DictionaryDAL.ts` | **per-language table/column routing in `searchByWord1`** (`dictTableForLanguage`, `dictionaryColumns`, `isZh`-gated pinyin/pronunciation clauses); stage-2 segmentation fallback (zh-only); `getAiCacheEntry`, `upsertAiCacheEntry`; return `canAskAi`; `getAiUsageCount`, `incrementAiUsage` (daily limit) |
| DAL iface | `server/dal/interfaces/IDictionaryDAL.ts` | new method signatures (incl. `getAiUsageCount`/`incrementAiUsage`) |
| Service | `server/services/DictionaryService.ts` | `qualifiesForAiFallback(term, language)` (`/search` button gate — ≥2-char non-CJK zh/es); `buildAiSystemPrompt(language)` (per-language zh/es prompt); `generateAiEntry(term, language, userId, usageDate)` (dedicated Sonnet client + prompt caching + `web_search` tool w/ pause_turn loop + validation; accepts pinyin / Chinese / English for zh, English / Spanish for es; **daily-limit gate + increment**); `resolveAiCache` + `resolveChineseAiFallback` (staleness check) |
| Controller | `server/controllers/DictionaryController.ts` | `aiEntry` handler (computes `usageDate` from `tz`; maps `RateLimitError` → 429); thread `canAskAi`/`aiEntry` through both `search` (pinyin) and `segmentSearch` (Chinese no-complete-match) |
| Routes | `server/routes/dictionaryRoutes.ts` | `POST /api/dictionary/ai-entry` |
| Types | `server/types/*`, client `src/types.ts` | `DictionaryEntry.source?: 'ai'`; AI-entry response types |
| Client hook | `src/hooks/useDictionarySearch.ts` | `aiEntry`, `canAskAi`, `askAi()` (sends `tz`); `aiLimitReached` + `aiLimitMessage` (429) |
| Client UI | `src/pages/DictionaryPage.tsx` | orange unclickable card + inline orange "AI" pill; daily-limit note; results-count pill → blue, segment-count prefix removed |
| Client UI | `src/components/AiDictionaryEntryCard.tsx` | orange synthetic card; headword font chosen from its script (CJK vs Latin) so es words render in the Latin UI font |
| Theme | `src/theme/colors.ts` (`COLORS.yellowMain` `#FF8E47`) | orange for AI cards (existing token) |

## Resolved decisions

- **Segmentation ambiguity** → **enumerate all tilings** (not greedy); search each so both `xian`
  and `xi`+`an` real words surface.
- **Community bar** → **no AI** there.
- **Empty-cache TTL** → **3 months**.
- **Abuse / rate limiting** → **per-user daily cap (revised).** Originally deemed unnecessary (finite
  pinyin space saturates the cache). Superseded once the fallback began accepting arbitrary
  Chinese-character queries + web search: now `DICTIONARY_AI_DAILY_LIMIT` completed model calls per
  user per local streak-day (default 10), enforced via `dictionary_ai_usage` (migration 99) → HTTP
  429. Cache hits are exempt. See [Daily limit](#daily-limit).

## Noted limitations

- **Cache-key spacing variants** — because the key is raw text (decided), spacing/case variants of
  the same intent don't share a row (`jian4shen1` vs `jian4 shen1`). Acceptable; the finite pinyin
  space still saturates.
- **Only `searchByWord1` is language-routed.** The other `DictionaryDAL` read paths
  (`findByWord1`, `findMultipleByWord1`, expansion-metadata helpers) still hard-code
  `this.tableName = dictionaryentries_zh`, so single-term lookups and reader enrichment remain
  **zh-only** — an `es` lookup through those paths returns nothing. Left as-is (out of scope); route
  them through `dictTableForLanguage` if/when the Spanish reader/lookup surfaces need it.
- **`es` unbounded AI spend.** The pinyin/Chinese query space is finite (cache saturates), but the
  **English** query space (zh *and* es) is effectively unbounded, so the per-user daily cap
  (`DICTIONARY_AI_DAILY_LIMIT`) — not cache saturation — is what bounds cost for the English paths.

## Dependencies / cross-references

- Numbered-pinyin matcher this reuses: [DICTIONARY_NUMBERED_PINYIN_SEARCH.md](./DICTIONARY_NUMBERED_PINYIN_SEARCH.md)
  (`buildNumberedPinyinPattern` in `server/dal/implementations/DictionaryDAL.ts`).
- Existing Anthropic client + `cache_control` prompt-caching pattern to mirror:
  `server/services/DictionaryService.ts` (`getAnthropicClient`, `generateExpansion`).
- Shared search hook + both consumers: [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md),
  `src/hooks/useDictionarySearch.ts`.
- Syllable-unit reference (not the segmenter, but the syllable-structure logic):
  `src/games/word-search/pinyinUnits.ts`.

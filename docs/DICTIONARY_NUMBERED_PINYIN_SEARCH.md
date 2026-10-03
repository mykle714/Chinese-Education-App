# Dictionary Search — Numbered-Pinyin Queries

> Status: **implemented**. Extends `GET /api/dictionary/search` (used by both the dictionary
> page and the Community search bar — see [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md)).

## What it is

`GET /api/dictionary/search?term=...` recognizes numbered-tone pinyin queries such as
`"jian4 shen1"` and matches them against the `numberedPinyin` column (space-separated syllables,
each suffixed with a tone digit 1–4; neutral-tone syllables carry **no digit at all** — see
`server/scripts/backfill/chinese/backfill-numbered-pinyin.js`).

Per space-separated syllable token in the query:

| Token form | Meaning | Column match |
|---|---|---|
| `base1`–`base4` | exact tone | that exact digit |
| `base0` or `base5` | neutral tone | bare base, no digit |
| `base` (no digit) | any tone | base with an optional 1–4 digit (includes neutral) |

A heteronym's OTHER readings (了 liǎo, 行 háng) live in `dictionaryentries_zh."searchReadings"`
(migration 165 — a pipe-separated list of every reading in both column spellings, built by
`server/scripts/backfill/chinese/lib/searchReadings.js` → `buildSearchReadings`). Both pinyin
regexes — the accent-agnostic one and the numbered one — also run against it, re-anchored per
reading by `anyReadingPattern`, so a word is findable under every reading, not only its primary
columns.

Matching is a **leading-syllable "starts with"** (not anchored at the end), so `"jian4"` alone
still matches `"jian4 shen1"` — consistent with the rest of `searchByWord1`'s prefix semantics.
Each token is anchored with a trailing `\y` word-boundary so a syllable can't bleed into a
longer one sharing the same prefix (e.g. any-tone `"shen"` must not match `"sheng1"`, and
neutral `"shen0"` must not match `"shen1"` — digits count as word characters in Postgres ARE, so
without the boundary an optional/absent digit would just consume whatever digit followed).

The whole numbered-pinyin path is skipped (falls back to the existing
word1/pronunciation/definitions search) if:
- any token isn't syllable-shaped (`^[a-zü]+[0-5]?$`), or
- **no** token carries an explicit digit — otherwise a plain multi-word phrase like `"to work
  out"` (no tone digits anywhere) would be misread as an all-any-tone pinyin query and silently
  hijack what should be a definitions search.

## The `rankBy` parameter (added 2026-09-09)

`GET /api/dictionary/search` accepts an optional `rankBy`
(`DictionarySearchRanking`, `server/contracts/wire.ts`). It changes **only the `ORDER BY`** —
the `WHERE` group, the `total`, and therefore the stage-2/AI fallback decisions are identical
either way, so it can never surface or hide a row that the other ranking would not.

> ⚠️ **`rankBy` no longer selects between two orderings.** Since 2026-09-09 every surface shares
> one bucket ladder, and `rankBy` chooses only whether that ladder is led by an *interleaved
> head*. The value names predate that convergence and are now weak — `relevance` does not rank by
> anything `english-first` does not, and `english-first` is not the only one putting English
> first. Renaming them is cheap (a query-param value, nothing persisted) and worth doing next
> time this is touched.

| Value | Ordering | Used by |
|---|---|---|
| `relevance` (default) | the shared bucket ladder | the dictionary page, the Community search bar |
| `english-first` | the same ladder **plus an interleaved head** | the iw composer's hint tray ([IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md) § 9a) |

A search is never *only* an English one or *only* a pinyin one — the query above ORs the
headword prefix, the pinyin regexes and the gloss regex together, so an ambiguous Latin term
qualifies under more than one reading and the ranking is what picks which the learner sees.
At a small `limit` that is not cosmetic: it decides which reading survives the `LIMIT` inside
Postgres. (`long` at `limit 8` under `relevance` returns eight pinyin 龙/垄/拢 rows and never
ships 长 "long" at all.)

### The shared bucket ladder

A match is **complete** when the term *is* the whole field, and **partial** when the term is only
part of it. Crossing that with the two readings gives four tiers, used by **every** ranking and
**both** languages; the complete-word tier is further split into a main and an alternate bucket
(zh only — see "Primary vs alternate readings" below):

| # | Bucket | Test | `long` (zh) | `casa` (es) |
|---|---|---|---|---|
| 0 | complete English | **any** normalized sense `=` normalized term | 长 "long" | — |
| 1 | complete word (main) | `lower(word1) =` term, or the row's **default reading** (`DEFAULT_READING_SQL`) `~ '^…$'` | 龙 lóng | **casa** |
| 2 | complete word (alternate) — zh only | `pronunciation`, `numberedPinyin` or any `searchReadings` entry `~ '^…$'`, but not the default reading | 吗 for "ma2" | — |
| 3 | partial word | `word1 ILIKE 'term%'`, or a pinyin regex as a prefix (`'^…'`) | 龙虾 lóng xiā | casarse |
| 4 | partial English | term is a whole word *inside* a sense | 寿 "long life" | casón "augmentative of casa" |

### Primary vs alternate readings (added 2026-10-03)

Before the split, every complete reading match tied in one bucket, and the tie broke on
`frequencyScore`. "ma2" therefore led with 吗/嘛 — which qualify only through their rare má
reading (吗啡) via `searchReadings` or a stale primary column — and the row then rendered with its
default sense's neutral "ma", looking like a wrong answer. Bucket 1 now holds only a complete match
on the reading the row **displays by default**; any other complete reading drops to bucket 2,
still above every partial match.

**"Main reading" = the default-sense reading, not the `numberedPinyin` column.**
`DEFAULT_READING_SQL` (`server/dal/implementations/DictionaryDAL.ts`) mirrors
`resolveDefaultPronunciation` (`server/utils/definitions.ts`): the highest-`frequencyScore` cluster's
`reading` (earliest on a tie), unless it is missing or its syllable count disagrees with
`pronunciation`, falling back to the `numberedPinyin` column — and for every unclustered row. Cluster
readings are normalized to the column spelling (neutral digit-less, ü as `v`). The column alone is not
enough: 么's column still says má while every sense reads `me5`
(`backfill-search-readings.js --repair-primary` re-points such columns, but has not been run over the
whole table).

The term is turned into a numbered regex by `parsePinyinQuery` + `pinyinQueryTokens`
(`server/utils/searchSenseMatch.ts`) and the existing `buildTokenPinyinPattern`. It accepts
numbered, tone-marked **and** toneless syllables (toneless = any tone) and needs no tone digit,
because it only orders rows that the `WHERE` already admitted, so it cannot hijack an English
search.

The interleaved head (below) samples buckets 1 and 2 as **one head group**, so its shape stays
`0,0,1,1,2,2,3,3`; main readings fill that group's two slots first.

### Sense matching (added 2026-10-03)

A row qualifies through any reading or gloss but is drawn with its default sense. When the term hit
a **different** sense, the search response names it, and the row shows that sense instead.

- **Server.** `DictionaryService.searchDictionary` sets `matchedSense` (the cluster's `sense`
  label, on the wire contract `DictionaryEntryBase`) on every returned entry via
  `resolveMatchedSense` (`server/utils/searchSenseMatch.ts`). It is null unless the entry has ≥ 2
  clusters and the term hit a non-default one:
  1. **Pinyin first.** If the term parses as pinyin and the default sense's displayed reading
     matches it (leading-syllable match, tones optional), nothing changes. Otherwise the best
     non-default cluster whose displayed reading matches wins.
  2. **English second**, only when no pinyin sense was chosen: the default sense's glosses matching
     the term (whole word, parentheticals stripped) means nothing changes; otherwise the best
     matching non-default cluster wins.
  "Best" = a complete match over a partial one, then higher cluster `frequencyScore`, then array
  order. A match through a reading that no cluster carries (a CEDICT-only reading in
  `searchReadings`) names no sense; that row renders as before, and the alternate bucket is what
  keeps it from leading.
- **Client.** `resolveSearchRowView` (`src/utils/definitionUtils.ts`) returns the row's pinyin
  (the matched cluster's reading via `clusterReadingOrColumn`, else `resolveDefaultPronunciation`)
  and its gloss list (the matched cluster's `glosses` first, then the rest of the flat
  `definitions`, de-duplicated). Used by `src/components/DictionaryEntryRow.tsx` (dictionary page
  and Compare slot B), `src/features/community/CommunitySearchBar.tsx` and
  `src/features/immersiveworld/play/IWLookupResults.tsx`.
- **Click-through.** `DictionaryPage` → `handleEntryClick` appends `?sense=<label>` to the cdp
  route; `DictionaryCardDetailPage` seeds `selectedSenseIndex` from it (outranking the
  requester's saved pick) through `resolveSelectedSenseIndex`. A gloss-less (particle) sense is
  absent from the cdp's sense list, so the page falls back to its default sense there.

Examples on dev: "row" → 行 shows háng with "row / line" first; "liao3" → 了 shows liǎo
"to understand"; "zhang3" → 长 shows zhǎng "to grow".

**Spanish uses the same tiers** (it has no alternate-reading bucket), with `word1` standing in for the pronunciation it does
not have. It has to: Wiktionary-derived Spanish glosses quote their own headword — casón is
*"augmentative of casa"*, casita is *"diminutive of casa"* — so with only a gloss bucket and a
headword bucket, English leading ranked `casa` itself **11th**, behind everything that merely
mentions it (`perro` 8th, `libro` 5th). The complete tier is what rescues the exact headword. An
earlier call had kept es at two buckets; unifying the rankings is what made that untenable, and
it was reversed.

**Every complete match outranks every partial one; English leads the complete pair, the word
side leads the partial pair.** The asymmetry is deliberate: someone typing a whole English word
usually means it, so an exact gloss is the best answer available — but a partial *pinyin* match
is usually someone mid-syllable, a far stronger signal than an English word merely appearing
somewhere inside a longer definition. Measured on dev, `men` gives 12 complete-pinyin (门
"door"), 100 incomplete-pinyin (门口), and 45 incomplete-English ("…worn by men in ancient…").

**Normalization for bucket 0.** A CC-CEDICT gloss carries a marker the headword does not — 吃 is
*"to eat"*, not *"eat"*. Raw equality would put the single best answer for every verb in bucket
3, behind partials like 饱 "to eat till full". So a leading `to` / `the` / `an` / `a` is stripped
(after the existing parenthetical-strip, plus a `btrim` and `lower`) from **both** the gloss and
the term, which also makes typing "eat" and "to eat" behave identically. **648** of the 4,224
discoverable zh rows have a `to `-prefixed first gloss and another **123** lead with an article.

Bucket 0 tests **every** sense, not just the first, and this is what it is for: 我 is
`["I","me","my"]`, so `me` is a complete match on its *second* sense and 我 leads the strip.
Testing `definitions[0]` alone would have surfaced 我 (the widened `WHERE` above finds it) but
ranked it in bucket 3, behind partial matches — found, yet buried. Unlike the `WHERE`, this test
is an equality on ONE sense, so it must unnest; the cost is fine because an `ORDER BY` expression
is evaluated only over rows that already matched, not the whole table. Each element is
additionally split on `'; '`, mirroring `generateShortDefinition` (`server/utils/definitions.ts`)
so "complete" agrees with how the dd is built — only 18 zh rows have a `'; '` inside one element
(从来's "never; always"), but without the split those senses would be invisible to the equality.

The ladder is a SQL `CASE`, so precedence falls out of the `WHEN` order: a row that is both
complete-English and complete-pinyin takes 0. Bucket 3 is the `ELSE` by elimination, since the
`WHERE` guarantees every row matched something.

### The interleaved head

`english-first` does not simply emit the buckets in order. It first takes **two rows from each
bucket** — `0,0,1,1,2,2,3,3` — and only then resumes the plain ladder. `long` therefore opens:

| # | | |
|---|---|---|
| 1–2 | 长 "long", 久 "long" | complete English |
| 3–4 | 龙 lóng, 儱 lǒng | complete pinyin |
| 5–6 | 龙头 lóng tóu, 龙年 lóng nián | incomplete pinyin |
| 7–8 | 伫 "to stand for a long time", 寿 "long life" | incomplete English |
| 9+ | 𬙂, 悠久, 悠长, 漫漫… | bucket 0 continues, then 1, 2, 3 |

Straight bucket order has a failure mode at the top of a short strip: a term with dozens of
exact glosses fills every visible slot with bucket 0 and the learner never learns a complete
*pinyin* reading of what they typed exists. The head guarantees every reading is represented in
the first handful of results.

It is a **pure re-ordering** — same rows, same `total`, and paging stays coherent because the
`ROW_NUMBER()` window is computed after the `WHERE` and before the `LIMIT`. Verified on dev by
paging the full result set for `long` (539), `men` (157) and `eat` (86): every row appears
exactly once and the id set is identical to `relevance`'s.

**The head is the ONLY difference between the iw tray and every other surface**, and that is
verified rather than asserted: paging both rankings end-to-end for zh `long`/`me`/`eat`/`men`/`shi`
and es `casa`/`perro`/`house`/`libro`, `english-first` comes out as exactly its own 8 head rows
followed by `relevance`'s order with those rows removed.

Mechanically it is also the one place the two run **different SQL**: `english-first` wraps
the shared `WHERE` in a subquery that numbers each row within its bucket
(`ROW_NUMBER() OVER (PARTITION BY <bucket> ORDER BY …)`) and orders on
`CASE WHEN "bucketPos" <= 2 THEN 0 ELSE 1 END, "rankBucket", "bucketPos"`. `relevance` keeps the
flat query, so it never pays for a window it does not use. When the ladder degrades to the
historical two-bucket word-first expression (no gloss predicate — only an empty term, which
callers already reject, so this is a defensive path) `english-first` degrades **all the way**, taking the flat path too, rather than
sampling a head off buckets the caller never asked for.

**Spanish uses the same four buckets**, with the headword in pinyin's slot (decided
2026-09-09, reversing an earlier two-buckets-for-es call): es has no `pronunciation` column, so
"complete word" means `word1` equals the term and "partial word" means it is a prefix. The
two-bucket version buried exact headwords under Wiktionary glosses that quote them ("casa" ranked
11th behind "diminutive of \"casa\"").

**Single-character terms search glosses too** (2026-09-24). There is no 2-character floor on the
English-definition predicate, so "I" finds 我/本人 and es "a"/"o"/"y" find their headwords. The
gloss regex is a sequential scan at any length, so the only added cost is ranking a larger match
set: on dev the worst case (es "a", ~19k matches) measured ~260 ms against ~80 ms for a typical
term; zh single letters stayed ~100–125 ms. Code: `server/dal/implementations/DictionaryDAL.ts` →
`searchByWord1` (`definitionsSearchEnabled`).

An unrecognised value is a **400**, not a silent fall back to the default, so a client typo
surfaces as a broken request rather than quietly-wrong ordering.

## Layers

| Layer | File | Responsibility |
|---|---|---|
| Parsing + SQL | `server/dal/implementations/DictionaryDAL.ts` (`buildNumberedPinyinPattern`, `anyReadingPattern`, used in `searchByWord1`) | token → regex, `~*` match against `"numberedPinyin"` and `"searchReadings"` |
| Default reading | `server/dal/implementations/DictionaryDAL.ts` → `DEFAULT_READING_SQL`; query parsing in `server/utils/searchSenseMatch.ts` → `parsePinyinQuery`, `pinyinQueryTokens` | bucket 1 vs 2 (main vs alternate complete reading) |
| Sense matching | `server/utils/searchSenseMatch.ts` → `resolveMatchedSense` (called from `DictionaryService.searchDictionary`); client `src/utils/definitionUtils.ts` → `resolveSearchRowView` | `matchedSense` on each hit; the row's pinyin + gloss order; cdp `?sense=` |
| English clause | `server/dal/implementations/DictionaryDAL.ts` → `STRIPPED_ALL_GLOSSES` | all-senses `~*` match; see the section above for why it is not `definitions[0]` |
| Ranking | `server/dal/implementations/DictionaryDAL.ts` → `searchByWord1` (`rankExpr`, `completeGlossMatch`, `GLOSS_LEADING_MARKERS`) | builds the bucket ladder from `rankBy`; its params are kept in a separate `rankParams` list because only the entries query has an `ORDER BY` |
| Controller/Service | `server/controllers/DictionaryController.ts` → `search`, `server/services/DictionaryService.ts` → `searchDictionary` | the pinyin parsing is entirely inside the DAL query; `rankBy` is validated in the controller against `DICTIONARY_SEARCH_RANKINGS` and passed straight through |
| Client | `src/hooks/useDictionarySearch.ts` | shared debounce + segment-vs-search fetch, used by `DictionaryPage.tsx` and `src/features/community/CommunitySearchBar.tsx` |

## Dependencies / cross-references

- Numbered-pinyin column format/backfill: `server/scripts/backfill/chinese/backfill-numbered-pinyin.js`.
- The gloss the result card actually renders (all senses, joined with `; `):
  `src/components/DictionaryEntryRow.tsx`. The search's English clause is kept aligned with it —
  they drifted once (see the all-senses section) and that drift was the 我/"me" bug.
- dd construction, which the complete-match test mirrors: `server/utils/definitions.ts` →
  `generateShortDefinition`.
- CJK-segment mode (the other branch `useDictionarySearch` can take): `GET
  /api/dictionary/segment`, [greedySegmentation.md](./greedySegmentation.md).
- Consumers: `src/features/dictionary/DictionaryPage.tsx`, `src/features/community/CommunitySearchBar.tsx`
  (see [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md)), and
  `src/features/immersiveworld/play/IWComposer.tsx` — which does NOT use
  `useDictionarySearch` (it never takes the CJK-segment branch, and it pages a horizontal chip
  strip rather than a list), and is the only caller passing `rankBy=english-first`.
- Spaceless-pinyin + AI synthetic-entry fallback that builds on this matcher (design):
  [DICTIONARY_AI_FALLBACK_SEARCH.md](./DICTIONARY_AI_FALLBACK_SEARCH.md).

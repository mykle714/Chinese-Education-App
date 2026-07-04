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

## Layers

| Layer | File | Responsibility |
|---|---|---|
| Parsing + SQL | `server/dal/implementations/DictionaryDAL.ts` (`buildNumberedPinyinPattern`, used in `searchByWord1`) | token → regex, `~*` match against `"numberedPinyin"` |
| Controller/Service | `server/controllers/DictionaryController.ts`, `server/services/DictionaryService.ts` | unchanged — the parsing is entirely inside the DAL query |
| Client | `src/hooks/useDictionarySearch.ts` | shared debounce + segment-vs-search fetch, used by `DictionaryPage.tsx` and `src/pages/CommunityPage/CommunitySearchBar.tsx` |

## Dependencies / cross-references

- Numbered-pinyin column format/backfill: `server/scripts/backfill/chinese/backfill-numbered-pinyin.js`.
- CJK-segment mode (the other branch `useDictionarySearch` can take): `GET
  /api/dictionary/segment`, [greedySegmentation.md](./greedySegmentation.md).
- Consumers: `src/pages/DictionaryPage.tsx`, `src/pages/CommunityPage/CommunitySearchBar.tsx`
  (see [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md)).
- Spaceless-pinyin + AI synthetic-entry fallback that builds on this matcher (design):
  [DICTIONARY_AI_FALLBACK_SEARCH.md](./DICTIONARY_AI_FALLBACK_SEARCH.md).

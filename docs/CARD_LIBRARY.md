# Card Library (the cards page's grid, filters, search and sort)

The learner's whole card library as a searchable, sortable, filterable grid of mini cards.
Its one host is the Deck Tower's **cards page** under each world's platform
([DECK_TOWER.md](./DECK_TOWER.md) § "The cards page" — the page's layout, the filter keys'
look, the platform stop and the header hand-off live there). This doc covers the data and
the shared components the page is built from.

Parent: [DECK_TOWER.md](./DECK_TOWER.md).

| Layer | File → symbol | Role |
|---|---|---|
| Feature hook | `src/features/flashcards/useCardLibrary.ts` → `useCardLibrary(lens)`, `CardsFilter`, `CardLibraryState` | The library through one mastery lens: filter, search, sort, the filter keys' figures |
| Feature data | `src/features/flashcards/cardLibrary.ts` → `loadCardLibrary`, `peekCardLibrary`, `libraryKey` | The `all` collection, loaded once and shared across world remounts |
| Feature module | `src/features/flashcards/builtinCollections.ts` → `lensCollectionEntries`, `builtinCollectionCount`, `BuiltinCollectionEntry` | The lens's two built-in collections and their figures |
| Feature module | `src/features/flashcards/collectionRef.ts` → `CollectionRef`, `collectionTitle`, `builtinCollectionId`, `withLens`, `lensFromSearch`, `LENS_PARAM` | The client-side name of a collection, and the `?world=` lens param a cdp is opened with |
| Feature component | `src/features/flashcards/CollectionSortControl.tsx` → `CollectionSortControl` | The sort trigger + menu |
| Shared component | `src/components/SearchField.tsx` → `SearchField` | Every search box in the app |
| Shared component | `src/components/MiniVocabCardGrid.tsx`, `MiniVocabCard.tsx`, `MiniCard.tsx`, `miniCardFace.ts` | The grid and the mini card |
| Utility | `src/utils/vocabSort.ts` → `sortVocabEntries`, `sortBundles`, `sortLabel`, `masteryLowestKey`; `src/utils/vocabSearch.ts` → `filterVocabEntries` | Orderings and the search filter |
| Client API | `src/api/collections.ts` → `fetchCollectionCards` | `GET /api/onDeck/collectionCards?collection=<id>` |
| Server | `server/routes/onDeckRoutes.ts`; `OnDeckVocabController.getCollectionCards` / `getMasteredCounts` / `getCategoryCounts`; `OnDeckVocabService.getBuiltinCollectionCards` / `getMasteredCountsByWorld` / `getCategoryCounts`; `server/dal/shared/vetTable.ts` → `BUILTIN_COLLECTION_IDS`, `parseBuiltinCollectionId`, `builtinCollectionClause`, `unmasteredBarClause`, `masteredBarClause`; `server/contracts/wire.ts` → `ALL_COLLECTION_ID`, `MASTERED_COLLECTION_IDS`, `masteredCollectionWorld`, `LEARN_NOW_COLLECTION_IDS`, `learnNowCollectionWorld` | The built-in collection reads and the count endpoints |

---

## Built-in collections

`builtinCollections.ts`, `collectionRef.ts`, `vetTable.ts`, `wire.ts`.

A **built-in collection** is a server-defined set of the learner's sorted cards, named by a
wire id (`CollectionRef` on the client). There are three ideas:

| Collection | Wire id(s) | What it holds |
|---|---|---|
| **All** | `all` (`ALL_COLLECTION_ID`) | every sorted card, mastered or not — the one bar-independent set. The library `cardLibrary.ts` loads |
| **Learning** | `learn-now`, `learn-now-reading`, `learn-now-writing` (`LEARN_NOW_COLLECTION_IDS`) | every sorted card whose named bar is unfinished |
| **Mastered** | `mastered`, `mastered-reading`, `mastered-writing` (`MASTERED_COLLECTION_IDS`) | the cards finished in one bar |

Learning and Mastered are **per bar**, and each Learning set is the exact complement of
its bar's Mastered set (`unmasteredBarClause` vs `masteredBarClause`), so the two always
partition that bar's library. The ids keep the old `learn-now` spelling (a wire value —
see CLAUDE.md § Terminology).

`lensCollectionEntries(lens)` gives one lens's two sets, Learning then Mastered — the
cards page's two filter keys. There is no **All** entry: the unfiltered grid already is
the whole library. The per-band collections (Unfamiliar / Target / Comfortable) do not
exist: a utcm band is a property of one card's progress, not a set a learner studies.

The client filters the loaded `all` library locally (`useCardLibrary` → `cardsFilter`,
using `barCategory` against the lens bar); `GET /api/onDeck/collectionCards` is called
only for `all`.

## Counts

`builtinCollectionCount(ref, categoryCounts, masteredCounts)` derives each figure from the
two count hooks the page already loads — no third endpoint:

| Figure | Source |
|---|---|
| All | `useCategoryCounts` — the four bands summed |
| Learning | `useCategoryCounts` — Unfamiliar + Target + Comfortable, mirroring the collection's own SQL. `useCardLibrary` fetches the band counts **per lens** (`?world=` on `GET /api/onDeck/categoryCounts`), so the bands are read off the same bar |
| Mastered | `GET /api/onDeck/masteredCounts` (`useMasteredCounts`) — that bar's total |

`masteredCounts` stays separate from `categoryCounts`: one answers "how many cards in each
band of one bar", the other "how many Mastered in each bar". Both are fetched whatever the
goals.

⚠️ These Learning figures count **every non-mastered card, cooling or not** — not the
Deck Tower's Learning tower, which counts off-cooldown cards in all four bands. td shows
both on purpose (CLAUDE.md § Terminology).

## The mini card

`src/components/MiniCard.tsx` (`MiniCard`, `MiniCardFrequencyBadge`), `miniCardFace.ts`
(`miniCardFaceSx`, `MINI_CARD_RING`, `MINI_CARD_WIDTH` / `HEIGHT` / `RADIUS`, and the
contents' geometry: `MINI_CARD_CONTENT_LAYOUT`, `MINI_CARD_BAR_STRIP`, `DEFINITION_*`,
`miniCardDefinitionBottom`).

The 92×132 tile is the app's one mini preview card. `MiniVocabCard` (the library grid),
`QuickMarkCard` (provisional sort offer), `ChallengeWordCard` (a challenge word set) and
acp's `DraggableCard` (`AddCardsPage.tsx`) all render it. `MiniCard` owns the tile
(size, radius, fill, hairline inset ring, elevation, offscreen containment, staggered
pop-in) and its contents: icon slot, word (`ForeignText`), 2-line definition and the
optional mastery strip. Wrappers pass plain display values plus `children` overlays
(corner badges, action buttons). The **mastery strip is opt-in** (`masteryBar`; only
`MiniVocabCard` passes it); omitting it gives the strip's height back to the definition.

**Its SVG twin.** `MiniCardSvg` (`src/components/MiniCardSvg.tsx`) draws the same face —
tile, ring, icon, cpcd word, two-line gloss — as native SVG, for the acp's iso deck tops
(`SortBins.tsx` → `DeckFace`), where WebKit mis-paints HTML inside a transformed
`<foreignObject>`. It places the contents by hand (`miniCardSvgLayout.ts` →
`layoutMiniCardSvg`) from `miniCardFace.ts`'s geometry and `cpcdLayout.ts`'s cpcd tables and
pinyin solver — the numbers `MiniCard` and `CPCDRow` render with — so changing those reaches
both. Changing anything else about the card's contents (a new element, a new style) must be
mirrored in `miniCardSvgLayout.ts`. It does not draw the mastery strip, icon layers or overlays.

The library grid prints the card on the Deck Tower's card stock (`MiniVocabCardGrid`
`cardStock` → `MiniVocabCard` `stock`); see DECK_TOWER.md § "The cards page".

⚠️ The ring is an INSET box-shadow, never a `border`: every element on the face is
absolutely positioned against the card box, and a real border would shift all of it by 1px.

## Why the card grid is windowed

`src/components/MiniVocabCardGrid.tsx` (`WINDOW_MIN_ITEMS`, `WINDOW_OVERSCAN_PX`,
`CASCADE_LIMIT`, the two spacers), `src/hooks/useWindowedRows.ts` (`useWindowedRows`,
`computeRowWindow`, `seedWindow`, `scrollParentOf`), `src/hooks/useIncrementalList.ts`,
`MiniVocabCard.tsx` (`memo`, `contentVisibility`), `src/__tests__/windowedRows.test.ts`.

The grid holds the learner's **entire** library, mastered cards included (470 on the large
test account). Four mechanisms, each doing a different job:

| Mechanism | What it removes | What it does NOT do |
|---|---|---|
| `memo` on `MiniVocabCard` + stable `onCardClick` | Re-rendering every card when unrelated page state changes | Nothing about the first mount |
| `content-visibility: auto` + `contain-intrinsic-size` | Layout and paint for offscreen cards | React still creates every element |
| `useIncrementalList` (the paced reveal) | The mount landing in ONE commit | Bound the total; past `CASCADE_LIMIT` (15) it stops pacing |
| `useWindowedRows` (windowing) | The rows themselves — only ~20 cards exist at a time | Apply to `renderCard` callers |

`CASCADE_LIMIT` returns everything past card 15 to a single commit; windowing is what makes
that safe (the commit is large in entries but small in rows). **Neither can be removed on
the assumption that the other covers it.**

- **Measured against the nearest scrollable ancestor**, not the viewport; rAF-coalesced,
  scroll listener on `window` with `capture: true`, a `ResizeObserver` for the scroller's
  height.
- **Spacers.** Rows outside the window are two full-width spacers, each
  `rows × (cardHeight + gap) − gap` tall (the container's own gap supplies the inner
  separation). The invariant is unit-tested in `windowedRows.test.ts`; get it wrong and
  the scroll jumps as rows enter the window.
- **The gap must stay constant** (`ROW_GAP_PX`): nothing may animate the container's
  `gap`, which is why the grid's scroll stretch moves rows with `translate3d`
  ([UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § "Scroll stretch").
- **Off below `WINDOW_MIN_ITEMS` (45)**, and **off for `renderCard` callers** (the challenge
  pages): spacer arithmetic is valid only on a fixed lattice. A new `renderCard` caller with
  an unbounded list must page or window itself.
- **Search** runs the term through `useDeferredValue` (`useCardLibrary`) before
  `filterVocabEntries`, so the caret never stalls. A new result is a new array, which
  restarts the reveal cascade — accepted as "results arriving".
- **A filter change remounts the grid** (`TowerCardsPage` keys `MiniVocabCardGrid` on
  `cardsFilter`), so every card replays its entrance; search does not remount (narrowing a
  set is not switching sets).

## Search field

`src/components/SearchField.tsx` → `SearchField`.

Every search box in the app is this one component: magnifier, conditional clear button,
`fullWidth`, density→icon-size pairing, focus-after-clear. Call sites: `TowerCardsPage`,
`DictionaryPage`, `DictionaryWordSearch`, `CommunitySearchBar`, `IconPickerDialog`.

- **`endAction`** renders a filter/sort control **inside** the trailing adornment, right of
  the clear button. The adornment renders whenever there is a term **or** an `endAction`,
  so the control does not vanish when the field empties. The cards page passes
  `CollectionSortControl`.
- `onChange` receives the **string**. `onClear` defaults to `onChange("")`; pass it only
  where clearing means more (the dictionary search's `clearSearch` also drops results).
- No data access: debouncing and querying stay with the host.

## Sort by

`src/utils/vocabSort.ts` (+ `src/__tests__/vocabSort.test.ts`),
`src/features/flashcards/CollectionSortControl.tsx`, `server/contracts/cooldown.ts`
(`barCooldownRemainingMs`), `src/utils/definitionUtils.ts` (`resolveDisplayDefinition`,
`resolveDisplayPronunciation`), `server/contracts/mastery.ts` (`barProgressBarHeight`,
`activeWorlds`).

`CollectionSortControl` is a bare `SwapVertIcon` trigger in the search field's
`endAction`; the active ordering is in its `aria-label` / tooltip (`Sort: <label>`,
`sortLabel`), not printed on screen. It owns the picker only — the host
(`useCardLibrary`) holds the key and applies it with `sortVocabEntries`.

**The menu is a list of bundles** (`SortBundle` / `sortBundles(language, goals, lens)`):
each row names a dimension and carries both directions as toggles (a `Box` with a MUI
`ToggleButtonGroup`, deliberately not a `MenuItem`).

| Row | Directions → keys | Orders on |
|---|---|---|
| Date added | Newest `recent` · Oldest `oldest` | `vet.createdAt` |
| Pinyin / Word | A–Z `alphaPronunciation` · Z–A `alphaPronunciationDesc` | tone-insensitive display pinyin (`entryKey` when none); "Word (A–Z)" for Spanish |
| Definition | A–Z `alphaDefinition` · Z–A `alphaDefinitionDesc` | the dd |
| Cooldown *(per bar)* | Shortest `cooldownReady*` · Longest `cooldownLongest*` | that bar's cooldown remaining (`barCooldownRemainingMs`) |
| Mastery *(per bar)* | Highest `mastery*Desc` · Lowest `mastery*Asc` | that bar's pbh (`barProgressBarHeight`) |

- **Opens on the lens bar's Mastery · Lowest** (`masteryLowestKey(lens)`) in every world:
  the page is the whole library and the errand is "what should I work on". Per visit, not
  persisted.
- **Per-bar rows are goal-gated** (`activeWorlds(goals)`; `MASTERY_KEY_WORLD`,
  `COOLDOWN_KEY_WORLD`). Under a skill lens only that bar's rows are offered and labels lose
  their qualifier. The core bar is never named "(Know)".
- **`allowPerSkillBars`** (the one visibility gate) hides reading/writing rows under the
  **core** lens; the main world's page passes `false`. Inert under a skill lens. It filters
  on the bundle's `world` tag, not its id.
- **`sortVocabEntries` takes no goals and no lens** — every key names its bar.
- **Client-side**: the whole library is one response, and every key is computable from the
  row; the alphabetical keys are sense-aware (a card files under what its face shows).
- **Cooldown 0 means "ready"**, not "no date" — a never-studied card leads Shortest.
  `sortVocabEntries` takes `now` once per sort; the list does not tick.
- **Missing timestamps sink to the bottom in both directions** (`DATE_KEYS`).
- ⚠️ No *Date mastered* row: `masteredAt` was not backfillable before migration 142, so
  most of a library would sink. The stamp is still stored and read by the cdp's mastery
  window.

See [MASTERY_REWORK.md](./MASTERY_REWORK.md) § Three bars for the bars themselves.

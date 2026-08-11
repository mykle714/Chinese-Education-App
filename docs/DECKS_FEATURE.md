# Decks & Collection Views

User-authored card sets, and the one page that renders every set of cards in the app.

Two things landed together here, because one made the other possible:

1. **Collection view page** — the `/flashcards/mastered` page was generalized into a
   page that renders *any* set of the learner's cards, with a search bar and a
   launch button that drops straight into any game or the flp **with just those
   cards**.
2. **Decks** — a deck is a named set of a user's cards (`decks` / `deck_cards`,
   migration 141). Selecting one opens its collection view. The `/decks` page,
   whose space used to be the inline Learn Now card grid, is now the deck list.

---

## 1. Data model (migration 141)

`database/migrations/141-create-decks.sql`

| Table | Columns | Notes |
|---|---|---|
| `decks` | `id` serial PK · `userId` uuid → `users(id)` CASCADE · `language` varchar(8) · `name` varchar(64) · `createdAt` · `updatedAt` | Unique on (`userId`, `language`, `lower(btrim(name))`); CHECK `btrim(name) <> ''`; index on (`userId`, `language`) |
| `deck_cards` | `deckId` int → `decks(id)` CASCADE · `vocabEntryId` int · `addedAt` | PK (`deckId`, `vocabEntryId`); index on `vocabEntryId` |

### A deck carries no study state

A deck is a set of cards **and nothing else** — no scheduling, no mastery, no
progress. All of that lives on the vet row the deck points at, which is what lets
a card sit in three decks with **one** mark history. Consequently:

* Deleting a deck **never** deletes a card or its history. It drops membership rows.
* Renaming, creating and deleting decks are free operations with no study
  consequences.

### Per-language, and why

`language` lives on the **deck**, not on the membership row. User vocab is
physically split into `vocabentries_zh` / `vocabentries_es`, every game runs in
exactly one language, and a mixed deck would force every read to union both tables
and every launch surface to re-filter. The deck's language also tells the read path
*which vet table to join* (`vetTableForLanguage`).

The same deck name in two different languages is allowed and expected ("Food" for
zh and for es); the unique index is per (user, language).

### ⚠️ No foreign key on `deck_cards."vocabEntryId"`

Not an oversight. The vet is two physical tables sharing one id sequence, so there
is no single table to reference and Postgres cannot express "references exactly one
of these two". The integrity an FK would have given us comes from two places:

* `ON DELETE CASCADE` from `decks` — covers deck deletion.
* An explicit `DELETE FROM deck_cards` **inside the vet row-delete transaction** —
  `VocabEntryDAL.delete` (`server/dal/implementations/VocabEntryDAL.ts`). Covers
  card deletion. Without it, deleting a card would leave dangling membership rows
  and every deck holding it would report an inflated `cardCount` forever.

If the vet is ever unified into one table, add the FK and delete that cleanup.

### `color` is derived, not stored

There is deliberately no `color` column. A deck's pastel comes from
`deckAccentColor(deckId)` (`src/features/flashcards/collectionRef.ts`), a modulo
over the app's existing accent family. It is stable for the life of the deck, costs
no migration, and cannot drift.

---

## 2. Server layers

| Layer | File | Owns |
|---|---|---|
| Types | `server/types/decks.ts` | `DeckSummary`, request bodies |
| DAL | `server/dal/interfaces/IDeckDAL.ts`, `server/dal/implementations/DeckDAL.ts` | The two deck tables. **No vet reads.** |
| Service | `server/services/DeckService.ts` | Ownership, language scoping, name rules, the deck cap |
| Controller | `server/controllers/DecksController.ts` | HTTP edge |
| Routes | `server/routes/deckRoutes.ts` | Registration |
| DI | `server/dal/setup.ts` | `deckDAL` → `deckService` → `decksController` |

### Endpoints

```
GET    /api/decks                              → DeckSummary[]   (caller's current language)
POST   /api/decks              {name}          → DeckSummary     201
PATCH  /api/decks/:id          {name}          → DeckSummary
DELETE /api/decks/:id                          → 204
GET    /api/decks/:id/cards                    → VocabEntry[]
GET    /api/decks/memberships?vocabEntryId=N   → number[]  (deck ids)
PUT    /api/decks/memberships  {vocabEntryId, deckIds} → number[]
```

⚠️ **Route ordering**: both `/api/decks/memberships` routes are declared **above**
`/api/decks/:id` — "memberships" is a legal `:id` segment value.

### Rules the service owns

* A deck belongs to exactly one account and one language, both taken from the
  **session**, never from the request body.
* A deck the caller does not own is reported **NotFound**, not Forbidden, so deck
  ids leak nothing.
* **100 decks per language** (`MAX_DECKS_PER_LANGUAGE`, `DeckService.ts`). A
  product limit, not a database constraint — changeable without a migration.
* Name ≤ 64 chars (mirrors the column), non-blank, unique per (user, language)
  case-insensitively. The unique index is the authority; the service's pre-check
  only produces a nicer message for the ordinary case.
* Membership saves are **whole-set**, not deltas: `deckIds` is what the card's
  membership should *be*. Deck ids the caller does not own are silently ignored, so
  a menu left open across a deck deletion still saves the ticks the user did make.

### Why the deck's card READ lives on `OnDeckVocabService`

`GET /api/decks/:id/cards` returns fully-enriched `VocabEntry` rows — DICT_JOIN
columns, the computed utcm category, the enrichment pipeline. All of that already
exists on `OnDeckVocabService` beside the built-in collection read
(`getBuiltinCollectionCards`), and a deck is simply another collection. So `DeckService`
owns the **policy** (is it yours, which language) and delegates the **read** to
`OnDeckVocabService.getDeckCards`.

That read is **SORTED**, not playable, and orders by `deck_cards."addedAt" DESC` —
a deck is something the user assembled, so "what I most recently put in here" is
the meaningful recency.

---

## 3. Launching a game or the flp with one collection

The collection view page's top button launches any surface restricted to that set.

### Wire format

| Collection | Launch params | Server filter (`builtinCollectionClause`) |
|---|---|---|
| All Cards | *(none)* | none — **All is the default pool** |
| Unfamiliar / Target / Comfortable | `?collection=unfamiliar` etc. | `compute_core_category(...) = '<band>'` |
| Learn Now | `?collection=learn-now` | `compute_core_category(...) <> 'Mastered'` |
| Mastered (core) | `?collection=mastered` | `masteredBarClause('core')` |
| Reading Mastered | `?collection=mastered-reading` | `masteredBarClause('reading')` |
| Writing Mastered | `?collection=mastered-writing` | `masteredBarClause('writing')` |
| A deck | `?deck=<id>` | `AND (EXISTS deck_cards row OR bucket = 'provisional')` |

**`all` is the one that sends nothing**, because every game and the flp already draw
from every sorted card — a clause for it would restate `vetPlayableClause()`.

> ⚠️ **`learn-now` used to be the empty one, and that was a latent bug.** It was
> correct while Learn Now meant "every sorted card"; once the `all` collection existed
> the two stopped being the same set, and Learn Now is really "sorted AND not
> core-mastered". A round launched from Learn Now was therefore including mastered
> cards its own page does not list. It now sends its id like any other narrowing
> collection. **Expect a behaviour change**: Study-from-Learn-Now no longer serves
> mastered cards.

`CollectionFilter` (`OnDeckVocabService`) has just two variants — `deck` (a STORED
set, the `deck_cards` join) and `builtin` (a COMPUTED set, carrying the id whose
clause defines it). Adding the band collections therefore added no variant, only ids.

### Where the filter is applied

One helper, `OnDeckVocabService.deckPlayFilter`, returns a WHERE fragment + bind
params and is spliced into **every** candidate query — including the fallback and
last-resort ones, so a restricted round can never quietly top itself up from
outside the set:

* `fetchGameCandidates` — all four games' pools, and the Word Search grid
* `fetchFlpCandidates` — the single candidate source behind **both** flp paths (the
  initial loop's quotas and top-up, via `fetchEligibleCategoryCards`, and the refill)

SQL fragments live in `server/dal/shared/vetTable.ts`: `vetDeckClause` (strict, for
reads that mean "the deck") and `vetDeckOrProvisionalClause` (for rounds). The deck
id is always a **bind parameter**; only the `$n` placeholder position is interpolated.

### ⚠️ The refill is a separate call, and it must carry the restriction

`POST /api/flashcards/mark` is what refills the flp working loop. A deck-launched
session that omitted the restriction there would serve an off-deck card the moment
the learner answered the first card correctly. The client therefore echoes the
collection back in the mark body (`deckId` / `collection`), and the route threads
it into `getNextLibraryCardWithFallback`.

The same applies to Bubble Match's "Play Again" partial refill and Speed Reading's
mid-run top-up — both append the collection params to the refill request.

### Ownership is checked at launch

`OnDeckVocabController.resolveCollection` resolves `?deck=` through
`DeckService.getDeck`, so a stale link to a deleted deck **404s** rather than
quietly playing the whole library under a deck's name. This is a correctness check,
not a security boundary: every downstream query is already filtered by
`ve."userId"`, but "selects nothing" would then trigger the provisional top-up and
hand the learner a round made entirely of lent cards with no explanation.

### Playing a small deck

A deck smaller than a surface's baseline is topped up by the ordinary provisional
mechanism (docs/PROVISIONAL_CARDS.md). Two decisions worth knowing:

* Lent cards **are** servable in a deck-restricted round — that is what
  `vetDeckOrProvisionalClause` is for. The game is full rather than degraded.
* Lent cards are **not** written into the deck. Playing an under-sized deck never
  silently grows it, and the existing provisional notice still tells the learner
  which words were borrowed.

**But a deck-restricted flp round is never topped up mid-loop.** The two lending
triggers are scoped differently on purpose (docs/PROVISIONAL_CARDS.md § "Which flp
sessions may be topped up"):

| Trigger | Deck round? |
|---|---|
| `ensureBaseline('flp')` — the learner holds fewer than 20 playable cards at all | **lends**, as above |
| `lendCards` — the loop can't be filled because every card is on cooldown | **does not lend**; `canLendProvisional` returns false for any `collection` |

The distinction is between *bootstrapping a learner who has almost nothing* and
*papering over a deck that is simply resting*. A deck whose cards are all cooling comes
back empty with "Every card in this deck is resting" rather than serving ten words that
aren't in the deck. Do not unify these two by making `canLendProvisional` accept decks.

Distractors are *not* restricted: Speed Reading's foils
(`/api/games/speedReading/distractors`) stay global, because drawing them from the
deck would make the deck itself the answer key.

---

## 4. Client layers

| File | Role |
|---|---|
| `src/api/decks.ts` | Typed calls against `/api/decks/*`. No `token` param (FRONTEND_LAYERING §3.2). |
| `src/features/flashcards/collectionRef.ts` | **The one definition of "a collection"** — kinds, titles, routes, launch params, mark-body fields, deck accent color |
| `src/features/flashcards/useLaunchCollection.ts` | Reads the collection back off a surface's own URL |
| `src/features/flashcards/CollectionViewPage.tsx` | The generalized page (all three collection kinds) |
| `src/features/flashcards/MasteredRedirect.tsx` | `/flashcards/mastered` → `/flashcards/collection/mastered` |
| `src/features/flashcards/FlashcardsDecksPage.tsx` | `/decks`, now the deck list |
| `src/features/flashcards/AddToDeckMenu.tsx` | The checkbox menu, mounted on the cdp and the eip |

### Routes

```
/flashcards/collection/all               ─┐
/flashcards/collection/unfamiliar        ─┤
/flashcards/collection/target            ─┤
/flashcards/collection/comfortable       ─┤
/flashcards/collection/learn-now         ─┼─ CollectionViewPage
/flashcards/collection/mastered          ─┤
/flashcards/collection/mastered-reading  ─┤
/flashcards/collection/mastered-writing  ─┤
/flashcards/deck/:id                     ─┘
/flashcards/mastered                     ─── MasteredRedirect (legacy)
```

**The list of built-in ids lives server-side** — `BUILTIN_COLLECTION_IDS` in
`server/dal/shared/vetTable.ts`, right beside `builtinCollectionClause`, the WHERE
fragment that gives each id its meaning. `collectionRef.ts` re-exports it rather than
restating it: a collection the client can link to but the server cannot resolve would
be a dead page, and a second list is exactly how that happens. The id *spellings*
(`mastered-reading`, `unfamiliar`) come from `wire.ts`.

One route serves all eight because the segment is `:builtin` — adding a ninth
collection is a case in `builtinCollectionClause` and a tile on the fdp, nothing else.

**Two routes, not one `:collectionId`.** A deck is addressed by its numeric id under
its own path segment, so a user who names a deck "mastered" gets
`/flashcards/deck/42` — a deck name can never shadow a built-in collection route.

All are **node pages** (docs/UX_AND_NAVIGATION.md): footer kept, left back arrow,
horizontal slide.

### `/decks` is now three bands

1. **Review / Study Mix / Challenge** — *whole-library* study entry points. To study
   one collection, open it and use its launch button.

   > **Renamed (was Easy / Mix / Hard).** The rename went all the way down — the
   > `StudyMode` values are `'review'` and `'challenge'` in both
   > `server/services/OnDeckVocabService.ts` (`MODE_CONFIGS`) and
   > `useWorkingLoop.ts`, and the flp launches at `?mode=review` / `?mode=challenge`.
   > Nothing persists a mode, so there was no stored value to migrate. A stale
   > `?mode=easy` bookmark fails the validity check and opens a **Study Mix**
   > session rather than dead-ending; Match Speed's `modeConfigFor` does the same
   > with an old nav-state value.
2. **Cards** — *All*, *Unfamiliar*, *Target*, *Comfortable*, as **deck tiles** in one
   row. Four rather than the page's usual three, deliberately: the utcm bands read as
   a single scale and wrapping *Comfortable* onto its own line would break that
   reading. `DeckTile` flex-shrinks, so four fit a phone width.
3. **Mastered** — one tile per **active** mastery bar: *Mastered Cards* (core,
   always), *Reading Mastered* and *Writing Mastered* (each gated on that account
   goal). `FlashcardsDecksPage` maps over `activeBars({reading, writing})` and asks
   `collectionPath` / `collectionTitle` for each, so adding a bar is a change in one
   contract rather than in the page. All three tiles share the **Mastered blue**, so
   the row reads as one achievement in three skills.
4. **Decks** — the user's sets, wrapping at **three per row**, plus a `+` to create
   one.

### Every set on the page is the same object

Bands 2–4 all render **`DeckTile`** (`src/components/DeckTile.tsx`) — the stacked-card
icon — and all navigate to that set's CollectionViewPage. They differ only in what
fills them, which is the point: a utcm band, a mastery bar and a user-authored deck
are all just "a set of your cards", and the page should not argue otherwise.

`DeckTile` was extracted from `DeckBuckets` (the Account page's display-only count
block), which now consumes it. The stacked-card look existed once, privately, inside
that component; the fdp needed it eight more times, and a second copy would have
drifted on the stack offsets the moment either page was touched. The tile is purely
presentational — a label, an optional count, two colors, an optional `onClick` — and
knows nothing about bands, bars or routes.

Colors come from `BAND_COLORS` (`src/utils/categoryColors.ts`) for the built-ins and
from `deckTileColors(id)` for a user deck — the same id-derived palette as
`deckAccentColor`, paired with a saturated body tone so a deck tile has the same
two-tone structure as a band tile. **All** is the one grey tile: every other color on
the page names a set (a band, a bar, a deck), and All is their union rather than
another member, so it takes a neutral pair instead of a fifth hue.

The three **Mastered** tiles come from `MASTERY_BAR_COLORS` (same file), one hue per bar
rather than three blues. `reading` and `writing` are single-mark-type bars, so each tile
takes ITS MARK's color out of `MARK_TYPE_COLORS` — red and orange, the same colors those
marks paint on the cdp track and the mini-card strip — and reads them rather than
restating the hex, so a mark and its Mastered tile cannot drift. `core` blends
recognition and production, has no single mark color to borrow, and keeps Mastered blue.
⚠️ Those two hues are also the Unfamiliar and Target band hues one section above; the
sections are captioned and separated, but interleaving them would need the colors to
diverge.

The tile's natural size is **72 × 105** (`SIZING` in `DeckTile.tsx`). That is the width
the Account row has always rendered at — four tiles inside a 350px-capped section
shrink to ≈71.5px — while the fdp's roomier grid used to let the same component sit at
its old 92px natural size. Pinning the natural size to the Account width makes every
deck on both pages identical; the tile still flex-shrinks below it when a container is
narrower than its row.

**Learn Now has no tile here.** The band row covers it exactly (Unfamiliar + Target +
Comfortable), so a fifth tile would have been a second name for the same set. Its
route, its endpoint and the `learn-now` collection id all remain — the flp and every
game still draw on that set.

### Counts

| Row | Source |
|---|---|
| All / the three bands | `useCategoryCounts` — `All` is the sum of the four core bands |
| The Mastered tiles | `GET /api/onDeck/masteredCounts` (`useMasteredCounts`) |
| A deck | `DeckSummary.cardCount` |

`masteredCounts` is deliberately separate from `categoryCounts`: that endpoint answers
"how many cards in each of the four **bands** of one bar", this one answers "how many
Mastered in each **bar**". Same word, orthogonal keys — one response could not carry
both without being disambiguated by key name. All three counts are fetched regardless
of goals, so toggling one on reveals a tile that already has its number.

The Learn Now card grid and its search bar moved to
`/flashcards/collection/learn-now`.

### Add to deck (cdp + eip)

`AddToDeckMenu` is an icon button opening a checkbox menu of the user's decks, with
"New deck…" at the bottom. Mounted in:

* `VocabCardDetailPage.tsx` — the cdp header actions, beside Edit and Delete
* `InfoCardPanelBody.tsx` — the eip header action grid (which grows a third row)

Two behaviours worth knowing:

* **Saves once, on close**, as a whole set. Ticking three boxes is one request, not
  three, and a half-completed sequence can't leave membership in a state the user
  never chose. The response is adopted over the optimistic state, so a deck deleted
  while the menu was open drops out rather than appearing ticked forever.
* **Self-hides without a vet row.** The eip can be opened on a dictionary entry the
  user hasn't saved; there is nothing to file, so the button is simply absent.

Deck **rename** and **delete** live inside the deck's own collection page (an
overflow menu in the header), not on the `/decks` list — so the list stays a plain
set of tappable rows.

### Sort by (every collection)

`CollectionViewPage` carries a **Sort by** button under the search field, opening a
menu of orderings. The comparators live in `src/utils/vocabSort.ts`, next to the
`filterVocabEntries` search they share a toolbar with.

**The menu is a list of BUNDLES, not of orderings.** Every dimension is genuinely
bidirectional, so each menu row names the dimension and carries both directions as
toggles on its right (`SortBundle` / `sortBundles`, rendered as a `Box` row with a
MUI `ToggleButtonGroup` — deliberately *not* a `MenuItem`, since the row itself is not
selectable and a nested button inside one would swallow the toggles' taps). That is
what let the orderings double without the menu doubling.

| Row label | Directions → keys | Orders on |
|---|---|---|
| Date added | Newest → `recent` · Oldest → `oldest` | `vet.createdAt`. `recent` is **the default** for Learn Now / Mastered |
| Added to this deck | Newest → `deckAdded` · Oldest → `deckAddedOldest` | `deck_cards.addedAt` — **deck-only**, and `deckAdded` is the **default inside a deck** |
| Pinyin / Word | A–Z → `alphaPronunciation` · Z–A → `alphaPronunciationDesc` | tone-insensitive display pinyin; `entryKey` when there is none |
| Definition | A–Z → `alphaDefinition` · Z–A → `alphaDefinitionDesc` | the **dd** — the definition the card face actually shows |
| Mastery *(one row per active bar)* | Highest → `mastery*Desc` · Lowest → `mastery*Asc` | that bar's pbh (`barProgressBarHeight`) |
| Date mastered *(one row per active bar)* | Newest → `masteredRecent*` · Oldest → `masteredOldest*` | that bar's own `vet.masteredAt` stamp; missing dates last **in both directions** |

**The mastery and date-mastered rows are per bar, and goal-gated.** `sortBundles`
emits one of each per `activeBars(goals)` entry; `MASTERY_KEY_BAR` and
`MASTERED_AT_KEY_BAR` map each key back to the bar its comparator reads. A bar is
named in the row label (`Mastery (Read)`) **only when more than one bar is active** —
a learner with no goals reads plain "Mastery", i.e. the menu they had before migration
143. Date mastered reads `masteredAtForBar(entry.masteredAt, bar)`, that bar's **own**
stamp rather than the newest across bars, so a reading crossing cannot reorder the
core list. See [MASTERY_REWORK.md § Three bars](./MASTERY_REWORK.md).

**`sortVocabEntries` takes no goal flags.** Every key names its own bar, so an applied
ordering cannot change under a settings toggle; goals affect only which rows the menu
offers. The toolbar button reads `"<dimension> · <direction>"` (`sortLabel`), falling
back to "Sort" for a key the current goals no longer offer.

Four things about it are deliberate:

* **Client-side, not an `orderBy` parameter.** All three collection reads return the
  whole collection in one response — there is no pagination to respect — and every
  key is computable from fields already on the rows. A server-side sort would cost a
  round trip per menu tap and would have to reimplement the sense resolvers in SQL,
  where they do not exist.
* **The alphabetical keys are sense-aware.** Both go through
  `resolveDisplayDefinition` / `resolveDisplayPronunciation`, so a card files under
  what its face actually shows. A card whose learner picked 会 = "to reckon accounts"
  sorts under `kuàijì` / "to reckon accounts", not under the det column's first sense.
* **Pinyin is tone-insensitive.** 冰/兵/病 cluster under `bing` rather than being split
  three ways by their diacritics' code points. For Spanish, where cards carry no
  `pronunciation`, the same option is a plain A–Z on the word and is labelled
  "Word (A–Z)" for that reason.
* **The choice is per-visit, not persisted.** It is a way of looking at the set, not
  a property of it, so every collection opens in its natural order. Navigating
  between two collections resets the key (both routes render this same component, so
  React can reuse the instance).

**Missing timestamps sink to the BOTTOM in BOTH directions** (`DATE_KEYS` +
the `isDate` branch in `sortVocabEntries`). A date key's 0 means "no date", not "the
epoch" — so "Oldest" must not open with every card that has never been mastered. This
matters most for `masteredAt`, absent on every card mastered before migration 142 (see
[MASTERY_REWORK.md](./MASTERY_REWORK.md) § `masteredAt`), and it became load-bearing
only when bundling made every date readable both ways. A mastery **height** of 0 gets
no such treatment: that is a real value, and "Lowest" legitimately starts there.

---

## 5. Code ↔ doc dependencies

| This doc's section | Depends on |
|---|---|
| §1 Data model | `database/migrations/141-create-decks.sql`; `VocabEntryDAL.delete` (the FK stand-in) |
| §2 Server layers | `server/types/decks.ts`, `IDeckDAL.ts`, `DeckDAL.ts`, `DeckService.ts`, `DecksController.ts`, `deckRoutes.ts`, `dal/setup.ts` |
| §2 Deck card read | `OnDeckVocabService.getDeckCards` |
| §3 Launch filter | `vetTable.ts` (`vetDeckClause`, `vetDeckOrProvisionalClause`); `OnDeckVocabService.deckPlayFilter` + its three fetchers; `OnDeckVocabController.resolveCollection`; `routes/flashcardRoutes.ts` (mark body) |
| §4 Client | `src/api/decks.ts`, `collectionRef.ts`, `useLaunchCollection.ts`, `CollectionViewPage.tsx`, `FlashcardsDecksPage.tsx`, `AddToDeckMenu.tsx`, `routes/routeMeta.ts`, `routes/registry.ts` |
| §4 Tiles & built-in collections | `src/components/DeckTile.tsx` (+ `DeckBuckets.tsx`, its other host); `src/utils/categoryColors.ts` (`BAND_COLORS`); `collectionRef.ts` (`deckTileColors`, `MASTERED_TITLES`, `builtinCollectionRef`, `builtinCollectionId`); `server/dal/shared/vetTable.ts` (`BUILTIN_COLLECTION_IDS`, `parseBuiltinCollectionId`, `builtinCollectionClause`); `server/contracts/wire.ts` (`ALL_COLLECTION_ID`, `BAND_COLLECTION_IDS`, `bandCollectionCategory`, `MASTERED_COLLECTION_IDS`, `masteredCollectionBar`); `OnDeckVocabService.getBuiltinCollectionCards` + `getMasteredCountsByBar`; `OnDeckVocabController.getCollectionCards` + `getMasteredCounts`; `routes/onDeckRoutes.ts`; `src/hooks/useMasteredCounts.ts` |
| §4 Sort by | `src/utils/vocabSort.ts` + `src/__tests__/vocabSort.test.ts`; `CollectionViewPage.tsx` (the sort row + `visibleEntries` memo); `src/utils/definitionUtils.ts` (`resolveDisplayDefinition`, `resolveDisplayPronunciation`); `server/contracts/mastery.ts` (`barProgressBarHeight`, `activeBars`, `masteredAtForBar`); `database/migrations/142-add-mastered-at-to-vocabentries.sql`, `143-three-mastery-bars.sql`; `OnDeckVocabService.getDeckCards` (`deckAddedAt`) |

Related docs: [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (small-deck top-up),
[GAMES_FEATURE.md](./GAMES_FEATURE.md) (launch params),
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (node pages),
[MASTERY_REWORK.md](./MASTERY_REWORK.md) (the three mastery bars the Mastered
collections filter on),
`database/migrations/143-three-mastery-bars.sql` (on prod since 2026-08-11).

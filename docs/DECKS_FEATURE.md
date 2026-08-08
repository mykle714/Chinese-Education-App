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
| Types | `server/types/decks.ts` | `DeckSummary`, request bodies, `CollectionRef` |
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
exists on `OnDeckVocabService` beside the other two collection reads (mastered /
non-mastered library), and a deck is simply a third collection. So `DeckService`
owns the **policy** (is it yours, which language) and delegates the **read** to
`OnDeckVocabService.getDeckCards`.

That read is **SORTED**, not playable, and orders by `deck_cards."addedAt" DESC` —
a deck is something the user assembled, so "what I most recently put in here" is
the meaningful recency.

---

## 3. Launching a game or the flp with one collection

The collection view page's top button launches any surface restricted to that set.

### Wire format

| Collection | Launch params | Server filter |
|---|---|---|
| Learn Now | *(none)* | none — Learn Now **is** the default pool |
| Mastered | `?collection=mastered` | `AND compute_utcm_category(...) = 'Mastered'` |
| A deck | `?deck=<id>` | `AND (EXISTS deck_cards row OR bucket = 'provisional')` |

There is deliberately **no** `collection=learn-now`: every game and the flp already
draw from the sorted library, so a clause for it would restate `vetPlayableClause()`.

### Where the filter is applied

One helper, `OnDeckVocabService.deckPlayFilter`, returns a WHERE fragment + bind
params and is spliced into **every** candidate query — including the fallback and
last-resort ones, so a restricted round can never quietly top itself up from
outside the set:

* `fetchGameCandidates` — all four games' pools, and the Word Search grid
* `fetchEligibleCategoryCards` — the flp initial loop's quotas and top-up
* `fetchLibraryCandidatesByCategory` — the flp refill and the cooled fallback

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
/flashcards/collection/learn-now   ─┐
/flashcards/collection/mastered    ─┼─ CollectionViewPage
/flashcards/deck/:id               ─┘
/flashcards/mastered               ─── MasteredRedirect (legacy)
```

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
2. **Learn Now** and **Mastered Cards** — two identically-styled link rows, side by
   side. That identical styling is the point: Learn Now stopped being "the page you
   are on" and became a collection like any other.
3. **Decks** — the user's sets as rounded pastel cards with card counts, plus a `+`
   to create one.

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

---

## 5. Code ↔ doc dependencies

| This doc's section | Depends on |
|---|---|
| §1 Data model | `database/migrations/141-create-decks.sql`; `VocabEntryDAL.delete` (the FK stand-in) |
| §2 Server layers | `server/types/decks.ts`, `IDeckDAL.ts`, `DeckDAL.ts`, `DeckService.ts`, `DecksController.ts`, `deckRoutes.ts`, `dal/setup.ts` |
| §2 Deck card read | `OnDeckVocabService.getDeckCards` |
| §3 Launch filter | `vetTable.ts` (`vetDeckClause`, `vetDeckOrProvisionalClause`); `OnDeckVocabService.deckPlayFilter` + its three fetchers; `OnDeckVocabController.resolveCollection`; `routes/flashcardRoutes.ts` (mark body) |
| §4 Client | `src/api/decks.ts`, `collectionRef.ts`, `useLaunchCollection.ts`, `CollectionViewPage.tsx`, `FlashcardsDecksPage.tsx`, `AddToDeckMenu.tsx`, `routes/routeMeta.ts`, `routes/registry.ts` |

Related docs: [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (small-deck top-up),
[GAMES_FEATURE.md](./GAMES_FEATURE.md) (launch params),
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (node pages),
[MASTERY_REWORK.md](./MASTERY_REWORK.md) (the utcm category the Mastered collection filters on).

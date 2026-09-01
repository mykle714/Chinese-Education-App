# Decks & Collection Views

User-authored card sets, and the one page that renders every set of cards in the app.

Two things landed together here, because one made the other possible:

1. **Collection view page** — the `/flashcards/mastered` page was generalized into a
   page that renders *any* set of the learner's cards, with a search bar and a
   button that drops straight into the **flp** with just those cards. (It used to
   offer every game too; games are now launched from the Games hub, which carries its
   own collection selector — see § 3.)
2. **Decks** — a deck is a named set of a user's cards (`decks` / `deck_cards`,
   migration 141). Selecting one opens its collection view. The `/decks` page,
   whose space used to be the inline Learn Now card grid, is now the deck list.

---

## 1. Data model (migration 141)

`database/migrations/141-create-decks.sql`

| Table | Columns | Notes |
|---|---|---|
| `decks` | `id` serial PK · `userId` uuid → `users(id)` CASCADE · `language` varchar(8) · `name` varchar(64) · `createdAt` · `updatedAt` · **`editMode`** (migration 148) | Unique on (`userId`, `language`, `lower(btrim(name))`) — **becomes partial**, see below; CHECK `btrim(name) <> ''`; index on (`userId`, `language`) |
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

### `editMode` — user-authored vs. generated decks (migration 148, on dev)

⚠️ **Not built.** Specified by [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 4 and
signed off 2026-08-16; it ships with that feature's migration.

Study Challenge generates a deck per player per challenge (`vs Bob`) holding the ten
contested words. Those decks are real `decks` rows — they render in the deck list, open a
normal collection view, and launch games — but the user may not edit them, and they are
deleted when the challenge's window closes.

One new column expresses all of that:

```
decks."editMode"  'custom' | 'preset'   NOT NULL DEFAULT 'custom'
```

* **`'custom'`** — every deck that exists today. Fully mutable.
* **`'preset'`** — generated. Rename, delete, and membership changes are **rejected by
  `DeckService`**, and it does not count against `MAX_DECKS_PER_LANGUAGE`.

**There is deliberately no `challengeId` on `decks`.** The owning challenge holds the
pointer (`study_challenges.presetDeckIds`, a jsonb map of player → deck id), not the other
way round. A deck is a named set of cards; *why* it exists is the challenge's business.
That keeps this table free of a column that would be NULL for every row a user made.

⚠️ **This requires relaxing `decks_user_language_name_uniq` to a partial index:**

```sql
CREATE UNIQUE INDEX decks_user_language_name_uniq
  ON decks ("userId", language, lower(btrim(name)))
  WHERE "editMode" = 'custom';
```

The index exists because two decks called "Food" are indistinguishable in the
add-to-deck checkbox menu. **Generated decks never appear in that menu**, so exempting
them costs nothing — and they need the exemption, because two challenges against the same
friend would both want to be called `vs Bob`. The rows are told apart in the deck list by
the friend's glyph in the spine's foot slot.

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
* **A `'preset'` deck rejects every mutation** (planned, above): rename, delete, and
  membership writes all fail on it, and it is excluded from the 100-deck count. The guard
  belongs in `DeckService` beside the ownership check — one place, not one per endpoint,
  and *not* in the controller, where a future endpoint would forget it.
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

**Two surfaces choose a collection, one each:**

| Surface | Chooses | How |
|---|---|---|
| Collection view page's top button | the **flp**, with the collection the page is showing | `withCollectionParams("/flashcards/learn", collection)` |
| **Games hub header selector** | the collection **every game** on the hub is launched with | `GamesCollectionSelector` writes a session-only store; `GamesPage` wraps each link in `withCollectionParams` |

The collection-page button used to open a sheet listing the flp *and every game*.
Choosing the cards and then the activity was backwards, so the game half moved to the
Games hub (`src/games/GamesCollectionSelector.tsx` + `src/features/flashcards/selectedCollection.ts`,
detailed in [GAMES_FEATURE.md](./GAMES_FEATURE.md) § "Collection selector"). **The wire
format below did not change** — the hub sends exactly the params a collection-page
launch always sent, and every game still reads them back with `useLaunchCollection()`.

### Wire format

| Collection | Launch params | Server filter (`builtinCollectionClause`) |
|---|---|---|
| All Cards | *(none)* | none — **All is the default pool** |
| Learn Now | `?collection=learn-now` | `compute_core_category(...) <> 'Mastered'` |
| Mastered (core) | `?collection=mastered` | `masteredBarClause('core')` |
| Mastered Reading | `?collection=mastered-reading` | `masteredBarClause('reading')` |
| Mastered Writing | `?collection=mastered-writing` | `masteredBarClause('writing')` |
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
clause defines it). Adding or removing a built-in collection therefore changes no
variant, only the id list.

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
  `vetDeckOrProvisionalClause` is for, together with the `lentIds` the baseline top-up
  threads into the round (selection is otherwise sorted-only —
  docs/PROVISIONAL_CARDS.md § 4b). The game is full rather than degraded.
* Lent cards are **not** written into the deck. Playing an under-sized deck never
  silently grows it, and the existing provisional notice still tells the learner
  which words were borrowed.

**But a deck-restricted round is never topped up mid-loop.** The two lending triggers
are scoped differently on purpose (docs/PROVISIONAL_CARDS.md § 4b):

| Trigger | Deck round? |
|---|---|
| `ensureBaseline('flp')` — the learner has SORTED fewer than 20 cards at all | **lends**, as above |
| the fill ladder's last tier — the round could not be filled from the deck | **does not lend**; `canLendProvisional` (flp) and the `!opts.collection` guard (games) both refuse any `collection` |

The distinction is between *bootstrapping a learner who has almost nothing* and
*papering over a deck that is simply resting*. Do not unify these two by making
`canLendProvisional` accept decks.

**What a resting deck does now (2026-08-20).** It replays itself. The fill ladder gained
a COOLED tier above lending, and that tier is **not** restricted — a deck round whose
cards are all cooling re-serves them rather than coming back empty. The marks do not
count (`POST /api/flashcards/mark` drops a mark on a cooling track), so the learner is
reviewing, not progressing; nothing in the UI says so yet
([DEFERRED_WORK.md](./DEFERRED_WORK.md) § 2). This replaces the old "Every card in this
deck is resting" empty state as the common case — that state is now reached only by a
deck whose cards are all excluded for some other reason.

Distractors are *not* restricted: Speed Reading's foils
(`/api/games/speedReading/distractors`) stay global, because drawing them from the
deck would make the deck itself the answer key.

---

## 4. Client layers

| File | Role |
|---|---|
| `src/api/decks.ts` | Typed calls against `/api/decks/*`. No `token` param (FRONTEND_LAYERING §3.2). |
| `src/features/flashcards/collectionRef.ts` | **The one definition of "a collection"** — kinds, titles, routes, launch params, mark-body fields, deck accent color |
| `src/features/flashcards/builtinCollections.ts` | **The one list of built-in collections a surface offers** — two lists: `lensCollectionEntries(lens)` for the decks panel and `builtinCollectionEntries(goals)` for the Games hub selector, plus their order, colors, grouping and `builtinCollectionCount` |
| `src/features/flashcards/masteryCenters.ts` | What a Mastery Center **is**: the two skill bars that have one, their routes, titles, button labels and the goal gate (`activeMasteryCenters`) |
| `src/features/flashcards/useLaunchCollection.ts` | Reads the collection back off a surface's own URL |
| `src/features/flashcards/selectedCollection.ts` | **Session-only store** for the collection the Games hub plays with (never persisted); read by `GamesPage` / `WordSearchHubItem`, written by `GamesCollectionSelector` |
| `src/games/GamesCollectionSelector.tsx` | The hub-header "Playing with …" pill + menu (see [GAMES_FEATURE.md](./GAMES_FEATURE.md)) |
| `src/features/flashcards/CollectionViewPage.tsx` | The generalized page (all three collection kinds) |
| `src/features/flashcards/MasteredRedirect.tsx` | `/flashcards/mastered` → `/flashcards/collection/mastered` |
| `src/features/flashcards/FlashcardsDecksPage.tsx` | `/decks` — the study buttons (Review / Challenge / Study Mix / the two Center buttons), the **two** sheet pills (Cards / Decks) and the modal sheet's mounting. **Lens `core`.** |
| `src/features/flashcards/MasteryCenterPage.tsx` | `/flashcards/reading` + `/flashcards/writing` — the same panel as a **page**, lens `reading` / `writing` |
| `src/features/flashcards/useDecksPanel.ts` | **All of the panel's data, for one lens** — the count hooks, the deck fetch, the card-library fetch, the search/sort state and the tile figures. Shared verbatim by the fdp and both Centers. |
| `src/features/flashcards/DecksPanelBody.tsx` | Body of the panel (`variant: "sheet" \| "page"`, `section: "all" \| "cards" \| "decks"`): the library duo, the Challenges / Decks shelf rows and the inline Cards grid (`LibraryDuo`, `ShelfRow`, `SectionLabel`) |
| `src/features/flashcards/LibraryDuo.tsx` | The panel's two library constants (`.duo`) — Learn Now + Mastered, with their figures. The one place the sheet is not spines; see § "Your library" |
| `src/features/flashcards/StudyHand.tsx` | The three study modes as a fanned hand of cards, on the page behind the sheet (`.fanw`) |
| `src/features/flashcards/useHandSwipe.ts` | The omnidirectional throw gesture on the hand's front card — slop classifier, radial commit threshold, the flp's drag constants, click suppression |
| `src/features/flashcards/SlotNumber.tsx` | The slot-machine reel a figure spins as while its count is in flight, and the landing that settles it |
| `src/utils/flpReadiness.ts` | The hand's ready counts — `rankFlpEligible`'s cooldown rule restated on the client, per band |
| `src/features/flashcards/NewDeckDialog.tsx` | The "name your deck" prompt behind every panel's `+`; shows the **server's** message verbatim on failure |
| `src/features/flashcards/AddToDeckMenu.tsx` | The checkbox menu, mounted on the cdp and the eip |

### Routes

```
/flashcards/collection/all               ─┐
/flashcards/collection/learn-now         ─┤
/flashcards/collection/learn-now-reading ─┼─ CollectionViewPage
/flashcards/collection/learn-now-writing ─┤
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
(`mastered-reading`, `all`) come from `wire.ts`.

One route serves all of them because the segment is `:builtin` — adding another
collection is a case in `builtinCollectionClause` and an entry in one client list,
nothing else.

Two more routes carry the **Mastery Centers** (§ "Mastery Centers" below):

```
/flashcards/reading  ─┬─ MasteryCenterPage
/flashcards/writing  ─┘
```

They are two literal paths rather than `/flashcards/center/:bar`, so a typo cannot
produce a third, meaningless Center; the page reads its own `pathname` against
`MASTERY_CENTER_PATHS`.

**Two routes, not one `:collectionId`.** A deck is addressed by its numeric id under
its own path segment, so a user who names a deck "mastered" gets
`/flashcards/deck/42` — a deck name can never shadow a built-in collection route.

All are **node pages** (docs/UX_AND_NAVIGATION.md): footer kept, left back arrow,
horizontal slide.

### Which collections exist

The built-in list is deliberately **three ideas wide**:

| Collection | What it holds |
|---|---|
| **All Cards** | every sorted card, mastered or not — the one **bar-independent** set |
| **Learn Now** | every sorted card whose **named bar** is unfinished — one per bar |
| **Mastered** | the cards finished in one bar — one per bar |

**Learn Now is per-bar, exactly as Mastered is.** `learn-now` (unqualified) is the
core set and keeps its original id; `learn-now-reading` / `learn-now-writing` are the
same idea about one skill. Each is the exact **complement** of that bar's Mastered
collection (`unmasteredBarClause` vs `masteredBarClause`, `vetTable.ts`), so the two
sets a surface shows always partition that bar's library. This is what lets a Mastery
Center answer "what have I still not learned to read" — a question the single
core-banded Learn Now could not express, because a card can be finished for
recognition and untouched for reading.

The per-band collections (`unfamiliar` / `target` / `comfortable`) **were removed**.
A utcm band is a property of one card's progress, not a set a learner studies: nobody
opens "my Target cards" to drill them, and a set whose membership changes on every
mark is a poor thing to launch a round against. The bands still exist everywhere they
mean something — the category on a card, the Account page's bucket row, the mini-card
chip — just not as collections. Consequence: `?collection=target` no longer resolves
(it falls back to `learn-now`) and `/flashcards/collection/target` renders nothing.

**Two lists, because there are two kinds of surface.** `builtinCollections.ts` owns
both, so they cannot disagree about what a collection *is*:

| List | Rendered by | Contents |
|---|---|---|
| `lensCollectionEntries(lens)` | the decks **panel** — fdp (`core`) and both Centers | that ONE bar's Learn Now + Mastered. Two entries, one group, always — rendered by `LibraryDuo` rather than as spines. |
| `builtinCollectionEntries(goals)` | `GamesCollectionSelector` | All Cards, core Learn Now, and one Mastered per **active** bar — the reading/writing ones under a separate `Mastered` caption. |

The Games hub keeps the goal-driven list because there the learner is choosing a set
to **play with**, not looking at one skill; three menu rows all called "Learn Now"
would be unreadable, and a reading game launched from core Learn Now is a perfectly
sensible round.

**⚠️ `All Cards` has no TILE on any panel.** The collection is unchanged — its route
(`/flashcards/collection/all`), its count and its `CollectionRef` all still exist, and
`GamesCollectionSelector` still offers it as a playable set. It is simply absent from
`lensCollectionEntries`, because every panel renders those same cards **inline** at the
bottom of its own scroller (the **Cards** section, § 4). A tile whose only job is to
open a page showing the grid already on screen is a navigation for nothing. (This used
to be a filter inside `FlashcardsDecksPage`; it is now stated in the list, where the
two Centers inherit it.)

Counts come from the same module (`builtinCollectionCount`) fed by the **lens's** band
counts, so a collection's definition and its number cannot drift.

### Mastery Centers — the same panel, read through one skill

`/decks` answers exactly one question: **how well do you KNOW these words**
(recognition + production — the `core` bar). Reading and writing each get their own
page, the **Reading Center** and the **Writing Center**, which render *the same panel*
through their own bar.

| | fdp | Reading Center | Writing Center |
|---|---|---|---|
| Route | `/flashcards/decks` | `/flashcards/reading` | `/flashcards/writing` |
| Lens | `core` | `reading` | `writing` |
| Frame | modal pull-up sheet (pill-raised) | node page | node page |
| Study buttons | Review / Challenge / Study Mix | — | — |

**Why.** One page was answering two questions at once: a learner pursuing reading had
a *Mastered Reading* tile wedged among figures that were all core, and **no surface
anywhere** ordered their library by what they still cannot read. Splitting the skills
out leaves the fdp doing one thing and gives each skill a page that does the same for
it. Nothing per-skill belongs on `/decks` any more — no tile, no count, no sort row.

**What a lens changes** (one `MasteryBarId`, threaded into four places — everything
else follows):

| | Core (fdp) | Skill lens (a Center) |
|---|---|---|
| Collections | Learn Now + Mastered Cards | that bar's Learn Now + Mastered |
| Tile figures | `?bar=core` band counts | `?bar=<skill>` band counts |
| Card grid order | "Recently added" (a deck: "Date added") | that bar's **Mastery · Lowest** |
| Sort menu | one row set per **active** bar | that ONE bar's rows |
| Cooldown row | longest-resting of recognition/production | longest-resting of that bar's track |
| Each card | ONE strip + badge, **core** band | ONE strip + badge, **that bar's** band |
| cdp Mastery section | the **core** bar + its two cooldown rows | that bar + its cooldown row |

**Gating.** A Center's fdp **button** appears only when its goal is set
(`users.readingGoal` / `writingGoal`) — the same gate the bars, the Mastered
collections and the sort rows already use, and the reason Spanish accounts never see
one (no `es` card can accrue those marks). ⚠️ **The ROUTE is not gated.** Reading and
writing marks accrue for every account whatever their goals say (migration 143), so a
hand-typed `/flashcards/reading` shows a truthful, possibly non-empty page rather than
a wall — the same rule `?collection=mastered-reading` follows on the server.

**Exactly one bar is ever drawn.** `core` is a lens like any other, not the absence of
one: a mini card shows a single hairline track and the cdp's Mastery section a single
column, both for the surface's own bar. Until 2026-08-19 both drew one track per GOAL
the account had set, which is how reading and writing progress ended up on `/decks`
and on cards opened from it — the exact thing the Centers were built to move. The goal
flags still decide which Center BUTTONS exist and which rows the core sort menu offers;
they no longer decide how many bars get painted. See
[MASTERY_REWORK.md](./MASTERY_REWORK.md) § 5.

**The lens travels with the navigation.** A per-bar collection carries its lens in its
own id, so those tiles need nothing added. A **deck** and a **card** are bar-agnostic
sets, so they carry `?bar=` (`withLens` / `lensFromSearch`, `collectionRef.ts`) — the
collection page prefers the collection's own lens and falls back to the param
(`lensFromCollection(ref) ?? lensFromSearch(search)`), and the cdp's Mastery section
shows that one bar and its cooldown when the param is present. Without this, tapping a
deck inside the Reading Center would silently drop the learner into a core view of it.

**Sharing, not copying.** `useDecksPanel(lens)` owns every fetch and derivation and
`DecksPanelBody` owns every pixel; the three pages differ only in the lens they pass
and the frame they mount. The Center page is ~110 lines, almost all of it comment.

### `/decks` = a study area + two button-raised pull-up sheets

The page is split across **three surfaces**:

* **Page (behind)** — section 1 only, the library line, the Center rail and the card hand.
  `MobileTabScreen` is mounted with **`scrollable={false}`**: nothing behind the sheets
  scrolls any more.
* **Cards sheet** — **Your library** (the `LibraryDuo`) over the inline **Cards** grid,
  in `DecksPanelBody` (`variant="sheet"`, `section="cards"`).
* **Decks sheet** — **Challenges** then **Decks**, same component (`section="decks"`).

Only the fdp splits them. A Mastery Center is a whole page with room for the lot, so it
passes `section="all"` and renders every section in its original order (Your library →
Challenges → Decks → Cards).

The sheet is the **same component as the eip bottom sheet**, `SheetPanel`, used the
**same way** since 2026-08-24: a **modal** sheet (`minHeight` unset, scrim on, `onClose`
wired), so it has the eip's three stops and the eip's default 0.5 collapse rule.

| Stop | Value | What shows |
|---|---|---|
| **0** | — | dismissed; the page unmounts the panel |
| **default** | `parentHeight × 0.6` | the open height, and the dismiss floor |
| **max** | `parentHeight × 1` | the full list — the sheet merges into the page header (docs/EIP_SHEET_GESTURES.md) |

It **used to be persistent** (`minHeight = FOOTER_HEIGHT + FOOTER_EXTRA_GAP + SHEET_LIP`,
`showScrim={false}`, `collapseThresholdRatio` 0.3): a 44px lip above the footer that had
to be dragged up, with stops `{resting, max}` and no way to dismiss it. Both the lip and
that stop set are gone.

**How it opens — two pills, two sheets.** The fdp raises **two** sheets, from
`.flashcards-decks__cards-pill` ("↑ Cards", left) and `.flashcards-decks__decks-pill`
("↑ Decks", right), both anchored `FOOTER_CLEARANCE` above the bottom of the frame at
`zIndex: 2`. They are placed by `SheetPill`'s `align` prop (`"left"` / `"right"`), which
offsets each one half of `PILL_PAIR_GAP` off the frame's midline — the **pair** is
centred whatever the labels measure, and neither pill needs the other's width.

Each pill names the section its sheet renders (`DecksPanelBody`'s `section` prop, below):

| Pill | `section` | What the sheet holds |
|---|---|---|
| **Cards** | `"cards"` | the library duo (Learn Now / Mastered) + the Cards section: search, sort, grid |
| **Decks** | `"decks"` | Challenges, then the user's own Decks (with the `AddSpine`) |

> **Was one pill, "Sets & Cards".** A single panel stacked all four captioned sections
> into one scroller, so the two errands it serves — *where is that word?* and *which set
> do I open?* — were separated by a scroll rather than by a name, and no one caption
> could name the sheet. The split is a **host** choice only: the Mastery Center pages
> still pass `section="all"` and render the whole stack in its original order, and both
> fdp sheets read the **same** `useDecksPanel` instance on the page, so opening one does
> not refetch the other.

The pills are the exact counterpart of the flp's More Info pill (`MoreInfoPill` →
`openEicSheet`) and the cdp's, all built from the shared `SheetPill` body
(`src/components/SheetPill.tsx`; the flp keeps its own copy because it MEASURES the pill
to size the card slot), including the part that matters: the panel is **mounted only
while open** (`openSheet`, a `"cards" | "decks" | null` — one state, because the sheets
are modal and mutually exclusive), so every open replays the `0 → default` animation, and
the pills sit *under* the sheet's scrim (`zIndex: 10`), so they dim and stop taking taps
while a sheet is up. The single `SheetPanel` is **keyed on the section**, so switching
sheets remounts rather than swapping content under a held height. Dismiss is the eip's:
drag below the default height, or tap the scrim.

**Bottom edge — the sheet owes the footer nothing.** A *modal* sheet holds
`useHideFooter` for its whole lifetime (`SheetPanel`), so the floating footer is off
screen while either fdp sheet is up. `DecksPanelBody`'s scroller therefore reserves
only its own breathing room in the `"sheet"` variant (`SHEET_BOTTOM_PAD`, 12px) and
fades out over a 24px band ending **at** the sheet's bottom edge
(`SHEET_EDGE_FADE_MASK`). It used to reserve `FOOTER_CLEARANCE` and wear
`EDGE_FADE_MASK_NO_TOP` — written when the sheet was persistent and the pill really
did hover over it — which after the modal conversion left ~90px of blank paper under
the last row plus a further `FOOTER_HEIGHT` of fully-masked-out box: ~164px of the one
surface whose whole job is showing cards (fixed 2026-08-31).

The `"page"` variant (the Mastery Centers) keeps both: there the footer *is* over the
scroll area, so it still reserves `FOOTER_CLEARANCE` and wears
`EDGE_FADE_MASK_NO_TOP` (exported from `MobileTabScreen` rather than re-derived), whose
top band is dropped because the sheet's top edge is its own grabber and stays solid.
`FlashcardsDecksPage` wraps both surfaces in one `position: relative` box, because
that box — not the viewport — is what caps the sheet's height.

⚠️ **The panel's scroller pins every direct child to `flex-shrink: 0`**
(`"& > *"` in `DecksPanelBody`). It is a scrolling flex column, so its content is
*supposed* to overflow — but a flex item's default `flex-shrink: 1` makes each section
compress to fit the box instead, and the column's height stops being the sum of its
sections. The symptom that exposed it: expanding the collapsible **Decks** section did
not push the **Cards** grid down, because the `Collapse` (which carries
`min-height: 0`, so nothing floored it) absorbed its own growth by being squeezed. Any
new section added to this scroller inherits the rule; do not remove it.

**Data lives in the hook, presentation in the body.** The count hooks, the deck fetch,
the card-library fetch and the search/sort state are all in `useDecksPanel(lens)`, and
`DecksPanelBody` receives that whole state object as ONE `panel` prop — the fields are
not independent (collections, counts, card list and default ordering all derive from
the same lens), and splitting them into twenty props let a host pass a lens-scoped card
list beside core-scoped counts without the type system noticing. The page keeps only
what is genuinely page-level: its layout, its snackbar and its `NewDeckDialog`.

**`touchAction: "pan-y"` in BOTH variants**, plus `overscroll-behavior: contain`.
This container is where the panel opts in to scrolling (CLAUDE.md § Touch & Scroll:
scrolling is opt-in, never inherited). As a *page* nothing intercepts its touchmoves,
so the browser pans it; as a *sheet* `SheetPanel` still picks the gesture's mode on
its first committed move, but expresses "scroll" by **not** cancelling the event, so
the browser pans it there too (docs/EIP_SHEET_GESTURES.md § "Gesture mode lock").

> It was `"none"` in the sheet variant until 2026-08-24, while `SheetPanel` drove
> `scrollTop` from JS. That is what made this panel — the app's heaviest scroller at
> ~470 mini cards — visibly lag when every other card grid, including the identical
> one on `CollectionViewPage`, did not: a main-thread scroll advances only as fast as
> the main thread finishes each frame.

1. **The study area** — the only thing left on the page itself, and one choice: *which
   session am I starting*. Three rows, top to bottom (`FlashcardsDecksPage`,
   `src/features/flashcards/StudyHand.tsx`). To study one collection instead, open it
   from the sheet and use its launch button.

   **(a) The library line** (`.duebar`) — ONE mono overline: the library's size. It is
   **blank until the count lands**, then fades in over 320ms — the same contract the hand's
   corner tags keep, so the page has one way of saying "not yet" instead of a mono ellipsis
   here and empty tags an inch below. It used to read "counting…"; a line that is only ever
   a figure does not need a second loading vocabulary. The element stays mounted (the fade
   needs something to run on) and holds `\u00A0` while empty, so the hand beneath does not
   shift up and settle back.

   The artboard's right slot carried a second overline naming the scope the modes draw
   from ("all cards"). It is **gone**. The hand only ever draws from the whole library, so
   that label was a constant dressed as a scope, and a constant on screen is a question the
   reader has to rule out. Bring it back only if the hand gains a scope that can change.

   > ⚠️ The artboard's left slot reads **"24 due today"**. A ready count now *exists* —
   > `flpReadyCountsByBand` is what the three hand cards below print — but "due today" is a
   > stronger claim than "ready now": it implies a deadline the app does not model, and
   > nothing expires at midnight. Band totals are a third question again (a Target card
   > marked ten minutes ago is in the band and is not ready), and this slot prints the
   > library SIZE, which is honest on its own terms. If it should carry readiness instead,
   > change the LABEL with it — never print a ready count under a due caption. See
   > [DEFERRED_WORK.md](./DEFERRED_WORK.md) § 9.

   **(b) The Centers rail** (`.ctr2`) — one tile per goal the account pursues, omitted
   entirely when it pursues neither (and always for Spanish, which cannot accrue those
   marks) so the hand keeps that space. They sit ABOVE the hand, not in it, because they
   are a different KIND of destination: a place to look at your library by skill, not a
   session to start. Filled with the ramp's **pastels** (reading `red`, writing the new
   `yel`) rather than the saturated `MARK_TYPE_COLORS` — a tile is a surface, and only
   marks and mastery cells take the saturated hues (SHELF_REDESIGN.md D2b). They also
   carry the hand's hairline (`COLORS.border`) and its RESTING elevation
   (`HAND_CARD_RESTING_SHADOW`, exported from `StudyHand.tsx`) — never the front card's
   lifted shadow, since a tile is not the played card. Without those the rail read as a
   flat patch of colour sitting beside three real cards; with them it is the same object
   family, one row up. Its radius stays 15px against the hand's 22px because the tile is
   about half the size. See § "Mastery Centers".

   **(c) The card hand** (`StudyHand`, `.fanw`) — Study Mix, Review and Challenge as a
   fanned hand of three cards with **one played forward**.

   This replaced a Review/Challenge row above a 3:4 Study Mix slab. Three buttons is
   three peers, which is not what these are: they are one choice, and Study Mix is the
   answer nine times out of ten. A hand says that in its geometry — exactly one card is
   forward and readable, the other two are visibly present, named, and one tap from
   taking its place. Nothing is hidden and nothing is repeated.

   - **Bringing a card forward is deliberately not starting the session.** The front card
     carries the figure and its own `Study now`, so choosing a mode and committing to it
     are two taps. That matters because Review and Challenge are the two modes a learner
     picks on purpose and wants to see the size of first.
   - **The fan is an ordered stack, and every arrangement is reachable.** `StudyHand`
     holds a `HandOrder` — the three modes bottom → top, `[back-left, back-right, front]`
     — rather than deriving the back slots from whichever card is forward. A derived rule
     has only three states (one per possible front card); the stack has all six.
     `FAN_ORDER` (challenge → review → mix) now seeds the opening arrangement only.
   - **Two ways to bring a card forward, and no card ever leaves the frame.**
     **Throwing** the front card (`useHandSwipe`) sends it to the BACK of the stack and
     surfaces the card directly behind it — `[a, b, c] → [c, a, b]`, a 3-cycle. The throw is
     **omnidirectional**: the card follows the finger on both axes, exactly as an flp card
     does, and commits once its straight-line distance from the start of the gesture passes
     `CARD_DISMISS_THRESHOLD_VW × card width` — one radius for every direction, so the
     commit boundary is a circle rather than two side gates. Every direction is the **same
     move**: the hand is a cycle of three, so there is no second direction for a throw to
     mean, and the direction survives only as the card's exit path and the lean it takes
     from the drag's horizontal component (`afterSwipe` takes no direction argument at all).
     **Tapping** a back card promotes it and leaves the other two in their relative order
     (`afterTap`); tapping the *middle* card is a transposition of the top two. A 3-cycle
     plus a transposition generate every ordering of three elements, so swipe and tap
     together reach all six arrangements.
   - **The gesture shares the flp's feel, not its code.** `useHandSwipe` reads
     `CARD_DRAG_SENSITIVITY` and `CARD_DISMISS_THRESHOLD_VW` from
     `src/features/flashcards/constants.ts`, so a throw here and a swipe on the flp card
     stack answer a finger identically. It is a separate hook from the flp's `useCardDrag`
     because that one is built around the card FLIP (tap-to-flip classifier, flip lock,
     `hasFlippedCurrentCard` drag gate, two tutorial hints), none of which a one-faced hand
     card has. The hand sits above a draggable `SheetPanel` inside a scrolling
     `MobileTabScreen`, and because the throw now uses BOTH axes it can no longer hand the
     vertical one back to them: the gesture stays pending until the finger clears 8px in
     any direction, then claims the touch outright (`preventDefault`), and the front card
     is `touchAction: "none"`. A finger that starts on the played card drags the card; the
     page and the sheet are scrolled from anywhere else. Below 8px it is still a tap, so
     `Study now` and the back cards keep their clicks.
   - **A promotion is a hard content switch, not a crossfade.** Geometry animates over
     260ms (`SLOT_TRANSITION`); the front/back layouts swap at t=0 of the commit. The two
     layouts are different compositions — a big numeral plus a commit button versus a
     single name row — not two states of one composition, so there is nothing meaningful
     to interpolate. The single exception is the card's **name**, whose `font-size` travels
     with the slot over the same 260ms: the head's height follows that size and the numeral
     centres against what the head leaves, so an instant 16→27px jump there would jolt the
     numeral the pre-render exists to hold still. On release the drag offset returns to 0 with the transition back on,
     and CSS interpolates from the currently-computed transform, so a thrown card carries
     on from where it was let go instead of snapping to centre first.
   - **The card behind pre-renders the whole front face.** `backRight` — the one the next
     swipe promotes — draws its tag, big numeral, hairline and commit button while still in
     the fan. At rest none of it shows (the played card covers it), so it costs the fan
     nothing; it pays the moment a throw begins, because the number the learner is deciding
     on is uncovered **already drawn** instead of appearing once the gesture resolves. The
     inert button is part of the pre-render on purpose: it reserves the space the numeral
     centres against, and without it the numeral would centre in a taller box and jump into
     place on arrival. On the queued card that button is `disabled`, `aria-hidden`, out of
     the tab order and `pointer-events: none`, so it can neither commit a mode that is not
     forward nor swallow the tap that brings the card forward.
   - **Every card wears its figure as a top-right quantity tag** (`N Cards`), with its
     name at the top-left — on the front card and on the card queued directly behind it
     (`backRight`) alike. The tag is what carries a number through the whole cycle: it is
     already legible the instant a throw clears the card behind, and it is already in its
     final position when that card lands forward, which matters because the promotion is a
     hard switch and anything that *moves* between the two layouts moves visibly. The cost
     is that the front card states its figure twice — small in the tag, large in the
     numeral below — and that repetition is the point rather than an oversight.
   - **A landed `0` swaps the tag for a sentence** (`StudyHandCard.zeroMessage`). "0 Cards"
     reads as a shortfall; the state it actually describes is either "you finished" or
     "go get more", so the tag says which: Review prints **"All caught up!"**, Challenge
     and Study Mix print **"Ready for more cards!"** (`ZERO_MESSAGE_MORE_CARDS`). The big
     numeral still shows the `0` — the tag is the gloss on it, not a replacement.
   - **`backLeft` keeps the old right-clustered head.** The bottom card is two promotions
     from the front and its left edge is the part the fan overlaps first, so a name pinned
     there would slide under another card, which is worse than no name at all.
   - **Ineligibility is not disablement, and a zero is not a fault.** Review is
     ineligible with no earned Comfortable/Mastered cards, but still fires `onStudy`, so
     the page can explain ("Mark more cards in Study Mix…") rather than leaving a dead
     card. The card can always be brought forward; it is the commit that is refused.
     **The card is not greyed for it** — its ramp fill and opacity are unchanged, and only
     the `Study now` button dims. A `0` is the ordinary end of a session (everything
     marked, everything resting), and draining the card's colour would turn that into a
     failure state; the `zeroMessage` above says it in words instead.

   **The figures.** Each mode's number is how many cards **that mode could deal right
   now**: its bands, counted over the library, minus everything still on cooldown.

   | card | bands | caption |
   |---|---|---|
   | Challenge Mix | Unfamiliar + Target | `Cards` |
   | Review Mix | Comfortable + Mastered | `Cards` |
   | Study Mix | all four | `Cards` |

   **While a count is in flight the figure spins.** `SlotNumber`
   (`src/features/flashcards/SlotNumber.tsx`) renders the big numeral as a blurred
   slot-machine reel and lands it when the count arrives. Each digit column is a strip of
   0–9 **repeated twice** inside a one-digit window, driven by two CSS animations with no
   JS per frame: `slotSpin` translates `0 → -50%` linear-infinite (half a doubled strip is
   exactly one revolution, so the loop is seamless, and a negative per-reel delay desyncs
   the columns), and `slotLand` runs `0 → var(--slot-land)` on a decelerating curve, where
   the variable is one extra revolution *plus* the target digit. `slotLand` is listed second
   and carries a per-reel stagger, so during its delay only `slotSpin` is active — the reel
   keeps spinning until its turn — and `forwards` holds the landed digit afterwards. The
   position discontinuity where `slotLand` starts is invisible under `SPIN_BLUR_PX`, and it
   is what buys the effect without ever reading a transform back out of the compositor.
   `SLOT_LINE_HEIGHT` is exported because the host's numeral must use the same
   `line-height`: the reels are swapped for plain text once landed, and a different line
   box would change the figure's height at that swap.

   The landing is triggered **by** the arrival, so it never delays the truth — there is no
   fabricated wind-down holding a fake number after the real one is known. A visitor with
   `prefers-reduced-motion: reduce` gets no reels at all: the figure is blank until the
   count lands. This is the app's first reduced-motion guard, scoped to this one animation
   because a strobing numeral sits exactly where the reader is waiting and cannot be looked
   away from.

   **The corner tags start blank and fade in.** They are four cramped mono characters in a
   corner — too small for any placeholder to read as "loading" rather than as a wrong
   number — so they render empty and cross to `N Cards` over a 320ms opacity transition
   once the count lands. The element stays mounted throughout so the fade has something to
   run on. One thing moving on a card reads as *fetching*; two read as noise, and the big
   numeral is already doing that job.

   ⚠️ **"Challenge Mix" / "Review Mix" are display names only.** The `StudyModeId` values
   stay `challenge` / `review`: they are the `?mode=` query param the flp parses
   (`FlashcardsLearnPage` → `selectedMode`) and the keys of the server's `MODE_CONFIGS`.
   Same rule as the "Learn Now" rename (CLAUDE.md § Terminology) — rename what the learner
   reads, never the wire. Match Speed's three difficulty modes still read "Review" and
   "Challenge" (`src/games/match-speed/constants.ts` → `MODE_CONFIGS`); they are the same
   three ideas on a different surface and were left alone.

   **The two halves partition the four bands, so Challenge + Review == Study Mix.** That
   identity is the reason the three numbers are worth printing together — the hand shows
   one pool split two ways and a learner can read the split straight off the cards, which
   is also why all three captions say the same word. Anything that changes one mode's
   bands must keep the partition or the hand stops making arithmetic sense.

   Making the figures cooldown-aware corrected a long-standing understatement: Study Mix
   used to print Unfamiliar + Target + Comfortable and silently omit **Mastered**, while
   its loop (`DEFAULT_LOOP_CONFIG`, `OnDeckVocabService.ts`) has always dealt 1 Mastered
   card in 10 — so the figure was short by the largest band a long-running account has.

   **Readiness is the flp's rule, restated — not a second definition.**
   `src/utils/flpReadiness.ts` applies `rankFlpEligible`'s eligibility test (at least one
   of the session's two mark types off cooldown, windowed by the card's **core**
   category) on top of the shared `server/contracts/cooldown.ts` arithmetic. Note this
   deliberately differs from the card grid's own cooldown SORT, which takes the *maximum*
   remaining across a bar's tracks windowed by each track's *per-type* category — the
   grid answers "what has rested longest", these figures answer "what would a session
   deal me". The util's docblock carries the full comparison.

   **Computed on the client, with no endpoint.** The page already loads every sorted card
   (`useDecksPanel` → `fetchCollectionCards(ALL_COLLECTION_ID)`, which excludes lent
   provisional rows), those rows carry `typedMarkHistory`, and the cooldown module is a
   client-importable contract. A count endpoint would have added a round trip and a
   second definition of "rested" that could drift from the pool it predicts. `now` is
   read **once** per computation — a clock advancing mid-count could break the partition
   by a card. See DEFERRED_WORK.md § 9, whose original "this needs server work" reasoning
   this disproved.

   All three are `undefined` until the library lands, and the numeral spins as a
   `SlotNumber` reel rather than printing a provisional `0` — `0` is a real answer every
   one of these figures can give, and on a cooldown count it is a *common* one (a learner
   who has just finished a session).

   **Nothing else on a card may read that `undefined` as a zero either.** `reviewEligible`
   is tri-state (`undefined` = not counted yet) for exactly this reason: it used to be
   `(reviewPool ?? 0) > 0`, which declared the mode empty for the whole length of the
   library fetch and — while `StudyHand` still greyed the card itself — repainted the
   Review card **grey → blue** on every visit to the page. `StudyHand` tests
   `eligible === false` strictly, so the loading state now renders identically to an
   offered card. Challenge and Study Mix pass no `eligible` at all and were never
   affected.

   **The Review gate reads the ready count.** Review goes ineligible (dimmed commit
   button, full-colour card) when nothing in Comfortable/Mastered is off cooldown —
   and only once that is *known*: a tap while the count is still in flight starts the
   session rather than raising the toast, and the flp cannot lend its way out of that: a
   lent card has an empty mark history, so it bands Unfamiliar and can never satisfy a
   Review pool. Two different zeroes reach that state and they need opposite advice, so
   the toast branches on `nextFlpReadyMs`: nothing **earned** yet → "Mark more cards in
   Study Mix to unlock this deck"; everything **resting** → "All your review cards are
   resting. Next ready in <span>." Challenge and Study Mix stay ungated — provisioning
   fills their bands.

   Tested by `src/__tests__/flpReadiness.test.ts`, which pins the partition identity, the
   minimum-across-tracks rule and the core-window choice.

   **The hand's bottom padding is derived**, not typed:
   `SETS_PILL_HEIGHT + STUDY_AREA_GAP` — the scroll area already reserves
   `FOOTER_CLEARANCE`, which is exactly where the two sheet pills are anchored, so only
   the pills' own band is missing. Change `SETS_PILL_HEIGHT` and `Study now` still stops
   just above it instead of sliding under it.

   > **Renamed (was Easy / Mix / Hard).** The rename went all the way down — the
   > `StudyMode` values are `'review'` and `'challenge'` in both
   > `server/services/OnDeckVocabService.ts` (`MODE_CONFIGS`) and
   > `useWorkingLoop.ts`, and the flp launches at `?mode=review` / `?mode=challenge`.
   > Nothing persists a mode, so there was no stored value to migrate. A stale
   > `?mode=easy` bookmark fails the validity check and opens a **Study Mix**
   > session rather than dead-ending; Match Speed's `modeConfigFor` does the same
   > with an old nav-state value.

2. **Your library** — the **lens's** two CONSTANTS, *Learn Now* and *Mastered*, as the
   two wide tiles of `LibraryDuo` (`.duo`). **No *All Cards* tile** — those cards are the
   panel's last section instead.

   > **The one place the sheet is not spines**, and the reason is what the surface is for
   > rather than an exception for its own sake. Every other shelf here answers "which
   > set?" and encodes its count as the spine's HEIGHT — a comparison between neighbours,
   > exactly right for a row of six decks. These two have no neighbours to be compared
   > against: "612" and "208" are the figures the learner came to read, and a 74px spine
   > cannot print a figure at a size worth reading. So they keep the shelf's MATERIAL and
   > drop its geometry — same single pastel, same inset white highlight, same dark strap
   > down the left edge, same bottom-heavy corner radius: a spine laid on its side and
   > opened up far enough to hold a number. This narrows SHELF_REDESIGN.md **D9**; it is
   > not licence to bring tiles back anywhere else.

   > ⚠️ The artboard prints **"+17 this week"** under Mastered. No endpoint returns that
   > delta (`masteredAt`, migration 142, makes it derivable), so the caption says what the
   > set IS instead. Do not synthesise it from the client's own counts —
   > [DEFERRED_WORK.md](./DEFERRED_WORK.md) § 10.

   > **`CollectionGroup` values are user-visible strings.** The /decks sheet uses
   > them as its captions and `GamesCollectionSelector` renders `entry.group`
   > verbatim as its menu `ListSubheader`, so the caption was renamed at the source
   > (`builtinCollections.ts`: `'Cards' → 'Collections'`) rather than in the sheet —
   > otherwise the two surfaces, which are documented as sharing one grouping, would
   > have disagreed. Client-side only: no API path, DB value or `CollectionRef` kind
   > carries this string.

   > **The separate *Mastered* section is gone from this panel.** It used to hold
   > *Mastered Reading* / *Mastered Writing* when those goals were set. Those tiles now
   > live in their own Center, where every other number is about the same skill — that
   > is the split the Centers exist for. The `Mastered` group value still exists for
   > the Games hub's menu, which renders the goal-driven list.
3. **Decks** — the user's sets as `Spine`s on one **horizontally scrolling** `ShelfRow`
   (not a wrapping grid: a wrapped second line would stand on nothing), with the
   design's own `AddSpine` riding at the end of the row as the "new deck" affordance —
   which is why the caption no longer carries a `+` button. **Collapsible**: the whole
   caption row is the toggle (a wide target beats a
   24px chevron on a phone). The chevron **rotates** rather than
   swapping glyphs. The open/closed state is remembered **on the device**
   (`localStorage`, key `decksSheet.decksOpen`, default **open**) rather than on the
   account: it is a way of looking at the sheet, not data about the learner, and the
   read is try/caught so a storage-hostile context loses the memory and not the
   section. A learner with many decks folds them away to put the card grid directly
   under the built-in collections.
5. **Challenges** *(built on dev)* — generated challenge decks (`editMode = 'preset'`),
   the same `Spine` on the same kind of row as a user's own decks.
   The **opponent's friend icon** goes in the spine's foot glyph slot (see "Slots, and
   the glyph on the foot" below); the challenge spines carry the generic deck glyph
   until that is wired. See
   [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 4.

6. **Cards** — the learner's **whole sorted library** as a `MiniVocabCardGrid`, with a
   search box above it. This is the `all` collection, fetched once per visit
   (`fetchCollectionCards(ALL_COLLECTION_ID)`, `src/api/collections.ts`) and searched
   **client-side** with the same `filterVocabEntries` the collection page and the
   dictionary bars use — so typing costs no round trip and there is no second notion of
   "matches". The caption's figure is the **unfiltered** total: it names the size of the
   library, and a number that shrank while you typed would be reporting the search
   instead. The grid mounts only the rows near the viewport, so its cost does not grow
   with the library (see "Why the card grid is windowed" below); the search term is
   deferred before it reaches the filter, so the input never lags the finger.

   It carries the **same sort picker as the collection page** — the shared
   `CollectionSortControl` (see § "Sort by"), minus the deck-only *Date added* row,
   since `all` is not a deck. Like the collection page's, the key is **per-visit**:
   the library always opens on "Recently added".

   This is where `/decks` originally showed cards, and where it shows them again. The
   errand it serves — *find that one word* — is far more frequent than *pick a set*,
   and routing it through the **All Cards** tile cost a navigation to reach the same
   grid. "Study these cards" stays on the collection page: this section is for finding
   a card, not for configuring a session.

**Why a fifth section rather than mixing generated decks into *Decks*:** the two behave
differently in every way a user can touch — a challenge deck cannot be renamed, deleted or
added to, appears without being asked for, and vanishes when its window closes. Sorted in
among decks the user built, "why can't I delete this?" has no answer on screen. In its own
section the difference is stated by position before anyone taps.

The section is **absent, not empty**, when the user has no live challenges — the same rule
the Mastered section already follows. And it is where the ~5-entry tidiness note the deck
list carries is enforced from the other side: `MAX_ACTIVE_CHALLENGES = 6` bounds it.

⚠️ The friend icon is **not** on the deck row. `decks` carries no `challengeId`
(§ 1), so the read path inverts `study_challenges.presetDeckIds` in memory to map deck →
opponent. That keeps the pointer in one direction only.

Every section is a **`ShelfRow`** (`src/components/shelf/Shelf.tsx`) — a flex row of
spines, bottom-aligned, standing on a 3px wooden `board` that overhangs the row by 6px
on each side. There is no width arithmetic: spines are a fixed 74px, the row is as wide
as the column, and however many fit, fit.

Rows either **wrap** or **scroll sideways**, and the choice is load-bearing rather than
cosmetic: spines are `flex-shrink: 0`, so a wrapped second line stands on **no board at
all**. *Collections* wraps (a fixed set of two or three, known to fit); *Challenges* and
*Decks* scroll, because they grow.

Every row is **left-aligned**. The old `TileGrid` centred its short rows and left-aligned
its growing ones; centring is wrong on a shelf, because the board runs the full width of
the row and spines floating in the middle of it read as a mistake.

### Why the card grid is windowed

**Code:** `src/components/MiniVocabCardGrid.tsx`, `src/hooks/useWindowedRows.ts`
(`computeRowWindow`), `src/hooks/useIncrementalList.ts`,
`src/components/MiniVocabCard.tsx`, `src/features/flashcards/useDecksPanel.ts`.

This section holds the learner's **entire** library — mastered cards included — inside a
pull-up sheet. On the large test account that is **470** cards, and the panel is mounted
only when the sheet opens, so the whole grid's mount lands *inside the sheet's opening
animation*. Everything below exists because of that one fact.

Four mechanisms, in the order they were added, each doing a different job:

| Mechanism | What it removes | What it does NOT do |
|---|---|---|
| `memo` on `MiniVocabCard` + stable `onCardClick` | Re-rendering every card when unrelated page state changes (a snackbar, a dialog) | Nothing about the first mount |
| `content-visibility: auto` + `contain-intrinsic-size` on the card | Layout and paint for offscreen cards | React still creates every element — this is a *browser*-side skip |
| `useIncrementalList` (the paced reveal) | The mount happening in ONE commit | Bound the total; and past `CASCADE_LIMIT` it stops pacing at all |
| `useWindowedRows` (windowing) | The rows themselves — only ~20 cards exist at a time | Apply to `renderCard` callers (see below) |

The load-bearing point is the third row's caveat. The paced reveal was introduced to keep
the panel's buttons pressable while the list filled in; `CASCADE_LIMIT = 15` was later
added for a purely cosmetic reason (a 470-step waterfall is absurd) and, as a side effect,
returned everything past card 15 to a single commit. Windowing is what makes that cap
safe: the commit is large in *entries* but small in *rows*, because only the rows in the
window are ever mounted. **Neither the cap nor the windowing can be removed on the
assumption that the other one covers it.**

**How the window is measured.** `useWindowedRows` measures the band against the nearest
**scrollable ancestor**, not the viewport. On this panel the grid and its scroller move
together while the sheet is dragged taller, so a scroller-relative band is unchanged by
the resize and needs no recomputation during the gesture — only the scroller's *height*
matters, and a `ResizeObserver` catches that. Measurement is rAF-coalesced, the scroll
listener is registered on `window` with `capture: true` (scroll events do not bubble), and
the ancestor walk happens once per subscription rather than once per frame.

**How the height stays honest.** The rows outside the window are replaced by two
full-width spacers. Each spacer is itself a flex item, so the container's own 16px `gap`
supplies the separation on its inner side — which is why each spacer's height is `rows ×
(cardHeight + gap) − gap`. The invariant (`leading + gap + rendered + gap + trailing ==
totalRows × cardHeight + (totalRows − 1) × gap`) is unit-tested over a band swept down the
whole list in `src/__tests__/windowedRows.test.ts`. Get it wrong and the scroll position
jumps as rows enter the window; that is the failure this arithmetic is guarding against.

**The gap must stay constant.** The spacer arithmetic above is done against a fixed
`ROW_GAP_PX`, so nothing may animate the grid container's `gap` — the spacers would lie
by (rows above × delta) px and the scroll would jump. This is why the grid's scroll
stretch (`useScrollStretch`, [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § "Scroll
stretch") moves rows with a `translate3d` instead of with `gap`.

**Two deliberate limits:**

- **Windowing is off below `WINDOW_MIN_ITEMS` (45)** — about five screens. Under that,
  nearly everything is inside the band anyway and the two forced layouts per scroll frame
  would buy nothing.
- **Windowing is off for `renderCard` callers** (Quick Mark, the two challenge pages).
  The spacer arithmetic is only valid on a **fixed lattice**; a custom card that is not
  exactly `cardHeightPx` tall on every row would make the spacers lie. Those callers
  bound their own lists — Quick Mark paginates — so they lose nothing. **A new
  `renderCard` caller with an unbounded list must page or window itself.**

**The search box.** `useDecksPanel` runs the term through `useDeferredValue` before it
reaches `filterVocabEntries`. The keystroke updates the input at normal priority so the
caret never stalls; the re-filter, re-sort and grid re-render ride the deferred copy,
which React discards and redoes when the next character arrives. Note that a new filter
result is a new array identity, which **restarts the reveal cascade** — the results
visibly pop in on each settled keystroke. That is currently accepted as reading like
"results arriving" rather than as a defect.

### Every set on the page is the same object

Sections 2–5 all render **`Spine`** (`src/components/shelf/Spine.tsx`) and all navigate
to that set's CollectionViewPage. They differ only in what fills them, which is the
point: a built-in collection, a mastery bar and a user-authored deck are all just "a set
of your cards", and the page should not argue otherwise.

A spine is a book seen edge-on — a pastel body, an inset white highlight down its right
side, a **dark strap down its left** (`.sp::after`; without it the shape reads as a
rounded rectangle, and that strap is the whole illusion), the set's name at the top and
its count as a mono numeral at the foot. It is purely presentational: a label, a colour,
an optional count and some optional slots. It knows nothing about bands, bars or routes.

> It replaced `DeckTile` — the stacked-card icon, 422 lines — in the shelf redesign's
> A3 (decision D9, [SHELF_REDESIGN.md](./SHELF_REDESIGN.md)). With it went the rotated
> edge label, the centred glyph, the two-card stack and `estimateLabelLines()`. The one
> idea carried forward is the `cqw` scaling below.

**A spine takes ONE colour.** `BAND_COLORS` / `deckTileColors` still return a
`main`/`accent` pair, but the accent was `DeckTile`'s lighter inner fill and a spine has
no such surface — the inset highlight does that job. The shelf reads only `.main`.

**Height is information.** `spineHeight(count)` (`spineGeometry.ts`) bands a set into
`short` 96 / `base` 116 / `tall` 140. Banded, not continuous: a smooth height curve gives
a row of near-identical spines that looks like sloppy alignment rather than data, and
makes a 40-card and a 43-card deck visibly different for no reason a learner can act on.
The cutoffs (`< 20`, `< 100`, `100+`) are a first cut — the design specifies the heights
but not the boundaries.

**Except in the sheet.** The fdp's pull-up sheet squats every spine to **74px**
(`SHEET_SPINE_HEIGHT`, the design's `.sheet .sp`) because a 140px spine would eat the
panel — so inside the sheet the height stops encoding anything and only the numeral
carries the count. The Mastery Center **pages** have room and do band.

Colors come from `builtinCollectionEntries` for the built-ins (which reads
`BAND_COLORS.All`, `LEARN_NOW_COLORS` and `MASTERY_BAR_COLORS` out of
`src/utils/categoryColors.ts`) and from `deckTileColors(id)` for a user deck — the
same id-derived palette as `deckAccentColor`. **All** is the one grey spine: every other
color on the page names a set, and All is their union rather than another member, so it
takes a neutral instead of another hue. **Learn Now** takes purple — a hue no band owns,
so it cannot be misread as Comfortable green, which still means the band on mini-card
chips and the Account bucket row.

The three **Mastered** spines come from `MASTERY_BAR_COLORS` (same file), one hue per bar
rather than three blues. `reading` and `writing` are single-mark-type bars, so each
takes ITS MARK's color out of `MARK_TYPE_COLORS` — red and orange, the same colors those
marks paint on the cdp track and the mini-card strip — and reads them rather than
restating the hex, so a mark and its Mastered spine cannot drift. `core` blends
recognition and production, has no single mark color to borrow, and keeps Mastered blue.

The three Mastered collections stay named **"Mastered Cards" / "Mastered Reading" /
"Mastered Writing"** (`MASTERED_TITLES`, `collectionRef.ts`) — one word order for all
three, so every Mastered spine breaks to the same shape: MASTERED, then what was
mastered. (The reason is weaker than it was: a spine's name wraps normally rather than
sideways. The consistency is still worth keeping.)

### Slots, and the glyph on the foot

A spine has three optional slots — `pin` (a mono badge on a translucent white chip,
top-right), `caption` (a mono line along the foot) and `glyph` — plus two more on the
`vol` variant used by the Reader (`meta`, `ownerGlyph`).

**`glyph` is the set's identifying icon**, and it sits on the **foot row**,
right-aligned, opposite the count. That position is the design's `.sp.vol .own` (a
glyph pinned to the right edge, clear of the foot content) generalised to every
variant. It is deliberately NOT the design's other glyph slot `.mine`, which is a
top-LEFT corner mark — exactly where `label` starts, so the two overlap on any spine
that has a name. And it cannot be centred the way `DeckTile`'s was, because a spine
has no middle.

The foot is a real flex row rather than two absolutely-positioned corners, so the
count and the glyph cannot overlap however long the numeral gets.

**The glyph is a Material Symbols NAME, not an element** (decision D3). The spine
scales every interior size against its own width, which it cannot do to an opaque
`@mui/icons-material` element. Two maps, one per surface:

| Surface | Map | Glyphs |
|---|---|---|
| panel collections + decks | `collectionGlyph(ref)`, `src/features/flashcards/collectionGlyph.ts` | all → `style` (a card stack), learn-now (**any bar**) → `school`, mastered/core → `trophy`, mastered/reading → `menu_book`, mastered/writing → `edit`, deck → `folder` |
| Account utcm bands | `BUCKET_GLYPHS`, `src/components/DeckBuckets.tsx` | Unfamiliar → `help`, Target → `adjust`, Comfortable → `check_circle`, Mastered → `trophy` |

`collectionGlyph` lives beside the fdp rather than in `builtinCollections.ts` because
that module is the shared list of *which* collections exist — the Games hub selector
reads it too and draws a color dot, not a glyph — and it deliberately owns no
presentation. It switches exhaustively over `CollectionRef`, so a fifth kind of
collection is a type error rather than a silently glyph-less spine. The Account map is
separate because `components/` may not import from `features/`
([FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)) and because a utcm band is a card
property, not a collection; the two maps share exactly one glyph on purpose — the
trophy, so "mastered" looks like one idea on both pages.

The three Mastered spines take the glyph of the **skill** mastered (trophy / open book
/ pencil) rather than three identical trophies, which would defeat the point.

> It was named `collectionIcon` and returned a `ReactNode` until A3. Renamed with the
> return type, so a silent swap under the same name could not compile at some call
> site and break at another.

### Names that do not fit a 74px spine

A spine has **56px** of content across. Three of the labels this page uses are wider
than that as single words, so the `.nm` block needs three things working together:

- **Tracking is `-0.01em`, not the design's `-0.005em`.** "Unfamiliar" measures
  **56.02px** at the design's value — it misses by two hundredths of a pixel and wraps
  to "Unfamilia / r". Half a percent of tracking is invisible; that break is not.
- **`overflow-wrap: break-word`, not the design's `anywhere`.** `anywhere` creates a
  soft-wrap opportunity at *every* character, so the line-breaker always fills to the
  last one that fits and hyphenation never applies. `break-word` only breaks a word
  that cannot fit a line of its own — which is exactly when hyphenation should run.
- **The caller supplies soft hyphens for words that must break.** `hyphens: auto` is
  set on `.nm` but cannot be relied on: it needs the browser to ship hyphenation data
  for the document's language. So `BUCKET_LABELS.Comfortable` is `"Comfort\u00ADable"`
  — a `U+00AD` SOFT HYPHEN, invisible unless the break lands there, at which point it
  renders "Comfort- / able". Knowing where an English word divides is caller
  knowledge; `Spine` renders whatever string it is handed and carries no dictionary.

### The "+ new deck" affordance

The Decks section header no longer carries a `+` IconButton. The design's own affordance
is **`AddSpine`** (`.sp.add`) — a spine-shaped hole with a dashed outline and a centred
`+` — which rides at the end of the decks row, so "make another one" sits where the
existing ones are rather than in the caption above them. Consequence: it is hidden while
that section is collapsed.

`AddSpine` is its own component, not a `Spine` variant: it shares only the box — no body
colour, no strap, no shadow, no title, no count, none of the slots — and folding it in
would make every one of those a conditional inside `Spine` for a shape that carries no
data.

### One spine, many widths, one design

Every interior size is authored in px against its variant's natural width and emitted as
`cqw` by `scaled()`, with `container-type: inline-size` on the spine. A spine rendered at
a non-natural `width` is therefore the same object enlarged, not a second design with the
same furniture at a different scale. This is the one idea carried forward from
`DeckTile`, which needed it to be 100px on the fdp and ~71.5px on Account at once.

- The reference is **per variant**, not a single global 74. The design authors
  `.sp.vol`'s interior at its own 86px width (`.ti` is 11.5px there, the same numeral as
  `.nm` at 74px), so a single 74 reference would render vol's text ~16% larger than the
  artboard.
- It is `inline-size`, never `size`. `size` containment additionally makes the height
  self-contained — and the height is the information. (`size` is also what broke the hub
  cards, [BENTO_SYSTEM.md § Known gaps](./BENTO_SYSTEM.md).)
- The sheet's 74px squat overrides `height` only, so the interior does not shrink with
  it — which is correct: the design keeps `.nm` at 11.5px in the sheet.

### Counts

All figures are derived by `builtinCollectionCount` (`builtinCollections.ts`) from the
two count hooks the page already loads — no third endpoint:

| Tile | Source |
|---|---|
| All Cards | `useCategoryCounts` — the sum of the four core bands |
| Learn Now | `useCategoryCounts` — Unfamiliar + Target + Comfortable, mirroring its own SQL (`core category <> 'Mastered'`) |
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

`AddToDeckMenu` opens a checkbox menu of the user's decks, with "New deck…" at the
bottom. Its trigger has two shapes — a bare icon button, or a labelled outlined button
when a `label` prop is given. Mounted in:

* `FlashcardsLearnPage/CardOpsRail.tsx` — the `add to deck` cell on the card's own `•••`
  rail (`AddToDeckMenu` in its `rail` appearance), which is where filing a card lives
  since 2026-08-24. It replaced the "Add to Deck…" button in the action bar at the end of
  the **eip definition tab** (labelled). It used to live in the eip *header*'s action
  grid as a bare icon; it moved so the action reads as a named button rather than a
  guessed-at glyph. Since **2026-08-28** this is the ONLY host: the cdp mounts the same
  rail on its hero card, so its header copy (a bare icon beside Edit and Delete) was
  removed along with Edit — the header keeps `delete` alone. See
  [CARD_NOTES.md](./CARD_NOTES.md).

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

**Two surfaces** carry a **Sort by** button under their search field, opening a menu
of orderings: `CollectionViewPage` and the decks panel's inline **Cards** section (on
the fdp and on both Mastery Centers).
The comparators live in `src/utils/vocabSort.ts`, next to the `filterVocabEntries`
search they share a toolbar with; the button and its menu are one shared component,
**`CollectionSortControl`**.

**What the component owns, and what it doesn't.** It owns the picker — the menu's
non-obvious markup (see below) is ~100 lines, and a second copy would have drifted the
first time a mastery bar or a language was added. It does **not** own the sort KEY:
each host holds that in its own state and applies it with `sortVocabEntries`, because
each host holds the entries, and they default differently (`defaultSortKey`: a deck
opens on `deckAdded`, everything else on `recent`, and **anything under a skill lens on
that bar's Mastery · Lowest** — a Center is opened with one question, and card age does
not answer it). `allowDeckOnly` gates the deck-only rows — false everywhere
`deckAddedAt` is not selected.

**The rows.** *Date added*, *Added to this deck* (deck-only), *Pinyin* / *Word*,
*Definition*, **Cooldown**, then *Mastery* and *Date mastered* — one of each per
**active** bar.

**Cooldown** (`cooldownReady` / `cooldownLongest`, and a per-bar pair each for reading
and writing) orders by how long until the card is **fully off cooldown in one bar**:
the MAXIMUM remaining window across **that bar's** mark types (`cooldownKey`, reading
`server/contracts/cooldown.ts` with each track's PER-TYPE category — the same window the
cdp prints under each bar).

* Why the maximum and not the soonest-ready track: the minimum is **degenerate**. A
  track with no correct mark reports 0, and outside the reading/writing goals most
  cards have two such tracks — so nearly every card would score 0 and the ordering
  would collapse into one enormous tie. The maximum lets an untouched track simply
  lose, so the key is the longest-resting track and it moves whenever any track is
  marked.
* **"Ready first"** is therefore the *what have I been neglecting* ordering (never
  studied, or fully rested); **"Longest"** surfaces the cards deepest into their rest.
* ⚠️ **0 means "ready", not "no date"** — cooldown is deliberately **not** a `DATE_KEY`,
  so a never-studied card leads "Ready first" instead of sinking with the dateless ones.
* ⚠️ **It used to span all four mark types** on the argument that an ordering must be
  goal-independent. It still is — every key names its bar, and a goal toggle changes
  nothing about what any key computes. What changed is that a surface now has a **lens**:
  a single all-four-types number cannot answer *"what reading have I been neglecting"*,
  because a card whose recognition has rested six months would outrank the one whose
  reading track is genuinely the stalest thing on the page. So the row is now per bar,
  like the other two (`COOLDOWN_KEY_BAR` / `COOLDOWN_KEYS`).
* The key depends on the clock, so `sortVocabEntries` takes `now` — read **once per
  sort** and injected (a key that drifted mid-sort would make the comparator
  inconsistent), and injectable for the tests. The list does **not** tick: a card that
  becomes ready while you are looking at it moves on the next sort, not live.

**Two visibility gates**, both filtering the shared list rather than forking it
(`CollectionSortControl`):

| Gate | Hides | Off where |
|---|---|---|
| `allowDeckOnly` | rows tagged `deckOnly` (*Added to this deck*, which reads `deckAddedAt`) | anything that is not a deck — the field is only selected by the deck read |
| `allowPerSkillBars` | rows whose `bar` is `reading` or `writing` | the panel's **Cards** section, **under the core lens only** |

The fdp's Cards section drops the per-skill rows because it lists the *whole library*
and is opened to **find a card**; a per-skill mastery ordering is a view of the bar, and
belongs on the pages that are about that bar. ⚠️ Under a **skill lens** the gate is
inert by construction: the lens bar is the only bar the menu has, and filtering it out
would leave the Center with no mastery row at all. Both gates filter on the bundle's
**tag** (`deckOnly`, `bar`) rather than on its `id` string, so adding a bar cannot
silently slip a row past them.

**The lens narrows the menu.** `sortBundles(language, goals, lens)` emits one row set
per `activeBars(goals)` under the core lens, and **only the lens bar's** rows under a
skill lens. With a single bar in play the labels lose their qualifier — a Center's menu
reads *Mastery*, not *Mastery (Read)*, because the page title already said which skill.

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
| Cooldown *(one row per bar)* | Ready first → `cooldownReady*` · Longest → `cooldownLongest*` | that bar's longest-resting track |
| Mastery *(one row per bar)* | Highest → `mastery*Desc` · Lowest → `mastery*Asc` | that bar's pbh (`barProgressBarHeight`). **The default under a skill lens** (Lowest) |
| Date mastered *(one row per bar)* | Newest → `masteredRecent*` · Oldest → `masteredOldest*` | that bar's own `vet.masteredAt` stamp; missing dates last **in both directions** |

**The mastery, cooldown and date-mastered rows are per bar, and goal-gated.**
`sortBundles` emits one of each per `activeBars(goals)` entry (or per the lens bar
alone); `MASTERY_KEY_BAR`, `COOLDOWN_KEY_BAR` and `MASTERED_AT_KEY_BAR` map each key
back to the bar its comparator reads. A row label names its bar
(`Mastery (Read)`) only when **more than one bar is active** *and* the bar is a
**per-skill** one. The core bar is never named: the unqualified label *is* the core
bar, so the menu reads "Mastery" / "Mastery (Read)" / "Mastery (Write)" and never
"Mastery (Know)". The core exemption exists because the fdp's Cards section offers the
core rows **alone** (`allowPerSkillBars={false}`), where a "(Know)" suffix named a
distinction the menu was not drawing. A learner with no goals still reads plain
"Mastery" — the menu they had before migration 143 — and so does a learner inside a
Center, where the lens has already narrowed the list to one bar. Date mastered reads `masteredAtForBar(entry.masteredAt, bar)`, that bar's **own**
stamp rather than the newest across bars, so a reading crossing cannot reorder the
core list. See [MASTERY_REWORK.md § Three bars](./MASTERY_REWORK.md).

**`sortVocabEntries` takes no goal flags and no lens.** Every key names its own bar, so
an applied ordering cannot change under a settings toggle or a navigation; goals and the
lens affect only which rows the menu offers and which key a surface *opens* on. The toolbar button reads `"<dimension> · <direction>"` (`sortLabel`), falling
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
| §3 Games-hub selector | `src/features/flashcards/selectedCollection.ts`; `src/games/GamesCollectionSelector.tsx`; `src/games/GamesPage.tsx` (`launchPath`); `src/games/word-search/WordSearchHubItem.tsx` (`newGamePath`); `src/api/decks.ts` (`fetchDecks`) |
| §4 Client | `src/api/decks.ts`, `collectionRef.ts`, `useLaunchCollection.ts`, `CollectionViewPage.tsx`, `FlashcardsDecksPage.tsx`, `useDecksPanel.ts`, `DecksPanelBody.tsx`, `NewDeckDialog.tsx`, `AddToDeckMenu.tsx`, `routes/routeMeta.ts`, `routes/registry.ts` |
| §4 Mastery Centers | `src/features/flashcards/masteryCenters.ts` (bars, routes, titles, `activeMasteryCenters`); `MasteryCenterPage.tsx`; `useDecksPanel.ts` (the lens); `collectionRef.ts` (`withLens`, `lensFromSearch`, `lensFromCollection`, `LEARN_NOW_COLLECTION_IDS`); `builtinCollections.ts` (`lensCollectionEntries`); `src/hooks/useCategoryCounts.ts` (`?bar=`); `src/components/MiniVocabCard.tsx` + `MiniVocabCardGrid.tsx` (the `lens` prop); `src/components/mastery/MasteryWindow.tsx` (`lens`); `VocabCardDetailPage.tsx` (`?bar=`); `server/contracts/wire.ts` (`LEARN_NOW_COLLECTION_IDS`, `learnNowCollectionBar`, `parseMasteryBar`); `server/dal/shared/vetTable.ts` (`unmasteredBarClause`, `builtinCollectionClause`); `OnDeckVocabService.getCategoryCounts` (the `bar` param); `OnDeckVocabController.getCategoryCounts`; `routes/routeMeta.ts` + `registry.ts`. See [MASTERY_REWORK.md](./MASTERY_REWORK.md). |
| §4 Spines & built-in collections | `src/components/shelf/*` (`Shelf`, `Spine`, `AddSpine`, `spineGeometry`) (+ `DeckBuckets.tsx`, the Account host); `src/utils/categoryColors.ts` (`BAND_COLORS.All`, `LEARN_NOW_COLORS`, `MASTERY_BAR_COLORS`); `src/features/flashcards/builtinCollections.ts` (`lensCollectionEntries`, `builtinCollectionEntries`, `builtinCollectionCount`); `collectionRef.ts` (`deckTileColors`, `MASTERED_TITLES`, `builtinCollectionRef`, `builtinCollectionId`); `server/dal/shared/vetTable.ts` (`BUILTIN_COLLECTION_IDS`, `parseBuiltinCollectionId`, `builtinCollectionClause`); `server/contracts/wire.ts` (`ALL_COLLECTION_ID`, `MASTERED_COLLECTION_IDS`, `masteredCollectionBar`, `LEARN_NOW_COLLECTION_IDS`, `learnNowCollectionBar`); `OnDeckVocabService.getBuiltinCollectionCards` + `getMasteredCountsByBar`; `OnDeckVocabController.getCollectionCards` + `getMasteredCounts`; `routes/onDeckRoutes.ts`; `src/hooks/useMasteredCounts.ts` |
| §1 `editMode` + §4 Challenges section | [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) §§ 4, 9; `database/migrations/148-create-study-challenges.sql`; `DeckService` → `assertMutable` (the preset mutation guard) and `createPresetDeck`; `DeckDAL` → `createPresetDeck` / `countCustomDecks` / `findDeckEditMode`; `study_challenges.presetDeckIds` |
| §4 Cards section (inline library) | `src/api/collections.ts` (`fetchCollectionCards`) — also the collection page's built-in read; `src/components/MiniVocabCardGrid.tsx`; `src/utils/vocabSearch.ts` (`filterVocabEntries`); `useDecksPanel.ts` (the fetch, the search + sort state); `DecksPanelBody.tsx` (the section + the `decksSheet.decksOpen` collapse) |
| §4 Why the card grid is windowed | `src/hooks/useWindowedRows.ts` (`useWindowedRows`, `computeRowWindow`, `seedWindow`, `scrollParentOf`); `src/components/MiniVocabCardGrid.tsx` (`WINDOW_MIN_ITEMS`, `WINDOW_OVERSCAN_PX`, `CASCADE_LIMIT`, the two spacers); `src/hooks/useIncrementalList.ts`; `src/components/MiniVocabCard.tsx` (`memo`, `contentVisibility`); `src/features/flashcards/useDecksPanel.ts` (`useDeferredValue` on the search term); `src/__tests__/windowedRows.test.ts` |
| §4 Sort by | `src/utils/vocabSort.ts` + `src/__tests__/vocabSort.test.ts`; `server/contracts/cooldown.ts` (`cooldownRemainingMs`) + `server/contracts/mastery.ts` (`computeTypeCategory`) for the Cooldown key; `src/features/flashcards/CollectionSortControl.tsx` (the shared button + menu, both visibility gates); `CollectionViewPage.tsx` and `useDecksPanel.ts` (each holds its own key + `visibleEntries` memo); `src/utils/definitionUtils.ts` (`resolveDisplayDefinition`, `resolveDisplayPronunciation`); `server/contracts/mastery.ts` (`barProgressBarHeight`, `activeBars`, `masteredAtForBar`); `database/migrations/142-add-mastered-at-to-vocabentries.sql`, `143-three-mastery-bars.sql`; `OnDeckVocabService.getDeckCards` (`deckAddedAt`) |

Related docs: [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (small-deck top-up),
[GAMES_FEATURE.md](./GAMES_FEATURE.md) (launch params),
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (node pages),
[MASTERY_REWORK.md](./MASTERY_REWORK.md) (the three mastery bars the Mastered
collections filter on),
`database/migrations/143-three-mastery-bars.sql` (on prod since 2026-08-11).

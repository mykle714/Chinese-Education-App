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
the friend's icon on the tile.

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
| `src/features/flashcards/builtinCollections.ts` | **The one list of built-in collections a surface offers** — order, colors, grouping (`hasMasteredSection`) and tile counts; shared by the fdp and the Games hub selector |
| `src/features/flashcards/useLaunchCollection.ts` | Reads the collection back off a surface's own URL |
| `src/features/flashcards/selectedCollection.ts` | **Session-only store** for the collection the Games hub plays with (never persisted); read by `GamesPage` / `WordSearchHubItem`, written by `GamesCollectionSelector` |
| `src/games/GamesCollectionSelector.tsx` | The hub-header "Playing with …" pill + menu (see [GAMES_FEATURE.md](./GAMES_FEATURE.md)) |
| `src/features/flashcards/CollectionViewPage.tsx` | The generalized page (all three collection kinds) |
| `src/features/flashcards/MasteredRedirect.tsx` | `/flashcards/mastered` → `/flashcards/collection/mastered` |
| `src/features/flashcards/FlashcardsDecksPage.tsx` | `/decks` — the study-button row, all of the page's data (counts, deck fetch, create dialog), and the persistent sheet's mounting |
| `src/features/flashcards/DecksSheetBody.tsx` | Body of that sheet: the Cards / Mastered / Challenges / Decks tile sections (`TileGrid`, `SectionLabel`, `LineSeparator`) |
| `src/features/flashcards/AddToDeckMenu.tsx` | The checkbox menu, mounted on the cdp and the eip |

### Routes

```
/flashcards/collection/all               ─┐
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
(`mastered-reading`, `all`) come from `wire.ts`.

One route serves all eight because the segment is `:builtin` — adding a ninth
collection is a case in `builtinCollectionClause` and a tile on the fdp, nothing else.

**Two routes, not one `:collectionId`.** A deck is addressed by its numeric id under
its own path segment, so a user who names a deck "mastered" gets
`/flashcards/deck/42` — a deck name can never shadow a built-in collection route.

All are **node pages** (docs/UX_AND_NAVIGATION.md): footer kept, left back arrow,
horizontal slide.

### Which collections exist

The built-in list is deliberately **three ideas wide**:

| Collection | What it holds |
|---|---|
| **All Cards** | every sorted card, mastered or not |
| **Learn Now** | every sorted card whose **core** bar is unfinished |
| **Mastered** | the cards finished in one bar — one collection per **active** bar |

The per-band collections (`unfamiliar` / `target` / `comfortable`) **were removed**.
A utcm band is a property of one card's progress, not a set a learner studies: nobody
opens "my Target cards" to drill them, and a set whose membership changes on every
mark is a poor thing to launch a round against. The bands still exist everywhere they
mean something — the category on a card, the Account page's bucket row, the mini-card
chip — just not as collections. Consequence: `?collection=target` no longer resolves
(it falls back to `learn-now`) and `/flashcards/collection/target` renders nothing.

**One conditional rule: is *Mastered* its own section?** Only when the account pursues
a reading or writing goal, i.e. only when there is more than one Mastered collection
to tell apart. With `core` alone that tile joins the **Collections** section, because a
captioned section holding a single tile is a heading for nothing.

**One shared list, two surfaces.** `src/features/flashcards/builtinCollections.ts`
owns the entries, their order, their colors and their grouping.
`FlashcardsDecksPage` renders them as tiles and `GamesCollectionSelector` as menu
rows — **the fdp is the source of truth for what a collection is**, and a set a
learner can open on `/decks` but cannot play a game with would be a silent
inconsistency. Counts come from the same module (`builtinCollectionCount`), so a
collection's definition and its number cannot drift.

### `/decks` = a button row + a persistent pull-up sheet

The page is split across **two surfaces**:

* **Page (behind)** — section 1 only, the study-entry buttons. `MobileTabScreen` is
  mounted with **`scrollable={false}`**: nothing behind the sheet scrolls any more.
* **Sheet (front)** — sections 2–5, every *set* of cards, in `DecksSheetBody`.

The sheet is the **same component as the eip bottom sheet**,
`SheetPanel`, in its **persistent** mode (`minHeight` > 0, `showScrim={false}`, no
`onClose`) — so the drag/fling/scroll-coupling model is shared code, not a second
implementation. See [EIP_SHEET_GESTURES.md § Two modes](./EIP_SHEET_GESTURES.md).
Its two stops are:

| Stop | Value | What shows |
|---|---|---|
| **resting** ("closed") | `FLOATING_FOOTER_INSET + FLOATING_FOOTER_HEIGHT + FLOATING_FOOTER_EXTRA_GAP + SHEET_LIP` (44) | the grabber and the first caption, sitting just above the floating footer pill |
| **max** | `parentHeight × 0.92` | the full list |

It **cannot be dismissed** and has **no open animation** — it is painted at its
resting height on the first frame. The floating footer (frame-level, `zIndex: 100`)
hovers *over* the sheet at every height, so the sheet's scroller both reserves
`FLOATING_FOOTER_CLEARANCE` at its bottom **and wears the same bottom edge-fade mask**
(`EDGE_FADE_MASK_NO_TOP`, exported from `MobileTabScreen` rather than re-derived) —
tiles dissolve as they pass behind the pill instead of being sliced by it. The top
band of that mask is dropped: the sheet's top edge is its own grabber, which stays
solid.
`FlashcardsDecksPage` wraps both surfaces in one `position: relative` box, because
that box — not the viewport — is what caps the sheet's height.

**Data stays on the page, presentation moves to the sheet.** The count hooks, the
deck fetch, the create-deck dialog and the snackbar all remain in
`FlashcardsDecksPage`; `DecksSheetBody` takes them as props.

1. **Review / Study Mix / Challenge** — *whole-library* study entry points, the only
   thing left on the page itself. To study one collection, open it from the sheet and
   use its launch button.

   Laid out as a **row + a slab**: Review and Challenge sit together on one row at
   **equal width** (peers — the two halves of one difficulty axis), and **Study Mix**
   is a **fixed 3:4 (w:h) portrait slab**, centred in the space between that row and
   the resting sheet and grown until it hits the first edge — width or height,
   whichever runs out first. Study Mix is the
   biggest target because it is the one that always works: Review is greyed without
   earned Comfortable/Mastered cards, and Challenge is a mode choice, while a mixed
   session is the default thing to do. Its type steps up to `SIZE.title` to match the
   footprint, and Review/Challenge return to the base `bodyLg` now that each has half
   a row rather than a quarter.

   **How the ratio holds.** The slab's slot (`flashcards-decks__mix-slot`) declares
   `container-type: size`, and the button is `flex: none` with
   `width: min(100cqw, 75cqh)` + `aspect-ratio: 3 / 4` — `75cqh` being the width a 3:4
   box has at the slot's full height, so the smaller term wins and the box fills
   without ever overflowing. It is deliberately **not** `flex: 1`: a flex-grown item
   has a definite height, and a definite height overrides `aspect-ratio`. The obvious
   alternative (`height: 100%; width: auto; max-width: 100%`) breaks the ratio too —
   when `max-width` clamps, the definite height stays put. Container-query units
   resolve against the slot's **content box**, so the slot's padding is genuine margin
   around the slab.

   The slab's bottom padding is **derived**, not typed:
   `SHEET_CLOSED_HEIGHT - FLOATING_FOOTER_CLEARANCE + STUDY_AREA_GAP` — the scroll
   area already reserves the footer's clearance, so only the amount by which the
   resting sheet out-stands it is missing. Change `SHEET_LIP` and the button still
   stops just above the sheet instead of sliding under it.

   > **Renamed (was Easy / Mix / Hard).** The rename went all the way down — the
   > `StudyMode` values are `'review'` and `'challenge'` in both
   > `server/services/OnDeckVocabService.ts` (`MODE_CONFIGS`) and
   > `useWorkingLoop.ts`, and the flp launches at `?mode=review` / `?mode=challenge`.
   > Nothing persists a mode, so there was no stored value to migrate. A stale
   > `?mode=easy` bookmark fails the validity check and opens a **Study Mix**
   > session rather than dead-ending; Match Speed's `modeConfigFor` does the same
   > with an old nav-state value.
2. **Collections** — *All Cards* and *Learn Now* as **deck tiles**, plus *Mastered Cards*
   when it has no section of its own (no reading/writing goal).

   > **`CollectionGroup` values are user-visible strings.** The /decks sheet uses
   > them as its captions and `GamesCollectionSelector` renders `entry.group`
   > verbatim as its menu `ListSubheader`, so the caption was renamed at the source
   > (`builtinCollections.ts`: `'Cards' → 'Collections'`) rather than in the sheet —
   > otherwise the two surfaces, which are documented as sharing one grouping, would
   > have disagreed. Client-side only: no API path, DB value or `CollectionRef` kind
   > carries this string.
3. **Mastered** — one tile per **active** mastery bar: *Mastered Cards* (core,
   always), *Mastered Reading* and *Mastered Writing* (each gated on that account
   goal) — **rendered only when a reading or writing goal is set**
   (`hasMasteredSection`). The page maps over whatever `builtinCollectionEntries`
   returns for each group, so adding a bar is a change in one contract rather than in
   the page.
4. **Decks** — the user's sets, wrapping at **three per row**, plus a `+` to create
   one.
5. **Challenges** *(built on dev)* — generated challenge decks (`editMode = 'preset'`), same
   `DeckTile`, same wrapping, but with the **opponent's friend icon** in the tile's icon
   slot instead of the `+`. See [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 4.

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

Every section shares one row component (`TileGrid`, now in `DecksSheetBody.tsx`): a **centered wrapping flex**
capped at exactly three tiles' worth of width (`3 × TILE_WIDTH + 2 × TILE_GAP`,
derived rather than typed twice — a wider gap with a stale cap would push the third
tile onto its own line, a narrower one would let a fourth up). It is not a
3-column grid, because a grid pins each tile to a column and its last row is then
stuck with visibly empty columns. The width cap is what keeps the three-per-row
rhythm, and `DeckTile` never grows past its natural 72px, so a short row is normal
tiles rather than stretched ones.

It takes **two alignments**, deliberately:

* **Centered** — *Collections* and *Mastered*. Fixed sets of two or three tiles that never
  wrap, so there is no column structure to preserve, and left-aligning them would
  leave an obvious hole where the third tile isn't.
* **Left** (`alignLeft`) — *Decks*. A growing, wrapping list: centered, adding a
  fourth deck would shunt the first three sideways to re-center the row above, so a
  deck would move every time the user makes another one. Left-aligned, each deck keeps
  its place and every row starts on the same column.

### Every set on the page is the same object

Sections 2–5 all render **`DeckTile`** (`src/components/DeckTile.tsx`) — the
stacked-card icon — and all navigate to that set's CollectionViewPage. They differ
only in what fills them, which is the point: a built-in collection, a mastery bar and
a user-authored deck are all just "a set of your cards", and the page should not
argue otherwise.

`DeckTile` was extracted from `DeckBuckets` (the Account page's display-only count
block), which now consumes it. The stacked-card look existed once, privately, inside
that component; the fdp needed it for every set it lists, and a second copy would have
drifted on the stack offsets the moment either page was touched. The tile is purely
presentational — a label, an optional count, an optional `icon` **element**, two
colors, an optional `onClick` — and knows nothing about bands, bars or routes.

The stack itself is **two cards**, not three: the face (`.deck-tile__layer-1`) plus one
back card offset 8px down-right (`.deck-tile__layer-2`). 8px is exactly the layers'
width slack (`calc(100% - 8px)`), so the two-card stack still fills the tile's box.

Colors come from `builtinCollectionEntries` for the built-ins (which reads
`BAND_COLORS.All`, `LEARN_NOW_COLORS` and `MASTERY_BAR_COLORS` out of
`src/utils/categoryColors.ts`) and from `deckTileColors(id)` for a user deck — the
same id-derived palette as `deckAccentColor`, paired with a saturated body tone so a
deck tile has the same two-tone structure as a built-in one. **All** is the one grey
tile: every other color on the page names a set, and All is their union rather than
another member, so it takes a neutral pair instead of another hue. **Learn Now** takes
purple — a hue no band owns, so it cannot be misread as Comfortable green, which
still means the band on mini-card chips and the Account bucket row.

The three **Mastered** tiles come from `MASTERY_BAR_COLORS` (same file), one hue per bar
rather than three blues. `reading` and `writing` are single-mark-type bars, so each tile
takes ITS MARK's color out of `MARK_TYPE_COLORS` — red and orange, the same colors those
marks paint on the cdp track and the mini-card strip — and reads them rather than
restating the hex, so a mark and its Mastered tile cannot drift. `core` blends
recognition and production, has no single mark color to borrow, and keeps Mastered blue.
Those two hues are also the Unfamiliar and Target band hues, which used to collide with
the band row one section above; with the band tiles gone they mean only "reading" and
"writing" on this page.

**The name runs up the tile's right edge.** The face carries three things: the card
**count** as a small stat pinned to its top-left corner (`.deck-tile__count`, 11px/800
at a 7px inset), the set's **icon** centered in the middle (`.deck-tile__icon` — see
below), and the set's name as a rotated run against its right edge — faded grey
uppercase (`COLORS.textSecondary` at `opacity: 0.5`, `TRACKING.caps`) turned 90°
counter-clockwise so it reads bottom-to-top, centered on the tile's height
(`.deck-tile__label`, via `writing-mode: vertical-rl` + `transform: rotate(180deg)`).
This is deliberately the **same treatment the Games hub gives a card's mark-type
label** — see [HUB_MENU_SYSTEM.md § Edge label slot](./HUB_MENU_SYSTEM.md) — so a
name attached to a set reads the same way on both surfaces. Two consequences:

- **A long name wraps sideways, up to three lines.** In vertical writing mode the
  inline axis is the height and the block axis is the width, so a name that outruns
  the face (~13 characters at `labelFontSize`) starts a second **column** beside the
  first rather than a second row below it — the label grows *inward across* the tile,
  never off its top. `MAX_LABEL_LINES` (3) caps that via `max-width`; past it the
  remainder is clipped, which only 64-char user deck names reach. Callers pass the
  plain name and never pre-break it.
- **The label is pinned top AND bottom, never `top: 50%` + a translate.** The line
  length *is* the box's height here, and an absolutely-positioned box given only
  `top` gets just the space below that offset as its inline size — at 50% every
  label wrapped at half the face ("ALL CARDS" took two columns) and the translate
  that re-centered it gave none of the space back. With both offsets set,
  `text-align: center` does the centering, since it aligns along the inline axis.
- **The count and the icon yield the label's column.** `estimateLabelLines()` guesses
  the wrapped line count from the text (a word-aware character estimate, `CHAR_ADVANCE_EM`)
  and both elements reserve `lines × SIZING.labelLineColumn` (12px per line) on the
  right. It is an estimate on purpose — measuring the rendered label would cost a
  layout pass per tile to move a few pixels of padding, and being one line out only
  shifts the count slightly off-center, never under the letters.

Because the tile wraps after the first word that doesn't fit, the three Mastered
collections are named **"Mastered Cards" / "Mastered Reading" / "Mastered Writing"**
(`MASTERED_TITLES`, `collectionRef.ts`) — one word order for all three, so every
Mastered tile breaks to the same shape: MASTERED, then what was mastered. The
reading/writing names previously read the other way round.

### The icon in the middle of the face

The count used to be big and centered; it is now a corner stat, and the middle of the
face belongs to a **glyph naming the set** — which is what tells two tiles of the same
color apart at a glance, and what makes an unfamiliar deck readable before its sideways
name is. It is a 30px `@mui/icons-material` outlined element rendered at
`opacity: 0.38` (`SIZING.iconSize` / `iconOpacity`), inset on the right by the label's
column so a wide glyph centers in the space actually left to it.

**The tile does not choose it.** `icon` is a prop, because picking a glyph needs to
know what collections, mastery bars and decks are — exactly the knowledge `DeckTile` is
built not to have. There are two maps, one per surface:

| Surface | Map | Icons |
|---|---|---|
| fdp collections + decks | `collectionIcon(ref)`, `src/features/flashcards/collectionIcon.tsx` | all → `StyleOutlined` (a card stack), learn-now → `SchoolOutlined`, mastered/core → `EmojiEventsOutlined`, mastered/reading → `MenuBookOutlined`, mastered/writing → `EditOutlined`, deck → `FolderOutlined` |
| Account utcm bands | `BUCKET_ICONS`, `src/components/DeckBuckets.tsx` | Unfamiliar → `HelpOutline`, Target → `Adjust`, Comfortable → `CheckCircleOutline`, Mastered → `EmojiEventsOutlined` |

`collectionIcon` lives beside the fdp rather than in `builtinCollections.ts` because
that module is the shared list of *which* collections exist — the Games hub selector
reads it too and draws a color dot, not an icon — and it deliberately owns no
presentation. It switches exhaustively over `CollectionRef`, so a fifth kind of
collection is a type error rather than a silently icon-less tile. The Account map is
separate because `components/` may not import from `features/`
([FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)) and because a utcm band is a card
property, not a collection; the two maps share exactly one glyph on purpose — the
trophy, so "mastered" looks like one idea on both pages.

The three Mastered tiles take the icon of the **skill** mastered (trophy / open book /
pencil) rather than three identical trophies, which would defeat the point of having a
glyph at all.

### One tile, two sizes, one design

The tile's natural size is **100 × 146** (`SIZING` in `DeckTile.tsx`), chosen so three
of them **fill the fdp's row**: the page's content column is 337px (a 393px frame less
the 28px gutter its section headings use), and 3 × 100 + 2 × 18px of gap is 336, so the
row's outer edges land on the headings above it. `TILE_WIDTH` in
`DecksSheetBody.tsx` must stay equal to `SIZING.cardWidth` — `ROW_MAX_WIDTH` is
derived from it, and a mismatch either pushes the third tile onto its own line or lets
a fourth up.

The Account row still renders the tile at **≈71.5px** (four across in a 350px-capped
section, where it flex-shrinks). Two sizes on two pages used to be drift worth fixing;
it isn't any more, because **every interior size scales with the rendered width**:

- The tile declares `container-type: inline-size`, and the count, icon, label, stack
  offsets and corner radii are all authored in `SIZING` against `REFERENCE_WIDTH` (72)
  and emitted as `cqw` by the `scaled()` helper. A 100px tile is the 72px one enlarged,
  not a second design with the same furniture at a different scale.
- `REFERENCE_WIDTH` is 72 **because that is what the Account row renders**, so that row
  is pixel-for-pixel unchanged by the fdp's resize. Change the reference only if you
  want to move both pages at once.
- It is `inline-size`, never `size`. `size` containment additionally makes the height
  self-contained, which is what broke the hub cards
  ([HUB_MENU_SYSTEM.md § Edge label slot](./HUB_MENU_SYSTEM.md)). Nothing here fits
  text to its own length — the whole tile scales as one piece.
- `estimateLabelLines()` works in reference units for the same reason, and its answer
  is scale-invariant.

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

* `VocabCardDetailPage.tsx` — the cdp header actions, beside Edit and Delete (icon)
* `InfoCardActionBar.tsx` — the "Add to Deck…" button in the action bar at the end of
  the **eip definition tab** (labelled). It used to live in the eip *header*'s action
  grid as a bare icon; it moved so the action reads as a named button rather than a
  guessed-at glyph.

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
| §3 Games-hub selector | `src/features/flashcards/selectedCollection.ts`; `src/games/GamesCollectionSelector.tsx`; `src/games/GamesPage.tsx` (`launchPath`); `src/games/word-search/WordSearchHubItem.tsx` (`newGamePath`); `src/api/decks.ts` (`fetchDecks`) |
| §4 Client | `src/api/decks.ts`, `collectionRef.ts`, `useLaunchCollection.ts`, `CollectionViewPage.tsx`, `FlashcardsDecksPage.tsx`, `DecksSheetBody.tsx`, `AddToDeckMenu.tsx`, `routes/routeMeta.ts`, `routes/registry.ts` |
| §4 Tiles & built-in collections | `src/components/DeckTile.tsx` (+ `DeckBuckets.tsx`, its other host); `src/utils/categoryColors.ts` (`BAND_COLORS.All`, `LEARN_NOW_COLORS`, `MASTERY_BAR_COLORS`); `src/features/flashcards/builtinCollections.ts` (`builtinCollectionEntries`, `hasMasteredSection`, `builtinCollectionCount`); `collectionRef.ts` (`deckTileColors`, `MASTERED_TITLES`, `builtinCollectionRef`, `builtinCollectionId`); `server/dal/shared/vetTable.ts` (`BUILTIN_COLLECTION_IDS`, `parseBuiltinCollectionId`, `builtinCollectionClause`); `server/contracts/wire.ts` (`ALL_COLLECTION_ID`, `MASTERED_COLLECTION_IDS`, `masteredCollectionBar`); `OnDeckVocabService.getBuiltinCollectionCards` + `getMasteredCountsByBar`; `OnDeckVocabController.getCollectionCards` + `getMasteredCounts`; `routes/onDeckRoutes.ts`; `src/hooks/useMasteredCounts.ts` |
| §1 `editMode` + §4 Challenges section | [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) §§ 4, 9; `database/migrations/148-create-study-challenges.sql`; `DeckService` → `assertMutable` (the preset mutation guard) and `createPresetDeck`; `DeckDAL` → `createPresetDeck` / `countCustomDecks` / `findDeckEditMode`; `study_challenges.presetDeckIds` |
| §4 Sort by | `src/utils/vocabSort.ts` + `src/__tests__/vocabSort.test.ts`; `CollectionViewPage.tsx` (the sort row + `visibleEntries` memo); `src/utils/definitionUtils.ts` (`resolveDisplayDefinition`, `resolveDisplayPronunciation`); `server/contracts/mastery.ts` (`barProgressBarHeight`, `activeBars`, `masteredAtForBar`); `database/migrations/142-add-mastered-at-to-vocabentries.sql`, `143-three-mastery-bars.sql`; `OnDeckVocabService.getDeckCards` (`deckAddedAt`) |

Related docs: [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (small-deck top-up),
[GAMES_FEATURE.md](./GAMES_FEATURE.md) (launch params),
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (node pages),
[MASTERY_REWORK.md](./MASTERY_REWORK.md) (the three mastery bars the Mastered
collections filter on),
`database/migrations/143-three-mastery-bars.sql` (on prod since 2026-08-11).

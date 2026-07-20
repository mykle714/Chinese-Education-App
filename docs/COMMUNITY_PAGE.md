# Community Page — Shareable Advanced Card-Icon Layouts

> Status: **implemented**. Backed by migration 86 (`community_layout_votes`), the
> `/api/community/*` endpoints, and the `src/pages/CommunityPage/` UI. Reached from the Home
> hub (`/community`).

## What it is

A discovery surface where learners browse, upvote, and copy **advanced card-icon layouts**
(the per-word icon arrangements from [CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md)) that *other*
users have saved. The page (`CommunityPage.tsx`, a Home-hub `NodePage`) has a search bar
(`CommunitySearchBar`) above two horizontally-scrolling, infinitely-paginated feeds:

1. **"For words you're learning"** — other users' advanced layouts for words in the viewer's
   **non-mastered library** (`starterPackBucket = 'library'` and category ≠ `Mastered`).
   Returned in random order, a page (10) at a time.
2. **"Top designs this week"** — advanced layouts across all other users, ranked by this-week
   vote count (descending, stable `(ownerUserId, entryKey)` tiebreak). Designs with zero votes
   this week are still included; they sort to the bottom of the feed.

All three (the two feeds and the search bar's per-entry rows) share the same tap→zoom→vote/apply
flow.

### Search bar (feed 3 — per-entry designs)

`CommunitySearchBar.tsx` shares its search behavior with `DictionaryPage.tsx` via the
`useDictionarySearch` hook (`src/hooks/useDictionarySearch.ts`): a 400ms-debounced input,
CJK-segment mode (`GET /api/dictionary/segment`) for multi-character Chinese input, and plain
`GET /api/dictionary/search` otherwise — including numbered-pinyin queries like "jian4 shen1"
(`buildNumberedPinyinPattern` in `server/dal/implementations/DictionaryDAL.ts`; see
[DICTIONARY_NUMBERED_PINYIN_SEARCH.md](./DICTIONARY_NUMBERED_PINYIN_SEARCH.md)).
Instead of rendering dictionary-entry cards, each matched `DictionaryEntry` heads a
`CommunityFeedRow` scoped to that one word (`entryKey = word1`) via `POST
/api/community/entry-feed` — "highest rated designs for this entry," ranked by this-week votes
the same way as the Top feed. An entry with no shared designs still renders, with
`CommunityFeedRow`'s empty-hint. While the search term is non-empty
(`CommunityPage`'s `searchActive`), the two default feeds are hidden so the search results are
the whole page.

## Key concepts

- **A "design"** is identified by its owner's vet row: **`(ownerUserId, entryKey, language)`** —
  one user's saved layout on one word. Votes and apply reference this logical identity (not the vet
  row's numeric id) so a tally survives the row being edited/re-saved/recreated.
- **Authorship + duplicate suppression** (migration 119, `author` uuid on both vet tables).
  Applying a design *copies* the jsonb onto the viewer's row, so one piece of artwork ends up on
  many users' cards and, without help, appears as many identical feed tiles. `author` records who
  DESIGNED the layout currently sitting in `iconLayout`, and travels with the artwork:
  - the icon editor self-attributes on save, **but only when the layout actually changed**
    (`author = CASE WHEN "iconLayout" IS DISTINCT FROM <new> THEN <saver> ELSE author END` in
    `VocabEntryDAL.updateIconLayout`) — an untouched re-save of a copied design keeps crediting
    the original designer; editing it makes the editor the new author;
  - the apply path passes the source row's author explicitly, so a copy-of-a-copy still credits
    the original, never the intermediate sharer;
  - a save whose layout is **not advanced** clears `author` to NULL (it is no longer a design);
  - NULL = unattributed (all pre-119 rows). Every read uses `COALESCE(author, "userId")`
    (`AUTHOR_OF_VE` in `CommunityLayoutDAL`), i.e. "assume self-authored", so no backfill is needed.

  A **DESIGN's** identity for display purposes is therefore
  **`(authorUserId, entryKey, iconLayout)`** — plain jsonb equality on the layout, which is
  key-order-independent. The feeds keep only one row per such group (`dupRank`, a
  `ROW_NUMBER()` window preferring the row whose owner *is* the author), credit
  `authorName`, and additionally drop any design the **viewer** authored
  (`COALESCE(ve.author, ve."userId") <> viewer`) so your own work is not sold back to you
  through someone else's copy.
- **"Advanced"** = `isAdvancedLayout(iconLayout)` — 2+ icons, OR a single icon that's been
  moved/resized/rotated/mirrored. Because the editor persists exactly the active draft and basic
  mode always writes a single **default-placed** icon, this geometric test equals "saved while in
  advanced mode": designs the owner sees in *basic* mode are correctly excluded. The check exists
  in two mirrored forms — SQL (`IS_ADVANCED_LAYOUT`) and JS (`isAdvancedLayout`), both in
  `server/dal/shared/advancedLayout.ts`, mirroring the client
  `src/cardIcons/cardIconLayout.ts` (`isAdvancedLayout`/`isDefaultPlacement`,
  constants `x=0.5, y ∈ {≈0.34624 grid-aligned, 0.3333 legacy}, scale∈{1.25,1.2,1}, rotation=0, !flipX`).
- **Sharing is automatic** — every advanced layout is eligible; there is no opt-in flag/column.
- **"This week"** = most-recent **Sunday 04:00 in the viewer's local timezone**, the same
  boundary the wins/weeklies system uses. The expression is shared at
  `server/dal/shared/weekBoundary.ts` (`WEEK_BOUNDARY`), imported by both `WinsDAL` and
  `CommunityLayoutDAL`. Queries that reference it must `JOIN users u` so the timezone is in scope.

## Interactions

- **Thumbnail** (`CommunityDesignCard.tsx`) — the preview is the **same `MiniVocabCard`** the
  /decks page renders (identical color + information layout), fed a `VocabEntry` adapted from the
  design. Below it: the owner's name and the inline vote toggle.
- **Zoom** (`CommunityDesignZoom.tsx`) — tapping a thumbnail opens a floating enlarged card over
  a dark backdrop scrim (transparent MUI `Dialog`, mirroring the writing-practice popup chrome),
  with no explicit close control — a tap on the greyed background dismisses. The enlarged card
  (`CommunityCardView.tsx`) lays out its information **exactly like the flp flashcard's back
  (second) face** — reusing `ChineseBlock`/`EnglishBlock` from `FlashCardSection.tsx` in the same
  lower-third geometry, with the icon arrangement behind. A floating toolbar below holds the vote
  toggle + the apply button.
- **Thumbnail attribution + inline vote** — each feed thumbnail (`CommunityDesignCard.tsx`) shows
  the **author's name** (`authorName`, falling back to `ownerName` when the author's account is
  gone) and an inline **upvote button** below the preview, so a design can be voted without opening
  the zoom. The zoom credits the same name.
- **Upvote toggle** — the shared `VoteButton.tsx` (used by both the thumbnail and the zoom
  toolbar) is a **toggle**: tap to vote (`POST /vote`), tap again to unvote (`POST /unvote`), once
  per design per week. **Color encodes state — GREY = not voted, COLORED (blue) = voted.** Design
  previews always render in full color (the vote state lives on the button, not by dimming the
  card). The client learns its voted set from `GET /api/community/my-votes` on load; `votedKeys`
  is lifted to `CommunityPage` so a toggle in either feed reflects on the button in both.
  **Both the voted state and the count are parent-owned shared stores** (a design can appear in
  more than one row simultaneously — e.g. both feeds, or a search row): alongside `votedKeys`,
  `CommunityPage` holds `voteDeltas` (a `designKey → net ±1` map) threaded through the same
  channels. `VoteButton` is fully controlled — `voted` from `votedKeys`, count from
  `design.voteCountThisWeek + voteDeltas[key]` — and `toggle` updates both stores optimistically
  via `onVoteChange(design, next)` (reverting with the inverse call on failure), so voting on one
  instance updates every duplicate at once. Only a transient `pending` double-tap guard stays local.
  (Before `voteDeltas`, the count lived in each `VoteButton`'s local state, so a vote left duplicate
  cards in other rows coloured-but-stale.)
- **Apply toast** — a successful apply shows a top-center "Added!" / "Added card & design!"
  success `Snackbar` (mirrors the dictionary add-to-library flow).
- **Apply** (`ApplyDesignButton.tsx`, the **single shared component** used by both feeds) — copies
  the design's `iconLayout` onto the viewer's card. Label flips on `design.inLibrary`:
  - owns the word → **"Add design to card"**
  - doesn't own it (feed 2) → **"Add card & design"** (adds the card to the library first)
  - if the viewer already has an **advanced** design on that card, the server returns
    `would-override` and the button shows a confirm dialog before re-applying with `override=true`.

## Data model

New table **`community_layout_votes`** — migration
`database/migrations/86-create-community-layout-votes-table.sql`. Append-only upvote log (one row
per cast vote), NOT a per-design counter:

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `voterUserId` | uuid → users (CASCADE) | who voted |
| `ownerUserId` | uuid → users (CASCADE) | the owner of the voted row (votes stay row-keyed, not author-keyed) |
| `entryKey` | varchar | the voted word (vet identity) |
| `language` | varchar(8) | `zh` \| `es` |
| `votedAt` | timestamptz default now() | week filter / tiebreak |

Indexes: `(ownerUserId, entryKey, language, votedAt)` for the per-design tally;
`(voterUserId, votedAt)` for "my votes this week" + the once-a-week guard. **No unique
constraint** — the once-per-week rule is time-windowed (a UNIQUE would block legitimate
next-week votes), so it is enforced in the DAL's `recordVote` (insert-iff-not-exists-since-the
-boundary).

### `author` column (migration 119)

`database/migrations/119-add-author-to-vocabentries.sql` adds to **both** `vocabentries_zh` and
`vocabentries_es`:

| Column | Type | Notes |
|---|---|---|
| `author` | uuid → users(id) **ON DELETE SET NULL** | who designed the layout in `iconLayout`; NULL = unattributed/legacy. SET NULL (not CASCADE) so deleting the author never deletes a learner's card. |

Indexed per table (`idx_vocabentries_{zh,es}_author`) for the feed dedupe grouping.

## Layers

| Layer | File | Responsibility |
|---|---|---|
| Migration | `database/migrations/86-*.sql` | the votes table |
| Migration | `database/migrations/119-*.sql` | `author` on both vet tables (design attribution + dedupe key) |
| Shared SQL | `server/dal/shared/weekBoundary.ts`, `advancedLayout.ts` | `WEEK_BOUNDARY`, `IS_ADVANCED_LAYOUT` + JS `isAdvancedLayout` |
| DAL | `server/dal/implementations/CommunityLayoutDAL.ts` (`ICommunityLayoutDAL`) | feed reads (via `vetReadFrom` + `DICT_JOIN`), duplicate suppression (`AUTHOR_OF_VE`, `AUTHOR_JOIN`, `dupRank`, `excludeClause`), vote log, `findViewerEntry`, `getDesignLayout` (returns layout **+ author**), `getDesignsForEntry` |
| DAL (write) | `server/dal/implementations/VocabEntryDAL.ts` `updateIconLayout` | the `author` tri-state: id = force, `null` = clear, omitted = self-attribute iff the layout changed |
| Service | `server/services/CommunityLayoutService.ts` | once-a-week vote guard delegation; `applyDesign` (reuses `VocabEntryService.addToLibrary` + `updateIconLayout`) |
| Controller | `server/controllers/CommunityLayoutController.ts` | request parsing (exclude arrays, page clamp, language resolution) |
| Routes | `server/routes/gamesRoutes.ts` (`/api/community/*`); wired in `server/dal/setup.ts` | |
| Types | `server/types/community.ts`, client `src/types.ts` (`CommunityDesign`, `VotedDesignKey`, `VoteResult`, `ApplyDesignResult`, `designKey`) | |
| Client | `src/pages/CommunityPage/` — `CommunityPage`, `CommunitySearchBar`, `CommunityFeedRow`, `CommunityDesignCard`, `CommunityDesignZoom`, `ApplyDesignButton`, `VoteButton`, `CommunityCardView`, `communityApi.ts` | |
| Menu/route | `src/pages/HomePage.tsx` (`community` HubMenuRow), `src/App.tsx` (`/community`) | |

The read-only design render (`CommunityCardView.tsx`) reuses the same `CardIconLayer` + cpcd
(`ForeignText`) plumbing as `MiniVocabCard`, sized small for the thumbnail and large for the zoom.

## API (server)

All `authenticateToken`. Feeds are **POST** so the growing exclude lists aren't bound by URL
length. `excludeAuthors`/`excludeKeys` are parallel arrays of already-shown `(authorUserId,
entryKey)` pairs (the no-duplicates contract) — keyed on the **author**, not the row owner, so once
a design has been shown every other user's copy of it is excluded from later pages too (`dupRank`
alone only dedupes *within* a page). The trade-off: a same-author/same-word row carrying a
genuinely different layout is also skipped on later pages. `language` defaults to the user's study
language.

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/community/learning-feed` | `{ language?, excludeAuthors[], excludeKeys[], limit? }` | `{ designs: CommunityDesign[] }` |
| `POST /api/community/top-feed` | `{ language?, excludeAuthors[], excludeKeys[], limit? }` | `{ designs: CommunityDesign[] }` |
| `POST /api/community/entry-feed` | `{ entryKey, language?, excludeAuthors[], excludeKeys[], limit? }` | `{ designs: CommunityDesign[] }` |
| `GET  /api/community/my-votes` | — | `{ votes: VotedDesignKey[] }` |
| `POST /api/community/vote` | `{ ownerUserId, entryKey, language? }` | `{ result: 'recorded' \| 'already-voted' }` |
| `POST /api/community/unvote` | `{ ownerUserId, entryKey, language? }` | `{ removed: boolean }` (deletes this week's vote) |
| `POST /api/community/apply-design` | `{ ownerUserId, entryKey, language?, override? }` | `{ result: 'applied' \| 'added-and-applied' \| 'would-override' }` |

`limit` is clamped to `[1, 30]` (default 10). Feeds exclude the viewer's own rows
(`ve."userId" <> viewer`) **and** anything the viewer authored
(`COALESCE(ve.author, ve."userId") <> viewer`). Each `CommunityDesign` carries `authorUserId` +
`authorName` alongside `ownerUserId`/`ownerName`; the internal `dupRank` window value is stripped
in `normalize` and is never part of the API shape.

## Dependencies / cross-references

- Advanced layouts + the `iconLayout` jsonb: [CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md)
  (migration 82). Apply reuses its `PATCH …/icon-layout` service path
  (`VocabEntryService.updateIconLayout`).
- Add-to-library flow: `VocabEntryService.addToLibrary` (`server/services/VocabEntryService.ts`).
- Week boundary origin (wins/weeklies): `server/dal/implementations/WinsDAL.ts`,
  [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md).
- vet→det read plumbing: `server/dal/shared/vetTable.ts`, `server/dal/shared/dictJoin.ts`.
- Home-hub drill-in archetype (NodePage) + floating-popup chrome:
  [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md), the writing-practice popup
  (`src/components/handwriting/PracticeWritingPopup.tsx`).
- Multi-language vet scoping: [MULTI_LANGUAGE_IMPLEMENTATION.md](./MULTI_LANGUAGE_IMPLEMENTATION.md).

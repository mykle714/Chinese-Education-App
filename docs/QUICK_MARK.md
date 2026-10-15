# Quick Mark — bulk card triage grid

> ↑ Part of [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) → [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).
>
> STATUS: **IMPLEMENTED.** All open questions resolved (see §9). This doc describes
> the shipped structure.

## 1. What it is

**Quick Mark** is the **second** Discover-hub activity (after Sort Cards). Where
Sort Cards is a slow, one-pack-at-a-time drag flow, Quick Mark is a **fast bulk
triage grid**: the user picks a difficulty level, sees every not-yet-sorted
discoverable word at that level as a wall of mini cards ordered by conversation-frequency
score, and **swipes** each card — left = Add to Learn Now, right = Mastered. Every
swipe saves on its own; the card flies off and the grid closes up behind it.

It reuses the exact same two bucket effects as Sort Cards (§4) — through the very
same per-card `sortCard` / `undoSort` endpoints — so it introduces **no new persistence** — same vet rows, same `starterPackBucket`, same
`already-learned → Mastered` history trick.

### Route / navigation

| Route                             | Component        | Page type                         | Footer        |
| --------------------------------- | ---------------- | --------------------------------- | ------------- |
| `/discover/quick-mark/:language`  | `QuickMarkPage`  | `NodePage` (← back → `/discover`) | Floating pill |

`useDiscoverNavigation` (`src/hooks/useDiscoverNavigation.ts`) exposes
`quickMarkPath` / `goToQuickMark()`, language-keyed exactly like `sortPath`. The
route is registered in `src/App.tsx`. `DiscoverPage` (`src/features/discover/DiscoverPage.tsx`)
renders the `HubMenuRow` as the **second** row — between Sort Cards and Skipped Cards
(purple `COLORS.purpleAccent`, `PlaylistAddCheckIcon`).

## 2. Page layout (top → bottom)

```
NodePage header:  ← back        Quick Mark                        🔥
────────────────────────────────────────────────────────────────────
Level bar:                    [ HSK 3 ▾ ]          (dropdown, no Auto)
Legend:              ← ● Learn Now     ● Mastered →
────────────────────────────────────────────────────────────────────
                       ┌────┐  ┌────┐  ┌────┐
                       │card│  │card│  │card│      ← MiniVocabCardGrid
                       └────┘  └────┘  └────┘        (3-wide, cascade 15)
                       ┌────┐  ┌────┐  ┌────┐
                          … scrolls …
                 [ 学习 → Mastered        undo ]   ← toast after each swipe
```

- **Header**: no extra actions — there is nothing to Save or Clear, because each swipe
  commits on its own (§6). The `MinutePointsFireBadge` is `PageHeader`'s own.
- **Level bar**: the same HSK/difficulty `Chip`+`Menu` dropdown as
  `SortCardsPage` (`src/features/discover/SortCardsPage.tsx`) **minus the `Auto`
  menu item** — Quick Mark is always a concrete level. Label is `HSK N` for zh,
  `Level N` otherwise (`difficultyLabel`).
- **Legend** (`QuickMarkPage.tsx` → `LegendItem`): the two swipe directions, each with a
  dot in its destination colour (§3).
- **Grid**: `MiniVocabCardGrid` (`src/components/MiniVocabCardGrid.tsx`) — the
  same 364px 3-wide wrapping grid used by the `/decks` Learn Now preview and
  `/flashcards/mastered`, in its `staggerReveal` mode: the first 15 cards fan in
  via per-card animation delay, the rest render with no entrance animation.

## 3. The swipe

Each card is a `QuickMarkCard` (`src/components/QuickMarkCard.tsx`): the shared
`MiniCard` with the frequency badge top-left (`MiniCardFrequencyBadge` — the word's
`frequencyScore`, 1 = literary … 5 = natural colloquial). No mastery strip: these words
are not the learner's cards yet.

| Gesture | Effect |
| ------- | ------ |
| Swipe **left**  | **Add to Learn Now** — bucket `library` → core band Unfamiliar |
| Swipe **right** | **Mastered** — bucket `already-learned` → core band Mastered |
| Tap | Opens the eip for the word (det lookup first — §3a) |
| Vertical drag | Scrolls the page, even when it starts on a card |
| No action | The card is left alone (no vet row) — the old "Skip" state |

Right = "I already know it" mirrors the Reading Center's right = "I could read it".
The direction → bucket / colour / label tables live in
`src/components/quickMarkSwipe.ts` (`QUICK_MARK_BUCKET`, `QUICK_MARK_COLOR`,
`QUICK_MARK_LABEL`), shared by the card, the legend and the toast so they can never
disagree.

**Feedback while dragging — colour only, no overlay or label.** The card follows the
finger with a slight tilt, and its own fill blends (`color-mix`) toward the colour of the
**collection it joins**, reaching it in full at the commit distance: left = Learn Now
gold (`LEARN_NOW_COLORS.main`), right = the core bar's Mastered blue
(`MASTERY_BAR_COLORS.core.main`) — the same surfaces the fdp draws those collections
with (`src/utils/categoryColors.ts`). Release past `QUICK_MARK_COMMIT_PX` (60px, about
two-thirds of the 92px card) or flick it, and it flies off (`CARD_FLY_OUT_MS`, fading)
still filled with that colour; short of that it snaps back to its resting fill.

**The drag is painted imperatively** (`quickMarkSwipe.ts` → `paintQuickMarkDrag`, passed
as `useSwipeCommit`'s `paint`): at most once per animation frame it writes the swipe
layer's transform, the face's fill and the card's z-index straight to the DOM, and on
release it drops those inline styles so the card's React styles (snap-back transition,
or the committed fly-off) take over. React never renders mid-drag. This is a
performance requirement, not a style choice — the first version kept the drag offset in
React state, and every pointermove re-rendered the page and the grid's full ~100-card
list, which made the page visibly laggy. Likewise no card sets `will-change`: on a
~100-card grid it would promote ~100 compositor layers up front.

**The gesture** is the shared `src/hooks/useSwipeCommit.ts` → `useSwipeCommit` (also
behind the Reading Center's swipe grid — [READING_WRITING_CENTERS.md](./READING_WRITING_CENTERS.md)),
run with `axisLock: true`:

- every card carries `touch-action: pan-y`, so the browser keeps native vertical
  panning — a vertical drag scrolls and the browser sends `pointercancel`, which never
  commits;
- the hook additionally decides the axis after 8px of travel: mostly-vertical abandons
  the gesture (the card never moves — this is what makes a MOUSE drag behave), mostly-
  horizontal locks it and captures the pointer;
- one hook instance serves the whole grid; its handlers are referentially stable and
  each card carries `data-swipe-id`, so the `memo`'d cards re-render only when their own
  `leaving` / eip-spinner state changes.

**Three nested layers, one transform each** (`QuickMarkCard`): the outer flex item is
the gesture target and the element `useScrollStretch` writes its row-spread transform
onto; an inner `quick-mark-card__swipe-layer` carries the drag/fly-off transform; the
`MiniCard` inside keeps its own pop-in keyframe. Collapsing any two would make one
transform overwrite the other.

### 3a. The eip (tap)

A `DiscoverCard` is not a `VocabEntry`, so a tap looks the word up in det first
(`lookupVocabEntry`) and seeds the eip's root tab with the result — the same path as
the scp's card-info button (`SortCardsPage.tsx` → `handleOpenCardInfo`). One lookup at a
time; a slow one shows a small spinner on the card (`DelayedCircularProgress`, 1s
delay); a failed one is logged and otherwise silent. The click that ends a drag is not
a tap (`useSwipeCommit` → `wasDrag`). Rendered by the shared
`FlashcardsLearnPage/EipSheet.tsx`, whose scrim blocks swiping while it is up.

## 4. Persistence — reuses Sort Cards' buckets verbatim

No new tables/columns. Both destinations already exist in
`StarterPacksService.sortCard` (`server/services/StarterPacksService.ts`):

| Quick Mark swipe | Internal bucket    | Effect                                                          |
| ---------------- | ------------------ | -------------------------------------------------------------- |
| ← left           | `library`          | upsert vet row, empty history → core band `Unfamiliar` |
| → right          | `already-learned`  | upsert vet row + 8/8 on the **core** tracks (reading/writing stay 0) → core band `Mastered` |

Because both write a vet row, and the supply query excludes any word the user
has a vet row for (`_fetchSupplyRows` `NOT EXISTS (vet …)`,
`StarterPacksService.ts`), **cards already in the user's library/mastered
never appear in Quick Mark** — satisfying the "never override progress the user
already made" requirement automatically. (A swiped card leaves the grid at once — §6 — and
the same exclusion keeps it out of every later page.)

Undo (§6) is the only way a vet row created here is removed again — through the
existing `undoSort`, the same reversal Sort Cards uses.

## 5. Supply query

Service method `listQuickMarkCards(language, userId, level, cursor, limit=100)`
(`server/services/StarterPacksService.ts`):

- `WHERE de.language = $1 AND <supplyGate> AND <validPredicate>` — the supply gate is
  `_supplyGate()`: `de.discoverable = TRUE`, for every language (the zh-only `sortable`
  bar was retired by migration 144 — see docs/DISCOVER_FLOW.md § Card supply gate)
- `AND <levelExpr> = $level`  (exact level, no ±drift)
- `AND NOT EXISTS (vet row for this user/word[/pos])`  — excludes already-sorted
- **Skips are INCLUDED** (resolved): unlike Sort Cards' fresh supply, Quick Mark
  does **not** add the `discover_skips` exclusion (`StarterPacksService.ts` `skipFilter`)
  — a skipped word still has no vet row and gets a second chance to be triaged here.
- `ORDER BY de."frequencyScore" DESC NULLS LAST, de.id ASC`

**Pagination is KEYSET, not offset** (this is a correctness requirement, not a
preference): each swipe creates a vet row, which drops the card out of this
vet-excluding result set. A numeric `OFFSET` would then skip that many
still-unsorted cards on the next page. Instead the client sends the last card's
`{ score, id }` as a cursor and the query resumes strictly after it on the stable sort
key — immune to rows removed above. The cursor is the last card **fetched**
(`QuickMarkPage.tsx` → `cursorRef`), not the last card on screen: swipes remove cards
from the list, and with the whole page swiped away there would be no card to read it
from. (When that happens the page fetches the next page directly — the infinite-scroll
sentinel lives inside the card list and is gone with it.) `cursorScore` may be empty (the trailing
NULL-`frequencyScore` block); the query switches to `(frequencyScore IS NULL AND
id > cursorId)` there. `hasMore` is probed by fetching `limit + 1`.

**Default level** (resolved): opening the page with no `level` seeds from the user's
adaptive frontier — reuses Sort Cards' cold-start `estimateLevel` (mastered/learning
vet counts) and returns it as `level` with the first page.

Returns `{ cards: DiscoverCard[], level, hasMore }` (`DiscoverCard`, `src/types.ts`).

## 6. Saving, undo, failure

- **Every swipe saves immediately**: `sortCard({ cardId, bucket, language, packId: null })`
  → `POST /api/starterPacks/sort` (`StarterPacksService.sortCard`, the lightweight
  pack-mode path — writes the vet row + clears any skip, no replacement-card compute).
  The card is removed from the grid when its fly-off ends (`QuickMarkPage.tsx` →
  `handleCommit` / `removeCard`); the cards after it **slide** up into the gap (§6a).
- **Undo toast**: each swipe shows `<word> → <destination>` with an **undo** action for
  `UNDO_TOAST_MS` (4s). Only the most recent swipe is undoable. Undo puts the card back
  at its old position at once, waits for that card's in-flight `sortCard` (so the delete
  cannot race ahead of the insert it reverses — `pendingSorts`), then calls `undoSort`
  (`POST /api/starterPacks/undo`), which deletes the vet row (or demotes a promoted
  provisional row). Clickaway does not close the toast — the next swipe replaces it.
- **Failure**: a failed `sortCard` puts the card back and shows "Couldn't save <word>";
  a failed `undoSort` removes the card again (it is still sorted on the server) and
  shows "Couldn't undo <word>". The grid never shows a card in a state the server
  doesn't hold.
- **After leaving the page**: sorted cards are gone from this flow for good (their vet row
  excludes them from every future fetch); undoing later means deleting the card from
  the decks.

### 6a. Gap fill — cards slide, nothing fades in

When a card leaves the grid (or an Undo puts one back), every card after it changes
slot. `MiniVocabCardGrid` is a plain flex-wrap, so a re-render alone would make them
jump. Instead (FLIP, `src/components/quickMarkSwipe.ts`):

1. `QuickMarkPage` → `removeCard` / `restoreCard` call `snapshotSlots` just before
   `setCards`, recording each card's slot (`snapshotCardSlots`, keyed by
   `data-swipe-id`). Slots are layout offsets (`offsetLeft/Top`), so `useScrollStretch`'s
   transform on the outer card never leaks in; a card still mid-slide (back-to-back
   swipes) is recorded where it is SEEN, so the next slide starts from there.
2. A `useLayoutEffect` on `cards` (it runs before the browser paints the jumped
   layout) calls `playCardSlotSlide`: each moved card's swipe layer is put back at its
   old slot untransitioned, a forced style flush commits that, then it is released to its
   new slot over 260ms. (Not a rAF: the trigger is a timer/click, so a rAF callback would
   run before the next style recalc and the slide would never be seen.)
3. A card under a finger is skipped, and a drag that starts mid-slide takes the card
   over (`paintQuickMarkDrag` clears its `data-slot-slide` token).

Two things make sure no card ever *appears* during the slide:

- **Cards near the screen are already drawn — and only those.** `QuickMarkCard`
  overrides `miniCardFaceSx`'s `content-visibility: auto` with `visible`, and the page
  runs a draw window (`quickMarkSwipe.ts` → `observeCardDrawWindow`, re-armed on every
  `cards` change): an IntersectionObserver on the scroll area with a margin of **two grid
  rows (`DRAW_MARGIN_PX` = 2 × 148px) above and below the screen**. Cards inside the band
  paint; cards beyond it get inline `content-visibility: hidden` (layout footprint kept by
  `contain-intrinsic-size`, so FLIP measurements are unaffected). A one-at-a-time swipe
  pulls cards up at most one row; the second row covers the observer's one-frame lag on a
  fast scroll. Cards default to drawn, so one not yet reported is never blank. The
  explicit margin replaces the browser's own `auto` margin, which each engine picks for
  itself.
- **The pop-in plays once, at mount.** The grid assigns `animationDelayMs` by list
  position (first 15 slots). `QuickMarkCard` freezes the value it mounted with
  (`mountDelayMs`), so a card shifting into slot 14 doesn't gain the animation and
  replay its pop-in. An Undo'd card is a fresh mount and does pop back in.

### Footer clearance

The page keeps the nav footer (it's registered in all three route gates —
`Layout.tsx` `isMobileDemoPage` mounts the phone frame + footer, `FooterPresenter`
`FOOTER_ROUTE_PREFIXES` picks the Discover tab, `pageTransition.ts` `NODE_PREFIXES`
gives the node-page horizontal slide). The grid renders an explicit `FooterSpacer`
below its cards (in the grid `footer` slot): the ScrollArea's bottom padding is not
honored at scroll-end in this flex + overflow-scroll layout, so without the in-flow
spacer the last card row overlaps the footer bar by ~50px.

## 7. Layer summary

| Layer            | Piece                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Route/nav        | `useDiscoverNavigation` (quickMarkPath), `App` route, `DiscoverPage` row |
| Page (view)      | `QuickMarkPage` (`NodePage` + level dropdown + legend + grid + undo toast + eip) |
| Component        | `QuickMarkCard` (mini card + frequency badge; at-rest / flying-off states), `quickMarkSwipe.ts` (direction tables + `paintQuickMarkDrag`) |
| Hook (shared)    | `useSwipeCommit` — the axis-locked swipe gesture                      |
| HTTP route       | `GET …/:language/quickMark`, `POST /api/starterPacks/sort`, `POST /api/starterPacks/undo` |
| Controller       | `StarterPacksController` (`getQuickMarkCards`, the shared sort/undo handlers) |
| Service          | `StarterPacksService.listQuickMarkCards`, `.sortCard`, `.undoSort`    |
| DAL / DB         | **unchanged** — reuses vet rows + existing bucket effects              |

## 8. Referenced code

- `src/features/discover/QuickMarkPage.tsx` — the page (level dropdown, legend, grid, per-swipe save, undo toast, eip, keyset infinite scroll)
- `src/components/QuickMarkCard.tsx` + `src/components/quickMarkSwipe.ts` — the swipeable card + the direction → bucket/colour/label tables and the imperative drag painter
- `src/hooks/useSwipeCommit.ts` — the shared swipe gesture (axis lock, flick, tap slop)
- `src/components/MiniVocabCardGrid.tsx` — the shared grid; `renderCard` + `footer` + `staggerReveal` props added for Quick Mark. `staggerReveal` renders all cards at once and fans the first 15 in by a per-card animation-delay (instead of the paced batch reveal, which stepped as "3, then a batch, then the rest").
- `src/features/discover/starterPacksApi.ts` — `fetchQuickMarkPage`, `sortCard`, `undoSort`
- `server/services/StarterPacksService.ts` — `listQuickMarkCards`, `sortCard`, `undoSort`
- `server/controllers/StarterPacksController.ts` — `getQuickMarkCards`
- `server/routes/starterPacksRoutes.ts` — the Quick Mark list route
- `src/hooks/useDiscoverNavigation.ts`, `src/features/discover/DiscoverPage.tsx`, `src/App.tsx` — hub + route wiring
- `src/components/Layout.tsx` (`isMobileDemoPage`), `src/components/FooterPresenter.tsx`, `src/utils/pageTransition.ts` — the three route gates that give the page its phone frame, nav footer (Discover tab), and node-page slide
- `src/components/MobileFooter.tsx` `FooterSpacer` — the explicit bottom clearance the grid renders below its cards

### Dependency: the "already-learned" → Mastered write

Quick Mark's swipe-right path delegates to `sortCard`'s `already-learned` branch, which
seeds `coreMasteredTypedMarkHistory` so the card's **core** bar reads Mastered —
recognition + production at 8/8, reading and writing left at 0 (migration 143; see
[MASTERY_REWORK § "Declaring a card already known"](./MASTERY_REWORK.md)). That write
goes through `VocabEntryDAL.updateTypedMarkHistory` (`typedMarkHistory`, migration
101), NOT the old generated `category` / `markHistory`. Quick Mark inherits whatever
`sortCard` does here — this very change needed no Quick Mark code, which is the point
of the delegation.

## 9. Resolved decisions

| Question              | Decision                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| Grid volume           | **Paginate** — infinite scroll, ~100 rows/page (KEYSET cursor, `hasMore`) |
| Skipped words         | **Included** — no `discover_skips` exclusion; skips get a second triage   |
| Commit model          | **Per swipe, immediately** (2026-10-12; was a batched Save) + Undo toast for the last swipe |
| Swipe directions      | **Left = Learn Now, right = Mastered** (2026-10-12)                      |
| After a swipe         | **Fly off, grid closes up** (2026-10-12; was: stays in view, re-editable) |
| Tap                   | **Opens the eip** (2026-10-12; was: cycles the mark)                     |
| Default level         | **User's current level** — seed from Sort Cards' adaptive frontier estimate |
| New tables/columns    | **None** — reuses vet rows + existing `library`/`already-learned` effects |
</content>
</invoke>

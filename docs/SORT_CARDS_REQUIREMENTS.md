# Sort Cards (Discover) — Feature Requirements

This document defines **what** the Sort Cards flow must do and **why**. It is a
requirements document, not a design — it intentionally avoids prescribing *how* the
behavior is achieved (data structures, leveling mechanics, etc. are solution choices
made elsewhere). For where the flow lives in navigation, see
[DISCOVER_FLOW.md](./DISCOVER_FLOW.md).

---

## 1. Purpose

Sort Cards lets a user **build their library by triaging dictionary cards one at a
time**. The user is shown a single word card and decides what to do with it. Over a
session they pull the cards they want to learn into their library and set aside the
rest.

The flow is **primarily for a new user** — someone whose skill level the system does
**not yet know**. Its job is two-fold:

1. **Serve well-matched cards** so the user stays engaged.
2. **Learn the user's level** from how they sort, and continuously refine the cards
   it serves.

---

## 2. Why difficulty matching matters

A user's tolerance for mismatch is **asymmetric**:

| Cards shown | Novice user | Advanced user |
| --- | --- | --- |
| Too **easy** | Fine / reassuring | Mildly bored, but tolerant of a few |
| Too **hard** | **Demoralized — will quit** | Fine |

This asymmetry drives the core requirement:

- **Start at the lowest level.** Every user begins at the easiest level for that
  language. A novice will abandon the flow if hit with hard cards; an advanced user
  will patiently sort through a few easy ones. Easy-first is the safe default for an
  unknown user.
- **Never overshoot above the user's actual level.** Elevating the estimate past what
  the user actually knows is the failure mode to avoid above all others — once that
  happens, the user stops seeing cards at their real level and the flow can't recover
  on its own (§6.1 downgrade is the recovery path, but overshoot should be avoided in
  the first place, not relied on to be corrected after the fact).
- **Don't leave an advanced user stranded at a low level.** The estimate must climb
  fast enough that a genuinely advanced user reaches their real level in a reasonable
  number of sorts, not linger at the bottom for an extended session.

---

## 3. Per-language levels

- A user's skill level is **tracked independently per language**. A master of Chinese
  may be a complete novice in Spanish.
- Everything in this document (starting level, adaptation, matching) applies **within
  a single language** and must not leak across languages.

---

## 4. Core interaction requirements

### 4.1 One pack at a time
- The on-deck unit is a **sort pack**: **up to 4 cards** to sort (see §4.5), not a
  single bare card. No sentence is shown in this flow.
- The user sorts each card in the pack independently into one of the destinations
  (see §5). When **every** card in the pack has been sorted (or the pack is skipped),
  the next pack appears.
- **Pack entrance.** A pack landing on deck (first load, a level switch, or the next
  pack replacing a finished/skipped one) **slides up from the bottom edge of the
  screen**. Each whole `CardSlot` moves (header band + card + action row). The slots
  are staggered 60 ms apart in a **random order** that is drawn once per pack. Slots
  put back by **Undo** (§4.6) instead do a small 24 px rise + fade, so Undo reads as
  "put back" rather than as new content. The slot's transform is cleared to `none` at
  rest so it doesn't form a stacking context that would trap a dragged card's
  z-index under its neighbours.
  *Code:* `src/features/discover/SortCardsPage.tsx` → `EnteringCardSlot`,
  `SlotEntrance`, `DOCK_STAGGER_STEP_MS`, `dockDelays`, `undoRestoredPackKey`.
- **Pack exit.** When a pack advances, its slots (craters, any locked "sorted!" cards,
  header bands, action rows) **slide up and are clipped at the platform's top edge**.
  The new pack's entrance **waits for the exit to finish** (`dockDelays` adds
  `PACK_EXIT_MS`). The two motions are sequential, not overlapped. A pack completed by a
  **drop** starts its exit on release, alongside the card's fall into the bucket (§5.3
  "A drop falls into the bucket"); only the replenish request waits for the sort POST
  (`advancePack`'s `afterSorted`), which keeps `/next-pack` from re-serving the pack. The
  leaving slots are an inert copy rendered in `PackExitClip`. That clip is absolutely
  positioned over `OnDeckSection` with `overflow: hidden`, and clips only the overlay:
  the platform itself stays overflow-visible so dragged cards still reach the
  buckets. The exit plays only when a replacement pack is already buffered. With an
  empty buffer the page shows its spinner instead, and a deferred exit would play
  late. Undo clears a pack that is still leaving. Under `prefers-reduced-motion` there
  is no exit and no entrance.
  *Code:* `SortCardsPage.tsx` → `leavingPack`, `advancePack`, `PackExitClip`,
  `packExitKeyframes`, `PACK_EXIT_MS`, `cardsRowRef`.

### 4.2 The on-deck card is immutable
- **Once a card is shown, it must not change** while the user is considering it.
- A shown card disappears **only** when the **user sorts it** — never because of a
  background refetch, a level re-estimation, or any other asynchronous event.
- This is a hard requirement: any adaptive logic that recomputes the user's level
  must affect **future** cards only, never the card currently on deck.

### 4.3 No waiting for the next card
- After the user sorts a card, the next card must appear **immediately** — the user
  must never wait on the network.
- This requires the client to keep a small **queue** of cards ready ahead of the user
  (a minimum of **2** is acceptable: the on-deck card + at least one ready behind it),
  replenished **before** it empties so replenishment never blocks the user.

### 4.4 Always a card to sort
- The user must **always have a card to sort**, until they have sorted the **entire**
  dictionary for the language.
- Sorting an entire dictionary is functionally impossible in practice (the Chinese
  dictionary is far too large), so for design purposes **assume the user never runs
  out**. A literal "all cards sorted" terminal state is an edge case, not a normal
  outcome.

### 4.5 Sort packs (the on-deck unit)
A **sort pack** is a small group of vocabulary cards shown together:

- **Up to 4 cards, shown at once.** Up to four word cards are shown simultaneously,
  all draggable. The user may sort them in **any order** into any destination (§5). No
  sentence is displayed — earlier versions of this flow showed a sentence band above
  the cards; it was removed. `sort_packs` no longer carries an authored sentence either
  (migration 95 dropped `sentenceForeign`/`sentenceEnglish` — authoring a pack is just
  picking its up-to-4 `entryIds`, see docs/SORT_PACKS_IMPLEMENTATION.md §2/§6).
- **Two pack sources, one shape:**
  - **Authored packs** — hand-curated for a level, their up-to-4 cards chosen directly
    (no sentence). These are served first (§6.3).
  - **System fallback packs** — when no authored pack is available, the system serves
    a single word as a pack of **one**.
- **Already-sorted cards are locked.** A card already in the user's library (Add to
  Learn Now *or* Already Learned) appears **undraggable** with a **"sorted!"**
  watermark, so the user still sees the context but cannot re-sort it. A locked card is
  **greyed** (grey fill + grayscale filter) but keeps the same hairline ring and raised
  shadow as a live card — it is never drawn recessed. A pack in which
  **every** card is already sorted is **never served** — the system skips over it.
- **Previously-skipped cards reappear draggable inside authored packs.** If a card the
  user skipped is part of an authored pack, it is shown **draggable again** (not
  locked) — the pack's context is a fresh chance to sort it. Re-sorting it there clears
  its skip (§5.2).
- **Each card sits on a raised platform with a Commonality header + an action row below.**
  The on-deck zone (`OnDeckSection`) is styled as an elevated **platform** (plain white
  slab, rounded top, top-edge highlight, downward drop shadow) the cards rest on. Each
  card lives in a `CardSlot` column: a **header band** on top, the draggable card in the
  middle, and an **action row** (`CardActionRow`) of two icon buttons underneath.
    - **The card is the app's mini preview card.** `DraggableCard` renders the shared
      `MiniCard` (`src/components/MiniCard.tsx`) through react-spring's `animated()` —
      the same 92×132 tile (or its 78×112 **compact** face — see *Compact dock* below),
      icon slot, word, definition and hairline ring as the fdp,
      Quick Mark and challenge cards — with **no mastery strip** (these are words being
      triaged, not the learner's cards) and no corner frequency badge (the Commonality
      band above already shows it). The drop buckets are deliberately larger and keep
      their own size.
    - **Commonality header band** (`CardDeckHeader`). Each card carries its **own
      tier label** (`CommonalityTierLabel`, text from `COMMONALITY_TIER_LABELS`) over a
      row (`CommonalityMeterRow`) of the **five-dot frequency meter**
      (`FrequencyScoreDots`, `score` dots filled / rest hollow — the word's
      `frequencyScore`) beside an **"x/5"** numeric readout (`CommonalityScoreValue`).
      Rendered only when the entry has a score. Tier labels: 5 *Used all the time*,
      4 *Common*, 3 *Used sometimes*, 2 *Uncommon*, 1 *Rarely used* — display copy
      only, deliberately separate from the backfill's `FREQUENCY_SCORE_LABELS`
      (`server/scripts/backfill/shared/lib/frequencyLabels.js`), which feed the Spanish
      scoring prompt and are too long for a card slot. The label is **sentence case**
      (tracked caps would overflow a card-wide slot). Every multi-word label is split onto
      **two lines** by an embedded `\n` (*Used all / the time*, *Used / sometimes*,
      *Rarely / used*; rendered with `white-space: pre-line`), while single-word labels
      stay on one line. The box always reserves two lines and bottom-aligns the text — every card's meter row, and
      so every card face, stays on the same baseline. This is the per-card face of the
      register ordering the supply uses (§6.4). The band lives on the platform (a sibling
      above `CardShell`, not inside it), so it stays put while the card is dragged into a
      bucket. *(Replaced a single "Commonality" caption shown only over the middle card,
      and before that an old top-left circular numeric badge. The eip + cdp meters still
      use the "Commonality" caption + x/5 form.)*
      Code: `src/features/discover/SortCardsPage.tsx` → `CardDeckHeader`,
      `COMMONALITY_TIER_LABELS`, `CommonalityTierLabel`; `src/components/FrequencyScoreDots.tsx`.
    - **Play-audio button.** A `SpeakerButton` **below the card** that narrates just that
      card's word on tap (`handlePlayCardAudio` → `tts.speakSentence`); spins while that
      card is speaking (`tts.speakingKey === entryKey`). A tap **ends** any pack autoplay
      still in progress (`stopPackAutoplay`) so the next autoplay word can't cut the
      replay off; the eip's speaker buttons do the same (`handleEipSpeak`,
      `handleEipSpeakSentence`). See AUDIO_PLAYBACK.md § 4.
    - **Info button.** An `InfoOutlinedIcon` button beside the speaker
      (`.sort-cards__card-info-button`) that opens the **eip** for that card — see §4.7.
  Both buttons are MUI `size="small"` (32px).
    - **Card crater.** The card sits in a fixed well the size of its face (`CardWell`,
      92×132 or 78×112 compact) over a
      recessed **crater** (`CardCrater`: `COLORS.header` fill + `SHADOW.recessed`, the
      old already-sorted card look). The crater shows wherever the card is not: while
      it is being dragged, and after it is sorted or skipped this session. A resolved
      card's slot keeps its header band and action row around the crater (the buttons
      stay live), so neighbours don't reposition. The pack exit (§4.1) then carries
      the whole slot off. Undo re-showing a card in a slot that is still on deck pops
      it back into the crater (`DraggableCard` → `settleIn`).
      *Code:* `SortCardsPage.tsx` → `CardWell`, `CardCrater`, `renderSlotBody`;
      `src/theme/shadows.ts` → `SHADOW.recessed`.
- **Compact dock (4-card packs on narrow screens).** A pack is laid out on regular
  92×132 MiniCards whenever the whole row fits across the platform at that size, and on
  the **compact 78×112 face** only when it does not — **fit-to-width**, not a rule keyed
  on the card count (`dockCardSize`). In practice only a 4-card pack on a phone narrower
  than ~430px goes compact; a 1–3-card pack always fits and never shrinks. The decision
  is made **per pack** from the platform's measured width (`onDeckSectionRef`, a
  ResizeObserver), so a leaving 4-card pack keeps its compact face through its exit while
  a 3-card replacement rises in at regular size.
    - The compact face is a **real second geometry** of `MiniCard` (`size="compact"`),
      not a CSS scale of the regular one: the icon slot, word and definition re-lay for
      the smaller box and the type steps down one notch on the existing scales (cpcd
      `compact` 16px/9px, es plain text 12px, definition `SIZE.caption`), so no new font
      sizes are introduced. It is the **only** exception to "every mini card is 92×132";
      no other surface uses it.
    - The **held card lifts relative to its own face** (compact × `HELD_CARD_SCALE`), and
      the fall ghost is drawn at the dropped card's size (`FallingCard.size`).
    - The **header band and action row do not shrink** — the tier label, dot meter and
      32px buttons keep their sizes; only the gap between slots tightens (10 → 6px,
      `CARDS_ROW_GAP`).
  *Code:* `src/components/miniCardFace.ts` → `MINI_CARD_DIMENSIONS`, `MiniCardSize`;
  `src/components/MiniCard.tsx` → `CONTENT_LAYOUT`; `src/features/discover/SortCardsPage.tsx`
  → `dockCardSize`, `CARDS_ROW_GAP`, `CardsRow`, `CardWell`, `onDeckSectionRef`.
- **A pack is shown at most once.** Once the user has **finished** a pack (every card
  sorted) **or skipped** it, that pack never appears again — regardless of whether its
  cards were sorted or skipped. (This is the per-user "seen packs" record; it applies
  to authored packs. System fallback packs-of-1 are already de-duplicated by the
  individual card's sorted/skipped state.)

### 4.6 Undo
- The user can **undo** recent actions one at a time. An undoable **action** is a
  single card outcome: a card sorted into a destination, **or** a card skipped. A Skip
  press skips every remaining unsorted card in the pack, so it enqueues **one undoable
  action per card skipped** (both sorts and skips are undoable by the same mechanism).
- The **4** most recent card actions are undoable — exactly one full pack (a pack holds at most 4 cards; `UNDO_DEPTH = MAX_CARDS_PER_PACK` in `SortCardsPage.tsx`).
- Undo reverses exactly one action: it removes that card's library/skip record and
  **re-shows the card draggable**. If reversing it requires a pack that has already
  advanced off-deck (e.g. undoing a Skip), that pack is brought back on deck; if the
  action had marked the pack as **seen** (§4.5), undo clears that mark too.
- **Undo never destroys earned progress** (migration 140,
  [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md)). "Removes the library record" used to
  mean an unconditional `DELETE`. A card can now arrive at the sort flow *already
  carrying marks* — a provisional card the learner played in a game — so `undoSort`
  branches atomically in one CTE:
  - the row **has marks** → demote it back to `starterPackBucket = 'provisional'`. It
    leaves the deck, keeps its history, and stays in the discover supply so it can be
    re-sorted later with the progress intact. The response carries `demoted: true`.
  - the row **has no marks** → `DELETE`, exactly as before.

### 4.7 Extra info panel (eip) on an on-deck card

A learner should not have to guess from a two-line gloss which bucket a word belongs
in. The **info button** in each card's action row (§4.5) opens the **same eip bottom
sheet the flp uses** — not a reduced copy of it.

*Code: `src/features/discover/SortCardsPage.tsx` (`handleOpenCardInfo`, `handleCloseEip`,
the `<EipSheet>` mount); `src/api/dictionary.ts` (`lookupVocabEntry`);
`src/features/flashcards/FlashcardsLearnPage/{EipSheet,InfoCardSection,EipTabStrip,useEipTabs}`
— `EipSheet` is the shared host block scp, iw and the Reading Center all mount.
Gesture/height behavior of the sheet itself: [EIP_SHEET_GESTURES.md](./EIP_SHEET_GESTURES.md).*

- **Same components, no fork.** scp mounts `InfoCardSection` + `EipTabStrip` and drives
  them with `useEipTabs`, exactly as `FlashcardsLearnPage` does. Definition / example
  sentences / breakdown (or "used in") sub-tabs, drag-to-resize, drill-in tabs and
  Compare therefore all behave identically to the flp. This is the **first non-flp
  mount** of the eip; before this the sheet was flp-private and the read-only cdp was
  the only other "everything about this word" surface.
- **The card must be looked up first.** A `DiscoverCard` is *not* a `VocabEntry` — it
  carries no `definitionClusters`, `longDefinitionParts`, approval flags or `usedIn`.
  Tapping info therefore issues `GET /api/dictionary/lookup/:term?language=` via
  `lookupVocabEntry`, adapts the result (`dictionaryEntryToVocabEntry`) and seeds it as
  the panel's **root tab** (`openForRoot`), so the tab strip stays hidden until the user
  actually drills in. The tapped button shows a plain (non-delayed) `CircularProgress`
  while that request is in flight, and every info button is disabled meanwhile — one
  lookup at a time. A failed lookup logs and does nothing else: this is an optional
  detour, not a step the sort flow depends on.
- **`?language` is required here, unlike the flp.** scp's language comes from the route
  (`/discover/sort/:language`), which can differ from the account's `selectedLanguage`.
  `DictionaryController.lookupTerm` used to read *only* `selectedLanguage`, so a
  Chinese-selected account sorting Spanish would have resolved every lookup against
  `dictionaryentries_zh`. The endpoint now takes an **optional** `?language=zh|es`
  (`resolveWriteLanguage(req.query.language) ?? user.selectedLanguage`) — omitting it is
  the old behavior, which is what every other caller still relies on.
- **Opening the panel suspends sorting.** `SheetPanel`'s scrim covers the buckets and
  the on-deck cards, so no card can be dragged while the sheet is up. Reading about a
  word and sorting it are separate modes on purpose.
- **Closing KEEPS every tab** (2026-09-06). The trail belongs to the CARD, not to the
  panel, so reopening the panel on the same card resumes the drill-in chain on the word
  the learner was reading. What starts a clean trail is opening the panel on a
  **different** card — `openForRoot` reseeds whenever the root word changes — and leaving
  the page, which unmounts `useEipTabs` and drops everything.
- **No "+ Add to Learn Now" button in the panel header.** `onAddToLibrary` is
  deliberately not wired: on scp, adding to Learn Now *is* the drag gesture the whole
  page is built around, and a second, differently-shaped way to do it inside the panel
  would compete with it. (The flp still offers it for drilled-in words.)
- **Sheet geometry — `EipHost` no longer caps the sheet (2026-08-30).** `SheetPanel`
  now portals BOTH its scrim and its sheet to the frame-level host, so the sheet sizes
  itself from the frame and pins to the real bottom edge no matter what `EipHost` does
  (see [EIP_SHEET_GESTURES.md](./EIP_SHEET_GESTURES.md) § "Mount sites"). That is what
  lets the sheet reach full height and merge into the page header — hosted inside
  `ContentArea` it was clipped below that header and could never have covered it.
  `EipHost` was **deleted on 2026-10-03** when scp moved onto the shared `EipSheet`;
  both of its load-bearing tricks had already become vestigial **for the sheet**:
  - the `bottom: -FOOTER_CLEARANCE` stretch, which stopped the sheet floating 90px above
    the screen edge (`MobileTabScreen`'s ScrollArea reserves that band for the footer
    bar; `OnDeckSection` uses the same trick to paint its platform under the pill);
  - the explicit `zIndex: 1100`, which kept the on-deck cards' inline `zIndex: 1000`
    (`CardShell`'s drag lift) from painting straight through the open sheet. The sheet
    now carries `SHEET_BASE_Z_INDEX` (1201) at frame level and clears the cards itself.

  The portaled scrim covers the whole frame, so nothing on the page needed the wrapper's
  stacking context either.
- **The footer pill slides away while the sheet is open.** `SheetPanel` takes the
  `useHideFooter` hold itself for every modal sheet (2026-08-30); this page's own
  `useHideFooter(eipOpen)` call was deleted as a duplicate.
  It is rendered at frame level by `FooterPresenter`, outside this page's DOM, so it
  *cannot* be layered under the sheet by any z-index here — it would otherwise hover on
  top of the panel's content. It slides back on close, and on unmount if the user
  navigates away with the sheet open. See
  [LEAF_NODE_PAGES.md § Transient suppression](./LEAF_NODE_PAGES.md).
- **Pinyin display follows the flp's saved preference** (`useFlashcardLearnSettings`'s
  `showPinyin` / `showPinyinColor`) — and that stays true: this key is the **flp's**,
  read by the reference surfaces (scp, cdp, dictionary cdp). Games are moving OFF it
  onto their own per-game settings, which is what stops a game from editing this panel
  ([GAMES_FEATURE.md § "Pinyin is a per-game setting"](./GAMES_FEATURE.md)).
  scp exposes no toggle of its own — the panel is a
  read-only detour, not a second settings surface.

---

## 5. Sort destinations and Skip

Each card is dragged into one of **two** destinations:

| Destination | Meaning | Effect |
| --- | --- | --- |
| **Add to Learn Now** | "I want to learn this" — the user **does not yet know** this card. | Card enters the user's library, and counts as evidence about the user's level (they did not know this card). |
| **Already Learned** | "I already know this." | Card is **stamped as mastered immediately**, and counts as evidence the user's level is at or above this card. |

**Skip is no longer a destination** — it is a de-emphasized action (§5.1), deliberately
removed from the drag targets so the user reaches for a real destination first.

Note that **both** destinations persist identically as `starterPackBucket = 'library'`
(`StarterPacksService.sortCard`, `server/services/StarterPacksService.ts`).
What separates them is that Already Learned *additionally* seeds a typed mark history
(`coreMasteredTypedMarkHistory`) that resolves the row to **Mastered**. There is no
`'already-learned'` value stored anywhere — the two destinations are distinguishable
only by the resulting utcm category.

**It masters the CORE bar only** — recognition and production at 8/8, reading and
writing left at **0**. Sorting a card as known is a claim about knowing the word, not
about reading or writing it, and those are separate bars since migration 143. So a
learner with the writing goal sees such a card in *Mastered* with an empty Write
bar, and it does **not** appear in *Mastered Writing*. See
[MASTERY_REWORK.md § "Declaring a card already known"](./MASTERY_REWORK.md).

**A third bucket value exists but is never a sort destination:** `'provisional'`
(migration 140) marks a card the *server* lent the learner so a game or flp could reach
its baseline. Sorting such a card **promotes it in place** — `sortCard` flips the bucket
to `'library'` and touches nothing else, so marks earned while it was temporary survive.
The discover supply query treats a provisional row as **unsorted** (it filters on
`vetSortedClause()`, not on row existence), which is exactly how these cards keep being
offered until the learner decides. See [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md).

### 5.2.1 Set mode — sorting a fixed set
`/discover/sort/:language?set=provisional&words=a,b,c` hands the page a **fixed** set
instead of the open-ended level-based supply: the temporary cards a game just lent,
reached from the round's "Keep these cards" button. Each card becomes its own pack-of-1,
so all the pack machinery above applies unchanged, except that the queue is **never
replenished** and the page **closes itself** as soon as the queue empties — by any route
(sorted, skipped, or already empty on arrival), via a `queue.length` effect rather than
from the sort handler. See [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) § Set mode.

### 5.3 Library tally (level bar outer columns)
The level bar carries a two-figure running tally of the account's library, one figure at
each end, so the user can see their collection grow as they sort:

| Figure | Column | Definition | Color |
| --- | --- | --- | --- |
| **Learn Now** | left | library cards whose utcm category is Unfamiliar + Target + Comfortable | ink figure on a pill filled with `RAMP[LEARN_NOW_HUE].surface` — the fdp Learn Now filter tile's fill (`LibraryDuo`); its bucket wears the same hue (`LEARN_NOW_COLORS`) |
| **Mastered** | right | library cards whose utcm category is Mastered | ink figure on a pill filled with `RAMP[MASTERY_BAR_HUES.core].surface` — the fdp Mastered filter tile's fill (`LibraryDuo`); its bucket wears the same hue (`MASTERY_BAR_COLORS.core`) |

- The figures sit at **opposite ends** rather than as one cluster, so each reads as its
  own standing total instead of the pair reading as a ratio. Each figure is on the **same
  side as its own drop bucket** below it (Add to Learn Now is the left bucket, Already
  Learned the right), so a figure and the bucket that feeds it share a side.

- The two figures are **disjoint** (Learn Now deliberately *excludes* Mastered) so they
  read as the two drop buckets and sum to the whole library. This differs from the decks
  page's `totalLibraryCards`, which is the inclusive total.
- Each figure's pill, its drop bucket, and the fdp filter tile for the same collection
  (`src/features/flashcards/LibraryDuo.tsx`) all use **one hue per collection**: Learn Now =
  `LEARN_NOW_HUE`, Mastered = `MASTERY_BAR_HUES.core` (`src/utils/categoryColors.ts`).
  These are *collection* colours, not utcm band colours — the buckets used to wear
  `BAND_COLORS.Unfamiliar`, which painted Learn Now red here and yellow on the fdp.
- **Bucket look.** Each bucket is one solid fill of the collection's ramp SURFACE tier,
  pressed into the page with `SHADOW.recessedDeep` — the card crater's inward top shadow
  (§4.5, `SHADOW.recessed`) scaled ~2× to the bucket's size, so a bucket reads as a well a
  card drops into. The recess only shades the top edge, so the bucket also carries the
  app's standard `1px solid COLORS.border` hairline (the `CARD_SURFACE` edge,
  `src/theme/surfaces.ts`). The left bucket's label is just **"Learn Now"**; labels are
  `SIZE.bodyLg` (16px). *Code:* `SortCardsPage.tsx` → `Bucket`.
- **Drop-target cue.** Buckets rest at **0.6 opacity** and go fully opaque while they are
  the active drop target, or while a dropped card is still falling into them; they never
  change size. The cue lives on the **held card** instead, modelled on Bubble Match's
  hover system (`src/games/bubbles/Bubble.tsx` → `.bubble__dim`): a picked-up card lifts
  once to `HELD_CARD_SCALE` (1.12, Bubble Match's `SCALE_HELD`) and keeps that size for the
  whole drag; while carried over a bucket a `COLORS.scrim` wash fades in over it — the
  wash is the only drop-target cue on the card. The wash is driven by the card's spring,
  never React state, because the card must not re-render mid-drag.
  *Code:* `SortCardsPage.tsx` → `DraggableCard`, `OverBucketWash`.
- **A drop falls into the bucket.** On release over a bucket the card is sorted **at
  once** (`handleCardDrop` → `handleSortCard`): it is resolved and unmounts, leaving its
  crater, and a pack-completing drop starts the pack exit (§4.1) in the same frame. The
  fall itself is drawn by a stand-in, `FallingCardGhost`, portalled to `<body>` and
  fixed-positioned, so it plays **in parallel** with the pack sliding out — inside the
  slot it would be clipped by `PackExitClip`. The ghost starts exactly as the held card
  looked (centre, 1.12, washed) and glides to the bucket's centre while shrinking to 0.15
  and fading (`DROP_FALL_MS` = 340ms; position eases out, scale/opacity ease in). Reduced
  motion draws no ghost. The ghost is `memo`'d, and that is load-bearing: react-spring v10
  re-applies a `useSpring(() => initial)` initializer on every render, so an un-memo'd
  ghost is snapped back to its start pose by the drop's own page re-renders and the fall
  never plays (the same trap `DraggableCard`'s memo guards against). *Code:* `SortCardsPage.tsx` → `handleCardDrop`,
  `FallingCardGhost`, `fallingCards`, `dropFallConfig`.
- **The tally pill gulps the card.** The tally credit for a falling card is **deferred to
  its landing** (`handleFallLanded`), so the receiving pill's figure ticks up as the card
  disappears into the well, and the pill swells wide and squat and wobbles back to size
  (`TALLY_GULP_MS` = 480ms, a damped squash-and-stretch), as if it swallowed the card.
  Owed credits are tracked in `pendingLandingsRef`; an Undo of a card still mid-fall
  cancels its owed credit and removes its ghost instead of decrementing. Only sorts gulp;
  an Undo decrements silently. Replayed by bumping the pill's React `key`; off under
  reduced motion. *Code:* `SortCardsPage.tsx` → `tallyGulps`, `SortTallyValue`'s `gulp`,
  `pendingLandingsRef`.
- The baseline is fetched **once** on mount from `GET /api/onDeck/categoryCounts`
  (`useCategoryCounts`, `src/hooks/useCategoryCounts.ts`). Sorts made during the
  session are layered on as an **optimistic delta** — a drop bumps its figure
  as its fall lands (a fraction of a second after release) and Undo (§4.6) gives it back — rather than refetching a whole-library
  aggregate once per card. A skip moves neither figure (it creates no vet row).
- The delta is exact because the supply query excludes any word the user already holds a
  vet row for, so every on-deck card is a brand-new library row rather than a
  re-categorization of a row already in the baseline.
- It renders only once the baseline has loaded, so no "0" flashes before the real value.
- Position: the level bar, **not** the page header — that row already holds the
  audio-mode chip / undo / the minute-points badge. The level bar is a grid of **three
  equal columns** (Learn Now | Difficulty dropdown §6.6 | Mastered); each element is
  centred in its column and each pill is centred over its caption, so the three pills are
  evenly distributed and none moves when a figure's digit count grows. The tallies are
  placed by explicit `gridColumn`, so the dropdown holds the middle column even before
  they render. They are `pointer-events: none` so they can never intercept a drag.
- Client implementation: `src/features/discover/SortCardsPage.tsx` — the `SortTallyColumn`
  (`side="left" | "right"`) / `SortTallyValue` / `SortTallyLabel` styled components,
  `learnNowCount` / `masteredCount` derivations, and `adjustTally` (called from
  `handleSortCard` and `handleUndo`).

### 5.1 Skip is a de-emphasized action, not a drag target
- Skip is a single small **button in the top-right corner of the on-deck platform** — not a
  drag bucket, and not in the page header (moved 2026-09-28, so it reads as acting on the
  cards it skips). It sits in its own slim in-flow row (`OnDeckToolbar`) above the cards
  rather than overlaying the corner, because the per-card header bands would collide with
  it. The intent is to **de-emphasize** skipping as an option.
- Client implementation: `src/features/discover/SortCardsPage.tsx` → `OnDeckToolbar`,
  `handleSkipPack`.
- Pressing Skip **defers all remaining unsorted cards in the current pack** at once,
  then advances to the next pack. (Already-sorted/locked cards in the pack are
  unaffected — they were never the user's to sort.)
- Each deferred card is recorded **individually**, so it appears on its own in the
  Skipped cards page (§7) and can be brought back one at a time.
- A skip carries **no level signal**. Users skip for any number of unknown reasons
  (not interested, distracted, undecided), so a skip must never move the level
  estimate up or down.

### 5.2 When skipped cards come back
Skipped cards do **not** re-enter the sort flow automatically (this **replaces** the
earlier "recycle once in-level cards run out" rule). A skipped card returns only when
the user **chooses** to bring it back, in one of three ways:

- **Recycle all** — a button in the Skipped cards page header (§7) clears the user's
  skips for the language, returning all of them to the normal supply as fresh
  single-card fallback packs.
- **Sort it individually** — opening a skipped card's detail page (§7) and choosing
  Add to Learn Now / Already Learned sorts it directly and removes it from the skipped
  list.
- **Inside an authored pack** — a skipped card that happens to belong to an authored
  pack is shown draggable again (§4.5); sorting it there also clears its skip.

---

## 6. Adaptive leveling

### 6.1 Cold start, then a client-owned target level
- Every user starts at the **lowest level they have not yet cleared** for that
  language (§2), computed from their existing account state (mastered/library cards)
  the moment they enter the flow.
- From that point on, the **running target level lives on the client**, not
  recomputed from account state on every request. The client tracks it for the
  rest of the session and tells the server what to serve next.
- The target **moves in either direction** — there is no upward-only constraint.
- Two competing failure modes bound the adaptation (§2): the target must not
  **overshoot** above the user's real level, and it must not **undershoot** —
  leaving an advanced user stuck at a low level for too long.

### 6.2 A SortPack is one signal
- A **SortPack counts as exactly one signal**, however many of its (up to 4) cards
  get sorted — never one signal per card.
- The rule is deliberately **naive — no streaks, no thresholds, no counters**:
  - **Any "Add to Learn Now" card in the pack** makes the whole pack's signal negative,
    even if other cards in the same pack were "Already Learned". The target drops to
    **(that pack's level) − 1**. One unknown word at the level is enough.
  - A pack where **every** sorted card is "Already Learned" (no "Add to Learn Now" at
    all) is positive and raises the target to **(that level) + 1** immediately.
- There is **no neutral pack**: any pack with at least one sorted card moves the target
  one way or the other. Only fully-skipped packs carry no signal.
- **Skips carry no signal** (§5.1) — a pack that is skipped, or partially skipped
  with no library/already-learned cards in it, moves the target in neither
  direction.
- The new target is always computed as **(the completing pack's own level) ± 1**,
  never as an increment of whatever the client's current running target happens to
  be — the two can differ because a replacement pack may already be in flight (see
  §6.4), and anchoring on the completing pack's level keeps the adjustment from
  compounding on a value that's already stale.

### 6.3 Cards are matched to the level
- The user is normally served cards **at the current target level**.
- Cards too easy or too hard relative to the target are not served during normal
  operation.

### 6.4 Supply order, running out of in-level cards, and queue lag
- **At the target level, authored packs are served first**, then **system fallback
  single-card packs** for the remaining un-sorted, un-skipped words at that level
  (§4.5). The two groups order by **different authorities**, and this is deliberate:
  - **Authored packs: curation order (`sort_packs."packOrder"`, ascending).**
    `packOrder` is a human teaching sequence — packs at a level are written to build
    on one another — so nothing derived may reorder them. Applied once, in
    `SortPacksDAL.fetchPacksAtLevel`'s `ORDER BY`; `getNextPacks` consumes that order
    as-is and does **not** re-sort.
  - **Fallback singles: colloquial register — highest `frequencyScore` first**
    (natural/colloquial words before literary ones), cards with no score last, ties
    by card id. These are machine-selected words with no curation order to respect,
    so a derived ordering is the best available. Applied in `_fetchSupplyRows`'s
    `ORDER BY`.

  > Authored packs were briefly re-sorted by mean `frequencyScore` inside
  > `getNextPacks`, which overrode `packOrder` on all but exact ties and made the
  > curation sequence effectively dead. Removed — if a level's packs are coming out
  > in the wrong order, fix their `packOrder`, not the serve path.
- When the user has **sorted all packs at their level**, the flow **offers packs from
  adjacent levels** so the user always has something to sort (§4.4), serving them **as
  close to the target level as possible** — exhaust the nearest levels first and only
  reach further out as those deplete. The user should drift away from the target level
  as gradually as the available cards allow.
- Previously skipped cards do **not** become eligible again here. They re-enter the
  flow only by explicit user action (§5.2), never automatically.
- Because the client always keeps a small queue ready ahead of the user (§4.3), a
  target-level change triggered by the pack now on deck only affects the
  **replenishment requested after it** — the pack already sitting in the buffer was
  fetched at the prior target and still gets shown. A one-pack lag on every level
  change is expected and acceptable.

### 6.5 Adaptation must not disturb the on-deck card
- A target-level change changes which cards are **served next**. It must never
  reorder, swap, or remove the card the user is currently looking at (restates §4.2
  from the leveling side) — it only affects the pack requested to replenish the
  queue after the change.

---

## 6.6 Manual level override (dropdown)

- The level indicator is a **dropdown**, not a static readout: the first entry is
  **Auto**, and one further entry per difficulty level.
- The trigger (`SortLevelDropdown`, `sort-cards__level-dropdown`) is drawn in the tally
  pills' shape — both spread `LEVEL_BAR_PILL_SHAPE` (ink figure, hairline border, fully
  rounded) — on a white fill rather than a ramp surface, since it is a control rather
  than one of the two destinations. A trailing down-arrow marks it as a dropdown.
- A **"Difficulty"** caption sits **below** the pill (`sort-cards__level-caption`),
  rendered with the tallies' `SortTallyLabel` style, so all three level-bar
  elements share one pill → caption layout and one caption treatment (§5.3).
- The **Auto** entry always just reads "Auto" — it never shows the live target level
  number, since the target can change every pack and a fluctuating number in the
  dropdown would be noisy rather than informative.
- Selecting **Auto** resumes serving from the client's current running target level
  exactly as §6.1–§6.4 describe.
- Selecting a **specific level** pins supply to **exactly that level** — no
  adjacent-level drift (§6.4) while a manual level is active, and pack outcomes seen
  while pinned do **not** feed §6.2's signal (the running auto target is untouched
  until the user switches back to Auto).
- A level switch is **exempt** from §6.5's "must not disturb the on-deck card" rule: it
  is an explicit user action, and it is acceptable (expected) for it to replace the
  on-deck pack with one matching the newly-selected level.
- Client implementation: `src/features/discover/SortCardsPage.tsx` — `autoLevelRef` (running
  target) and `packBucketsRef` (per-pack bucket outcomes this session, from which
  `applyPackSignal` derives the pack's one ±1 signal — there is no streak/threshold
  state), plus the `sort-cards__level-dropdown` / `sort-cards__level-menu`
  dropdown. Server: `StarterPacksService.getNextPacks`'s `requestedLevel` (the level
  to center supply on — client's tracked target, or its dropdown pin) and `manual`
  (whether to drift on exhaustion) parameters, threaded through
  `GET /api/starterPacks/:language` (`level`/`mode` query params) and
  `POST /api/starterPacks/nextPack` (`level`/`mode` body fields) via
  `StarterPacksController`. `estimateLevel` is called **only** for the cold-start
  seed (§6.1) — never again mid-session.

---

## 6.6 Client API module — `src/features/discover/starterPacksApi.ts`

All three Discover pages (`SortCardsPage.tsx`, `QuickMarkPage.tsx`,
`SkippedCardsPage.tsx`) reach the server through this one module. It exports
`fetchStarterPacks` / `fetchNextPack` / `sortCard` / `skipPack` / `undoSort` /
`fetchSkippedCards` / `recycleSkips` / `fetchQuickMarkPage` / `saveQuickMarks`.

Two rules it exists to enforce:

1. **One spelling per endpoint.** Each page previously hand-rolled its own
   `fetch(`${API_BASE_URL}/api/starterPacks/...`)` + `res.ok` ladder, so the same
   endpoint was written three different ways and a path or payload change had three
   places to miss.
2. **No `token` in the signature.** Calls go through the shared transport
   `src/api/http.ts`, which reads the bearer token fresh at call time. The pages used to
   keep an `authHeaders = useMemo(..., [token])` whose identity churned every ~15 minutes
   on a silent token refresh, dragging that churn into every callback dep array that
   touched it — the failure mode CLAUDE.md's "Never reload/reset a page on a silent token
   refresh" rule exists to prevent. Load effects key on `isAuthenticated`, never `token`.

API paths are camelCase; they must stay in step with `server/routes/starterPacksRoutes.ts`.

---

## 7. Skipped cards page

- A dedicated page lists **all words the user has currently skipped** in the active
  language, modeled on the Mastered cards page. It is reachable from the **Discover
  hub menu** (a row alongside Sort Cards).
- **Tapping a skipped card** opens a small **action popup** with three choices —
  **Cancel**, **Mark as Already Learned**, **Mark as Learn Now**. Choosing a
  destination sorts the card into the library and **removes it from the skipped list**;
  Cancel dismisses the popup with no change. (It does **not** navigate to the card
  detail page.)
- The page header carries a **Recycle all** action that returns *every* skipped card to
  the normal sort supply at once (§5.2).
- The list is **per-language** (§3) and shows only currently-skipped cards: a card that
  has since been sorted (by any path) no longer appears.

---

## 8. Acceptance criteria (testable)

1. **Cold start:** a brand-new user entering the flow is shown the easiest cards, not
   hard ones.
2. **Per-language isolation:** a user's progress/level in one language does not affect
   the cards or level shown in another.
3. **Immutability:** while a pack is on deck, no background event changes, reorders, or
   removes its cards; a card leaves the pack only via a user sort, and the pack
   advances only when all its cards are sorted or it is skipped.
4. **No wait:** after a pack is finished, the next pack is on screen with no perceptible
   network delay; the client always has ≥1 pack ready behind the on-deck pack.
5. **Already Learned:** sorting a card as already learned stamps it mastered
   immediately.
6. **Skip is de-emphasized and signal-free:** Skip is a header button (not a drag
   target); pressing it defers all remaining unsorted cards in the pack and never
   changes the user's level estimate, in any quantity.
7. **Pack composition:** a pack shows up to 4 cards (no sentence); cards already in the
   library render locked with a "sorted!" watermark; a pack whose cards are all already
   sorted is never served.
8. **Authored-first supply:** at a level, authored packs are served before system
   fallback single-card packs.
9. **Level adaptation:** a finished pack contributes exactly one signal — any "Add to
   Learn Now" card in it drops the target to that pack's level minus 1; an all-"Already
   Learned" pack raises the target to that level plus 1. There is no streak or threshold
   to accumulate: one pack, one ±1 move. A skipped (or partially skipped, signal-less)
   pack changes
   nothing. The new target is always anchored on the completing pack's own level, not
   an increment of a possibly-stale running target.
10. **Out of in-level cards:** when the in-level pool is exhausted, the user is served
    nearest adjacent-level packs rather than hitting a dead end.
11. **Skips never auto-return:** skipped cards re-enter the flow only via the Skipped
    page (Recycle all / individual sort) or when shown inside an authored pack — never
    automatically.
12. **Skipped page truthfulness:** a skipped card appears on the Skipped page until it
    is sorted (incl. via the tap popup) or recycled, then disappears from it.
13. **Pack shown once:** a pack the user has finished or skipped is never served again.
14. **Per-card undo:** undo reverses one card action at a time — a sort **or** a skip —
    up to 4 actions back, restoring the card (bringing its pack back on deck if needed)
    and clearing any seen mark.
15. **Never empty:** under normal data volumes the user can sort indefinitely without
    reaching an "all sorted" state.
16. **Manual level override:** picking a specific level from the dropdown serves only
    that level (no drift to adjacent levels, and pack outcomes seen while pinned don't
    feed the auto target) until switched back to Auto; the Auto entry always just reads
    "Auto" — it never displays the target level number.
17. **Library tally:** the top-right tally shows the account's Learn Now and Mastered
    library counts as two disjoint figures; a drop into either bucket increments the
    matching figure immediately, Undo decrements it, and a skip changes neither.
18. **Undo/level interaction (known simplification):** undoing a card action does not
    reverse any level-target change that action's completing pack already triggered —
    the target it moved to stays in effect. See `SortCardsPage.tsx`'s
    `applyPackSignal`.

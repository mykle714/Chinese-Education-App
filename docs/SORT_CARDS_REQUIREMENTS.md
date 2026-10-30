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
  pack replacing a finished/skipped one) runs in on a **sideways conveyor** (since
  2026-10-29; it used to slide up from the bottom of the screen): each card's well
  **slides in from past the right edge** (`translateX(100vw)` → 0, `DOCK_SLIDE_MS`
  520 ms, ease-out), and the slot's **info labels** — the tier tag row above and the
  action row below — **fade in** (`LABEL_FADE_MS`) as the card arrives (from 70% of its
  slide). Every card travels the same 100vw, so they move at one speed. The slots are
  staggered 60 ms apart **in slot order, leftmost first**. A card
  put back by **Undo** (§4.6) inside the on-deck pack instead does a small 24 px rise +
  fade, so Undo reads as "put back" rather than as new content; a pack brought back by
  Undo plays the conveyor backwards (see "Undo across packs" below). The slot's transform is cleared to `none` at
  rest (fill mode `backwards`) so it doesn't form a stacking context that would trap a dragged card's
  z-index under its neighbours.
  *Code:* `src/features/discover/SortCardsPage.tsx` → `EnteringCardSlot`,
  `SlotEntrance`, `dockInKeyframes`, `labelFadeInKeyframes`, `SLOT_LABELS`,
  `DOCK_STAGGER_STEP_MS`, `dockDelays`, `undoRestore`.
- **Pack exit.** When a pack advances, its cards (empty wells, any locked "sorted!"
  cards) **slide off to the left** (`translateX(-100vw)`, ease-in — the belt runs right
  → left) while its info labels (tier tags, action rows) **fade out in place**. The
  overlay is dropped after `PACK_EXIT_MS` by a timer keyed on `exitId`.
  The new pack's entrance **waits for the exit to finish** (`dockDelays` adds
  `PACK_EXIT_MS`). The two motions are sequential, not overlapped. A pack completed by a
  **drop** starts its exit on release, alongside the bin's place animation (§5.3
  "A drop despawns the card"); only the replenish request waits for the sort POST
  (`advancePack`'s `afterSorted`), which keeps `/next-pack` from re-serving the pack. The
  leaving slots are an inert copy rendered in `PackExitClip`. That clip is absolutely
  positioned over `OnDeckSection` with `overflow: hidden`, and clips only the overlay:
  the section itself stays overflow-visible so dragged cards still reach the
  bins. The exit plays only when a replacement pack is already buffered. With an
  empty buffer the page shows its spinner instead, and a deferred exit would play
  late. Undo clears a pack that is still leaving. Under `prefers-reduced-motion` there
  is no exit and no entrance.
  *Code:* `SortCardsPage.tsx` → `leavingPack`, `advancePack`, `PackExitClip`,
  `packExitKeyframes`, `labelFadeOutKeyframes`, `PACK_EXIT_MS`, `cardsRowRef`.
- **Undo across packs.** When Undo reaches back into the PREVIOUS pack, the conveyor runs
  **backwards** (since 2026-10-29). First the on-deck pack **un-docks**, which is its
  entrance reversed: its labels fade out, and each card slides back off to the **right**
  (`translateX(100vw)`, the dock's ease-out mirrored into an ease-in), **rightmost first**,
  60 ms apart. This is the same `leavingPack` overlay with `direction: "right"`, held for
  `undoExitMs(cardCount)`. Then the previous pack **returns**, which is its exit
  reversed: its cards slide in from the **left** over `PACK_EXIT_MS` and its labels fade
  in as they arrive (`EnteringCardSlot` entrance `"return"`, delayed by the un-dock's
  length). The undone card is back in its slot as the pack returns, while its bin plays
  the stack animation backwards (§5.3). The un-docked pack stays buffered right behind
  the returned one. Under reduced motion, the packs simply swap.
  *Code:* `SortCardsPage.tsx` → `handleUndo`, `undoRestore`, `undoExitMs`,
  `packUnDockKeyframes`, `packReturnKeyframes`, `EnteringCardSlot`.

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
  Learning *or* Already Learned) appears **undraggable** with a **"SORTED" head band**
  across the top of its panel, styled like the head band on a Deck Tower card (the
  "LEARNING" / "MASTERED" strip, IsoCard `iso-card__band`): IsoCard's inset, depth,
  corner, and bold, tracked caps label are all scaled from the tower card's width, and
  it is filled with the sorted stock's wall grey (until 2026-10-29 it was a diagonal
  "sorted!" stamp across the centre), so the user still sees the context but cannot re-sort it. A locked card is
  **greyed**: the card stock in greys (`SORTED_STOCK` — `COLORS.header` rim,
  `COLORS.card` panel, and a wall one iso step darker than the panel, `shadeHex(COLORS.card, 0.07)`,
  derived the way `COLORS.cardWall` is from `cardBeige`), with its print (icon, word,
  definition) grayscaled to `SORTED_PRINT_OPACITY` (0.4). It keeps the hairline ring and
  raised wall, so it is never drawn recessed, but it is **grounded**: it does not
  levitate and casts no shadow. The live cards float above the ground; this one stands
  on it. **Tapping it or trying to drag it** plays the app's invalid-operation shake
  (`src/theme/invalidShake.ts`, the same wobble as a wrong bubble or Bucket Drop bucket).
  A drag shakes once it passes the drag threshold, and a tap shakes on release. Each
  attempt replays the shake in place: `shakeNonce` drives an inline animation restart
  instead of a remount, because a remount mid-gesture would strand the drag state and the
  shake would play only once. Its audio/info buttons are outside the card and never shake.
  Being sorted (`sorted`) is a separate prop from being undraggable (`locked`),
  so live cards sliding out in the leaving overlay keep their normal look.
  *Code:* `SortCardsPage.tsx` → `DraggableCard`, `SORTED_STOCK`, `SORTED_PRINT_OPACITY`,
  `sortedBandSx`, `cardStockShadow`. A pack in which
  **every** card is already sorted is **never served** — the system skips over it.
- **Previously-skipped cards reappear draggable inside authored packs.** If a card the
  user skipped is part of an authored pack, it is shown **draggable again** (not
  locked) — the pack's context is a fresh chance to sort it. Re-sorting it there clears
  its skip (§5.2).
- **Each card levitates over the ground with a tier tag above and two actions below**
  (Tower Tier 2 design, 2026-10-29 — see §4.9 for the page's colours). There is no
  platform under the pack any more: the on-deck zone (`OnDeckSection`) is transparent, so
  the cards sit straight on the page ground, a row along the bottom above the slab
  footer. Each card lives in a `CardSlot` column: a **tier tag** on top, the draggable
  card in the middle, and an **action row** (`CardActionRow`) underneath.
    - **The card is the app's mini preview card.** `DraggableCard` renders the shared
      `MiniCard` (`src/components/MiniCard.tsx`) through react-spring's `animated()` —
      the same 92×132 tile (or its 78×112 **compact** face — see *Compact dock* below),
      icon slot, word, definition and hairline ring as the fdp,
      Quick Mark and challenge cards — with **no mastery strip** (these are words being
      triaged, not the learner's cards) and no corner frequency badge (the tier tag
      above already shows it).
    - **Card stock.** The card is cut from the **Deck Tower's card stock**
      (docs/TOWER_STYLE_SHIFT.md § "Card stock"): a cream rim (`COLORS.cardFace`) around
      an inset beige printed panel (`COLORS.cardBeige`, `FLP_CARD_STOCK_INSET_RATIO` in
      from each edge, corners `FLP_CARD_PANEL_RADIUS_RATIO` — a `::before` under the
      icon and text). In place of MiniCard's soft raised shadow it wears the
      hairline ring (CLAUDE.md "Buttons & cards" — the tower's stock has none), a solid **wall** in the card stock's
      wall colour (`COLORS.cardWall`, the tower's card walls) showing **below and to the
      right** of the face, as thick as a Deck Tower card (`CARD_THICKNESS` ≈ 2px at the
      tower's scale) — extruded 2px right × 2px down, drawn as `CARD_WALL_STEPS` stepped
      box-shadows along that vector (`cardWall`) — and a flat **cast shadow** down-right on
      the ground in the look's `groundShadow` (the iso shadow rule the platforms use),
      **proportional to the wall on both axes**: `CARD_SHADOW_PER_WALL` (14/6, the
      artboard's shadow-drop-to-lip ratio) × the 2px wall ≈ 4.7px right and 4.7px down
      (`cardCastShadow`). `SHADOW.lifted` (the tower's held-card shadow) was
      tried and dropped: a soft 12%-ink blur, invisible on the tinted grounds.  A
      sorted (locked) card wears the same stock in greys (`SORTED_STOCK`, § 4.5 "Already-sorted
      cards are locked"), with no cast shadow.
      *Code:* `SortCardsPage.tsx` → `sortCardStockSx`, `cardWall`.
      ⚠️ The artboard draws only a bottom lip, `0 6px 0 #EBD5BE`; the right wall was added
      by user request (2026-10-29), and the framework's `cardWall` (`#EDDAC4`) is used.
    - **Levitation.** Resting cards rise and fall 3px over 4.2s (`cardLevitateKeyframes`),
      each slot at a different phase (`LEVITATE_PHASES_MS`) so the pack never moves in
      lockstep. It animates the CSS `translate` property, which composes with the drag
      spring's `transform` instead of fighting it. Off under reduced motion.
    - **Desktop hover raise** (since 2026-10-29). When a mouse rests on a live card, its
      levitation stops and it eases up `HOVER_RAISE_PX` (10px) over `HOVER_RAISE_MS`
      (180 ms), like the selected card in a hand of cards. Its cast shadow springs out to
      `HOVER_LIFT` (0.5) of a held card's reach, so the shadow falls further away as the
      card rises, the same rule as a pickup. When the mouse leaves, the card eases back down
      and the bob restarts from rest. A missed drop settles back to the hover lift if the
      mouse is still over the card. The raise is mouse only (`pointerType === "mouse"`), so
      touch never hovers, and sorted or locked cards never raise. *Code:* `DraggableCard`
      → `handlePointerEnter` / `handlePointerLeave`, `.sort-cards__flash-card--hovered`.
    - **Tier tag** (`CardDeckHeader`). Each card carries its **own tier label**
      (`CommonalityTierLabel`, text from `COMMONALITY_TIER_LABELS`, `SIZE.body`) over the
      **five-dot frequency meter** (`FrequencyScoreDots`, 8px dots — the word's
      `frequencyScore`), both in the look's soft ink (`inkSoft`) straight on the ground —
      no keycap. The "x/5" readout was dropped with the redesign. Rendered only when the
      entry has a score. Tier labels: 5 *Used all the time*, 4 *Common*, 3 *Used
      sometimes*, 2 *Uncommon*, 1 *Rarely used* — display copy only, deliberately separate
      from the backfill's `FREQUENCY_SCORE_LABELS`
      (`server/scripts/backfill/shared/lib/frequencyLabels.js`), which feed the Spanish
      scoring prompt and are too long for a card slot. **Sentence case** (tracked caps
      would overflow). Every multi-word label is split onto **two lines** by an embedded
      `\n` (`white-space: pre`); the box always reserves two lines and bottom-aligns the
      text, so every card's dots, and so every card face, stay on one baseline. This is
      the per-card face of the register ordering the supply uses (§6.4). The tag sits on
      the ground (a sibling above the card, not inside it), so it stays put while the card
      is dragged. *(The eip + cdp meters still use the "Commonality" caption + x/5 form.)*
      Code: `src/features/discover/SortCardsPage.tsx` → `CardDeckHeader`,
      `COMMONALITY_TIER_LABELS`, `CommonalityTierLabel`; `src/components/FrequencyScoreDots.tsx`.
    - **Play-audio action.** A bare 28px `volume_up` glyph **below the card**
      (`.sort-cards__card-audio-button`, a 36px round hit target, no keycap) that narrates
      just that card's word on tap (`handlePlayCardAudio` → `tts.speakSentence`); it
      becomes a spinner while that card is speaking (`tts.speakingKey === entryKey`). A tap
      **ends** any pack autoplay still in progress (`stopPackAutoplay`) so the next
      autoplay word can't cut the replay off; the eip's speaker buttons do the same
      (`handleEipSpeak`, `handleEipSpeakSentence`). See AUDIO_PLAYBACK.md § 4.
    - **Info action.** An `info` glyph beside it (`.sort-cards__card-info-button`, same
      size) that opens the **eip** for that card — see §4.7.
    - **Empty well.** The card sits in a fixed well the size of its face (`CardWell`,
      92×132 or 78×112 compact). While the card is dragged, and after it is sorted or
      skipped this session, the well is simply **empty** (the artboard draws no crater;
      the old recessed `CardCrater` was removed 2026-10-29). A resolved card's slot keeps
      its tag and action row (the actions stay live), so neighbours don't reposition. The
      pack exit (§4.1) then carries the whole slot off. Undo re-showing a card in a slot
      that is still on deck pops it back into its well (`DraggableCard` → `settleIn`).
      *Code:* `SortCardsPage.tsx` → `CardWell`, `renderSlotBody`.
- **Compact dock (4-card packs on narrow screens).** A pack is laid out on regular
  92×132 MiniCards whenever the whole row fits across the on-deck row at that size, and on
  the **compact 78×112 face** only when it does not — **fit-to-width**, not a rule keyed
  on the card count (`dockCardSize`). In practice only a 4-card pack on a phone narrower
  than ~430px goes compact; a 1–3-card pack always fits and never shrinks. The decision
  is made **per pack** from the row's measured width (`onDeckSectionRef`, a
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
    - The **tier tag and action row do not shrink** — the tier label, dot meter and
      action glyphs keep their sizes; only the gap between slots tightens (24 → 14px,
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
- **Opening the panel suspends sorting.** `SheetPanel`'s scrim covers the bins and
  the on-deck cards, so no card can be dragged while the sheet is up. Reading about a
  word and sorting it are separate modes on purpose.
- **Closing KEEPS every tab** (2026-09-06). The trail belongs to the CARD, not to the
  panel, so reopening the panel on the same card resumes the drill-in chain on the word
  the learner was reading. What starts a clean trail is opening the panel on a
  **different** card — `openForRoot` reseeds whenever the root word changes — and leaving
  the page, which unmounts `useEipTabs` and drops everything.
- **No "+ Add to Learning" button in the panel.** On scp, adding to Learning *is* the
  drag gesture the whole page is built around. (Since 2026-10-29 no eip outside the
  Dictionary flow offers one at all — the flp's add-only "+" and its `onAddToLibrary`
  prop were removed.)
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
    bar; `OnDeckSection` uses the same negative-margin trick to measure its bottom padding from the frame edge);
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

### 4.8 Expanding the platform into the Quick Mark grid — ENTRY REMOVED 2026-10-29

> **Status: unreachable.** The Tower Tier 2 re-skin (§4.9) removed the ⊞ expand button
> and all of scp's hosting code for the panel (the `quickMark` state, the preload, the
> pinned-card sort/undo bridges, `getPlatformRect` / `getSlotRect`). Quick Mark had no
> other entry point, so **the grid cannot be opened anywhere in the app**. The panel and
> its hooks are still in the tree, unimported: `src/features/discover/QuickMarkPanel.tsx`,
> `useQuickMarkGrid.ts`, `useQuickMarkPreload.ts`. Whether to delete them or give Quick
> Mark a new entry is an open decision ([DEFERRED_WORK.md](./DEFERRED_WORK.md)). The rest
> of this section describes the hosting as it worked before the removal (recover it from
> git history at `09f607e`); it no longer matches `SortCardsPage.tsx`.

The on-deck platform could be **maximized** into Quick Mark, the bulk-triage grid
([QUICK_MARK.md](./QUICK_MARK.md) owns the grid; this section owns how scp hosted it).
Quick Mark has no page or hub tile of its own any more (deleted 2026-10-17): this was the
only way in.

- **Open — the ⊞ button** (`sort-cards__expand-button`, Material Symbol `apps`) sits
  beside "skip" in `OnDeckToolbar`, the same 24px height and quiet ink. Only a press
  opens it. A drag-up handle was considered and dropped. Hidden in set mode (§5.2.1):
  a fixed set is not an open-ended supply to bulk-triage.
- **Close — the ✕** in the panel header's right slot (the shared `SheetCloseX`). The
  page header (back arrow, audio chip, Undo) is covered while the panel is open, so the
  ✕ is the only way out of it.
- **Coverage — maximized.** Fully open, the panel covers the whole frame: the NodePage
  header, level bar, tallies, buckets and platform. It paints the page ground
  (`COLORS.background`, MobileTabScreen's default `surfaceColor`) with square corners,
  so it reads as a page, not a sheet. Like a maximized `SheetPanel` it ends **headed**: a
  real `PageHeader` titled "Quick Mark" (no back chevron) with the close cluster — the
  minute-points flame (scp's own is covered) and the ✕ — in its right slot, and
  `SAFE_TOP` padding on the panel surface.
  It runs down under the floating footer pill, exactly as the platform does.
- **Contents.** The full Quick Mark supply at one level, with the on-deck pack's
  **still-unsorted cards pinned first**. Pre-sorted (locked) cards and cards already
  resolved this session stay on the platform. The grid opens at the dropdown's pinned
  level, or the on-deck pack's own `level` when the dropdown is on Auto.
- **The morph** (`QuickMarkPanel.tsx`). Opening is deliberately slower than closing
  (`EXPAND_MS` 620 vs `COLLAPSE_MS` 340): it is a change of mode, the close a way back.
  The panel grows up out of the platform: a clip-path inset starts at the platform's top
  edge and opens to the top of the frame, its 20px top corners squaring off and its fill
  shifting from the platform's white to the page ground (`slabFrame` → `PAGE_FRAME`).
  Each pinned card flies from its slot (`CardWell[data-sort-card-id]`) into its cell on
  a `MorphGhost` (a compact face grows into the regular one), the 4th card of a 4-card
  pack straight into its row-2 cell (`startExpandFlights`). The rest of the panel's
  cards **pop in** with the grid's stagger as it grows: the preloaded supply (next
  bullet) — the cards in the grid at mount (`mountCardIdsRef`) — starts with the content
  fade (`SUPPLY_POP_START_MS`) and steps `SUPPLY_POP_STAGGER_MS` per card. Without a
  preload the supply pops in with the grid's own stagger when its fetch lands. Closing
  plays the clip backwards (back to a white, rounded slab): every pinned card still
  unsorted flies from its cell back to its slot. The panel and
  its ghosts unmount on the same frame, uncovering the real cards beneath. Reduced
  motion skips all of it.
- **Preload** (`src/features/discover/useQuickMarkPreload.ts` → `useQuickMarkPreload`).
  While the panel is closed and a pack is on deck, scp keeps the grid's FIRST supply
  page fetched in the background for the level the panel would open at (the dropdown's
  pin, else the on-deck pack's level), 800ms after the last trigger so it never competes
  with a pack's own fetch and entrance. One page per level, not one per pack: words the
  platform resolved since the fetch (`doneRef`, via `isResolvedAnywhere`) and every card
  of the opening pack are filtered out when `handleOpenQuickMark` takes it. It is
  refetched when the level changes, when that filter would leave fewer than 15 cards
  (and more pages exist), and after a close on which the grid sorted supply words
  (`invalidate`). With no usable page for that level the grid fetches at open as
  before. The taken page rides `quickMark.seed` → `QuickMarkPanel.supplySeed` →
  `useQuickMarkGrid`'s `seed`, which mounts the grid full and resumes paging from the
  seed's cursor.
- **A pinned card is still a pack card.** Its swipe goes through `handleSortCard` (via
  `handleSortPinned`), so it leaves a crater, feeds the pack's §6.2 signal, credits the
  tally, joins the §4.6 Undo stack and, when it is the pack's last card, completes the
  pack. Its grid toast-undo is the scp Undo (`handleUndoPinned`, which only acts when
  that card is the stack's top). Swiping a supply card writes `sortCard({ packId: null })`
  inside the grid and only moves the tally (`handleSupplySorted` /
  `handleSupplyUnsorted`). Supply swipes are **not** on the scp Undo stack: after
  closing, only pinned-card sorts can be undone from the header.
- **What runs while it is open.** A pack that completes in the grid advances
  normally underneath, with no pack-exit overlay (`advancePack` checks
  `quickMarkOpenRef`). Autoplay narration stops on open (`handleOpenQuickMark`); a pack
  that lands while the panel is open is narrated when it closes
  (`deferredNarrationKeyRef` → `narrationEpoch`).
- **Level change in the panel** also pins scp's dropdown (`onPickLevel` = `setSelectedLevel`):
  a normal §6.6 level switch, so the on-deck pack is replaced. The grid reloads at that
  level **unpinned**. The panel stays mounted through the refetch's spinner branch
  because every branch passes it as the same NodePage `overlay`.
- **On close** (`handleCollapseQuickMark`):
  - Supply words sorted in the grid are stripped from any queued pack still holding
    them. A buffered pack left empty is dropped; the on-deck pack itself is never
    emptied.
  - If the pack on deck is not the one the panel opened from, `dockEpoch` re-keys its
    slots so it plays its §4.1 "dock" entrance now, in view.
- **Stacking.** The panel lives in NodePage's `overlay` slot (a sibling of the
  scroll area, whose `touch-action: none` would forbid the grid's vertical pan), at
  z 1100: above the page header and the on-deck cards' 1000, and below the eip (1200+), which a card tap opens
  over it. It stays inside the Surface's stacking context, so the frame-level footer
  still floats above it.
- Client implementation: `src/features/discover/SortCardsPage.tsx` → `quickMark`
  state, `useQuickMarkPreload` (`takeQuickMarkPreload` / `invalidateQuickMarkPreload`), `isResolvedAnywhere`, `handleOpenQuickMark`, `handleSortPinned`, `handleUndoPinned`,
  `handleSupplySorted`, `handleSupplyUnsorted`, `handleCollapseQuickMark`,
  `getPlatformRect`, `getSlotRect`; `src/features/discover/QuickMarkPanel.tsx` →
  `QuickMarkPanel`, `MorphGhost`; `src/features/discover/useQuickMarkGrid.ts` →
  `useQuickMarkGrid`; `src/features/discover/useQuickMarkPreload.ts` →
  `useQuickMarkPreload`.

### 4.9 Tower Tier 2 layout and time of day

Since 2026-10-29 scp is drawn as a **tier-2 page under the Deck Tower** (Claude Design
project "Tower Tier 2 - Time of Day", the three "Sort ·" artboards, built on the earlier
"Tower Style Design" sort frames). Top to bottom:

| Zone | What | Code |
|---|---|---|
| Header | NodePage header: back + "Sort Cards" in the look's `ink`; `SoftIntroToggle` (feature testers), `AudioModeChip` in the Deck Tower study header's `outlined` skin (pill outline + label) in the same ink, the flame | `SortCardsPage` → `groundChrome`, `headerExtraActions` |
| Bins | The two drop targets as iso decks on floating platforms (§5.3), in the spare height and **pinned to its bottom** (`preserveAspectRatio="xMidYMax meet"`), then lowered a further `BINS_LOWER_PX` (20 viewBox px ≈ screen px) past that bottom edge (the scene is `overflow: visible`), so the platforms sit close above the cards and any extra height opens up under the toolbar | `BinsArea`, `SortBins.tsx` |
| Toolbar | Level pill · undo · skip, keycaps in a row at the top-right over the bins (Undo moved here from the header) | `SortToolbar`, `keycapSx` |
| On deck | The pack's levitating cards (§4.5), their action glyphs sitting right on the slab footer (`ON_DECK_FOOTER_GAP_PX` 0 — the glyphs are inset 4px in their 36px targets; the section's negative margin hands back the ScrollArea's **slab** reservation, `SLAB_FOOTER_TOTAL_CLEARANCE`), `SLOT_ACTIONS_GAP_PX` (12px) below the card | `OnDeckSection` |
| Footer | The floating **slab** footer (`footerStyle: "slab"` on the route), casting its shadow on the ground | `src/routes/routeMeta.ts`, `setFooterCastShadow` |

- **Keycaps.** The level pill, undo and skip are keycaps — all three fully rounded pills,
  `TOOLBAR_KEY_HEIGHT_PX` (30) tall (skip's hold ring follows `SKIP_BUTTON_RADIUS_PX`, half
  that height): the look's `keyFace` on a solid
  `0 3px 0` lip (`keyWall`), casting `4px 7px 0` onto the ground (`groundShadow`), with
  the app's hairline outline. **They press like the app's other raised buttons**
  (the shared `src/theme/keycapPress.ts` → `keycapPressSx`): on press the face snaps down the lip's 3px
  and the cast shadow tightens by the same amount, snapping back on release (no
  transition — the app's keys snap); skip stays sunk for the whole hold (`sort-cards__keycap--pressed`
  while `useLongPress` reports `pressing`). A disabled undo does not press.
  *Code:* `keycapSx`, `keycapShadow`, `KEYCAP_LIP_PX`.
- **Time of day.** The page reads the app's shared day clock
  (`src/timeOfDay/useDayClock.ts` → `useDayClock`, the same clock and feature-tester pin as
  the Deck Tower and the eip — docs/DECK_TOWER.md § "Time of day") and turns it into a
  `SortLook` (`src/features/discover/sortTimeOfDay.ts` → `sortLookAt`), blending the two
  bracketing phases like the tower's sky. Only the **ground**, the **shadows cast on it**
  and the **ink drawn on it** change through dawn, day and sunset; night also turns the
  platforms grey and the keycaps slate. The **cards never change** — cream stock in
  every phase.

  | Phase | Ground | Platforms | Ink on ground | Keycaps |
  |---|---|---|---|---|
  | Dawn | `#FAE9EE` | white | ink / ink2 | cream (`cardFace` / `cardWall`) |
  | Day | `#E4F2FC` | white | ink / ink2 | cream |
  | Sunset | `#FBEADB` | white | ink / ink2 | cream |
  | Night | `#1E2735` | `#E4E5E9` | `#EEF0F6` / `#C3C8D6` | `#2A3446` on `#121822` |

  `groundShadow` is the iso shadow rule on the ground (`shadowTone`, one `shadeHex` step).
  The ground also becomes the status-bar `theme-color` (`useThemeColor`), and every branch
  (spinner, set-mode done, no cards) paints it, so the page never flashes paper.
  ⚠️ **Outside the colour framework:** the four grounds, night's platform and night's slate
  keycap/ink tones are design-picked hexes that live only in `sortTimeOfDay.ts`.
- **Footer at night.** The slab footer stays **cream** at night, as on the Deck Tower; the
  artboard's night CSS paints it slate, but its own note says the footer keeps its day
  colours, and the slab is shared with the tower.
- **The iso kit is now imported by a second feature** (`features/discover` →
  `features/deckTower/iso`). docs/FRONTEND_LAYERING.md § 1 says it then moves to
  `src/components/iso/`; that move is tracked in DEFERRED_WORK.md.

---

## 5. Sort destinations and Skip

Each card is dragged into one of **two** destinations:

| Destination | Meaning | Effect |
| --- | --- | --- |
| **Add to Learning** | "I want to learn this" — the user **does not yet know** this card. | Card enters the user's library, and counts as evidence about the user's level (they did not know this card). |
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

### 5.3 Bins and session counts
The two destinations are **bins**: iso decks of cards standing on floating platforms in
the upper part of the page (`src/features/discover/SortBins.tsx` → `SortBins`, drawn with
the Deck Tower's iso kit, docs/ISO_ART_FRAMEWORK.md). Learning is on the left, Already
Learned on the right.

| Bin | Deck colour | Counts |
| --- | --- | --- |
| **To Learn** (`library`, the Learning collection) | `LEARNING_COLORS.main` (`RAMP[LEARNING_HUE].surface`, yellow) | cards sorted into it **this visit** |
| **Already Know** (`already-learned`) | `MASTERY_BAR_COLORS.core.main` (blue) | cards sorted into it **this visit** |

- **One hue per collection.** The deck colours are the fdp filter tiles' fills for the
  same collections (`src/features/flashcards/LibraryDuo.tsx`) — collection colours, not
  utcm band colours.
- **Name under the count.** The bin's name is printed flat on the same face as the count,
  directly under it, the pair centred on the deck's top (= the platform's centre). The
  names are **"To Learn"** and **"Already Know"** — the learner's verdict on the card,
  deliberately not the collection names (user choice 2026-10-29; the rest of this doc
  still calls the buckets Learning / Already Learned). A name over
  `NAME_LINE_MAX_CHARS` (8) breaks one word per line ("Already / Know"); "To Learn" stays on
  one line. The name is ≈ 13px (`NAME_SIZE`). A divergence from the artboard, which draws no label. The group's
  `aria-label` reads "To Learn: 3". *Code:* `SortBins.tsx` → `COUNT_AT`,
  `COUNT_NAME_GAP`, `NAME_LINE_MAX_CHARS`; `SortCardsPage.tsx` → `bins`.
- **The deck is the count.** Each bin starts as an empty **dashed footprint** on its
  platform (the bin colour darkened by the look's `footprintShade`: 0.18 by day, 0.45 at
  night, where the grey night platform washes out the pale yellow) and gains one card layer per card sorted into it this visit (alternating
  shaded layers under a top card in the bin's colour). The count is printed flat on the
  top card (or on the platform, greyed, at 0). The deck stops growing at `MAX_LAYERS`
  (20) so it never reaches the toolbar; the printed count stays exact. Undo takes a
  layer back off. A skip touches neither bin. *Code:* `SortCardsPage.tsx` →
  `sessionCounts`, `adjustTally`; `SortBins.tsx` → `SortBin`.
- **Session counts, not library totals (changed 2026-10-29).** The bins used to sit under
  a level-bar tally of the account's whole library (Learning = U+T+C, Mastered), fetched
  from `GET /api/onDeck/categoryCounts`. That tally, its "gulp" animation and its
  `useCategoryCounts` fetch were removed with the redesign; the page no longer shows the
  library totals anywhere.
- **Floating.** Both platforms bob (IsoPlatform `floating`) **in sync**, their
  shadows on the page ground.
- **Drop-target cue.** While a card is held over a bin that bin **grows** to
  `ACTIVE_SCALE` (1.1, about its own box centre, on the tower plate's overshoot —
  `KEYCAP_POP_TRANSITION`), and settles back the moment the card is let go. The growth never moves the hit test (the rects are snapshotted at drag
  start, below). **Nothing changes colour** (user request 2026-10-29): the other bin no
  longer desaturates, and the held card no longer takes a `COLORS.scrim` wash.
  On the held card itself: it lifts once to `HELD_CARD_SCALE` (1.12, Bubble Match's
  `SCALE_HELD`) — **no tilt** (the artboard's −5° `.held` rotate was dropped, user
  request 2026-10-29) — and its **cast shadow grows** as it rises off the ground (`lift`
  0 → 1 eases its offset out to `HELD_SHADOW_GROWTH` × the resting one, ≈ 4.7 → 11.7px;
  back to 0 on a miss). The lift and shadow are
  driven by the card's spring, never React state, because the card must not re-render
  mid-drag.
  *Code:* `SortCardsPage.tsx` → `DraggableCard`, `activeBinId`; `SortBins.tsx` →
  `ACTIVE_SCALE`, `.sort-bins__bin--active`.
- **Hit test.** Each bin's whole SVG group (platform and deck, including its shadow) is
  the drop target, registered by `SortBins` (`registerBin`) and snapshotted at drag start
  (`bucketRectsRef`), so the highlight and the drop share one threshold.
- **A drop despawns the card; the deck plays the place animation.** On release over a
  bin the card is sorted **at once** (`DraggableCard` `onDrop` → `handleSortCard`): it is
  resolved and unmounts where it was let go, leaving its well empty, and a
  pack-completing drop starts the pack exit (§4.1) in the same frame. Nothing travels to
  the bin — the dropped card simply vanishes (user request 2026-10-29; a portalled
  "falling ghost" used to glide it onto the deck). The bin's count rises in the same
  render, and its new top card (with the count) is **set down onto the deck** from
  `PLACE_DROP_PX` (28px) above (`sort-bins__placed`, 320 ms after a 120 ms beat (`PLACE_DELAY_MS`), fading in, with a small
  settle bounce; none under reduced motion). Until it lands, the deck under it keeps
  its OLD top card and number (or the empty footprint and "0"), which the new card then
  covers (`placingFrom`, cleared on the animation's end). **Undo** taking a card back off
  plays it **backwards**: the old top card, still carrying the old number, lifts off and fades
  out over the deck as it now stands (`.sort-bins__lifted`, `liftingFrom`). Any other
  fall in the count (more than one at once) just redraws.
  *Code:* `SortCardsPage.tsx` → `DraggableCard`, `handleSortCard`, `adjustTally`;
  `SortBins.tsx` → `PLACE_DROP_PX`, `PLACE_MS`, `PLACE_DELAY_MS`, `.sort-bins__placed`, `SortBin` (`placingFrom`), `BinPrint`.

### 5.3a Learning supply glow — REMOVED 2026-10-29

The Learning tally pill's yellow "you arrived short of cards" halo went with the tally
(§5.3). Its shared shape (`src/theme/lowSupplyGlow.ts`, `LEARN_NOW_ENOUGH_THRESHOLD`) is
still worn by the fdp's Sort Cards tile (DECKS_FEATURE.md § "Sort Cards tile"); scp no
longer signals when a short learner has sorted enough.

### 5.1 Skip is a de-emphasized action, not a drag target
- Skip is a small lowercase **"skip" keycap at the right end of the toolbar** (level pill ·
  undo · skip, top-right over the bins — §4.9) — not a drag bin. The intent is to
  **de-emphasize** skipping as an option.
- Client implementation: `src/features/discover/SortCardsPage.tsx` → `SortToolbar`,
  `handleSkipPack`.
- Pressing Skip **defers all remaining unsorted cards in the current pack** at once,
  then advances to the next pack. (Already-sorted/locked cards in the pack are
  unaffected — they were never the user's to sort.)
- Each deferred card is recorded **individually**, so it appears on its own in the
  skipped-cards sheet (§5.1a, §7) and can be brought back one at a time.
- A skip carries **no level signal**. Users skip for any number of unknown reasons
  (not interested, distracted, undecided), so a skip must never move the level
  estimate up or down.

### 5.1a Hidden: hold Skip for the skipped-cards sheet
- **Pressing and holding Skip for 2 s** (`SKIP_HOLD_MS`) opens a bottom sheet listing the
  user's currently-skipped cards for the language. It is **deliberately undiscoverable**:
  no label, tooltip, onboarding, or resting-state hint advertises it. Feedback appears
  only once a press is under way: the button's outline traces over the 2 s
  (`HoldProgressRing`, the same timer the sheet's cards use), and a 10 ms vibration fires
  when the sheet opens, on devices with the Vibration API (Android; iOS Safari and
  desktop get none).
- **Only a tap skips.** A press released within 250 ms (`useLongPress`'s `tapMaxMs`) is a
  tap and skips the pack as in §5.1. A press released after that but before 2 s is an
  abandoned hold and does **nothing**. A hold that completes opens the sheet and never
  also skips (the click that follows it is swallowed).
- Inside the sheet:
  - **Tap a card** → the eip for that word (the same opener as an on-deck card's info
    button, §4.7). The eip stacks above the sheet (`depth` 1).
  - **Hold a card for 1.5 s** (`RECYCLE_HOLD_MS`) → a ring traces the card's outline over
    the hold, with a **"recycling…"** label above the card. When the ring closes, the
    card is recycled (its `discover_skips` row is cleared) and fades out of the list.
    Letting go early, moving more than 10 px, or scrolling abandons the hold. As with Skip,
    only a press released within 250 ms counts as the tap that opens the eip; a longer
    abandoned hold does nothing.
  - **Recycle all** → every skipped card back to the supply
    (`POST /api/starterPacks/:language/recycleSkips`).
- Recycled cards are **not** pushed into the current session's queue. They rejoin the
  server supply and arrive through later `fetchNextPack` calls.
- The sheet re-fetches the list each time it opens (it is mounted only while open). A
  failed recycle re-fetches instead of guessing where to restore the card.
- Code: `src/features/discover/SortCardsPage.tsx` → `skipPress`, `SKIP_HOLD_MS`;
  `src/features/discover/SkippedCardsSheet.tsx` → `SkippedCardsSheet`,
  `RecyclableSkippedCard`; `src/hooks/useLongPress.ts` → `useLongPress` (tap vs. hold,
  click swallowing); `src/components/HoldProgressRing.tsx` → `HoldProgressRing` (the
  outline-tracing hold timer, sized to its host); `src/utils/haptic.ts` → `quietHaptic`. Server:
  `POST /api/starterPacks/:language/recycleSkip` → `StarterPacksController.recycleSkip` →
  `StarterPacksService.recycleSkip`.

### 5.2 When skipped cards come back
Skipped cards do **not** re-enter the sort flow automatically (this **replaces** the
earlier "recycle once in-level cards run out" rule). A skipped card returns only when
the user **chooses** to bring it back, in one of three ways:

- **Recycle all** — a button in scp's hidden skipped-cards sheet (§5.1a) clears the
  user's skips for the language, returning all of them to the normal supply as fresh
  single-card fallback packs.
- **Recycle one** — holding a card in the hidden skipped-cards sheet (§5.1a) clears just
  that card's skip.
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
  - **Any "Add to Learning" card in the pack** makes the whole pack's signal negative,
    even if other cards in the same pack were "Already Learned". The target drops to
    **(that pack's level) − 1**. One unknown word at the level is enough.
  - A pack where **every** sorted card is "Already Learned" (no "Add to Learning" at
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
    `packOrder` is a human teaching sequence (applied within each pack's derived level
    = its hardest card's difficulty, migration 177) — packs at a level are written to build
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
- The trigger (`sort-cards__level-dropdown`) is the first keycap of the toolbar (§4.9):
  a fully rounded pill (`keycapSx`, bold) with a trailing `keyboard_arrow_down` glyph.
- A **"DIFFICULTY"** caption under the pill (`sort-cards__level-caption`,
  `LevelCaption`) is a **soft introduction** (si `sortDifficultyCaption`,
  docs/SOFT_INTRODUCTION.md): shown for a learner's first visits, gone once they have
  made **7 visits over at least 7 days** — the artboard draws the pill alone.
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
- The level list itself is `src/features/discover/difficultyLevels.ts` →
  `DIFFICULTY_LEVELS` (shared with the panel); the dropdown adds Auto on top.
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

## 6.7 Client API module — `src/features/discover/starterPacksApi.ts`

scp (`SortCardsPage.tsx`), its Quick Mark grid (`useQuickMarkGrid.ts`) and its
`SkippedCardsSheet.tsx` reach the server through this one module. It exports
`fetchStarterPacks` / `fetchNextPack` / `sortCard` / `skipPack` / `undoSort` /
`fetchSkippedCards` / `recycleSkips` / `recycleSkip` / `fetchQuickMarkPage`.
(`recycleSkip` is used only by `SkippedCardsSheet.tsx`, scp's hidden sheet — §5.1a.)

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

## 7. Skipped cards (no page — the hidden sheet only)

- Skipped cards are reached **only** through scp's hidden skipped-cards sheet (§5.1a):
  hold the Skip button for 2 s. There is **no Discover tile and no route** for them.
  The `/discover/skipped/:language` page (`SkippedCardsPage`) and its Discover bento
  tile were removed 2026-10-12, when the sheet became the sole entry point.
- The sheet lists **all words the user has currently skipped** in the route's language
  (§3), newest skip first (`StarterPacksService.listSkipped`). A card that has since
  been sorted or recycled (by any path) no longer appears.
- The removed page let a learner sort a skipped card straight into Learning /
  Already Learned from a tap popup. The sheet does not: tap opens the eip, and getting a
  skipped word into a bucket means recycling it and sorting it when it comes back.

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
6. **Skip is de-emphasized and signal-free:** Skip is a small keycap in the toolbar
   (not a drag target); pressing it defers all remaining unsorted cards in the pack and never
   changes the user's level estimate, in any quantity.
7. **Pack composition:** a pack shows up to 4 cards (no sentence); cards already in the
   library render locked with a "sorted!" watermark; a pack whose cards are all already
   sorted is never served.
8. **Authored-first supply:** at a level, authored packs are served before system
   fallback single-card packs.
9. **Level adaptation:** a finished pack contributes exactly one signal — any "Add to
   Learning" card in it drops the target to that pack's level minus 1; an all-"Already
   Learned" pack raises the target to that level plus 1. There is no streak or threshold
   to accumulate: one pack, one ±1 move. A skipped (or partially skipped, signal-less)
   pack changes
   nothing. The new target is always anchored on the completing pack's own level, not
   an increment of a possibly-stale running target.
10. **Out of in-level cards:** when the in-level pool is exhausted, the user is served
    nearest adjacent-level packs rather than hitting a dead end.
11. **Skips never auto-return:** skipped cards re-enter the flow only via the hidden
    skipped-cards sheet (Recycle all / hold-to-recycle) or when shown inside an authored
    pack — never automatically.
12. **Skipped sheet truthfulness:** a skipped card appears in the skipped-cards sheet
    until it is sorted or recycled, then disappears from it.
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
17. **Session decks:** both bins start empty (a dashed footprint, "0") on every visit; a
    drop onto a bin adds one layer to its deck and one to its printed count as the card
    lands, Undo takes one back off, and a skip changes neither.
18. **Undo/level interaction (known simplification):** undoing a card action does not
    reverse any level-target change that action's completing pack already triggered —
    the target it moved to stays in effect. See `SortCardsPage.tsx`'s
    `applyPackSignal`.
19. **Hidden skipped sheet:** holding Skip for 2 s opens the skipped-cards sheet without
    skipping the pack, its outline tracing over the hold; nothing at rest advertises the
    gesture, and it is the only way to reach skipped cards. Holding a card in the sheet
    for 1.5 s recycles it; tapping it opens the eip.
20. *(Retired 2026-10-29 with the ⊞ expand button — §4.8.)*
21. **Time of day:** the page's ground, cast shadows and ground ink follow the Deck
    Tower's clock (and a feature tester's pinned phase) through dawn, day, sunset and
    night (§4.9); the cards stay cream in every phase.

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

This asymmetry drives two requirements:

- **Start at the lowest level.** Every user begins at the easiest level for that
  language. A novice will abandon the flow if hit with hard cards; an advanced user
  will patiently sort through a few easy ones (and quickly signal that they're too
  easy). Easy-first is the safe default for an unknown user.
- **Only adapt upward.** Because everyone starts at the bottom, the only adjustment
  the system needs to make is **moving the user's level up** as evidence accumulates.
  There is no symmetric "move down" requirement.
- **Adapt up carefully.** Moving up too aggressively is the failure mode to avoid: a
  user should not end up **consistently** seeing cards far too hard for them. If that
  happens, the level was raised too quickly. Upward adjustment should be paced so
  that being persistently over-leveled does not occur in practice.

---

## 3. Per-language levels

- A user's skill level is **tracked independently per language**. A master of Chinese
  may be a complete novice in Spanish.
- Everything in this document (starting level, adaptation, matching) applies **within
  a single language** and must not leak across languages.

---

## 4. Core interaction requirements

### 4.1 One pack at a time
- The on-deck unit is a **sort pack**: one short sentence plus **up to 3 cards** to
  sort (see §4.5), not a single bare card.
- The user sorts each card in the pack independently into one of the destinations
  (see §5). When **every** card in the pack has been sorted (or the pack is skipped),
  the next pack appears.

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
A **sort pack** groups a short sentence with the vocabulary it teaches:

- **A sentence band.** One example sentence sits at the top of the on-deck area: the
  foreign-language sentence together with its English translation. The band is
  **context only** — it is never sorted. (For Chinese it is rendered with
  per-character pronunciation; for Spanish, as plain text — see §3 and the
  per-language note below.)
- **Up to 3 cards, shown at once.** Below the band, up to three word cards are shown
  simultaneously, all draggable. The user may sort them in **any order** into any
  destination (§5).
- **Two pack sources, one shape:**
  - **Authored packs** — hand-curated for a level, carrying their **own authored
    sentence + translation** and their chosen up-to-3 cards (the cards are words drawn
    from that sentence). These are served first (§6.3).
  - **System fallback packs** — when no authored pack is available, the system serves
    a single word as a pack of **one**, using **that word's own first example
    sentence** for the band.
- **Already-sorted cards are locked.** A card already in the user's library (Add to
  Learn Now *or* Already Learned) appears **undraggable** with a **"sorted!"**
  watermark, so the user still sees the context but cannot re-sort it. A pack in which
  **every** card is already sorted is **never served** — the system skips over it.
- **Previously-skipped cards reappear draggable inside authored packs.** If a card the
  user skipped is part of an authored pack, it is shown **draggable again** (not
  locked) — the pack's context is a fresh chance to sort it. Re-sorting it there clears
  its skip (§5.2).
- **Per-language scope.** The sentence band is a pronunciation-annotated row for
  Chinese and plain text for Spanish; the multi-card sorting behavior is otherwise
  identical across languages.
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
- The **3** most recent card actions are undoable (a pack holds at most 3 cards).
- Undo reverses exactly one action: it removes that card's library/skip record and
  **re-shows the card draggable**. If reversing it requires a pack that has already
  advanced off-deck (e.g. undoing a Skip), that pack is brought back on deck; if the
  action had marked the pack as **seen** (§4.5), undo clears that mark too.

---

## 5. Sort destinations and Skip

Each card is dragged into one of **two** destinations:

| Destination | Meaning | Effect |
| --- | --- | --- |
| **Add to Learn Now** | "I want to learn this" — the user **does not yet know** this card. | Card enters the user's library, and counts as evidence about the user's level (they did not know this card). |
| **Already Learned** | "I already know this." | Card is **stamped as mastered immediately**, and counts as evidence the user's level is at or above this card. |

**Skip is no longer a destination** — it is a de-emphasized action (§5.1), deliberately
removed from the drag targets so the user reaches for a real destination first.

### 5.1 Skip is a de-emphasized action, not a drag target
- Skip is a single **button in the top-right corner** of the sort screen — not a drag
  bucket. The intent is to **de-emphasize** skipping as an option.
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

### 6.1 The system estimates a user level
- The system maintains an **estimated skill level** for the user, per language (§3).
- Every user starts at the **lowest** level (§2).
- The estimate is **refined upward** as the user sorts, based on sort actions that
  carry signal:
  - **Add to Learn Now** tells us the user **does not yet know** that card.
  - **Already Learned** tells us the user **already knows** that card.

  Both inform the level estimate. **Skips carry no signal** (§5.1).

### 6.2 Cards are matched to the level
- The user is normally served cards **at their estimated level**.
- Cards too easy or too hard relative to the estimate are not served during normal
  operation.

### 6.3 Supply order and running out of in-level cards
- **At the estimated level, authored packs are served first** (in their curation
  order), then **system fallback single-card packs** for the remaining un-sorted,
  un-skipped words at that level (§4.5).
- When the user has **sorted all packs at their level**, the flow **offers packs from
  adjacent levels** so the user always has something to sort (§4.4), serving them **as
  close to the user's estimated level as possible** — exhaust the nearest levels first
  and only reach further out as those deplete. The user should drift away from their
  estimated level as gradually as the available cards allow.
- Previously skipped cards do **not** become eligible again here. They re-enter the
  flow only by explicit user action (§5.2), never automatically.

### 6.4 Adaptation must not disturb the on-deck card
- Re-estimation runs in the background and changes which cards are **served next**.
  It must never reorder, swap, or remove the card the user is currently looking at
  (restates §4.2 from the leveling side).

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
7. **Pack composition:** a pack shows its sentence band plus up to 3 cards; cards
   already in the library render locked with a "sorted!" watermark; a pack whose cards
   are all already sorted is never served.
8. **Authored-first supply:** at a level, authored packs are served before system
   fallback single-card packs.
9. **Upward adaptation:** after the user sorts a run of cards indicating a higher
   level, subsequent packs move up toward that level — without overshooting into
   persistently-too-hard territory.
10. **Out of in-level cards:** when the in-level pool is exhausted, the user is served
    nearest adjacent-level packs rather than hitting a dead end.
11. **Skips never auto-return:** skipped cards re-enter the flow only via the Skipped
    page (Recycle all / individual sort) or when shown inside an authored pack — never
    automatically.
12. **Skipped page truthfulness:** a skipped card appears on the Skipped page until it
    is sorted (incl. via the tap popup) or recycled, then disappears from it.
13. **Pack shown once:** a pack the user has finished or skipped is never served again.
14. **Per-card undo:** undo reverses one card action at a time — a sort **or** a skip —
    up to 3 actions back, restoring the card (bringing its pack back on deck if needed)
    and clearing any seen mark.
15. **Never empty:** under normal data volumes the user can sort indefinitely without
    reaching an "all sorted" state.

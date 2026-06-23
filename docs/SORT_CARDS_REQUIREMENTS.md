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

### 4.1 One card at a time
- The user considers exactly **one card** at a time ("on deck").
- The user sorts it into one of the destinations (see §5), then the next card
  appears.

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

---

## 5. Sort destinations

The user sorts each card into one of these destinations:

| Destination | Meaning | Effect |
| --- | --- | --- |
| **Add to Learn Now** | "I want to learn this" — the user **does not yet know** this card. | Card enters the user's library, and counts as evidence about the user's level (they did not know this card). |
| **Already Learned** | "I already know this." | Card is **stamped as mastered immediately**, and counts as evidence the user's level is at or above this card. |
| **Skip for now** | "Not now." | Card is **deferred** — see §5.1. Has **no effect** on the level estimate. |

### 5.1 Skip-for-now behavior
- A skipped card is **not shown again** while the user still has **unsorted cards at
  their level**.
- Skipped cards only **re-enter** the pool once the user has run out of in-level
  cards to see (see §6.3).
- A skip carries **no level signal**. Users skip for any number of unknown reasons
  (not interested, distracted, undecided), so a skip must never move the level
  estimate up or down.

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

### 6.3 Running out of in-level cards
- When the user has **sorted all cards at their level**, the flow should **offer
  cards above and below their level** so the user always has something to sort
  (§4.4).
- When offering these out-of-level cards, the flow must serve cards **as close to
  the user's estimated level as possible** — exhaust the nearest levels first and
  only reach further out as those are depleted. The user should drift away from their
  estimated level as gradually as the available cards allow.
- Previously skipped cards (§5.1) become eligible again at this point.

### 6.4 Adaptation must not disturb the on-deck card
- Re-estimation runs in the background and changes which cards are **served next**.
  It must never reorder, swap, or remove the card the user is currently looking at
  (restates §4.2 from the leveling side).

---

## 7. Acceptance criteria (testable)

1. **Cold start:** a brand-new user entering the flow is shown the easiest cards, not
   hard ones.
2. **Per-language isolation:** a user's progress/level in one language does not affect
   the cards or level shown in another.
3. **Immutability:** while a card is on deck, no background event changes or removes
   it; it leaves the screen only via a user sort.
4. **No wait:** after sorting, the next card is on screen with no perceptible network
   delay; the client always has ≥1 card ready behind the on-deck card.
5. **Already Learned:** sorting a card as already learned stamps it mastered
   immediately.
6. **Skip is signal-free:** skipping cards, in any quantity, does not change the
   user's level estimate.
7. **Upward adaptation:** after the user sorts a run of cards indicating a higher
   level, subsequent cards move up toward that level — without overshooting into
   persistently-too-hard territory.
8. **Out of in-level cards:** when the in-level pool is exhausted, the user is served
   above/below-level cards (and previously skipped cards) rather than hitting a dead
   end.
9. **Never empty:** under normal data volumes the user can sort indefinitely without
   reaching an "all sorted" state.

# Focus Mode — a daily cap of 40 cards per world

**Status:** built on dev (2026-10-20), **not on PPE**. Migration 176 (expand-only; ships with a
plain `/deploy`).

Parent: [DECK_TOWER.md](./DECK_TOWER.md) (the lever lives on its platform). Related:
[PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (a focused round never lends),
[FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md) (a break skips an unplayable game).

---

## 1. What it is

When a learner's pile of off-cooldown cards in one **world** (Main / Reading / Writing —
docs/CONSTRUCTS.md § "Worlds and bars") has grown overwhelming, a lever appears on that
world's Deck Tower platform. Pulling it turns on **focus mode** for that world:

* each streak day (04:00 local) the world serves **at most 40 cards**, a set pinned the first
  time the day's cards are needed;
* a card leaves the set for the rest of the day once it is **marked correct**. A wrong mark
  leaves it in play, so a missed card can be retried.

| Rule | Value | Code |
|---|---|---|
| Lever appears | the world has **100** off-cooldown cards across **all four** utcm bands (U+T+C+M), or focus is already on | `FOCUS_LEVER_THRESHOLD`, `useFocusLever` |
| Daily cap | **40** | `FOCUS_DAILY_CARDS` |
| Auto-off | the day's snapshot finds **fewer than 40** off-cooldown cards | `FocusModeService.resolveWorld` |
| Scope | per **(user, language, world)** | `user_languages."focusWorlds"` |

**Why 100 counts all four bands:** U+T+C+M is what the learner sees as assigned to them, the
pile the feature exists to keep from overwhelming them.

*Code: `server/contracts/focusMode.ts` (numbers + wire shapes).*

## 2. Data model (migration 176)

| Object | Holds |
|---|---|
| `user_languages."focusWorlds"` `text[]` | worlds focus mode is on in. `'{}'` = off everywhere |
| `user_languages."focusEndedNotices"` `text[]` | worlds the server switched off by itself whose popup has not been shown yet |
| `focus_daily_snapshots` | ONE row per (user, language, world): `streakDate` + `vetIds int[]`, overwritten by the first request of each new streak day |

The snapshot is **pinned** because a live recompute would let a new card in every time one was
marked out, and the 40 would never run out. `vetIds` has no FK (vet ids span two physical
tables); a deleted card simply stops matching.

The notice is a column, not a response field, because a snapshot (and so an auto-off) can be
taken by a background request no page is watching: Home's flp preload (`preloadFlpSessions`).

*Code: `server/dal/interfaces/IFocusModeDAL.ts`, `server/dal/implementations/FocusModeDAL.ts`.*

## 3. Picking the daily 40

`FocusModeService` → `selectFocusSet` — the flp working loop's own logic, scaled from 10 to 40:

1. The world's sorted cards (writing world: 1–4-character Han words, the writing flp's rule),
   off cooldown on that world's bar, ranked as a queue, longest-waiting first (`rankCardQueue`).
2. Band quotas: Study Mix's 1-2-2-5 ×4 → **4 Mastered / 8 Comfortable / 8 Unfamiliar /
   20 Target** (`FOCUS_QUOTAS`, derived from `STUDY_MIX_QUOTAS`).
3. A short band's shortfall is borrowed in Mix's fill order, Target → Comfortable → Unfamiliar →
   Mastered (`STUDY_MIX_FILL_ORDER`, shared with the flp's `DEFAULT_LOOP_CONFIG`).

No cooling cards and no lent cards: if fewer than 40 cards are off cooldown, focus switches
itself off (§ 1) instead.

**When:** lazily, by whichever focus-aware request comes first on a new streak day (§ 4) —
the Deck Tower's counts, the flp, a game, `GET /api/focus`. There is no cron. Two concurrent
first-of-day requests agree on one set: `claimSnapshot` only replaces an older day's row.

## 4. Where focus narrows a round

*Code: `OnDeckVocabController.applyFocus`; `routes/flashcardRoutes.ts` (mark refill);
`OnDeckVocabService` → `CollectionFilter` `{ kind: 'focus', ids }`, `deckPlayFilter`.*

On every **unrestricted** launch whose world is focused, the controller substitutes a `focus`
collection holding today's remaining ids (snapshot minus cards marked correct today, re-read on
every request). Riding the collection slot is what makes a focused round behave like a named
set everywhere at once: every candidate query narrows to the ids, and every lend tier is skipped.

| Request | World | Notes |
|---|---|---|
| `GET /api/onDeck/distributedWorkingLoop` | `?world=` | baseline top-up skipped |
| `POST /api/flashcards/mark` (refill) | body `world` | resolved after the mark commits, so the card just marked correct is already out |
| `GET /api/onDeck/gamePool` | `worldForMarkType(markType)` | baseline top-up skipped; a short pool is a smaller board |
| `GET /api/onDeck/wordSearchGrid` | its mark type's world | no lending escalation |
| `GET /api/onDeck/flpReadyCounts` | `?world=` | counts only the remaining set; response adds `focusOn` |

**Not narrowed:** deck / built-in collection rounds (`?deck=`, `?collection=`: a hand-picked set
ignores focus), Study Challenge boards, Memory Map (its own `MemoryMapService` pool) and Writing
Grid (its own DAL).

**Never-block exception.** A focused world deliberately serves fewer cards than a surface's
baseline (`CARD_BASELINES`, PROVISIONAL_CARDS.md § 1). Focus is the learner's own choice to see
less.

**Auto-off signal.** When resolving switches focus off, the response carries
`X-Focus-Ended: <world>` (`FOCUS_ENDED_HEADER`, exposed through CORS in `server/server.ts`).
`src/api/http.ts` → `noteFocusEnded` turns it into the `focus-mode-ended` window event (Word
Search's raw fetch calls it itself).

## 5. Client

| Piece | File | Role |
|---|---|---|
| Lever art | `src/features/deckTower/iso/IsoLever.tsx`, `iso/leverGeometry.ts` | cream base, short thick ink stick, plain red ball, on a lift in a two-flap hatch (ISO_ART_FRAMEWORK.md § IsoLever) |
| Lever motion | `src/features/deckTower/useLeverMotion.ts` | `pull` / `sink` / `hatch` tweens |
| Lever logic | `src/features/deckTower/useFocusLever.tsx` | when it shows, taps, its popups; one per world in `DeckTowerPage` |
| Placement | `towerPlatforms.ts` → `leverAt` (9.85, 1.2) | back-right floor corner; its hatch is a pawn obstacle drawn after the stack |
| Popups | `src/features/focusMode/FocusDialog.tsx` | turn-on / turn-off / ended / game-blocked |
| Auto-off popup | `src/features/focusMode/FocusEndedNoticeHost.tsx` (mounted in `App.tsx`) | checks `GET /api/focus` on sign-in and on every `focus-mode-ended` event; dismiss acknowledges |
| Games menu | `src/features/focusMode/FocusGameGuard.tsx`, wrapping every game route in `src/routes/registry.ts` | refuses a launch with the game-blocked popup, then returns to the menu |
| flp breaks | `useGameBreak` | drops break candidates today's set cannot fill; none left → the break is skipped |

**The lever's life:**

* **Appears** (on the Learn Now deck only): the hatch's flaps swing down, then the lever rises
  on its lift, which stops flush with the floor. The floor under a standing lever is solid, with no seam.
* **Tap while off** → it pulls toward the viewer and "Turn on focus mode?" opens. *No* → it
  springs back. *Yes* → focus goes on and the lever **stays pulled**; the tower re-reads its
  counts and stands at most 40.
* **Tap while on** → "Turn off focus mode?". *Yes* → it springs back. If the full pile still
  holds 100+ cards that is all — the lever stays. Only if it is under 100 does the lever then
  recede into the platform and the flaps swing up to shut the hole. (While focus is on the
  counts are narrowed to today's set, so `useFocusLever` holds the lever up until the re-read
  full counts arrive, rather than sinking it on the stale narrowed figure.)
* Switching to the Mastered deck sinks it.

**A game is refused** when, in every world it can mark (a moded game picks its mode in-game),
focus is on and fewer than `focusGameMinimum(gameId)` cards remain: its `CARD_BASELINES` entry,
or 1 for a game with none (Hydra Bubbles, Memory Map, Writing Grid).

## 6. API

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/focus` | — | `FocusStatusResponse`: per world `{ on, remaining }` + `endedNotices` |
| `POST /api/focus` | `{ world, on }` | the new `FocusStatusResponse` |
| `POST /api/focus/notices/ack` | `{ worlds }` | 204 |

The language is always the account's selected one. Turning a world back on clears its owed
notice. Turning focus off does **not** delete the day's snapshot, so switching off and on again
the same day returns the same 40 rather than a fresh batch.

*Code: `server/controllers/FocusModeController.ts`, `server/routes/focusModeRoutes.ts`,
`src/api/focusMode.ts`. Tests: `server/__tests__/focusMode.test.ts`.*

# Deferred Work — the standing list of things we decided to do later

A single place for work that is **known, agreed to be worth doing, and deliberately not
being done right now**. It exists because the alternative is a `⚠️` buried in a feature doc
that nobody reads again, or a dead function sitting in prod because the person who could
have dropped it was in the middle of something else.

## What belongs here

* Cleanup that is safe but not urgent — a dead function, an unused column, a superseded
  script.
* A follow-up a shipped change knowingly left behind (the classic: the **contract**
  migration of an expand/contract pair).
* A decision that was explicitly postponed rather than made.

## What does NOT belong here

* **Bugs.** A bug is not deferred work, it is a bug.
* **Feature design questions.** Those live in the owning feature doc's question log
  ([ARENA_FEATURE.md](./ARENA_FEATURE.md) § 11, [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)
  § 11) where the surrounding context is.
* **Deploy steps for an unshipped change.** Those go in a
  `docs/<FEATURE>_DEPLOY_RUNBOOK.md` per CLAUDE.md, which is deleted once prod is verified.

## How to use it

Each item states **what**, **why it was deferred**, **what it costs to leave**, and
**what triggers doing it**. An item with no trigger is a wish, not a plan — give it one.
Delete an item when it is done; this file is a queue, not a history.

---

## Open items

### 1. Drop the dead `compute_utcm_category(jsonb, boolean, boolean)`

| | |
|---|---|
| **What** | A one-line contract migration: `DROP FUNCTION IF EXISTS compute_utcm_category(jsonb, boolean, boolean);` |
| **Why deferred** | Migration 143 (three mastery bars) replaced it with `compute_core_category()` but **intentionally retained it** so that old and new application code could both run during the deploy window. That window closed when 143 was verified on prod on **2026-08-11** |
| **Cost of leaving it** | Low but real. It is a dead function that reads like live schema — the next person adding a mastery column will find it and wonder whether to keep it in sync. It is exactly the kind of thing that gets accidentally resurrected |
| **Trigger** | Ride it along with the next migration that ships for any reason. It needs no window of its own and nothing calls it |
| **References** | [MASTERY_REWORK.md](./MASTERY_REWORK.md) (References section), `database/migrations/143-three-mastery-bars.sql` |

### 2. Mastery goal defaults — `users.readingGoal` / `users.writingGoal`

| | |
|---|---|
| **What** | Decide the column defaults before the mastery rework is built |
| **Why deferred** | It is a build-time detail of an unbuilt feature; the doc records `false` as the assumption but it has not been confirmed |
| **Cost of leaving it** | None today. It becomes urgent the moment the migration is written, because the default silently decides whether every existing account's progress bars change height on deploy day |
| **Trigger** | Writing the mastery-rework migration |
| **References** | [MASTERY_REWORK.md](./MASTERY_REWORK.md) § Open questions |

### 3. Per-type vs all-type `totalMarkCount` / `totalCorrectCount`

| | |
|---|---|
| **What** | Decide whether these two counters become per-mark-type or stay all-type aggregates |
| **Why deferred** | Kept all-type for now; nothing depends on the split yet |
| **Cost of leaving it** | Low. It becomes a data-migration question rather than a schema question if the four typed mark tracks ship first and the counters are split afterwards |
| **Trigger** | The mastery rework reaching implementation |
| **References** | [MASTERY_REWORK.md](./MASTERY_REWORK.md) § Open questions |

### 4. Build Study Challenge (phase 1, async) — queued behind Arena

| | |
|---|---|
| **What** | Implement the async Study Challenge. The design is complete: [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) (Q1–Q68) and [STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) (Q69–Q73) have **no open design questions**, and every doc the build depends on was updated on 2026-08-16 |
| **Why deferred** | Arena is mid-build in the working tree and owns the two things this would collide with: `database/migrations/146-create-arenas.sql` and uncommitted edits to `server/contracts/wire.ts`. Two features editing the same contract file at once buys a merge nobody needs |
| **Cost of leaving it** | None. Nothing depends on it and nothing degrades while it waits |
| **Trigger** | **Arena's build landing.** Re-check `ls database/migrations \| sort -V \| tail` first — this feature takes **147**, but only if nothing else claimed it meanwhile |
| **References** | [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) §§ 9–12, [STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md), [GAMES_FEATURE.md](./GAMES_FEATURE.md), [DECKS_FEATURE.md](./DECKS_FEATURE.md), [FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md), [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md) |

#### Deploy-order constraints to resolve before writing the migration

Two migrations this one sits on top of are **not yet on prod**, so the challenge migration
cannot be the first thing that ships:

* **140** (provisional cards) — the `mastered-first` provisioning mode extends it, and its
  runbook says 140 must land **before** the new code, because it writes a bucket value the
  old CHECK rejects. See [PROVISIONAL_CARDS_DEPLOY_RUNBOOK.md](./PROVISIONAL_CARDS_DEPLOY_RUNBOOK.md).
* **145** (`user_language_points` → `user_languages`) — must land before the app restarts.
  See [PER_LANGUAGE_MINUTES_DEPLOY_RUNBOOK.md](./PER_LANGUAGE_MINUTES_DEPLOY_RUNBOOK.md).

#### The build, in dependency order

Steps 1–2 are the contract; everything after depends on them, and 4–7 are largely
independent of each other.

1. **Migration 147** — `study_challenges` (the single table, [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 9),
   `decks."editMode"`, the two `friendships` block booleans, and
   `decks_user_language_name_uniq` rebuilt as a **partial** index
   (`WHERE "editMode" = 'custom'`). All signed off 2026-08-16.
2. **`server/contracts/wire.ts`** — `CHALLENGE_WORD_COUNT`, `CHALLENGE_ROUND_COUNT`,
   `MAX_ACTIVE_CHALLENGES` (6), `ProvisionMode`, and the challenge-eligible-game
   derivation. ⚠️ Merge with whatever Arena left here.
3. **Games** ([GAMES_FEATURE.md](./GAMES_FEATURE.md)) — the `challengeScoring` spec on
   `GameDef` and one spec per eligible game; wire the backgrounding signal into the
   existing `clockPaused` gate in **Bubble Match, Match Speed and Speed Reading** (Word
   Search already does it and is the reference). ⚠️ A challenge's stored game sequence
   needs a `(gameId, mode)` pair, not a bare id — Word Search is eligible only as *Pinyin*.
4. **Server** — `StudyChallengeDAL` (including the insert-only `jsonb_set` round write),
   `StudyChallengeService` (windows, candidate selection, accept transaction, winner
   resolution), controller, routes (⚠️ static segments above `/:id`), DI in
   `server/dal/setup.ts`. Plus `ProvisionalCardService`'s `mastered-first` mode and
   `DeckService`'s preset mutation guard.
5. **Client** — `src/api/studyChallenges.ts` (**no `token` param**),
   `src/features/studyChallenge/*`, the `/friends/challenges` NodePage and its
   language-blind badge, the fifth `/decks` section.
6. **Maintenance job** — `database/cron/expire-study-challenges.sql`, a third `ExecStart`
   in `cow-maintenance.service.template`, and its `Description=` update. ⚠️ A unit-template
   change is **not** rolled out by a git pull; the installer must re-render it.
7. **`docs/STUDY_CHALLENGE_DEPLOY_RUNBOOK.md`** — deliberately not written yet, because it
   must state exact step order and verification SQL for a migration that does not exist.
   Write it in the same commit as the migration, per CLAUDE.md.

**Live mode is phase 2 and is not part of this.** It needs a WebSocket at `/api/ws` and
adds no tables and no columns; it is buildable at any point after phase 1 exists. Its one
demand on this build is that nothing in phase 1 forecloses it — see
[STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) § 11.

---

## Recently closed

_Nothing yet. Move items here only if the reason they were deferred is worth remembering;
otherwise just delete them._

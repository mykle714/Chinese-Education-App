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

---

## Recently closed

_Nothing yet. Move items here only if the reason they were deferred is worth remembering;
otherwise just delete them._

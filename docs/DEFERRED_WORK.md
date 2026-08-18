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

### 1. Build Study Challenge (phase 1, async) — 🚧 **ONE PIECE LEFT as of 2026-08-17**

| | |
|---|---|
| **What** | Implement the async Study Challenge. The design is complete: [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) (Q1–Q68) and [STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) (Q69–Q73) have **no open design questions**, and every doc the build depends on was updated on 2026-08-16 |
| **Why deferred** | It *was* queued behind Arena, which owned the two things it would have collided with: `database/migrations/146-create-arenas.sql` and then-uncommitted edits to `server/contracts/wire.ts`. **That collision is gone as of 2026-08-16** — Arena is committed (`480c80d`, `12159ef`) and shipped to prod, so `wire.ts` is a normal read rather than a merge |
| **Cost of leaving it** | None. Nothing depends on it and nothing degrades while it waits |
| **Trigger** | **Met; the build is DONE except one piece.** Migration **148** applied on dev **and shipped to prod 2026-08-17** (its runbook is retired); the contract, the whole async server stack, the client surfaces, `mastered-first` provisioning, the shared scoring runner, pause-on-background for all four games, the maintenance job and the deploy runbook are all built and tested (see the status table at the top of [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)). **The one thing left is the scored round runner** — see the next row. **Next free migration number is 150** — 149 is the lifetime-counter drop |
| **What is left** | The per-game board integration only: a challenge-board pool read (ten contested cards + `mastered-first` filler, extending `/api/onDeck/gamePool` rather than adding a second loader), contested/filler classification inside Bubble Match / Match Speed / Word Search-Pinyin with `ChallengeEvent`s fed to `src/games/runtime/challengeScoring.ts`, Match Speed's alternation rule (§ 5.3), and the between-games scoreboard + round POST. Everything it depends on exists and is tested; this is wiring inside the three most complex pages in the app, which is why it was not rushed alongside the rest |
| **References** | [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) §§ 9–12, [STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md), [GAMES_FEATURE.md](./GAMES_FEATURE.md), [DECKS_FEATURE.md](./DECKS_FEATURE.md), [FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md), [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md) |

#### Deploy-order constraints to resolve before writing the migration

**Resolved 2026-08-16 — no longer a constraint.** Both migrations this one sits on top of
are now on prod: **140** (provisional cards, shipped 2026-08-08) and **145**
(`user_language_points` → `user_languages`, shipped 2026-08-16). Prod is current through
146, so the challenge migration is free to be numbered and shipped on its own.

#### The build, in dependency order

Steps 1–2 are the contract; everything after depends on them, and 4–7 are largely
independent of each other.

1. **Migration 148** — `study_challenges` (the single table, [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 9),
   `decks."editMode"`, the two `friendships` block booleans, and
   `decks_user_language_name_uniq` rebuilt as a **partial** index
   (`WHERE "editMode" = 'custom'`). All signed off 2026-08-16.
2. **`server/contracts/wire.ts`** — `CHALLENGE_WORD_COUNT`, `CHALLENGE_ROUND_COUNT`,
   `MAX_ACTIVE_CHALLENGES` (6), `ProvisionMode`, and the challenge-eligible-game
   derivation. Arena's additions to this file are already committed — read the current
   file and add alongside them; there is nothing to merge.
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
7. **Deploy runbook** — written with the migration, used on 2026-08-17, and deleted once
   prod was verified, per CLAUDE.md. Its one gap is recorded in the CLAUDE.md deploy
   notes: it assumed a single `migrate.sh` pass, but 148 (expand) had to precede the
   rebuild and 149 (contract) had to follow it.

**Live mode is phase 2 and is not part of this.** It needs a WebSocket at `/api/ws` and
adds no tables and no columns; it is buildable at any point after phase 1 exists. Its one
demand on this build is that nothing in phase 1 forecloses it — see
[STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) § 11.

---

### 2. Read the `[MarkSuppressed]` log and decide whether fill tier 4 should go

*Added 2026-08-18 with Hydra Bubbles. Code: `server/routes/flashcardRoutes.ts` (the
`[MarkSuppressed]` branch), `OnDeckVocabService.getGameVocabPool` (the fill tiers).
Docs: [HYDRA_BUBBLES.md § 8.1](./HYDRA_BUBBLES.md),
[GAMES_FEATURE.md](./GAMES_FEATURE.md) § the five fill tiers.*

**What changed.** A card's per-type cooldown is now a hard **"next markable at"**: a
mark landing inside the window is not recorded. Enforced once, server-side, at
`POST /api/flashcards/mark`, so no surface opts in or out.

**The collision this creates.** `getGameVocabPool`'s fill **tier 4 serves cooled
cards on purpose** — it is what lets a small library still assemble a full board on a
second round back to back. Those marks were recorded before this change and are
silently dropped now. The learner sees a normal round with normal scoring and **no
movement in their history**, with nothing in the UI to explain it.

**Why it shipped anyway.** The frequency of the collision is unknown, and both
alternatives trade a known cost for an unmeasured one: deleting tier 4 and lending
instead grows every small learner's provisional holding, and scoping the guard by
serving context needs a per-request trust flag, which is exactly the thing the
single-chokepoint design rules out.

**The task.** Read the log, then choose. It carries user, card, language, mark type,
the cooldown window in force, the serving `surface`, and whether the mark was
positive — the `surface` is there to separate the two cases, because
deck/collection rounds also suppress marks and **that** suppression is intended
(HYDRA_BUBBLES.md § 6.3). Specifically:

1. What share of suppressed marks come from tier 4 on an unrestricted round?
2. Is it concentrated in a few small-library accounts, or spread across everyone?
3. If it is material: delete tier 4 in favour of lending, or give the learner
   feedback ("resting until tomorrow") rather than silence?

**Until then:** a small-library learner can play a full round and earn nothing, with
no error and nothing visibly different.

### 3. Teach learners about bound-form words (the huìzi class)

| | |
|---|---|
| **What** | A short learner-facing note on the ~10 **hosted** forms in det (`一会儿`, `一辈子`, `一家子`, `一阵子`, `这会儿` …) saying the word is a fixed unit and its tail is not a standalone word. Full spec, the complete 14-item class, and four open questions: [BOUND_FORM_WORDS.md](./BOUND_FORM_WORDS.md) § 6 |
| **Why deferred** | The **data** half shipped on 2026-08-17 — the 6 bound bases were deleted from prod det (+1 vet row) and both re-entry paths are now gated by `boundForms.js`. That stopped the app teaching a bad card, which was the urgent part. The **teaching** half is new UI with an undecided surface (eip tab vs. bt inline copy vs. cdp chip) and so is not a same-day change |
| **Cost of leaving it** | Moderate and silent. A learner meeting `一会儿` has no way to know `会儿` is not a word, and the bt actively misleads by decomposing the word into `一` + `会` + `儿` — implying a compositional reading that does not hold. They will infer wrong and produce ungrammatical Mandarin. Nothing in the app currently corrects this |
| **Trigger** | The next piece of eip/cdp work that touches the bt or adds a tab — the note should ride along rather than claim a surface of its own. Decide open question § 6.1 (where it lives) at that point |
| **⚠️ Do not** | Add a det column for this without asking first (CLAUDE.md rule). The note is derivable at read time from `ZH_BOUND_FORMS`, which needs no migration and cannot drift from the denylist — that is the recommended route |
| **References** | [BOUND_FORM_WORDS.md](./BOUND_FORM_WORDS.md), `server/scripts/backfill/shared/lib/boundForms.js` |

---

## Recently closed

### Two runbooks with false "NOT YET DEPLOYED" banners (closed 2026-08-17)

`FREQUENCY_SCORE_DEPLOY_RUNBOOK.md` (migration 122) and `SENSE_COMMONALITY_DEPLOY_RUNBOOK.md`
(migration 139) **deleted** — both migrations are on prod, and per CLAUDE.md a temporary
runbook is deleted once prod is verified. Recoverable from git history if ever needed.

Both were read end to end before deletion rather than dropped on their banners, which is
how the frequency runbook's **§7 re-scoring step** was caught: a post-deploy data step that
was never run and would have been deleted along with the file. It was **reviewed and
deliberately not queued** — the re-run costs one Sonnet call per row and the resulting
mis-ranking is accepted for now; the full state, measurement query and run instructions
live in [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) § "`frequencyScore` — what the
1–5 number means", which is the owning doc. The
sense-commonality runbook held nothing outstanding — its behaviour notes and the
backfill-guard caveat already live in [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md).

**The transferable lesson:** a deploy runbook can be simultaneously stale about the deploy
and load-bearing about what comes after it. Read the whole file before deleting one — the
banner is about the migration, not about every step in the document.

### Per-type vs all-type `totalMarkCount` / `totalCorrectCount` (closed 2026-08-17 — question dissolved)

Resolved by **deleting both columns** (`database/migrations/149-drop-lifetime-mark-counters.sql`)
rather than by answering the question. A repo-wide search established they had been
**write-only since migration 101**: 101 dropped the three success-rate columns that were
their only consumers and kept the raw counters, and nothing picked them up again — no
sort, filter, aggregate or join, no service, and zero references in `src/`.

The lesson worth keeping: the "per-type or all-type?" framing presumed a reader. Asking
*who consumes this* before *what shape should it be* dissolved a standing schema decision
into a deletion. **Deployed and verified on prod 2026-08-17** (0 leftover columns across
`vocabentries_zh` / `vocabentries_es`). Being a **contract** migration, it was applied
*after* the container rebuild rather than in one `migrate.sh` pass with 147/148 — 148 had
to land before the new code and 149 after it, so the batch was split around the rebuild.

Note the ⚠️ one-way door: the lifetime tallies are gone and unreconstructible
(`typedMarkHistory` keeps only 8 marks per type). Accepted — nothing read them, and a
future lifetime statistic would start counting from zero.

### Drop the dead `compute_utcm_category()` (closed 2026-08-17 — done)

`database/migrations/147-drop-compute-utcm-category.sql`, the contract half of migration
143 (whose deploy window closed when 143 was verified on prod on 2026-08-11).
**Deployed and verified on prod 2026-08-17**: `pg_proc` now holds exactly
`compute_core_category(jsonb)` and `compute_type_category(jsonb,text)`, so the mirror set
is four-way as intended and the phantom fifth is gone.

### Mastery goal defaults — `users.readingGoal` / `users.writingGoal` (closed 2026-08-17)

Resolved as the doc assumed: **`boolean NOT NULL DEFAULT false`**, i.e. an existing
account pursues neither reading nor writing until it opts in, so no account's bars change
on deploy day. Confirmed against the live columns, not just the design doc.

### Study Challenge deploy-order constraints (closed 2026-08-16)

Migrations 140 and 145 were blocking the challenge migration from shipping first. Both
are now on prod; prod is current through 146. Kept here because the *shape* of the
constraint recurs: a new migration that depends on an unshipped one cannot be numbered
until the dependency lands.

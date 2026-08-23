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

### 1. Tell the learner when a card is resting and earning nothing

*Added 2026-08-18 with Hydra Bubbles; narrowed 2026-08-20 when lending moved to the
bottom of the fill ladder. Code: `server/routes/flashcardRoutes.ts` (the
`[MarkSuppressed]` branch), `OnDeckVocabService.getGameVocabPool` /
`getDistributedWorkingLoop` (the fill tiers). Docs:
[HYDRA_BUBBLES.md § 8.1](./HYDRA_BUBBLES.md),
[PROVISIONAL_CARDS.md § 4b](./PROVISIONAL_CARDS.md).*

**What changed.** A card's per-type cooldown is a hard **"next markable at"**: a mark
landing inside the window is not recorded. Enforced once, server-side, at
`POST /api/flashcards/mark`, so no surface opts in or out.

**The collision.** Every surface now serves **cooled cards** when its fresh tiers come
up short — and since 2026-08-20 it does so *in preference to lending*, so this is more
common than when the item was written, and deliberately so. The learner sees a normal
round with normal scoring and **no movement in their history**, with nothing in the UI
to explain it. On the flp the session simply ends: a suppressed mark returns
`newCard: null`, so the loop winds down after the cards it was given.

**Resolved, and no longer part of this item:** *should the cooled tier be deleted in
favour of lending?* No. Lending was demoted below it instead — minting words the learner
never chose was the worse failure, and it was growing provisional holdings without bound
(PROVISIONAL_CARDS.md § 4b). The `[MarkSuppressed]` log keeps its remaining job: telling
ordinary cooled-tier suppression apart from the deck/collection suppression that is
intended (HYDRA_BUBBLES.md § 6.3).

**The task that remains is UI.** Give the learner feedback rather than silence —
"resting until tomorrow" on the card, a muted state on a bubble, or an end-of-session
line saying how much of the round counted. The server already knows: the response
carries `suppressed: true`, and **no client reads it today**.

### 2. Teach learners about bound-form words (the huìzi class)

| | |
|---|---|
| **What** | A short learner-facing note on the ~10 **hosted** forms in det (`一会儿`, `一辈子`, `一家子`, `一阵子`, `这会儿` …) saying the word is a fixed unit and its tail is not a standalone word. Full spec, the complete 14-item class, and four open questions: [BOUND_FORM_WORDS.md](./BOUND_FORM_WORDS.md) § 6 |
| **Why deferred** | The **data** half shipped on 2026-08-17 — the 6 bound bases were deleted from prod det (+1 vet row) and both re-entry paths are now gated by `boundForms.js`. That stopped the app teaching a bad card, which was the urgent part. The **teaching** half is new UI with an undecided surface (eip tab vs. bt inline copy vs. cdp chip) and so is not a same-day change |
| **Cost of leaving it** | Moderate and silent. A learner meeting `一会儿` has no way to know `会儿` is not a word, and the bt actively misleads by decomposing the word into `一` + `会` + `儿` — implying a compositional reading that does not hold. They will infer wrong and produce ungrammatical Mandarin. Nothing in the app currently corrects this |
| **Trigger** | The next piece of eip/cdp work that touches the bt or adds a tab — the note should ride along rather than claim a surface of its own. Decide open question § 6.1 (where it lives) at that point |
| **⚠️ Do not** | Add a det column for this without asking first (CLAUDE.md rule). The note is derivable at read time from `ZH_BOUND_FORMS`, which needs no migration and cannot drift from the denylist — that is the recommended route |
| **References** | [BOUND_FORM_WORDS.md](./BOUND_FORM_WORDS.md), `server/scripts/backfill/shared/lib/boundForms.js` |

---

### 3. A5's three unbuilt atoms — `.modal`, `.sheet`, `.scrim`

| | |
|---|---|
| **What** | Three of the fifteen shelf-system generic atoms have no shared implementation: `.modal` (scrim + centred grey card + one dark CTA), `.sheet` (pull-up panel, `top:176px`, radius 26, grab handle) and `.scrim` (a flat 28% ink overlay). Spec: [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A5 |
| **Why deferred** | Each already has ONE live bespoke implementation — `HydraLendNotice` for the modal, the decks preview panel (entry 2) for the sheet, MUI `Backdrop` for the scrim — and none is repeated often enough to have drifted. Extracting a primitive from a single caller invents an API from one data point; the second caller is what tells you which parts are actually shared |
| **Cost of leaving it** | Low for now, rising. The moment a second sheet or a second blocking modal is written, the two will disagree on radius, top offset, grab-handle size and scrim opacity, and the fix becomes a reconciliation rather than an extraction |
| **Trigger** | The second caller. Whichever entry next needs a pull-up panel or a blocking modal extracts the primitive as part of its own work rather than inlining a third copy |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A5, `src/components/primitives/` |

### 4. Moderation for user-authored text shown to strangers — starting with the arena message

| | |
|---|---|
| **What** | A system for handling text one user writes and 24 strangers read. The first (and today only) such surface is the **arena message** (`users."arenaMessage"`, migration 152, [ARENA_FEATURE.md](./ARENA_FEATURE.md) § 2.1a) — one line under each competitor's name on the `/arena` board. At minimum it needs: a **report** affordance on a row, somewhere for reports to land, a **takedown** path (clear the message and keep it cleared), and a decision about whether a cleared account may write another. Probably also a cheap pre-filter on write, and a per-account rate limit so a takedown is not undone in one tap |
| **Why deferred** | The message shipped 2026-08-21 with SHAPE checks only — `ArenaService.setMessage` strips control characters, collapses whitespace, trims and caps at 80 — and none of that is judgement. Moderation was not built alongside it because the correct design depends on facts we do not have yet: how many people write one at all, and whether abuse arrives as a trickle (a human queue is fine) or not at all (a report button and nothing else is fine). Building a review queue for a feature nobody uses is the more expensive mistake |
| **Cost of leaving it** | **Currently low, and it stops being low the day the app has strangers in it.** Prod has no customers ([memory: prod is effectively a PPE](../CLAUDE.md)), and arena boards are mostly synthetic padding — bots draw their lines from a fixed pool and cannot type anything. So today the realistic blast radius is one tester reading another tester's line. The moment real users share a board, this is an unmoderated broadcast channel to 24 people who did not consent to each other, and the arena is the one surface a user **cannot leave mid-week** |
| **Trigger** | ⚠️ **Before the arena carries real strangers** — whichever comes first: the first non-tester cohort, or a second surface adopting user-authored public text (a profile blurb, a deck description shown to others, a challenge taunt). Do not ship a second such field before this exists; the second one is what makes an ad-hoc fix permanent |
| **Interim mitigation** | The write path is a single chokepoint by design (`ArenaService.setMessage` → `ArenaDAL.setArenaMessage`, the ONLY writer of the column), and `{ message: null }` clears it. So an urgent takedown today is one `UPDATE users SET "arenaMessage" = NULL WHERE id = …` and nothing else in the app needs to change |
| **References** | [ARENA_FEATURE.md](./ARENA_FEATURE.md) § 2.1a, `server/services/ArenaService.ts` → `setMessage`, `database/migrations/152-add-arena-message.sql`, `src/features/arena/ArenaMessageDialog.tsx` |

### 5. A lapsed challenge invitation still spends one of the issuer's six slots

| | |
|---|---|
| **What** | `StudyChallengeDAL.countActiveForUser` counts `pending` rows the user issued, and a `pending` row is only rewritten to `expired` by pass 1 of `database/cron/expire-study-challenges.sql`. Between the challengee's Wednesday 04:00 and the next run of that job, the challenger is carrying a slot against a challenge nobody can accept any more. Every OTHER read derives the lapse live ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § "The read path never waits for the job") — this count is the one that cannot |
| **Why deferred** | The count is a SQL aggregate and the deadline is per-challengee-timezone, so deriving it in SQL means joining `users.timezone` and re-deriving `DATE '2026-01-05' + 7 * "weekIndex" + 2` at 04:00 per row — a fourth copy of the boundary arithmetic (`server/shared/challengeWeek.ts`, the cron SQL, migration 150 already hold three), in the hot path of the challenges page, to reclaim a slot the hourly job reclaims anyway |
| **Cost of leaving it** | On prod, at most one hour of a slot, and only for a user who is at 6 of 6 with a lapsed invitation among them — they would see "You're in 6 challenges this week" briefly. On **dev**, where the timer is not installed, the slot stays spent until the SQL is run by hand |
| **Trigger** | If the cap ever drops, if the job's cadence ever slows, or if the boundary arithmetic gets a shared SQL helper for another reason — at which point this becomes a one-line change rather than a fourth copy |
| **References** | [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 1 "How many at once", § "The maintenance job (Q60)", `server/dal/implementations/StudyChallengeDAL.ts` → `countActiveForUser` |

---

## Recently closed

### Build Study Challenge, phase 1 async (closed 2026-08-22 — DONE)

The whole feature shipped in stages: migration 148 + the server stack + the client
surfaces (2026-08-17, on prod), and **the scored round runner on 2026-08-22** — the last
piece, and the one this entry stayed open for. It needed no migration.

What the runner turned out to be, for anyone reading the old plan: `?challengeId=` on the
EXISTING pool endpoints rather than a second loader (as the entry required), one gate
(`StudyChallengeService.getRoundContext`) deciding round/game/window, one assembler
(`OnDeckVocabService.getChallengeGamePool`) producing contested + `mastered-first` filler
SHUFFLED, and one client hook (`useChallengeRound`) owning the accumulator and the
active-time clock so four games could not drift into four readings of the same spec. The
full path is [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.2a.

Two things the plan did not anticipate, both recorded in that section: Word Search needed
an **8×8** grid (twelve 4-character words do not fit 49 cells), and **Hydra Bubbles is a
deliberate exception to the `mastered-first` filler rule** — its filler is its colour
economy, and mastered-first filler would make every bubble bloom.

**Live mode is phase 2**, needs a WebSocket at `/api/ws`, adds no tables and no columns,
and is buildable at any point now that phase 1 exists —
[STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) § 11.

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

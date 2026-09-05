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
bottom of the fill ladder. Code: `server/services/FlashcardMarkService.ts` →
`applyMark` (the `[MarkSuppressed]` branch), `OnDeckVocabService.getGameVocabPool` /
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

### 6. Pinyin is one shared setting across three games, and Hydra's track does not follow it

| | |
|---|---|
| **What** | Two halves of one decision (2026-08-23), designed and **not built**. (a) `showPinyin` lives in the flp's `useFlashcardLearnSettings` (`flashcard.learn-settings`) and is read *and written* by Bubble Match, Hydra Bubbles and Match Speed, so a change in one game silently changes the other two plus the cdp/scp/dictionary display. It should be **per game**, following `useWordSearchSettings` / `useDiscoverSettings`. (b) Hydra should then adopt the track rule — pinyin off on a zh board ⇒ `reading` — latched before the first spawn |
| **Why deferred** | (a) is small but touches five components; (b) is not. Hydra's tier ladder and its two color buffers are keyed on the mastery bands of the track it pools by, so a reading run re-bands the entire board — and a sparsely-marked reading track puts nearly every card in drain, which is the side that grows the board. Whether the § 3.1 spawn table still terminates under that mix is an open question (O5) that has to be answered before the conversion can ship |
| **Cost of leaving it** | A learner who switches Bubble Match to Reading loses pinyin in Hydra and Match Speed without asking, and Hydra keeps writing `recognition` marks for a board it is drawing as a reading board — the mark no longer describes what the player did. Match Speed is display-only, so it is merely surprising there |
| **Trigger** | Ship (a) whenever a game's settings are next touched — it stands alone and fixes the leak. (b) waits on O5 |
| **References** | [GAMES_FEATURE.md](./GAMES_FEATURE.md) § "Pinyin is a per-game setting", [HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md) § 6.0 + § 11 O5, [MASTERY_REWORK.md](./MASTERY_REWORK.md) § 1a, `src/hooks/useFlashcardLearnSettings.ts` |

---

### 7. Mastery scoring ignores guess odds, and reading/writing mastery has no buffer

| | |
|---|---|
| **What** | Two reworks of the same scoring core (design: [MASTERY_REWORK.md](./MASTERY_REWORK.md) § 8). (a) **Choice-aware marks** — `positiveCount` credits every `isCorrect` equally, but Speed Reading is a 1-in-2 guess, Match Speed 1-in-5, and the **last pair on a Bubble Match / Hydra board is correct by construction**, so it is a guaranteed positive for zero knowledge, once per board. (b) **A buffer zone for the reading and writing bars** — core's Mastered is `min(rec, pro) ≥ 6` (two slots of slack per track), while the single-track bars need a perfect 8/8, so ONE wrong mark un-masters a card and the bar flaps between bands session to session |
| **Why deferred** | Both edit the same three chokepoints in lockstep — `ReviewMark`/`positiveCount`/`categoryForPbh` in `server/contracts/` plus the SQL mirrors `mastery_positive_count()`, `compute_core_category()` (mig 143) and `compute_type_category()` (mig 128) — so doing them separately pays the TS↔SQL sync cost twice. And the design is not settled: true hysteresis needs stored state, which breaks the invariant that a band is a pure function of one row (the reason `compute_core_category()` is `IMMUTABLE` and no category expression joins another table). Six open questions in § 8.4 |
| **Cost of leaving it** | A learner who taps randomly through Speed Reading reaches **Target** on the reading bar; every board hands out one free positive; and a reading-mastered card bounces out of Mastered on a single bad tap, which also inflates velocity (a `category_promotions` row per crossing) and flips Memory Map membership and the card's cooldown between 14 and 180 days |
| **Trigger** | ⚠️ Do NOT ship a band change casually — `computeTypeCategory` is the same function games bucket and cool on, so it moves Memory Map membership, pool quotas and review scheduling retroactively (§ 8.3). **Option (C) — emit no mark when the choice set has one element — is separable, needs no schema or SQL change, and can land any time** ahead of the rest |
| **References** | [MASTERY_REWORK.md](./MASTERY_REWORK.md) § 8 (§ 8.1 choice odds, § 8.2 buffer, § 8.3 blast radius, § 8.4 open questions), [MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md) § 2.1, [VELOCITY.md](./VELOCITY.md), `server/contracts/mastery.ts`, `server/contracts/cooldown.ts` |

---

### 8. Two components render the design's `.shelfhd`, and a page can pick either

| | |
|---|---|
| **What** | `ShelfHeader` (`src/components/shelf/Shelf.tsx`) and `SectionHeader` (`src/components/primitives/Label.tsx`) both render the design's `.shelfhd` — a mono overline with an optional right-hand affordance — at the identical `19px 22px 0` padding. Neither is a superset: `ShelfHeader` takes `children` (so it can hold two `Label`s), `SectionHeader` takes a `label` node plus an `action` glyph name and an `actionLabel` for a11y |
| **Why deferred** | They were built in different parts of Part A (A3 and A5) for different reasons, and the split reads as intentional until you put them side by side. Collapsing them means picking one API and touching every caller; nothing is broken while both exist |
| **Cost of leaving it** | A page that needs both a shelf caption and a section caption uses two components that look identical, which is how the next divergence gets introduced. Entry 5 (Account) hit exactly this and picked `SectionHeader` for both, so its library header is a shelf caption drawn by the non-shelf component |
| **Trigger** | The next entry to touch A3 or A5. Merge into `SectionHeader` (the richer API), keep `ShelfHeader` as a re-export or delete it, and fix the `DecksPanelBody` / Reader / Account call sites |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A3, § A5, entry 5; `src/components/shelf/Shelf.tsx`, `src/components/primitives/Label.tsx` |

---

### 9. The decks page `.duebar` has no "due today" figure (the card hand now does)

| | |
|---|---|
| **What** | **RESOLVED for the card hand.** All three `StudyHand` figures are now cooldown-aware ready counts (`src/utils/flpReadiness.ts`), so Challenge + Review == Study Mix and each card says how many cards a session could deal right now. What remains is the `.duebar`'s LEFT slot, which artboard 2 reads as **"24 due today"** and which still prints the library SIZE |
| **Why deferred** | The original deferral — "it is server work: a DAL count, a service method, a controller route and a wire type" — turned out to be **wrong about the cost**. No server work was needed: the fdp already loads every sorted card (`useDecksPanel` → `fetchCollectionCards(ALL_COLLECTION_ID)`), those rows carry `typedMarkHistory`, and the cooldown arithmetic is a client-importable contract (`server/contracts/cooldown.ts`) that `vocabSort` was already using on the same page. Restating `rankFlpEligible`'s predicate on the client cost one pure util. The remaining `.duebar` slot is a **copy** decision, not a data one: "due today" is a different claim from "ready now" (it implies a deadline the app does not model), so the slot was left alone rather than filled with a number whose label would be a lie |
| **Cost of leaving it** | Small and shrinking. The headline still reads as a library size where the artboard wanted urgency — but the three figures directly beneath it now carry exactly that signal, so the page no longer leaves a learner unable to tell whether a session will serve them anything |
| **Trigger** | A copy pass on the `.duebar`. If it should show readiness, `flpReadyCountsByBand` already returns it — the work is deciding what the slot SAYS, not computing it |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) entry 2; [DECKS_FEATURE.md](./DECKS_FEATURE.md) § "The card hand"; `src/utils/flpReadiness.ts`; `src/features/flashcards/FlashcardsDecksPage.tsx` → the `.duebar`; `server/services/OnDeckVocabService.ts` → `rankFlpEligible` |

---

### 10. Three figures the redesigned card surfaces draw but cannot fetch

| | |
|---|---|
| **What** | Three separate artboard elements whose data does not reach the client. **(a)** Artboard 2's Mastered tile reads **"+17 this week"**; `masteredAt` (migration 142) makes the delta derivable but no endpoint exposes it, and `LibraryDuo` now renders no sub-caption at all (label + figure only). **(b)** Artboard 25's breakdown tab ends in a titled paragraph, **"How the parts make the word"**; the det tables carry `breakdownElaboration` for exactly this, but it is not on `server/contracts/wire.ts` and no read path selects it, so `BreakdownRow` renders the rows and stops. **(c)** Artboard 20's `.dfx` shows a per-POS sense count; that one IS derivable (`definitionClusters[].pos`) and ships, but only for CLUSTERED entries — an unclustered word gets the POS list with no counts, deliberately |
| **Why deferred** | (a) and (b) are each one column on an existing response plus its enrichment path; neither blocked the layout, and both were cheaper to leave a hole for than to add mid-pass. (c) is not deferred at all — it is the correct behaviour, listed here so nobody "fixes" it by defaulting to 1 |
| **Cost of leaving it** | (a) the sheet's Mastered tile shows a total with no sense of movement, which was the tile's whole argument for existing beside Learn Now. (b) the breakdown tab answers "what is this made of" but not "why does that add up to this meaning", which is the more interesting half |
| **Trigger** | (b) is the cheaper and more valuable one: add `breakdownElaboration` to the det read path and the wire `VocabEntry`, then render it under the rows. (a) when a velocity/streak pass is next touching `masteredAt` |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) entries 2 and 19–25; `src/features/flashcards/LibraryDuo.tsx`, `src/features/flashcards/BreakdownRow.tsx`, `src/features/flashcards/DefinitionFacts.tsx`; [BREAKDOWN_FEATURE_IMPLEMENTATION.md](./BREAKDOWN_FEATURE_IMPLEMENTATION.md) |

---

### 11. A drilled-in eip word lost its Add-to-Deck and Compare

> **Compare half: fixed and then REVERTED, both on 2026-09-04.** The eip entry header briefly
> carried a `compare_arrows` button (`InfoCardPanelBody`'s `onCompare`) acting on the word the
> header was showing; it was removed at the user's request, along with the `onCompare` prop on
> `InfoCardPanelBody`/`InfoCardSection` and its four call sites. Compare is once again reachable
> only from `WordToolsRail` above the card, so both halves of this item are deferred: a
> drilled-into word must be opened as its own page before it can be filed OR compared. See
> [WORD_COMPARE_FEATURE.md](./WORD_COMPARE_FEATURE.md).

| | |
|---|---|
| **What** | `InfoCardActionBar` (Add to Deck… / Compare To… / Practice Writing Me) rode at the end of the eip's definition tab and is **deleted**: artboards 20–25 make the panel information-only, so its three actions moved to the surfaces that own them — `CardOpsRail` on the card (add to deck) and `WordToolsRail` above it (compare, write it). Those rails act on the **card's** word. A word the learner has DRILLED INTO from the breakdown rows or an example segment therefore has no in-panel way to be filed or compared |
| **Why deferred** | It is a deliberate consequence of the design's own rule ("card operations have left the panel entirely"), not an oversight, and there IS a path: the breakdown rows are tappable and open that word's own page, where both actions live. But it is one more navigation than before for a real thing learners do |
| **Cost of leaving it** | Filing a component character into a deck costs a drill-in instead of a tap. Nothing is unreachable |
| **Trigger** | If it comes up in use. The fix is NOT to put the action bar back — it is to let the word trail's active pill carry a small ops affordance, so the actions stay attached to "the word you are looking at" rather than to a tab body |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) entries 19–25; `src/features/flashcards/FlashcardsLearnPage/InfoCardTabContent.tsx` (the comment at tab 0), `src/components/WordToolsRail.tsx`, `src/features/flashcards/FlashcardsLearnPage/CardOpsRail.tsx` |

---

### 12. A silent cloud→browser TTS fallback, with nothing counting it

| | |
|---|---|
| **What** | `useTTS.speakText` catches ANY cloud-provider failure and re-speaks through `WebSpeechProvider`, logging one `console.warn` and nothing else. No counter, no beacon, no server-side record — the app cannot answer "how often is narration falling back, and since when". Wanted: a fallback metric. Cheapest useful shape is a `kind: "tts-fallback"` record on the EXISTING client sink (`POST /api/diagnostics/error` / `perf`, `src/utils/errorReporting.ts` → `server/utils/diagnosticsLog.ts`) carrying the reason (HTTP status vs network vs decode vs `Web Audio unavailable`), the lang and the surface — plus a server-side counter of `TTSController.synthesize` failures grouped by upstream status, since one Google 403 is a fleet-wide outage and 200 client beacons for it are 200 records of the same fact |
| **Why deferred** | Found 2026-08-24 while diagnosing "the redesign broke TTS". It had not broken: Google TTS had been returning **403 `BILLING_DISABLED`** on project `cow2-497203` since ~2026-08-21, so every disk-cache MISS fell back to the browser voice while cached words still played the good voice. Three days, no signal — the only evidence was a `docker logs` grep and the newest mtime in `server/cache/tts/`. Building the metric was not the task in hand |
| **Cost of leaving it** | A provider outage is invisible until a human notices the robot voice and correctly attributes it — and the natural attribution is "whatever we changed last", which is what happened here. For a tone language the fallback is a correctness regression, not a cosmetic one: the browser voice ignores the SSML `<phoneme>` hint that makes a polyphone read the sense we display. Secondary: with no fast-fail, every uncached word re-pays a full round-trip to a provider we already know is refusing us |
| **Trigger** | Next time narration is touched, or the first time this fallback is diagnosed a second time. Do the server-side counter first — it is the one that catches an outage without depending on a learner's device reporting in. A short-lived circuit breaker (remember "provider down" for N minutes, fail the request immediately) belongs in the same pass and shares the same state |
| **References** | `src/hooks/useTTS.ts` → `speakText` (the catch), `src/services/tts/CloudTTSProvider.ts` → `getOrFetchBuffer` (the throw sites), `server/controllers/TTSController.ts` → `synthesize` (maps every upstream failure to 500 — see the note below), `server/services/TTSService.ts` → `callGoogle`; [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md) for the sink this should reuse |

**Related, and worth doing in the same pass:** `TTSController.synthesize` returns **500**
for an upstream **403**. The client cannot tell "provider unavailable" from "bad request"
without string-matching an error message, which is exactly what a circuit breaker would
need to decide. A 502/503 for an upstream failure would make the distinction cheap.

---

### 13. Move TTS from Google to Amazon Polly — with the app's move to AWS, not before

| | |
|---|---|
| **What** | Swap the TTS provider behind `TTSService` from Google Cloud Text-to-Speech to **Amazon Polly**, so narration bills to the same cloud account as everything else once the app moves to AWS. Scope is one provider method plus the SSML dialect: add a `callPolly` beside `callGoogle`, select on the existing `TTS_PROVIDER` env var, and port `buildPinyinSsml`. Voices to target: **`Zhiyu`** (cmn-CN, neural) for Chinese, `Mia` (es-MX) or `Lupe`/`Pedro` (es-US, neural) for Spanish, any neural US voice for English — replacing `cmn-CN-Wavenet-A` / `es-US-Neural2-A` / `en-US-Neural2-C` |
| **Why deferred** | Explicitly decided 2026-08-24: **do it when the whole app migrates to AWS, not as its own project.** Google is wired in and working again (the outage that surfaced this was an expired free trial on project `cow2-497203`, fixed by attaching a real billing account — not a provider problem). Migrating on its own buys nothing: at ~15k characters of lifetime usage the app sits inside the free tier of either provider indefinitely, so the comparison is $0 vs $0, and the only thing a solo migration can do is break tone accuracy. Polly is *cheaper* at volume (~$4/M standard, ~$16/M neural, vs Google WaveNet's $16/M) — a reason to prefer it once the account exists, not a reason to move today |
| **Cost of leaving it** | One cloud account kept alive purely for TTS after everything else has left it — a second bill, a second set of credentials (`server/google-tts-credentials.json`), and a second billing relationship that can lapse without anyone noticing. That last one is not hypothetical: it is exactly what happened on 2026-08-21 and went undetected for three days (see item 12) |
| **Trigger** | The whole-app AWS migration. There is **no plan doc for it yet** — when one is written, link this item from it. Do NOT start on a TTS bill; the free tier makes that argument empty |
| **The one real risk — the pinyin hint** | `buildPinyinSsml` emits `<phoneme alphabet="pinyin" ph="zhong1">`, Google's spelling. Polly uses a different alphabet identifier for Mandarin (believed `x-amazon-pinyin` — **verify against current Polly docs, this was not confirmed**). That tag is not decoration: it is what makes 重点 read *zhòng diǎn* rather than the stale *chóng diǎn* in the `pronunciation` column. Budget the porting effort here, not in auth or caching, and re-test polyphones specifically |
| **What ports for free** | The whole cache layer is provider-agnostic already. `synthesize()` reads the disk cache before any provider call, and the key is `sha256(provider:voice:text:pinyin)` — so **`provider` and `voice` are already in the key**, and a Polly cutover re-synthesizes into new slots without colliding with the ~674 Google MP3s. No cache wipe, no migration, and a rollback to `TTS_PROVIDER=google` still finds every old file. `TTSService` is constructor-injected from `dal/setup.ts`, so nothing above it changes; the client (`CloudTTSProvider`) never learns which provider answered |
| **References** | `server/services/TTSService.ts` → `callGoogle`, `voiceForLang`, `voiceTag`, `cacheKey`, `buildPinyinSsml`; `server/.env` (`TTS_PROVIDER`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_TTS_VOICE_*`); `server/dal/setup.ts`. Related: item 12 (the fallback metric — build it BEFORE this migration, so a provider swap has something to prove it worked) |

### 14. MUI numeric elevations are the last shadows outside the design's system

| | |
|---|---|
| **What** | Roughly ten call sites still write `boxShadow: 2 \| 3 \| 4 \| 6` — MUI's own elevation index, which resolves to MUI's default **pure-black** shadow ladder. Convert them to `SHADOW` (`src/theme/shadows.ts`) like every other card and floating surface. Known sites: `src/components/FlashCard.tsx` (4), `src/components/VocabDisplayCard.tsx`, `src/features/flashcards/FlashcardsPage.tsx` (3), `src/components/SegmentedSentenceDisplay.tsx`, `src/components/VocabEntryCards.tsx`, `src/games/word-search/WordSearchGrid.tsx` |
| **Why deferred** | Split out of the D13 shadow adoption on 2026-08-24 to keep that pass reviewable. It is a different KIND of edit: the `rgba(...)` sites were a mechanical find-and-replace, but a numeric elevation carries no information about what the surface IS, so each one has to be read and assigned a role token by hand (`raised`? `float`? `menu`?). Several are also on components that predate the redesign and may be deleted rather than converted |
| **Cost of leaving it** | These are **invisible to the obvious check**: a `grep` for `rgba(0` over `src/` now comes back almost clean, which reads as "the shadow migration is done" when ten surfaces are still on MUI's black ladder. That false all-clear is the real cost — more than the visual drift, which is subtle |
| **Trigger** | Whichever entry next touches one of those files (`FlashCard` and `VocabDisplayCard` in particular are old and un-converted), or a deliberate sweep. Do it with `git grep -nE "boxShadow: [0-9]"` rather than from this list, which will go stale |
| **References** | `src/theme/shadows.ts` → `SHADOW`; docs/SHELF_REDESIGN.md § D13 (the three rules and the role names) |

### 15. The arena's twelve division rungs all look identical

| | |
|---|---|
| **What** | `DivisionBanner` draws every rung — Slate through Legendary — on the same neutral grey. It needs a per-rung fill, and a per-rung ink for any fill dark enough to fail normal body text |
| **Why deferred** | The redesign's entry 9 shipped the banner's SHAPE (name, ladder position, next rung, twelve ticks, the pennant notch) without settling its MATERIAL. The design project's `Arena Division Banners.html` draws all twelve as distinct materials, and porting them — in full, then flattened to base gradients — would have minted ~30 hex values outside the ramp. Both ports were withdrawn on the user's ruling (2026-08-24) rather than take that palette decision under deadline. **D2 is therefore unbroken, and there is no arena-palette precedent to cite** |
| **Cost of leaving it** | A ladder whose rungs look alike is not a finished ladder: the point of twelve *named* rungs is that climbing one should look like something. What currently differentiates them is the name, the "N of 12" line and the tick row — the ticks carrying more weight than they were drawn to carry. This is the redesign's largest open visual gap, and unlike most gaps it is on a screen a competitor stares at for a week |
| **The decision to take** | Three options were costed: (a) port the twelve plates as a contained exception to D2 — a rung is a MATERIAL, and the ramp has fewer hues than the ladder has rungs, so ramp-only forces repeats; (b) ramp-only and accept the repeats; (c) the flattened middle, `linear-gradient` layers kept and every `repeating-*` / `radial-gradient` / `conic-gradient` texture dropped. (c) was built and withdrawn; the port rule is recorded in SHELF_REDESIGN entry 9 so it can be rebuilt exactly |
| **Trigger** | Any deliberate pass on Arena's look, or the moment someone asks why every division looks the same. Arena is **dev-only** — it is not in front of a prod user, which is part of why this could wait |
| **References** | `src/features/arena/DivisionBanner.tsx` (the whole change lives here); `src/features/arena/arenaStyles.ts` → `DIVISION_NAMES`; docs/ARENA_FEATURE.md § 7.0; docs/SHELF_REDESIGN.md entry 9 and D2 |

### 16. Starter-pack ordering has no real tie-break under the merged top band

| | |
|---|---|
| **What** | Every `frequencyScore` consumer that sorts (`StarterPacksService`, `ProvisionalCardService`, the gsa tie-break in `segmentString.ts`, dictionary search relevance) orders by `de."frequencyScore" DESC NULLS LAST, de.id ASC`. The secondary key is the surrogate id — i.e. arbitrary. It needs a real one: HSK level for zh, `difficulty` for es |
| **Why deferred** | It was survivable while the top of the scale was spread over two bands. The 2026-08-28 axis change **merged bands 4 and 5**, so the most common words — exactly the ones starter packs are built from — now collapse into a single band ordered by insertion id. The fix is a one-line ORDER BY change per call site, but "which secondary key" is a curation decision that deserves its own look, not a rider on a rubric change |
| **Cost of leaving it** | A learner's first pack is ordered arbitrarily within the everyday band. Nothing breaks; the ordering is simply not the ordering anyone intended. Roughly 1,015 zh discoverable words sat in the old 4∪5 |
| **Note (2026-08-28)** | The **per-sense** half of this same problem is now fixed: clusters tied on `frequencyScore` are ranked by a backfill pass before they are stored, so the read-side stable sort inherits a real order (docs/DEFINITION_CLUSTERS.md § Ties). That fix does **not** transfer here — it is a model pass over one word's senses, whereas these are SQL `ORDER BY`s over thousands of rows and need a stored column as the secondary key |
| **Trigger** | The re-score under the new rubric landing (it makes the flattening real in the data), or any complaint that early packs feel randomly ordered |
| **References** | `server/services/StarterPacksService.ts` (`ORDER BY` in the pack + recycle queries), `server/services/ProvisionalCardService.ts`, `server/dal/shared/segmentString.ts`, `server/dal/implementations/DictionaryDAL.ts`; docs/DEFINITION_MAPPING.md § `frequencyScore` |

### 17. Study Challenge deadlines don't say which clock they are on

| | |
|---|---|
| **What** | Mirror Arena's `ArenaBoundaries.timezone` + `timezoneDiffersFromViewer` (`src/api/arena.ts`) onto `ChallengeDeadlines`, so `challengeLabels.deadlineLabel` can format in — or at least name — the zone the server actually used. Today the server computes each boundary from `users.timezone` and ships an **absolute instant**, which the client formats in the **browser's** zone, and no copy names either |
| **Why deferred** | The 2026-08-28 root cause was a stale `users.timezone`, and that is now fixed at the source: the column is written at creation, on login/restore, on every ~15-minute token rotation, and on a foregrounded tab whose zone changed ([STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md), "Refresh path"). With the column fresh, the two zones agree and the label is right. Labelling is defence-in-depth against a case that should no longer occur, and it costs a wire-contract change plus copy on three surfaces |
| **Cost of leaving it** | When the column IS stale, the failure is silent and reads as a broken feature: a Friday 04:00 window rendered as "9 PM Thursday" for a UTC-stored account on a UTC−7 browser, with nothing on screen to hint that a timezone is involved. It took a code read to diagnose |
| **Trigger** | A second report of a challenge deadline at an unexpected hour, or any new surface that renders a server-computed local boundary as an absolute instant (that is the third instance, and the point at which the two implementations should become one helper) |
| **References** | [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 2 "`users.timezone` must be fresh", `server/services/StudyChallengeService.ts` → `toSummary`, `src/features/studyChallenge/challengeLabels.ts` → `deadlineLabel`, `src/api/arena.ts` → `ArenaBoundaries` |

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
an **8×8** grid (twelve 4-character words did not fit the ordinary board's 49 cells at the
time — that board has since grown to 9×6/54 cells and, since 2026-08-23, also holds twelve
words itself; the two boards' word counts now coincidentally match but their sizes still
differ), and **Hydra Bubbles is a
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

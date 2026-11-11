# Deferred Work — the standing list of things we decided to do later

A single place for work that is **known, agreed to be worth doing, and deliberately not
being done right now**. It exists because the alternative is a `⚠️` buried in a feature doc
that nobody reads again, or a dead function sitting in PPE because the person who could
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
  `docs/<FEATURE>_DEPLOY_RUNBOOK.md` per CLAUDE.md, which is deleted once PPE is verified.

## How to use it

Each item states **what**, **why it was deferred**, **what it costs to leave**, and
**what triggers doing it**. An item with no trigger is a wish, not a plan — give it one.
Delete an item when it is done; this file is a queue, not a history.

---

## Open items

### Remove the dormant `users."chineseFont"` setting

**What:** the app always renders in 975 Maru SC (`src/hooks/useChineseFont.ts`) and the
Settings picker is gone, but the rest of the path is still live: the column (migration
157), `server/contracts/wire.ts` → `CHINESE_FONT_IDS` / `UserProfile.chineseFont`,
`server/services/UserService.ts` → `updateDisplaySettings`, the `UserDAL` select list, and
`selectable` / `CJK_FONT_OPTIONS` in `src/theme/cjkFontOptions.ts`.
**Why deferred:** the choice was disabled, not retired, so it stays cheap to restore, and
dropping the column is a contract migration that must follow the new code onto PPE.
**Cost to leave:** one unread column and an accepted-but-ignored API field.
**Trigger:** the decision that users will not choose a typeface again.

### 1. Tell the learner when a card is resting and earning nothing

*Added 2026-08-18 with Hydra Bubbles; narrowed 2026-08-20 when lending moved to the
bottom of the fill ladder. Code: `server/services/FlashcardMarkService.ts` →
`applyMark` (the `[MarkSuppressed]` branch), `OnDeckVocabService.getGameVocabPool` /
`getDistributedWorkingLoop` (the fill tiers). Docs:
[HYDRA_BUBBLES.md § 8.1](./HYDRA_BUBBLES.md),
[PROVISIONAL_CARDS.md § 4b](./PROVISIONAL_CARDS.md).*

**What changed.** A card's cooldown (one clock per bar since 2026-09-25) is a hard **"next markable at"**: a mark
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
(PROVISIONAL_CARDS.md § 4b). The `[MarkSuppressed]` log keeps its remaining job: counting how often
cooled-tier suppression happens.

**The task that remains is UI.** Give the learner feedback rather than silence —
"resting until tomorrow" on the card, a muted state on a bubble, or an end-of-session
line saying how much of the round counted. The server already knows: the response
carries `suppressed: true`, and **no client reads it today**.

### 2. Teach learners about bound-form words (the huìzi class)

| | |
|---|---|
| **What** | A short learner-facing note on the ~10 **hosted** forms in det (`一会儿`, `一辈子`, `一家子`, `一阵子`, `这会儿` …) saying the word is a fixed unit and its tail is not a standalone word. Full spec, the complete 14-item class, and four open questions: [BOUND_FORM_WORDS.md](./BOUND_FORM_WORDS.md) § 6 |
| **Why deferred** | The **data** half shipped on 2026-08-17 — the 6 bound bases were deleted from PPE det (+1 vet row) and both re-entry paths are now gated by `boundForms.js`. That stopped the app teaching a bad card, which was the urgent part. The **teaching** half is new UI with an undecided surface (eip tab vs. bt inline copy vs. cdp chip) and so is not a same-day change |
| **Cost of leaving it** | Moderate and silent. A learner meeting `一会儿` has no way to know `会儿` is not a word, and the bt actively misleads by decomposing the word into `一` + `会` + `儿` — implying a compositional reading that does not hold. They will infer wrong and produce ungrammatical Mandarin. Nothing in the app currently corrects this |
| **Trigger** | The next piece of eip/cdp work that touches the bt or adds a tab — the note should ride along rather than claim a surface of its own. Decide open question § 6.1 (where it lives) at that point |
| **⚠️ Do not** | Add a det column for this without asking first (CLAUDE.md rule). The note is derivable at read time from `ZH_BOUND_FORMS`, which needs no migration and cannot drift from the denylist — that is the recommended route |
| **References** | [BOUND_FORM_WORDS.md](./BOUND_FORM_WORDS.md), `server/scripts/backfill/shared/lib/boundForms.js` |

---

### 3. A5's three unbuilt atoms — `.modal`, `.sheet`, `.scrim`

| | |
|---|---|
| **What** | Three of the fifteen shelf-system generic atoms have no shared implementation: `.modal` (scrim + centred grey card + one dark CTA), `.sheet` (pull-up panel, `top:176px`, radius 26, grab handle) and `.scrim` (a flat 28% ink overlay). Spec: [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A5 |
| **Why deferred** | Each already has ONE live bespoke implementation — `SheetPanel` (`src/components/sheet/`) for the sheet, MUI `Backdrop` for the scrim, and for the modal whichever blocking dialog survives (`HydraLendNotice`, the reference cited here, was **deleted 2026-09-05** when Hydra's lend popup became a per-bubble badge) — and none is repeated often enough to have drifted. Extracting a primitive from a single caller invents an API from one data point; the second caller is what tells you which parts are actually shared |
| **Cost of leaving it** | Low for now, rising. The moment a second sheet or a second blocking modal is written, the two will disagree on radius, top offset, grab-handle size and scrim opacity, and the fix becomes a reconciliation rather than an extraction |
| **Trigger** | The second caller. Whichever entry next needs a pull-up panel or a blocking modal extracts the primitive as part of its own work rather than inlining a third copy |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A5, `src/components/primitives/` |

### 4. Moderation for user-authored text shown to strangers — starting with the arena message

| | |
|---|---|
| **What** | A system for handling text one user writes and 24 strangers read. The first (and today only) such surface is the **arena message** (`users."arenaMessage"`, migration 152, [ARENA_FEATURE.md](./ARENA_FEATURE.md) § 2.1a) — one line under each competitor's name on the `/arena` board. At minimum it needs: a **report** affordance on a row, somewhere for reports to land, a **takedown** path (clear the message and keep it cleared), and a decision about whether a cleared account may write another. Probably also a cheap pre-filter on write, and a per-account rate limit so a takedown is not undone in one tap |
| **Why deferred** | The message shipped 2026-08-21 with SHAPE checks only — `ArenaService.setMessage` strips control characters, collapses whitespace, trims and caps at 80 — and none of that is judgement. Moderation was not built alongside it because the correct design depends on facts we do not have yet: how many people write one at all, and whether abuse arrives as a trickle (a human queue is fine) or not at all (a report button and nothing else is fine). Building a review queue for a feature nobody uses is the more expensive mistake |
| **Cost of leaving it** | **Currently low, and it stops being low the day the app has strangers in it.** PPE has no customers ([memory: PPE is effectively a PPE](../CLAUDE.md)), and arena boards are mostly synthetic padding — bots draw their lines from a fixed pool and cannot type anything. So today the realistic blast radius is one tester reading another tester's line. The moment real users share a board, this is an unmoderated broadcast channel to 24 people who did not consent to each other, and the arena is the one surface a user **cannot leave mid-week** |
| **Trigger** | ⚠️ **Before the arena carries real strangers** — whichever comes first: the first non-tester cohort, or a second surface adopting user-authored public text (a profile blurb, a challenge taunt). Do not ship a second such field before this exists; the second one is what makes an ad-hoc fix permanent |
| **Interim mitigation** | The write path is a single chokepoint by design (`ArenaService.setMessage` → `ArenaDAL.setArenaMessage`, the ONLY writer of the column), and `{ message: null }` clears it. So an urgent takedown today is one `UPDATE users SET "arenaMessage" = NULL WHERE id = …` and nothing else in the app needs to change |
| **References** | [ARENA_FEATURE.md](./ARENA_FEATURE.md) § 2.1a, `server/services/ArenaService.ts` → `setMessage`, `database/migrations/152-add-arena-message.sql`, `src/features/arena/ArenaMessageDialog.tsx` |

### 6. Pinyin is one shared setting across three games, and Hydra's track does not follow it

| | |
|---|---|
| **What** | Two halves of one decision (2026-08-23), designed and **not built**. (a) `showPinyin` lives in the flp's `useFlashcardLearnSettings` (`flashcard.learn-settings`) and is read *and written* by Bubble Match, Hydra Bubbles and Match Speed, so a change in one game silently changes the other two plus the cdp/acp/dictionary display. It should be **per game**, following `useLocalGameSettings` / `useDiscoverSettings`. (b) Hydra should then adopt the track rule — pinyin off on a zh board ⇒ `reading` — latched before the first spawn |
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
| **Trigger** | The next entry to touch A3 or A5. Merge into `SectionHeader` (the richer API), keep `ShelfHeader` as a re-export or delete it (it has no caller outside `src/components/shelf/` since the decks page was deleted), and fix the Reader / Account call sites |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A3, § A5, entry 5; `src/components/shelf/Shelf.tsx`, `src/components/primitives/Label.tsx` |

---

### 10. Three figures the redesigned card surfaces draw but cannot fetch

| | |
|---|---|
| **What** | Artboard elements whose data does not reach the client. **(a)** Artboard 2's Mastered tile reads **"+17 this week"**; `masteredAt` (migration 142) makes the delta derivable but no endpoint exposes it as such. ⚠️ **2026-11-08:** `LibraryDuo` (the tile's host) has since been deleted (c5541a9), and `GET /api/users/me/velocity` (`VelocityController.getVelocity`) now returns per-boundary `boundaryCounts` over `windowDays`, which `LibraryShelfWithVelocity` draws. That likely supersedes (a). Confirm it, then close this item. ~~**(b)** Artboard 25's "How the parts make the word" paragraph~~ — **built 2026-11-07**: `breakdownElaboration` is on the wire and rendered under the breakdown rows (BREAKDOWN_FEATURE_IMPLEMENTATION.md, Frontend Integration). Only (a) remains. |
| **Why deferred** | (a) and (b) were each one column on an existing response plus its enrichment path; neither blocked the layout, and both were cheaper to leave a hole for than to add mid-pass. |
| **Cost of leaving it** | (a) the sheet's Mastered tile shows a total with no sense of movement, which was the tile's whole argument for existing beside Learning. (b) resolved. |
| **Trigger** | (a) when a velocity/streak pass is next touching `masteredAt` |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) entries 2 and 19–25; `src/features/flashcards/LibraryDuo.tsx`, `src/features/flashcards/BreakdownRow.tsx`; [BREAKDOWN_FEATURE_IMPLEMENTATION.md](./BREAKDOWN_FEATURE_IMPLEMENTATION.md) |

---

### 11. A drilled-in eip word lost its Compare

> **Compare half: fixed and then REVERTED, both on 2026-09-04.** The eip entry header briefly
> carried a `compare_arrows` button (`InfoCardPanelBody`'s `onCompare`) acting on the word the
> header was showing; it was removed at the user's request, along with the `onCompare` prop on
> `InfoCardPanelBody`/`InfoCardSection` and its four call sites. Compare is once again reachable
> only from `WordToolsRail` above the card: a drilled-into word must be opened as its own
> page before it can be compared. (The Add-to-Deck half is moot: Decks were deleted
> 2026-11-04, and the card's `•••` rail, `CardOpsRail`, was deleted 2026-11-05 — Customize is on `WordToolsRail` too.) See
> [WORD_COMPARE_FEATURE.md](./WORD_COMPARE_FEATURE.md).

| | |
|---|---|
| **What** | `InfoCardActionBar` (Add to Deck… / Compare To… / Practice Writing Me) rode at the end of the eip's definition tab and is **deleted**: artboards 20–25 make the panel information-only, so compare and write-it moved to `WordToolsRail` above the card, which acts on the **card's** word. A word the learner has DRILLED INTO from the breakdown rows or an example segment therefore has no in-panel way to be compared |
| **Why deferred** | It is a deliberate consequence of the design's own rule ("card operations have left the panel entirely"), not an oversight, and there IS a path: the breakdown rows are tappable and open that word's own page, where both actions live. But it is one more navigation than before for a real thing learners do |
| **Cost of leaving it** | Comparing a component character costs a drill-in instead of a tap. Nothing is unreachable |
| **Trigger** | If it comes up in use. The fix is NOT to put the action bar back — it is to let the word trail's active pill carry a small ops affordance, so the actions stay attached to "the word you are looking at" rather than to a tab body |
| **References** | [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) entries 19–25; `src/features/flashcards/FlashcardsLearnPage/InfoCardTabContent.tsx` (the comment at tab 0), `src/components/WordToolsRail.tsx` |

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
| **What** | Roughly ten call sites still write `boxShadow: 2 \| 3 \| 4 \| 6` — MUI's own elevation index, which resolves to MUI's default **pure-black** shadow ladder. Convert them to `SHADOW` (`src/theme/shadows.ts`) like every other card and floating surface. Sites as of 2026-11-10 (2): `src/games/word-search/WordSearchGrid.tsx`, `src/components/CpcdPopup.tsx`. (`VocabDisplayCard` and `SegmentedSentenceDisplay` have been converted; `VocabEntryCards.tsx` was deleted.) |
| **Why deferred** | Split out of the D13 shadow adoption on 2026-08-24 to keep that pass reviewable. It is a different KIND of edit: the `rgba(...)` sites were a mechanical find-and-replace, but a numeric elevation carries no information about what the surface IS, so each one has to be read and assigned a role token by hand (`raised`? `float`? `menu`?). Several are also on components that predate the redesign and may be deleted rather than converted |
| **Cost of leaving it** | These are **invisible to the obvious check**: a `grep` for `rgba(0` over `src/` now comes back almost clean, which reads as "the shadow migration is done" when ten surfaces are still on MUI's black ladder. That false all-clear is the real cost — more than the visual drift, which is subtle |
| **Trigger** | Whichever entry next touches one of those files (`VocabDisplayCard` in particular is old and un-converted), or a deliberate sweep. Do it with `git grep -nE "boxShadow: [0-9]"` rather than from this list, which will go stale |
| **References** | `src/theme/shadows.ts` → `SHADOW`; docs/SHELF_REDESIGN.md § D13 (the three rules and the role names) |

### 15. The arena's twelve division rungs all look identical

| | |
|---|---|
| **What** | `DivisionBanner` draws every rung — Slate through Legendary — on the same neutral grey. It needs a per-rung fill, and a per-rung ink for any fill dark enough to fail normal body text |
| **Why deferred** | The redesign's entry 9 shipped the banner's SHAPE without settling its MATERIAL. The design project's `Arena Division Banners.html` draws all twelve as distinct materials, and porting them — in full, then flattened to base gradients — would have minted ~30 hex values outside the ramp. Both ports were withdrawn on the user's ruling (2026-08-24) rather than take that palette decision under deadline. ⚠️ **The "no precedent" half of this is now stale**: entry 9a minted `RAMP.gld` (2026-09-21), so the ramp has one real metal to build a ladder from and D2 has a documented exception to reason from. Note also that `Arena Flow - Shelf System.html` paints every rung `var(--grey)` itself, so the placeholder is now what the *design* draws, not merely what we settled for |
| **Cost of leaving it** | A ladder whose rungs look alike is not a finished ladder: the point of twelve *named* rungs is that climbing one should look like something. **This got worse on 2026-09-21**: the arena flow removed the "N of 12" meta AND the "next rung" line from the banner, so the name and the tick row are now the *only* things that change as you climb. This is the redesign's largest open visual gap, and unlike most gaps it is on a screen a competitor stares at for a week |
| **The decision to take** | Three options were costed: (a) port the twelve plates as a contained exception to D2 — a rung is a MATERIAL, and the ramp has fewer hues than the ladder has rungs, so ramp-only forces repeats; (b) ramp-only and accept the repeats; (c) the flattened middle, `linear-gradient` layers kept and every `repeating-*` / `radial-gradient` / `conic-gradient` texture dropped. (c) was built and withdrawn; the port rule is recorded in SHELF_REDESIGN entry 9 so it can be rebuilt exactly |
| **Trigger** | Any deliberate pass on Arena's look, or the moment someone asks why every division looks the same. Arena is **dev-only** — it is not in front of a PPE user, which is part of why this could wait |
| **References** | `src/features/arena/DivisionBanner.tsx` (the whole change lives here); `src/features/arena/arenaStyles.ts` → `DIVISION_NAMES`; `src/theme/colors.ts` → `RAMP.gld`; docs/ARENA_FEATURE.md § 7.0; docs/SHELF_REDESIGN.md entries 9 and 9a, and D2 |

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

### 18. Immersive World left callerless code and a personal-data question on `main`

*Added 2026-11-09, when Night Market + Immersive World were removed (archived — [ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md)).*

| | |
|---|---|
| **What** | Decide, item by item, whether to delete or keep five IW-era capabilities that now have no caller: (a) **`users.gender` / `users."birthDate"`** (migration 164) — still **asked at Register and in Settings**, with copy saying Immersive World characters use it, yet nothing reads it any more; (b) the TTS per-call `voice`, `prepare()` audio-as-clock duration and `stamp: false`; (c) the `english-first` dictionary search ranking; (d) the public sentence-segmentation helper on `DictionaryDAL`; (e) `formatDuration`'s Night-Market-badge option |
| **Why deferred** | The removal was scoped to code that only NM/IW could reach. These are generic enough that a revived IW (or another feature) might reuse them, and (a) is a product decision, not a cleanup |
| **Cost of leaving it** | (a) is the costly one: the app collects a birth date and gender for a purpose that no longer exists, and the on-screen copy describes that defunct purpose. (b)–(e) are dead branches that readers must still understand |
| **Trigger** | (a) now — before more sign-ups answer it. (b)–(e) the next time any of those files is reworked, or a decision that IW will not return |
| **References** | `src/utils/demographics.ts`, `src/pages/settings/AboutYouSections.tsx`, `src/pages/RegisterPage.tsx`, `server/services/UserService.ts`; `src/hooks/useTTS.ts`, `src/services/tts/*`; `server/dal/implementations/DictionaryDAL.ts`; `src/utils/formatDuration.ts` |

### 19. Rotate every API key and secret the app holds

*Added 2026-09-07.*

| | |
|---|---|
| **What** | Issue new values for every credential in the four env files and the Google service-account JSON, update dev **and** PPE, and confirm each consumer still works. The trigger was one key being exposed, but the decision was to rotate the whole set rather than that one — a partial rotation leaves you doing this again |
| **Why deferred** | Explicitly postponed by the owner on the day it came up. Nothing is on fire: the exposure below is not public, and no credential is committed to git |
| **Cost of leaving it** | The `ANTHROPIC_API_KEY` in `server/.env.docker` was transmitted three times as IDE selection context on 2026-09-07 and is therefore sitting in a stored Claude Code session transcript. It was never used, echoed, or sent anywhere else, but "it left the machine" is the bar for rotation. Until it is rotated, that key is spendable by anyone with the transcript. The rest of the set is precautionary |
| **Trigger** | Owner's choice — this one is a calendar item, not an event. Do it before any wider access to the machine or the transcripts, and immediately if unexpected API spend appears on the Anthropic or OpenAI account |

**What to rotate** — names only; never paste a value into a doc, a commit, or a chat.

| Credential | Lives in | Rotate at | Consumer |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `server/.env.docker` | console.anthropic.com | The backfill scripts |
| `OPENAI_API_KEY` | `server/.env.docker` | platform.openai.com | Enrichment / TTS fallbacks |
| `DICT_AI_API_KEY` | `server/.env`, `.env.docker`, `.env.production` | The issuing vendor | Dictionary AI features (est, compare, elaboration) |
| `ICONS8_API_KEY` | `server/.env`, `.env.docker` | icons8.com | The fie icon search proxy |
| `JWT_SECRET` | all three server env files | Generate a new random value | ⚠️ **Rotating this invalidates every live session** — every user is logged out. Do it deliberately, not in the same pass as the others |
| `DB_PASSWORD` | all three server env files | Postgres role | ⚠️ Must change in the DB and the env file together, and the containers restart |
| Google service account | `server/google-tts-credentials.json` (path via `GOOGLE_APPLICATION_CREDENTIALS`) | GCP IAM — issue a new key, then delete the old one | `server/services/TTSService.ts` |

**Checked while writing this**: none of these files is tracked by git — `.gitignore:14`
(`**/.env.*`), `server/.gitignore:12` (`.env`) and `server/.gitignore:20`
(`*-credentials.json`) cover all five. So this is a rotation, not a history rewrite.

**The habit that caused it**, worth fixing at the same time: Claude Code's IDE integration
appends the current editor selection to every message. A line left highlighted in a `.env`
file is re-sent with each turn regardless of what is being discussed. Clear the selection
before typing, and treat `.env` files as the one category where an idle highlight costs
something.

### 20. `ArenaState` carries a dead `opt-in` / `closed` split

| | |
|---|---|
| **What** | `GET /api/arena` returns one of four states, but `'opt-in'` and `'closed'` are rendered **identically** by the page. Narrow the union to three (`live` / `results` / `out`) and drop the `isBreakPeriod` branch that chooses between them |
| **Why deferred** | The distinction died when § 8 stopped gating enrolment on the break period — both states offer the same Join button, because the gate is a live seat, not the clock. The arena flow's state map confirms it: it names four states, and its fourth is **`out` — "not entered, not racing, *whether or not the break is open*"**. What the page actually splits on is `optedInNextWeek` (`waiting` vs `out`), which is a different axis entirely. Left alone during entry 9a because narrowing a server union is a backend change, and the page rebuild was already large |
| **Cost of leaving it** | Small but real: a wire enum whose variants do not correspond to anything visible is a standing invitation to write `if (state === 'closed')` and add behaviour that the design has no state for. It also makes the four names in `ArenaState` disagree with the four names in ARENA_FEATURE.md § 2.3, which are the design's |
| **The decision to take** | Whether `out` should be the wire name (matching the design and the page) or whether the server keeps `opt-in` as the single not-racing state. The former is clearer; the latter is a smaller diff |
| **Trigger** | The next backend pass on arena — ideally the same one that touches `ArenaService.getBoard` for another reason |
| **References** | `server/types/arena.ts` → `ArenaState`; `server/services/ArenaService.ts` → `getBoard` (the third return); `src/api/arena.ts` → `ArenaState`; `src/features/arena/ArenaPage.tsx` (the `seatless` derivation); docs/ARENA_FEATURE.md § 2.3 and § 8 |

### 21. One unscoped `backfill-breakdown-senses --reconcile` sweep to retire the orphan backlog

*Added 2026-09-22.*

| | |
|---|---|
| **What** | Run `server/scripts/backfill/chinese/backfill-breakdown-senses.js --reconcile` **unscoped** (no `--words=`, no `--shard=`) over the whole zh corpus, in oracle mode, until the `breakdownSenseOrphan` drift probe returns 0. ⚠️ `--reconcile`, never `--force` — `--force` re-tags all ~9.5k rows and re-spends every prompt to fix the ~1.4k that drifted |
| **Why deferred** | It needs a dedicated run of its own. Oracle rounds are scoped to a sharded 50-row candidate batch, and the orphan backlog is corpus-wide |
| **Cost of leaving it** | **The backlog grows every round and scoped rounds structurally cannot catch up**: 1185 → 1264 → 1290 → 1383 over four rounds, and 1358 → 1475 (+117) in the 2026-09-22T09:29Z round alone, then 1496 → 1674 (+178) in the 2026-09-22T16:26Z shard-0/2 round, which clustered 字 and 学 — components of hundreds of headwords. Each round's re-clustering renames cluster `sense` labels and orphans more rows elsewhere in the corpus than the round's own batch contains, so each round reconciles ~44 rows and creates ~137. The rise is worst exactly where the clusterer is most useful — 基/报/场/外 are components of hundreds of headwords, so refreshing 43 of them orphaned ~150 others. A round that shows a *fall* (e.g. 1443 → 1395, or 1669 → 1639 in the 2026-09-23T03:27Z shard-0/2 round, whose 38 clustered rows sat on 德-/心- compounds) is a round whose batch happened to sit on rare characters, not evidence of convergence. An orphaned pointer means a bt component shows a sense label that no longer exists on that character's entry. **The 2026-09-24T16:17Z shard-0/2 round is the cleanest evidence the sweep would work**: its planner named `backfill-breakdown-senses` as the *only* script with work, so the round ran no clusterer at all and the probe fell 1303 → 1253 — exactly −50, the batch size, with nothing created. That isolates the two effects: reconciling is exactly 1:1, and every net rise seen above comes from the clusterer running in the same round. An unscoped sweep, which by construction clusters nothing, converges in one pass. The 2026-09-24T19:32Z shard-0/2 round adds a mid-sized data point: 49 clustered rows (科, 管, 空-, 神- compounds) + 41 reconciled rows moved the probe 1120 → 1149 (+29 net), and 4 of the rows it orphaned were inside its own batch and had to be re-tagged in a second pass within the round |
| **Trigger** | Any oracle session with a full five-hour window free, or the next time the bt sense labels are worked on. Take the §2 det backup first, as any oracle round does |

**Blocked sub-case worth fixing first**: 乐 has no `yuè` "music" sense in its
`definitionClusters` (only the `lè` "happy / laugh" senses), so 器乐 and every other 乐-compound
**cannot** be reconciled correctly — the disambiguation prompt offers no "none of these" answer
and the tag goes in knowingly wrong. Repair 乐's det row before the sweep reaches it. Found
2026-09-22; see `docs/oracle-runs/oracle-run-20260922T060118Z.md` § 4a.

**Second sub-case, same shape — transliterations have no phonetic candidate.** The
sense-tagging prompt forces every component character onto one of the *lexical* labels
that character's own `definitionClusters` supply, but in a transliteration the character
carries sound, not meaning, and **no** candidate applies. Some characters happen to own a
phonetic cluster (阿 "used in transliteration", 斯 "(phonetic) transliteration syllable")
and tag cleanly; 波, 尔, 布, 特, 派, 对, 多, 美 do not, so the answerer must pick a label it
knows to be wrong and disclaim it in `reviewNotes` — 波尔多, 波尔布特, 波美度 and 派对 all
went in that way. **Fix:** offer `"(phonetic)"` as an always-available candidate in
`chinese/backfill-breakdown-senses.js`'s prompt and have the bt renderer suppress a gloss
line for it. Found 2026-09-24; see
`docs/oracle-runs/oracle-run-20260924T040014Z.md` § "⚠ BREAKDOWN SENSE REVIEW flags".

### 22. Drop the legacy single `displacedMark` from the mark/undo wire

*Added 2026-10-06 with silent acceleration. Code: `server/services/FlashcardMarkService.ts`
→ `ApplyMarkResult.displacedMark`; `server/routes/flashcardRoutes.ts` (mark response +
undo body fallback). Docs: [MASTERY_REWORK.md § 6](./MASTERY_REWORK.md) "Silent acceleration".*

**What.** An accelerated review can displace two marks, so the wire moved to
`displacedMarks: ReviewMark[]`. The server still sends `displacedMark`
(`= displacedMarks[0]`) and the undo route still accepts it alone.

**Why deferred.** An installed Capacitor build runs its bundled JS until it is updated;
dropping the field would break undo there.

**Cost to leave.** One duplicated field. An old client undoing a doubled review that
displaced two marks restores only one of them.

**Trigger.** When no build older than 2026-10-06 is in use, remove the field and the
fallback.

### 23. The daily banking animation ignores `prefers-reduced-motion`

*Added 2026-10-10 (the feature is built and on PPE; it runs on the Deck Tower). Docs:
[DAILY_MINUTE_BANKING.md](./DAILY_MINUTE_BANKING.md) § 3 and Q7.*

**What.** The once-per-day td banking animation (flame swells, drains, embers fly into the
avatar) plays for every learner, including those whose OS asks for reduced motion. The
proposed fallback was to skip the swell and the ember flight and show only the end state
with a brief static avatar glow. Precedent for honoring the setting: `IWSceneIntroCard`.

**Why deferred.** The owner chose to ignore the setting for the first build.

**Cost to leave.** A learner sensitive to motion gets a large animation (up to ~5 s, 1.8×
scale) once a day per language, on the Deck Tower (the footer's Flashcards tab).

**Trigger.** Any accessibility pass, or any feedback about motion from a learner.

### 24. The Deck Tower's study ignores `prefers-reduced-motion`

*Added 2026-10-24. Docs: [DECK_TOWER.md](./DECK_TOWER.md) § "Studying the tower";
code: `src/features/deckTower/useTowerStudy.ts`.*

**What.** Tapping a Learning tower always plays the 1.25 s camera dive onto the top
card and the 1.05 s climb back out. Neither checks
the OS reduced-motion setting, unlike the rest of the page (the build-up, the pan and the
resizes are instant under it). The likely fallback: cross-fade between the tower view and
the session (no camera move).

**Why deferred.** The owner chose to build the motion first and account for the setting
later.

**Cost to leave.** A motion-sensitive learner gets a large perspective fly-in and fly-out
on every study session.

**Trigger.** Once the in-place study's design is settled (it is still being tuned), or
any accessibility pass.

### 26. Dictionary "Closest matches" on a no-result query

*Added 2026-10-29. Docs: [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § 7b.*

| | |
|---|---|
| **What** | The tier-2 Dictionary redesign's no-results artboard lists **Closest matches** between the "Nothing for “shíjiānn”" well and the Ask AI button (shíjiānn → 时间, 事件, 世界). It needs a server-side near-miss search — e.g. strip tone marks, drop/edit trailing letters, rank the candidates by `frequencyScore` — returned alongside an empty `/api/dictionary/search` page |
| **Why deferred** | No such search exists; the redesign shipped the well and the wide Ask AI button without it (decided by the owner 2026-10-29) |
| **Cost of leaving it** | A typo'd query offers only AI, which spends the learner's daily AI-lookup cap on what is usually a spelling slip |
| **Trigger** | Any work on dictionary search ranking, or a playtest note that typo'd searches dead-end |
| **References** | `src/features/dictionary/DictionaryPageParts.tsx` → `DictionaryNoResults`; `server/controllers/DictionaryController.ts` → `search`; `server/dal/implementations/DictionaryDAL.ts` → `searchByWord1` |

### 27. Quick Mark has no entry point (dormant panel code)

*Added 2026-10-29. Docs: [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) § 4.8, [QUICK_MARK.md](./QUICK_MARK.md).*

| | |
|---|---|
| **What** | The Tower Tier 2 re-skin of acp removed the ⊞ expand button (the design has none, and the owner chose not to keep it) together with acp's hosting code for the Quick Mark panel. That button was Quick Mark's **only** entry, so the grid is unreachable. `QuickMarkPanel.tsx`, `useQuickMarkGrid.ts` and `useQuickMarkPreload.ts` are still in the tree with no importer. Decide: delete them (and retire QUICK_MARK.md), or give Quick Mark a new entry (a toolbar keycap, a td fixture) and restore the hosting from git at `09f607e` |
| **Why deferred** | Removing the button was a design decision; deleting a whole feature's code was not asked for |
| **Cost of leaving it** | Dead code that still type-checks and drifts silently; a reader of QUICK_MARK.md assumes a live feature |
| **Trigger** | The next Quick Mark or acp toolbar change, or a dead-code sweep |
| **References** | `src/features/discover/QuickMarkPanel.tsx`, `useQuickMarkGrid.ts`, `useQuickMarkPreload.ts` |

### 28. Move the iso kit to `src/components/iso/`

*Added 2026-10-29. Docs: [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) § 1, [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md).*

| | |
|---|---|
| **What** | `src/features/deckTower/iso` is imported from outside the Deck Tower feature by **four** acp files as of 2026-11-08: `SortBins.tsx`, `sortTimeOfDay.ts`, `sortCardStock.ts` and `SkippedCardsSheet.tsx` (all in `src/features/discover/`), plus the flp's hint pawn (`src/features/flashcards/FlashcardsLearnPage/hintPawn/HintPawn.tsx`, docs/HINT_PAWN.md). The kit's own index says it moves to `src/components/iso/` once that happens. **The "third importer" trigger has been met.** |
| **Why deferred** | A wide `git mv` across files other sessions were editing on the same day; the cross-feature import works meanwhile |
| **Cost of leaving it** | A layering violation (features/ importing another feature's internals) that the next importer will copy |
| **Trigger** | The next quiet day on `src/features/deckTower/`, or a third importer |
| **References** | `src/features/deckTower/iso/index.ts`, `src/features/discover/SortBins.tsx`, `src/features/discover/sortTimeOfDay.ts` |

### 29. One shared `mixHex`

*Added 2026-10-29. Docs: [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § 7b.*

| | |
|---|---|
| **What** | The shared copy now exists at `src/theme/shadeHex.ts` → `mixHex`. `src/features/deckTower/iso/palette.ts` re-exports it, and `eipPalette.ts` imports it. **One duplicate remains:** the private `mixHex` in `src/timeOfDay/tier2Look.ts`, which can now import `theme/shadeHex` directly because theme/ is shared |
| **Why deferred** | The shared `src/timeOfDay/` module may not import from a feature, and the other two files were being edited by other sessions the same day |
| **Cost of leaving it** | A fix to one (clamping, short hex, alpha) silently misses the other two |
| **Trigger** | Item 28 (the iso kit move), or the next touch of any of the three |
| **References** | the three symbols above |

### 34. Drop the storage the deleted Decks, Word of the Day and challenge preset decks left behind

*Added 2026-11-04, when Decks, the Word of the Day and the Study Challenge's preset decks
were deleted from the code. Docs: [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md),
[STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md).*

| | |
|---|---|
| **What** | A contract migration dropping storage no code reads any more: the `decks` + `deck_cards` tables (migration 141), the `study_challenges."presetDeckIds"` column (migration 148; new rows get the `{}` default), and the `daily_words` table (migration 169) |
| **Order** | Two writers must go FIRST, in an earlier deploy: (1) `VocabEntryDAL.delete` still runs `DELETE FROM deck_cards WHERE "vocabEntryId" = $1` (the FK stand-in — `deck_cards."vocabEntryId"` has no foreign key); (2) `database/cron/expire-study-challenges.sql` passes 3 and 4 still drop `editMode = 'preset'` decks and rewrite `presetDeckIds`. Remove both, reinstall the cron on PPE, then the migration can drop the tables and column. Check PPE first that no `'preset'` deck rows remain (passes 3/4 only clean up decks from challenges accepted before 2026-11-04) |
| **Why deferred** | Kept on purpose in the removal so the code change ships without a destructive migration |
| **Cost of leaving it** | Dead tables and a dead column that read as live to the next reader of the schema; the cron keeps doing a no-op sweep every tick |
| **Trigger** | Any schema cleanup pass, or once PPE has no `'preset'` deck rows |
| **References** | `database/migrations/141-create-decks.sql`, `148-create-study-challenges.sql`, `169-create-daily-words.sql`; `server/dal/implementations/VocabEntryDAL.ts` → `delete`; `database/cron/expire-study-challenges.sql` (passes 3, 4); `server/dal/implementations/StudyChallengeDAL.ts` (the column list) |

### 35. Uncalled endpoints and orphan client files

*Added 2026-11-04. These predate the Decks / Home removal; found during it.*

| | |
|---|---|
| **What** | Server endpoints with no client caller: `GET /api/onDeck/libraryCards` (`server/routes/onDeckRoutes.ts` → `OnDeckVocabController.getLibraryCards`), `GET /api/changelog` (`server/routes/metaRoutes.ts`), `POST /api/starterPacks/quickMarkBatch` (`server/routes/starterPacksRoutes.ts` → `StarterPacksController.quickMarkBatch`). Client files with no importer: `src/features/discover/QuickMarkPanel.tsx` (see item 27 — `quickMarkBatch` is its endpoint, so they go or stay together), `src/features/studyChallenge/ChallengeScoreTable.tsx`, `src/games/shared/useLocalGameSettings.ts`, `src/utils/arenaWeek.ts`. Delete each, or wire it back up |
| **Why deferred** | Out of scope for the removal that found them |
| **Cost of leaving it** | Dead code that type-checks and drifts; an uncalled authenticated endpoint is attack surface with no owner |
| **Trigger** | A dead-code sweep, or item 27's decision |
| **References** | the files above |

### 33. Spanish long-dd fixes (paused with all Spanish work, 2026-11-03)

| | |
|---|---|
| **What** | The Spanish half of the 2026-11-03 long-dd fix, which shipped for zh only. (1) Run `server/scripts/backfill/shared/patch-long-cluster-glosses.js --lang=es` on the 449 es cluster leads over 20 displayed chars (dry-run verified, never written). (2) Change the es step 4 manifest gate in `server/scripts/backfill/shared/lib/requiredScripts.js` from `when: 'multiDef'` to `'multiDefOrLongLead'`; zh got this fix and es did not, so **no single-gloss es row is ever planned for step 4** (34 discoverable rows, e.g. *agradecido* "grateful, thankful, appreciative, obliged, indebted"). Add the long-lead disjunct to `HAS_WORK_CLAUSE` in `spanish/backfill-process-definitions-array.js` too. (3) Port zh's "a failed short gloss leaves the row unstamped" fix to the es step 4. (4) Replace the es step 4's hand-copied `generateShortGloss` / `pass1Sort` with the shared ones (`chinese/lib/orderGlosses.js`, `shared/lib/senseShortGloss.js` → `askShortGloss`). That duplication is how fix (2) was missed. (5) `ddt` strips `(…)` but not Wiktionary's `[+…]` usage notes: 51 es cluster leads show e.g. *acabar* "to end up [+gerund]". (6) *venir*'s clusters lead with Wiktionary sense headings ("Senses relating to literal movement."), which is a source-import defect. (7) The es step 4's hand-copied short-gloss prompt and validator lack the 2026-11-10 "no semicolon" rule that zh got (`validateShortGloss` in `shared/lib/senseShortGloss.js`, the step-4 prompt in `chinese/lib/orderGlosses.js`); fix (4) picks it up for free |
| **Already in place** | The es clusterer already runs the per-sense short-gloss step on every new clustering (`spanish/backfill-cluster-definitions.js` → `run`, `shortenLongLeads`). That code was dry-run tested but has not written a row |
| **Why deferred** | All Spanish work is paused until further notice (CLAUDE.md § Multi-Language Support) |
| **Cost of leaving it** | Spanish cards and sense lists keep their long headlines; every es word the cron promotes with a single long gloss arrives without a short one |
| **Trigger** | Spanish work resumes |
| **References** | [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) § "Short lead gloss per sense"; [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) § 3 |

### 37. Verify the SVG mini card's Spanish headword (paused with all Spanish work, 2026-11-10)

| | |
|---|---|
| **What** | `MiniCardSvg` (the acp iso deck face, MiniCard drawn as native SVG) lays a Latin-script headword out by hand — `src/components/miniCardSvgLayout.ts` → `layoutPlainWord`: one bold `plainFontSize` line centred in the body, or, for a word wider than the body, wrapped lines start-aligned across it (what ForeignText's flex-wrapped span does in HTML). Written to mirror the HTML but never compared against it on an es card |
| **Why deferred** | All Spanish work is paused (CLAUDE.md § Multi-Language Support); the zh path was built and unit-tested (`src/__tests__/miniCardSvgLayout.test.ts`) |
| **Cost of leaving it** | A long es headword on an acp deck face may wrap or align slightly differently from the dock card it came from |
| **Trigger** | Spanish work resumes |
| **References** | [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) § 5.3 (the deck); `src/components/MiniCardSvg.tsx` |

### 36. Scaling: where server load concentrates, and what breaks first

*Added 2026-11-08 from a code-shape load analysis (no PPE measurements yet). "Checked"
below means the claim was confirmed by reading the cited code; "inferred" means it comes
from code shape alone, with no EXPLAIN or production data behind it.*

| | |
|---|---|
| **What** | Work through the concerns in the table below, measuring first (row 0) so the order is driven by real numbers rather than code shape |
| **Why deferred** | Current PPE traffic is test-scale; nothing here is failing today |
| **Cost of leaving it** | The pool starvation (row 2) degrades **silently**: cards arrive unenriched or with `hasAudio=false` instead of erroring, so it would read as flaky data rather than load. Per-swipe cost grows with deck size |
| **Trigger** | Before any public launch or marketing push, or when PPE shows either symptom: missing audio or related words on cards, or `connectionTimeoutMillis` errors in `cow-backend` logs |
| **References** | the files named per row; [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md) (client-side latency telemetry, complementary to this) |

**Baseline client traffic (for sizing).** A user actively studying sends about 22–25
requests a minute, about half of them writes. Most of it is one `POST /api/flashcards/mark`
plus one `POST /api/tts/synthesize` per card, plus 1–2 `POST /api/users/minutePoints/increment`
a minute. There is no WebSocket and no meaningful polling, so load scales with **active
study time**, not with open tabs.

| # | Concern | Evidence | Fix direction |
|---|---|---|---|
| 0 | **No measurement yet.** PPE has `pg_stat_statements` (`docker-compose.ppe.yml`, `track=all`); dev's `docker-compose.yml` does not, so query cost cannot be profiled locally | Checked | Read the top queries by `total_exec_time` plus table row counts on PPE; add `pg_stat_statements` to the dev compose too |
| 1 | **The replacement-card refill inside every mark.** `FlashcardMarkService.applyMark` → `OnDeckVocabService.getNextLibraryCardWithFallback` can call `fetchFlpCandidates` up to ~8 times. Each call is a whole-deck `DICT_JOIN` read filtered on `barCategoryExpr` (JSONB, unindexable), returning heavy JSONB columns, then the enrichment pipeline. About 15–30 SQL statements per correct swipe. (The working-loop deal had the same shape — five or more such reads per deal, ~0.7 s on a 400-card dev deck — and since 2026-11-08 reads its candidates once: `loadFlpDealPool`, ~0.25 s) | Inferred (call count from code shape); the deal measured | Read only the needed band; select narrow columns for ranking and fetch the winner's full row afterwards; a stored generated column + index for `compute_core_category` (it is IMMUTABLE) |
| 2 | **Pre-warm stamps fan out per cold word.** The deal's enrichment no longer fans out: since 2026-11-09 related words, used-in and writing used-in are one query each per deal (`VocabEntryDAL.findRelatedBySharedCharactersForWords` / `findUsedInForCharacters` / `findWritingUsedInForCharacters`), and no caller holds an outer client (`OnDeckVocabDAL`). What remains: `CardAudioService.prewarm` takes one pool client per **freshly synthesized** card for its `ttsVoice` stamp, in parallel (a cache hit takes none). Only a deal full of never-heard words reaches ~10 at once; the pool is `max: 20` with a 2s connect timeout (`server/db-config.ts`) | Checked (`CardAudioService`) | Collect the misses and stamp them in one `UPDATE … FROM unnest(…)`, or drop the stamp — nothing reads `ttsVoice` |
| 3 | ~~**Full scan per single-character card.**~~ **Closed 2026-11-09.** The used-in lists' pass 2 (`usedInSql` / `writingUsedInSql` in `VocabEntryDAL.ts`) now filters through `charsContainClause`, which the GIN expression index `idx_dictionaryentries_zh_word1_chars` (`string_to_array(word1, NULL)`, migration 186) serves | Measured on dev: 人 26 → 4 ms; a six-character batch ~150 → 6 ms; identical rows to the old `position` filter over the 200 commonest characters. `pg_trgm` was rejected: a trigram index cannot narrow a one-character pattern (35 ms, slower than the scan) | — |
| 4 | **TTS pre-warm blocks the request on a cold word.** The pre-warm (`CardAudioService.prewarm`) awaits synthesis before the flp deal, game boards and acp refills respond. The cache now persists across deploys (the `cow_tts_cache` volume, `TTS_CACHE_DIR`), a hit is a single `fs.access` with no DB write (`TTSService.ensureCached`), and Google calls time out at 8 s (`GOOGLE_TTS_TIMEOUT_MS`). A word nobody has heard yet still costs one synchronous upstream call in the request | Checked | Longer term, a shared object store (see item 13); or pre-warm in the background and let the client's own request synthesize |
| 5 | **API JSON is not compressed.** `nginx.conf` `gzip_types` leaves out `application/json` and `image/svg+xml`, and the server has no `compression` middleware. The worst case is `GET /api/onDeck/collectionCards`: a whole deck with no paging, enriched (substring extraction + `findMultipleByWord1` + greedy segmentation per example sentence) and sorted on the client | Checked (gzip); payload size inferred | Add both types to `gzip_types`; then consider paging or trimming fields for `collectionCards`. (`libraryCards` has the same shape but no caller, see item 35) |
| 6 | **Dictionary search scans with a regex per row, twice.** `DictionaryDAL` search applies `STRIPPED_ALL_GLOSSES` (`regexp_replace(definitions::text, …) ~* …`) to every row, then repeats the WHERE in a separate `COUNT(*)`. In-code timings: 80–260 ms per term on dev. GET requests are not rate-limited | Inferred | Full-text or trigram index on a stored stripped-gloss column; drop or approximate the separate count; cache hot terms |
| 7 | **`WRITING_MASTERY_SELECT` on every vocab read.** `compute_writing_mastery` (migration 170) runs one `vocabentries_zh` probe per character for every multi-character `entryKey`, including Spanish rows | Inferred | Only select it for the writing world and zh rows |
| 8 | **Minute-point increment is ~8 statements, with no transaction.** `UserMinutePointsService.incrementMinutePoints`, once a minute per active user, and twice a minute while the eip is open: each `useMinutePoints` instance ticks independently, and the server's 59s cooldown dedupes the write but both requests still arrive | Inferred | One shared client-side minute-points timer (a context, not per-flame hooks); batch the server statements |
| 9 | **Blockers to running more than one backend.** One Node process (`server/Dockerfile`); in-memory `express-rate-limit` stores (`server/middleware/rateLimits.ts`); local-disk TTS cache; nginx `proxy_pass` with no `upstream`/keepalive and `Connection 'upgrade'` forced on every `/api` request | Checked (process, limiters); nginx checked | Shared store (Redis or Postgres) for limiters; nginx `upstream` with `keepalive`; then cluster/replicas |
| 10 | **No query timeouts.** No `statement_timeout` or `idle_in_transaction_session_timeout` in `server/`, `database/` or either compose file, so one runaway query or leaked transaction holds a pool client indefinitely | Checked | Set both on the pool (`server/db-config.ts`) or as role defaults |
| 11 | **Tables that grow without bound.** `refresh_tokens` (an insert per refresh; `RefreshTokenDAL` never deletes), `category_promotions`, `wins`, `discover_skips`, `focus_daily_snapshots` | Inferred | Retention sweep in the hourly `cow-maintenance` timer, starting with expired/revoked refresh tokens |

### 38. Routed game pages end on a frozen board (no end card)

*Added 2026-11-10, when the medals became run tiers.*

| | |
|---|---|
| **What** | The standalone end popups of Match Speed (`MatchSpeedEndPopup`), Word Search (its inline win card) and Bucket Drop (`BucketDropEndPopup`) were deleted, with Play Again and Match Speed's cleanup mode. Their routed pages (`/games/match-speed`, `/games/word-search`, `/games/bucket-drop`) still exist and now end on a frozen board with no results and no replay. Before `standaloneGames` is switched back on, give those pages an end card (reuse `RunTierPanels` and the break's `FlpBreakResults`) or archive standalone games entirely |
| **Why deferred** | Every game runs as an flp break; the routed pages are unreachable while `standaloneGames` is OFF |
| **Cost of leaving it** | None while the flag is off. Flipping it on ships a dead end |
| **Trigger** | Any plan to turn `standaloneGames` back on |
| **References** | `server/contracts/featureFlags.ts` → `FEATURE_FLAGS.standaloneGames`; `src/games/match-speed/MatchSpeedStage.tsx`, `src/games/word-search/WordSearchStage.tsx`, `src/games/bucket-drop/BucketDropStage.tsx`; GAMES_FEATURE.md § Layer 2 (`GameEndPopup`), § Run tiers |

### 39. Tune the run-tier cutoffs and name the tiers

*Added 2026-11-10.*

| | |
|---|---|
| **What** | Every `SPEED_TIERS` / `ACCURACY_TIERS` ladder is a placeholder (the old medal lines spread over seven tiers, or a guess where a game had no medals), and tiers display as bare numbers. Tune each ladder from play data and give the tiers their names/art. Also: Speed Reading personal bests recorded before 2026-11-10 include the removed +3s wrong-answer penalty, so they are slower than or equal to a raw-time equivalent — decide whether to reset them (`game_personal_bests` rows for `speed-reading`) |
| **Why deferred** | The owner asked for numbered tiers first and will set the details later |
| **Cost of leaving it** | Tier spread may be lopsided; stale Speed Reading bests are easy to beat |
| **Trigger** | The owner's tier-detail pass |
| **References** | `src/games/shared/runTiers.ts`; each game's `constants.ts` → `SPEED_TIERS`, `ACCURACY_TIERS`; GAMES_FEATURE.md § Run tiers |

### 40. One hidden active-time stopwatch

*Added 2026-11-10.*

| | |
|---|---|
| **What** | `src/games/runtime/useActiveRunClock.ts` (Memory Map) is the third copy of the `accumulatedRef` / `runningSinceRef` stopwatch; Superposition (`SuperpositionStage.tsx` → `holdStopwatch`) and Writing Grid (`WritingGridStage.tsx` → `holdStopwatch`) inline the same pattern. Move both onto the hook |
| **Why deferred** | Out of scope for the tier rework that added the hook |
| **Cost of leaving it** | Three copies of a correctness-sensitive clock to keep in step |
| **Trigger** | Next change to either game's clock |
| **References** | the files above; GAMES_FEATURE.md § Backgrounding pauses the clock |

## Recently closed

### 31. Remove review and challenge modes (closed 2026-11-04 — DONE)

The flp and Match Speed have one mode, Study Mix. `StudyMode` / `parseStudyMode`, the
server `MODE_CONFIGS`, `REVIEW_BANDS`, `reviewNextReadyMs`, the `?mode=` / `?category=`
working-loop params and Match Speed's modes are gone; `server/contracts/studyMode.ts` is
the world axis only. Migration 182 (`182-delete-review-challenge-mode-history.sql`)
deletes Match Speed's `wins` levels 2/3 and the `review` / `challenge`
`game_personal_bests` rows.

### 25. Retire `/flashcards/learn` (closed 2026-11-04 — DONE)

The route is deleted. `FlashcardsLearnPage` requires its `tower` host (`FlpTowerHost`) and
renders only inside the Deck Tower; `FlashcardsLearnHeader` and the fdp ⇄ flp choreography
(`flpLaunch.ts`) are gone. The game-break motion lives in
`FlashcardsLearnPage/gameBreak/breakMotion.ts`.

### 30. Analyse how long sense names run (closed 2026-11-03 — DONE for zh)

Measured on `ddt(cluster)` (what the card, the eip header's sense list and the
`SensePicker` show). The fix is write-time, not display-side: a per-sense ≤20-char short
gloss in both clusterers, plus a one-off repair of existing rows
([DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) § "Short lead gloss per sense"). zh
cluster leads over 20 chars went 1,621 → 16; 明's ~120-char Flame Emperor line now
headlines "Flame Emperor Ming". The Spanish half is item 33.

### 32. Store Superposition's stroke groups on det (closed 2026-11-03 — DONE)

The flag is on, and the groups are now AI-authored by `server/scripts/backfill/chinese/backfill-superposition-groups.js`, a mark-discoverable pipeline step that the oracle workers fill over time. The deterministic `.ts` writer was deleted; the algorithm survives only as the on-device fallback. See [SUPERPOSITION_GAME.md](./SUPERPOSITION_GAME.md) § Stored groups.

### A lapsed challenge invitation still spent one of the issuer's six slots (closed 2026-09-13 — DONE)

The cap count is now derived from the deadlines rather than read from the stored
status. `StudyChallengeDAL.listCommittedForUser` returns the committed rows (it replaced
the `countActiveForUser` aggregate), and `StudyChallengeService.countActiveChallenges`
drops each row whose deadline has passed: a `pending` row past the challengee's Wednesday
04:00, or an `accepted` row past the later of the two test-window closes. The fix is
wider than the entry was: lapsed **accepted** rows had the same problem.

The "fourth copy of the boundary arithmetic" this entry was deferred over never happened.
Filtering in the service reuses `server/shared/challengeWeek.ts` instead of re-deriving
the boundary in SQL. The cost is one user lookup per distinct opponent (memoised, at most
seven for a full cap), not a hot-path join. See [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)
§ 9 "The read path never waits for the job".

### The decks page `.duebar` (closed 2026-09-05 — line deleted)

Resolved by **removing the line**, not by answering it. The `.duebar`'s only remaining
slot printed the library SIZE under a caption the artboard wanted to read "24 due
today" — a claim the app does not model. The three `StudyHand` cards directly beneath
it already print cooldown-aware ready counts (`src/utils/flpReadiness.ts` →
`flpReadyCountsByBand`), which is the signal the slot was standing in for, so the row
(`.flashcards-decks__library-line`) and its `libraryTotal` derivation were deleted from
`FlashcardsDecksPage` and the study area is now two rows: the Centers rail and the hand.
Bring a headline figure back only with a caption that matches what it counts.

### Build Study Challenge, phase 1 async (closed 2026-08-22 — DONE)

The whole feature shipped in stages: migration 148 + the server stack + the client
surfaces (2026-08-17, on PPE), and **the scored round runner on 2026-08-22** — the last
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
(migration 139) **deleted** — both migrations are on PPE, and per CLAUDE.md a temporary
runbook is deleted once PPE is verified. Recoverable from git history if ever needed.

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
into a deletion. **Deployed and verified on PPE 2026-08-17** (0 leftover columns across
`vocabentries_zh` / `vocabentries_es`). Being a **contract** migration, it was applied
*after* the container rebuild rather than in one `migrate.sh` pass with 147/148 — 148 had
to land before the new code and 149 after it, so the batch was split around the rebuild.

Note the ⚠️ one-way door: the lifetime tallies are gone and unreconstructible
(`typedMarkHistory` keeps only 8 marks per type). Accepted — nothing read them, and a
future lifetime statistic would start counting from zero.

### Drop the dead `compute_utcm_category()` (closed 2026-08-17 — done)

`database/migrations/147-drop-compute-utcm-category.sql`, the contract half of migration
143 (whose deploy window closed when 143 was verified on PPE on 2026-08-11).
**Deployed and verified on PPE 2026-08-17**: `pg_proc` now holds exactly
`compute_core_category(jsonb)` and `compute_type_category(jsonb,text)`, so the mirror set
is four-way as intended and the phantom fifth is gone.

### Mastery goal defaults — `users.readingGoal` / `users.writingGoal` (closed 2026-08-17)

Resolved as the doc assumed: **`boolean NOT NULL DEFAULT false`**, i.e. an existing
account pursues neither reading nor writing until it opts in, so no account's bars change
on deploy day. Confirmed against the live columns, not just the design doc.

### Study Challenge deploy-order constraints (closed 2026-08-16)

Migrations 140 and 145 were blocking the challenge migration from shipping first. Both
are now on PPE; PPE is current through 146. Kept here because the *shape* of the
constraint recurs: a new migration that depends on an unshipped one cannot be numbered
until the dependency lands.

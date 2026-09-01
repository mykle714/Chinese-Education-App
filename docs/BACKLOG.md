# Backlog — ideas that are wanted but not yet designed

The **front** of the pipeline. An item here is a wish that has been written down and
nothing more: no design, no tables, no estimate. Its job is to hold the *intent* and
the *open questions* so that whoever picks it up starts from the user's actual idea
rather than re-guessing it.

## The three queues, and how something moves between them

| File | Holds | Item looks like |
|---|---|---|
| **BACKLOG.md** (this file) | Wants. Not designed, not agreed in detail | a paragraph + open questions |
| `docs/<FEATURE>.md` | A design under discussion or built | full doc, `STATUS:` banner, question log |
| [DEFERRED_WORK.md](./DEFERRED_WORK.md) | Agreed work deliberately not being done *now* | what / why deferred / cost / trigger |

**Promotion.** When an item's open questions get answered, it leaves this file and
becomes its own `docs/<FEATURE>.md` with a `STATUS: DESIGN / DRAFT` banner and a
question log — the shape [HSK_LEVEL_TEST_OUT.md](./HSK_LEVEL_TEST_OUT.md) already uses.
Delete the entry here and leave nothing behind but the link. This file is a queue, not
a history.

**Not for:** bugs, follow-ups a shipped change left behind (→ DEFERRED_WORK.md), or
deploy steps (→ a `_DEPLOY_RUNBOOK.md`).

> Each entry's **Open questions** are questions *for the user*, not rhetorical framing.
> Nothing below should be built until its list is answered.

---

## Open items

*Written 2026-08-28 from a single planning pass. Every "What" below is the writer's
reading of a one-line prompt — correct it rather than trusting it.*

### 1. Beginner writing keyboard

**What.** A character-entry surface for learners who cannot yet type Chinese. Today the
only way a learner produces a character in the app is by **drawing** it
([PRACTICE_WRITING.md](./PRACTICE_WRITING.md) — Hanzi Writer guide + Google Input Tools
recognition, `zh` only, 1–4 characters). Nothing lets them *assemble* or *pick* one. A
"beginner keyboard" would be a third input mode sitting beside drawing: pinyin-with-training-wheels,
or component-based assembly, or a small candidate palette.

**Why.** Drawing tests recall of stroke order, which is the hardest skill and the last
one a beginner acquires. A learner who recognizes 想 and knows it is *xiǎng* has no way
to demonstrate that. It is also the missing input for any future "type your answer"
production drill — every production surface today is multiple-choice.

**Open questions.**
- Is this an **input method** (produce a character to submit as an answer) or a
  **teaching drill** in its own right, like Practice Writing's four levels?
- Pinyin-based (type `xiang`, pick from candidates), component-based (tap 木 + 目 + 心 —
  `dictionaryentries_zh.components` already exists, migration 125), or both?
- Does it replace the OS IME anywhere, or only appear inside drills?
- Spanish: accented-character entry is the analogous problem. In scope or not?
- Does it emit `production` or `writing` marks ([MASTERY_REWORK.md](./MASTERY_REWORK.md) § 1)?

---

### 2. AI-powered immersive mode

→ **Now has a doc: [IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md)** (abbrev **iw**), `STATUS: DESIGN /
DRAFT`. The open question this file used to hold — *what is a session?* — is answered one
way there: **an objective-driven scene with model-driven NPCs**, built on the night market
engine, where the learner's only inputs are one action button and a word palette whose
contents are emitted into the world as speech. Nothing built, no migration, no tables
confirmed; the whole design is blocked on that doc's § 14 question log. Decided so far: the
NPC reply wire format (measured — a latency bench is built and passing at
`server/scripts/bench/npc-latency/`); that **iw does not mark cards** — it earns minute
points and ends each scene with per-NPC 1–5 ratings plus a one-phrase performance tag, so it
never competes with the games on mastery; and that iw builds **its own beginner text
input** rather than waiting on an OS IME — which makes it overlap item 1 above, and the two
should be designed together with iw leading. **The next action is answering § 14.**

---

### 3. Redesign the Reading and Writing Centers

**What.** Rework `/flashcards/reading` and `/flashcards/writing`. Both routes currently
render the **same component** as the decks page — `MasteryCenterPage`, which is the fdp's
decks panel read through one skill bar instead of the core bar
(`src/features/flashcards/masteryCenters.ts`, [DECKS_FEATURE.md](./DECKS_FEATURE.md)
§ "Mastery Centers").

**Why.** Reusing the decks panel was the cheap way to ship the split, and it means each
Center inherits a layout designed to answer "how well do I know this" rather than "how is
my reading going". A Center that is a re-skinned deck list gives a learner pursuing reading
no surface built for reading.

**Open questions.**
- What should a Center actually *show*? Ranked "cannot read yet"? A reading-specific
  practice entry point? Progress over time?
- Should the two Centers diverge from each other, or stay one component with a bar prop?
- Does the redesign keep the collections/decks/grid spine at all, or replace it?
- The goal gate is on the **button, not the route** — does the redesign change that?
- Related and possibly the same work: DEFERRED_WORK.md § 7 (reading/writing mastery has
  no guess-odds buffer).

---

### 4. Breakdown explanation — finish it

**What.** Render the "How the parts make the word" paragraph under the bt breakdown rows.
The det tables already carry `breakdownElaboration`, and the backfill that fills it exists
(`server/scripts/backfill/chinese/backfill-breakdown-elaboration.js`), but the column is
**not on `server/contracts/wire.ts`** and no read path selects it, so `BreakdownRow` renders
the per-character rows and stops.

**Why.** The breakdown tab answers "what is this made of" but not "why does that add up to
this meaning", which is the more interesting half — and the half a learner cannot derive.

**Note — this one is already tracked.** It is DEFERRED_WORK.md § 10 **(b)**, with a stated
trigger. It sits here only because the user named it in this planning pass. It is the
cheapest item on the page: one column on the read path + the wire type + a paragraph in
the component. **If nothing else here gets picked up, pick this one.**

**Open questions.**
- Is the existing backfill's output good enough to ship, or does the rubric need another
  pass first? (A rubric change is a `SCRIPT_VERSION` bump, not a runbook — CLAUDE.md.)
- Single-character words have no `breakdown` at all (they have `components`) — do they get
  an elaboration of their visual parts instead, or nothing? See item 6.

---

### 5. Test out of an entire difficulty level

→ **Already has a doc: [HSK_LEVEL_TEST_OUT.md](./HSK_LEVEL_TEST_OUT.md)** (abbrev **lto**),
`STATUS: DESIGN / DRAFT`. Nothing built, no migration, no tables confirmed; the whole design
is blocked on that doc's § 11 question log. **The next action is answering those questions,
not writing anything new.** Listed here only so this page reflects the full set of wants.

---

### 6. AI-generated mnemonics for reading characters

**What.** Per-character generated memory hooks — a short story or image-cue tying a
character's *shape* to its *sound and meaning* ("想 = 木 + 目 + 心, wood-eye-heart…").
Distinct from item 4: that one explains how a **word's characters** compose its meaning;
this one explains how a **single character's parts** cue its reading.

**Why.** `components` (single-character visual parts, migration 125) is already computed and
currently feeds only the word search hint ladder. It is the natural input to a mnemonic and
is otherwise underused. Reading is a tracked mastery bar with no dedicated teaching surface.

**Open questions.**
- Scope: reading (pronunciation) only, or shape → meaning too?
- Generated **offline into a det column** (like every other enrichment — cacheable,
  reviewable via the [validations](./DATA_VALIDATION_SYSTEM.md) flow) or **per learner at
  runtime** (personal, expensive, unreviewable)? *The rest of the app's enrichment is
  offline; deviating needs a reason.*
- If offline: new column on `dictionaryentries_zh`, and does it join the discoverable
  enrichment set (i.e. does `/mark-discoverable` gain a step)? **Needs explicit confirmation
  — CLAUDE.md requires new columns be confirmed.**
- Quality bar: a bad mnemonic is worse than none, because it is memorable. Human review
  before display, or ship and flag?
- Where does it surface — the bt tab, the cdp, or a dedicated drill?

---

### 7. Bound-form words (会子 and its class)

→ **Already has a doc: [BOUND_FORM_WORDS.md](./BOUND_FORM_WORDS.md)**. The **data cleanup
is DONE on prod (2026-08-17)**; what remains is the **learner-facing teaching work**,
specified in that doc § 4 and tracked as DEFERRED_WORK.md § 2. Same as item 5: the next
action is a decision on the existing spec, not a new one.

---

### 8. Marimba sound effects

**What.** A sound-effect layer for the app — marimba-toned feedback on marks, correct/wrong,
level-up, card flip, and the game boards.

**Why.** The app has **no sound effects at all** today. The only audio path is TTS
(`src/services/tts/`, [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md)) — speech, not feedback.
Every game is silent, which flattens the moment-to-moment feel of surfaces (Hydra Bubbles,
Bubble Match, Word Search) whose whole appeal is tempo.

**Open questions.**
- One shared sfx layer for the whole app, or per-game sound design?
- Sourced samples or synthesized (Web Audio, no asset weight)?
- **Interaction with TTS** — this is the real design problem. A sound effect firing while a
  word is being spoken competes with the thing the learner is meant to hear. Duck, queue,
  or suppress?
- Settings: one master toggle, or separate sfx / speech volumes? (`useTTSSettings`
  already owns the speech half.)
- Mobile autoplay policy — audio needs a user gesture to unlock; which gesture arms it?
- Does the night market get ambience, or is this strictly feedback?

---

### 9. Game marks only get you so far (+ retire the Recognition/Production split in the UI)

**What.** Two changes to the mastery model, bundled because they touch the same
surfaces and the second is what makes the first legible to a learner.

**(a) A ceiling on what a game can prove.** Today a mark is a mark: a Bubble Match tap
and an flp self-graded recall both write a full-weight positive into the same 8-slot
window (`typedMarkHistory`, [MASTERY_REWORK.md](./MASTERY_REWORK.md) § 2), so a learner
can carry a card all the way to **Mastered** without ever leaving the game boards. The
want is a **cap**: game-sourced marks can push a card up to some band and no further —
the last stretch has to be earned on a surface that actually demands recall (the flp,
Practice Writing, a future typed-answer drill). Related but NOT the same as
[MASTERY_REWORK.md](./MASTERY_REWORK.md) § 8.1, which *discounts* a guessable mark
(credit `1 − 1/N`); a discount slows the climb, a cap stops it. They may compose — §
8.1 decides what a game mark is worth, this item decides how far any pile of them can
reach — or the cap may make the weighting unnecessary. Decide that before building
either.

**(b) Stop surfacing Recognition vs Production.** The two tracks stay exactly as they
are on the backend — `MarkType`, `BAR_MARK_TYPES`, the per-type 8-windows, the per-type
cooldowns, `compute_type_category()` — because the flp's face steering, the games'
pool selection (§ 7) and the cooldown queue all read them. What goes away is every
place a learner is *told* which of the two they are doing. The bar they already see is
called **"Know"** (`BAR_LABELS.core`, `src/utils/masteryCompute.ts`) and blends the
two; the split leaks out around it in: `MARK_TYPE_LABELS` / `MARK_TYPE_COLORS` (the
cdp `.msb` window paints recognition blue and production green, `MasteryWindow.tsx`
— note its per-track **cooldown rows** are the same leak), the mini-card two-mark strip
(`MiniVocabCard.tsx`), the Games hub tile subtitles ("Recognition · 30-second clock",
`src/games/GamesPage.tsx`), the Word Search hub sub-tile chip ("Reading & Production",
`WordSearchHubItem.tsx`), and the Account page Goals copy (`src/pages/AccountPage.tsx`,
"Recognition + Production are always pursued"). Reading and Writing keep their names —
they are real goals a learner opts into; only the core pair collapses.

**Why.** (a) The games are meant to be the *volume* surface — cheap, fast, high-rep —
and the flp the *proof* surface. Nothing in the model says so today, so the cheapest
path to a Mastered card is also the least convincing one, and Mastered stops meaning
anything. (b) Recognition-vs-Production is a modelling distinction, not a learner
one: nobody sets a goal for it (it is mandatory, § 3), no surface lets them choose it
(the flp picks it from the card's face, the games from the registry), and it is the one
piece of mastery vocabulary the app makes a learner learn for no decision they get to
make. Hiding it also removes the awkward moment where the cdp shows two separate
windows for one bar.

**Open questions.**
- **Where is the cap?** Game marks reach Comfortable and stop, or reach the last slot
  below Mastered and stop? Per band, or per pbh number?
- **Is the cap per bar or per card?** Reading is fed by Speed Reading and Word Search —
  both games. A core-only cap leaves reading uncapped; a global cap makes the reading
  bar unreachable until a reading-capable non-game surface exists (the flp
  pinyin-off session is one — is that enough?).
- **What counts as "a game"?** A `source` on the mark (new field on the jsonb), or is
  it derivable from the existing mark type + surface? The mark wire shape
  (`ReviewMark`) does not record where a mark came from today — **this is the one piece
  of new stored state the item probably needs, and it needs confirming.**
- **What does a capped card look like on screen?** A filled window that visibly cannot
  finish is a dead end unless the UI says why. Does the cdp gain a "review this on the
  flp to finish" affordance?
- **Does the cap apply retroactively** to cards already Mastered off game marks, or
  only from the ship date forward? (Retroactive demotion writes `category_promotions`
  rows downward — [VELOCITY.md](./VELOCITY.md) — and un-masters cards in the fdp's
  Mastered collections, `masteredAt`.)
- **(b): does the cdp still show two windows** for the core bar, or one merged 8-slot
  window? Merging is a real design question, not a rename — the two tracks have
  independent windows and independent cooldowns, so a merged window has to pick what a
  cell means.
- **(b): what happens to the Bubble Match track toggle** (`BubbleMatchTrackToggle`)?
  It names Recognition and Reading, which survives the rename — but its sibling copy on
  the Games hub does not.

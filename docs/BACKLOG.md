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

→ **Promoted and BUILT 2026-09-07: [BEGINNER_KEYBOARD.md](./BEGINNER_KEYBOARD.md)** (bk).
It is an app-wide component-assembly IME in `src/features/beginnerKeyboard/`. Open work
lives in that doc's question log.

---

### 2. AI-powered immersive mode

→ **Built, then removed.** This idea became Immersive World (an objective-driven scene with
model-driven NPCs, phase 1 + 2 built behind a flag). The feature was removed from `main` on
2026-11-09 with its code, design doc and tables archived for a possible revival with a new UI —
[ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md). Start there, not here.

---

### 3. ~~Redesign the Reading and Writing Centers~~ — closed

The Centers were redesigned (2026-10) and then **deleted on 2026-11-04**. Reading and
writing are now worlds of the Deck Tower ([DECK_TOWER.md](./DECK_TOWER.md) § Worlds): each
has its own tower (that bar's flp), cards page and game breaks. DEFERRED_WORK.md § 7
(reading/writing mastery has no guess-odds buffer) is still open.

---

### 4. Breakdown explanation — ✅ BUILT 2026-11-07

**What.** The "How the parts make the word" paragraph under the bt breakdown rows. **Done:**
the rubric was rewritten (backfill v2, literal-translation notes) and the column is on the
wire and rendered by `InfoCardTabContent` — see BREAKDOWN_FEATURE_IMPLEMENTATION.md § 5c and
its Frontend Integration section. Rows still show their v1 note until the oracle backfill
re-runs them under v2 (shown as stored, by decision).

**Why.** The breakdown tab answers "what is this made of" but not "why does that add up to
this meaning", which is the more interesting half — and the half a learner cannot derive.

**Note — this one is already tracked.** It is DEFERRED_WORK.md § 10 **(b)**, with a stated
trigger. It sits here only because the user named it in this planning pass. It is the
cheapest item on the page: one column on the read path + the wire type + a paragraph in
the component. **If nothing else here gets picked up, pick this one.**

**Open questions.**
- ~~Is the existing backfill's output good enough to ship?~~ **Answered 2026-11-07: no.**
  The rubric was rewritten (v2, literal-translation notes — 住手 → “Stop hand”: …); see
  BREAKDOWN_FEATURE_IMPLEMENTATION.md § 5c. The manifest bump re-runs the corpus through
  the normal oracle backfill.
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
is DONE on PPE (2026-08-17)**; what remains is the **learner-facing teaching work**,
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

**(b) Stop surfacing Recognition vs Production.** ⚠️ **Mostly done 2026-09-25 ("the know
merge", [MASTERY_REWORK.md](./MASTERY_REWORK.md)):** `MARK_TYPE_COLORS` paints both tracks the
same grey, and the Account and Word Search copy is gone. The last leak, the mini card strip's hover
`title`, was removed 2026-11-08 together with `MARK_TYPE_LABELS`. **No learner-facing
surface names the split any more.** The paragraph below is the original want. The two tracks stay exactly as they
are on the backend — `MarkType`, `WORLD_MARK_TYPES`, the per-type 8-windows, the per-type
cooldowns, `compute_type_category()` — because the flp's face steering, the games'
pool selection (§ 7) and the cooldown queue all read them. What goes away is every
place a learner is *told* which of the two they are doing. The bar they already see is
called **"Know"** (`WORLD_LABELS.core`, `src/utils/masteryCompute.ts`) and blends the
two; the split leaks out around it in: `MARK_TYPE_LABELS` / `MARK_TYPE_COLORS` (the
cdp `.msb` window paints recognition blue and production green, `MasteryWindow.tsx`
— note its per-track **cooldown rows** are the same leak), the mini-card two-mark strip
(`MiniVocabCard.tsx`), the Word Search hub sub-tile chip ("Reading & Production",
`WordSearchHubItem.tsx` — dormant since the Games hub, `src/games/GamesPage.tsx`, and its
tile subtitles were deleted 2026-11-06), and the Account page Goals copy (`src/pages/AccountSheet.tsx`,
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
  rows downward — [VELOCITY.md](./VELOCITY.md) — and un-masters cards in the Mastered
  collections and towers, `masteredAt`.)
- **(b): does the cdp still show two windows** for the core bar, or one merged 8-slot
  window? Merging is a real design question, not a rename — the two tracks have
  independent windows and independent cooldowns, so a merged window has to pick what a
  cell means.
- ~~**(b): what happens to the Bubble Match track toggle**~~ — moot: it was deleted
  2026-10-03 (the hub pins Recognition; reading is played as reading-flp breaks).

---

### 10. Word-tile Scrabble (HSK word tiles, sentence legality)

**Status: BUILT 2026-11-22 as Sentence Tiles — see [SENTENCE_TILES_GAME.md](./SENTENCE_TILES_GAME.md)**
(flag `sentenceTiles` ON, feature testers only, not deployed; migration 204). The owner is
playtesting it. The pilot's method, results and open questions stay in the Claude Doc
[Scrabble Viability Framework](https://claude.ai/artifact/9rm7EehdaZ2fiJqpzTRH1o)
(§ "Quality scoring" and § "Pilot: HSK 1–3 word tiles"); this entry keeps the pilot history.

**What.** A Scrabble-like game whose tiles are whole det entries (one word = one tile,
even multi-character), where every line on the board must read as a **natural
sentence**. Legality is judged by an AI agent call made from the server, because
sentences can't be checked against a dictionary. Tile point values are AI-rated
"nicheness" for now. They should later come from how rarely a tile appears in a sample
of sentences built from the bag.

**Framework decisions already made by the user.**
- Target player is **casual**.
- No pass/fail gates. Each metric gets a soft 0–1 quality score and the overall score
  is their geometric mean.
- Rack size and board size are both design variables.

**Where we left off (pilot, difficulty ≤ 3 = 1,680 tiles, 100-tile bags).**
- Overall ≈ **0.08**, driven by one metric: **61%** of a part-of-speech-composed bag are
  weak tiles (<10% chance of forming a 2-tile sentence). Numerals, classifiers,
  conjunctions and most nouns only fit sentences of 3+ tiles. Excluding that metric,
  rack 9 scores 0.79.
- Composing the bag by POS quota with duplicated function words cut dead racks from
  22% to 10%. It left random-pair legality unchanged at 7%.
- Rack 9 beat rack 7 on every rack metric (dead racks 7.5%, best sentence 3.5 tiles).
  Suggested board size is 9×9 to 11×11. That is reasoning only; nothing has simulated it.
- Every figure comes from one AI judge pass on small samples (40–50 racks). Treat each as ±5 points.

**Round 2 (2026-11-21, crossing rule lifted, plays run through one board tile, particles added).**
Scripts and judge outputs: `server/scripts/analysis/wordScrabblePilot/` (README there).
- Rack 9 + 3 anchors: **4% dead racks, rack score 0.94**. On an empty board the same bag is
  14% dead, so the opening move needs a free redraw or a seeded centre tile.
- No play used a whole rack (max 6 tiles). A 5+ tile long-sentence bonus fires on 14% of turns.
- Hook rate 12% (was 9.6%). Particles hook the back; reply words hook the front.
- Empirical tile points (usage when held) replace the AI rating. 25% of the bag is dead
  weight (<15% usage), half of it the numeral and classifier block (一 两 三 个 本 张). Next
  bag: swap those for det compounds (一个, 一些, 一点) or drop them.
- Judge noise looks like ±7 points. The next run should double-judge.

**Round 3 (2026-11-22, minimum connectivity filter, racks 9/11/13, two judges per rack).**
- Every candidate tile (1,684) has an AI connectivity rating 1–5: how little help it needs to
  join a sentence. Rubric: `connectivity-rubric.md`; ratings: `data/r3-conn-out-*.jsonl`.
  Against round-2 play data the ratings track real usage (Spearman 0.80; mean usage 5% / 23% /
  33% / 59% / 83% for ratings 1–5). The bag admits only rating ≥ 3 (1,129 of 1,684 tiles).
  This dropped 着 从 和 但是 and the numeral/classifier block. The compounds 一个 一点 一下 一些
  were rated 1–2 too, so they also fell out.
- **Dead racks 0% in every configuration, including the empty-board opening move** (14% in
  round 2). Dead-weight share fell from 25% to 10%.
- Rack 9 → 11 lifts the mean best sentence from 3.8 to 4.3 tiles and 5+ tile plays from 16% to
  43%. Rack 13 adds nothing over 11. **Rack 11 is the recommended size.** At rack 11 a 5+
  bonus would fire too often; a 6+ bonus fires on about 15% of turns.
- A bigger rack does **not** rescue low-connectivity tiles: rating-3 tiles are used 32% / 37% /
  26% at racks 9 / 11 / 13. The tiles still stuck are concrete nouns (云 腿 手指 河 公共汽车 学费).
  Caveat: judges list at most 6 plays, which undercounts usage on big racks.
- **Decided 2026-11-22: stuck nouns stay in the bag.** Their points reflect how rarely they play
  instead. `tile-points.py` prices every qualifying tile (1,129) as `1 + round(9·(1 − play rate))`,
  with play rate measured at rack 11. Sampled tiles use their own rate, shrunk toward their rating's
  mean (prior weight 10 racks). Unsampled tiles use their rating's mean only (rating 3 → 41%,
  4 → 67%, 5 → 88%), which can't tell a stuck noun from an easy one. Logged verdicts should
  replace this prior in the product. Bag spread: 吗/你 1 pt … 腿/云 9 pts.
- Two judges agree on dead racks and mean best sentence (gap ≤ 0.4 tiles). They disagree on the
  5+ rate by 4–16 points and on the play-count estimate.

**Data gaps found.**
- 也/吗/吧/呢 were missing from the pilot (NULL `difficulty`, not yet backfilled). **Fixed
  on PPE 2026-11-21** via `/mark-discoverable`. Dev has them since the 2026-11-22 pull. 吗
  and 吧 also had their import reading corrected (ma2 → ma, ba1 → ba). They are now
  difficulty 1/1/1/2.
- `dictionaryentries_zh."frequencyScore"` is 5 for 76% of difficulty ≤ 3 rows, so it
  can't weight a tile bag.

**Open questions (for the user).**
- ~~Should crosswise runs follow the sentence rule?~~ **Decided 2026-11-21: no.** Only
  the line a player places is judged. Incidental side-by-side runs are not checked, so
  crossings and parallel plays stay possible. Judge consistency is explicitly not a
  goal: the game is casual, played by correspondence (a few seconds of judging is
  fine), and players get published guidelines. Every verdict should be logged, because
  the logs become training data for an in-house scorer that can preview a move's
  score before it is played.
- Should frame-dependent tiles be merged into frames (一个, 三本), or kept and handled
  by a larger rack?
- Should each game draw its own bag (a fixed function-word skeleton plus content words
  from the learner's own cards)?
- Next run: two judges per item, racks of 10–11, and a move simulator for board size.

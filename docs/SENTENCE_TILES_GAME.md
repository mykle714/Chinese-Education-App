# Sentence Tiles (working title)

> **STATUS: DESIGN/DRAFT — nothing is built.** No route, `gameId`, flag, table or migration
> exists yet. Decisions the owner has made are in [§ 1](#1-decisions); everything else is a
> proposal, and the remaining questions are in [§ 10](#10-open-questions).
>
> "Scrabble" is a trademark, so it must not appear in the game's user-facing name.
> `sentence-tiles` is a placeholder for the `gameId` and route.

A Scrabble-shaped game where the tiles are **whole Chinese words** and the unit that scores
is a **sentence, not a word**. The player draws a rack of word tiles and places them on a
large panning grid; each new line reads across or down and crosses a character already on
the board.

Where the other games test recall of a single card, this one tests **composition**: choosing
words and ordering them into a sentence. No shipped game exercises that skill.

**Language scope:** `zh` only for now.

---

## 1. Decisions

Made by the owner on 2026-10-31.

| Topic | Decision | Consequence |
|---|---|---|
| Tiles | **Whole words**, not single characters | The player's tile order is the segmentation, so GSA is not needed to read a line |
| Board | **Large panning board** | Panning and tile dragging must share touch gestures (§ 9) |
| Opponents | **Solo, friends, and other app users** | The server must own game state and rule on moves (§ 8) |
| Mastery | **No marks** | No `MARK_TYPE`, no sense handling, and no Study Challenge eligibility |
| Referee | Owner asked for a **quick POS-based grammar**, under evaluation | Measured in § 4; recommendation in § 5 |

---

## 2. The central problem: what counts as valid?

Scrabble works because a finite dictionary can referee it. Sentences have no finite list, so
the referee shapes dealing, multiplayer fairness, cost and feedback. A multiplayer referee
must also be **deterministic**: two players submitting the same line must get the same
verdict.

---

## 3. Corpus available today

Measured on the dev database, 2026-10-31, discoverable `dictionaryentries_zh` rows only.

| Measure | Value |
|---|---|
| Discoverable entries, all with sentences | 28,304 |
| Distinct example sentences | 85,202 |
| Length, p10 / median / p90 (characters, punctuation included) | 10 / 14 / 18 |
| Segments per sentence, p10 / median / p90 | 7 / 9 / 12 |
| Clauses of 3–8 segments, with every segment tagged | 95,258 |
| Stored POS vocabulary | 12 tags |
| Most common contextual tags | noun 210,608 · verb 147,701 · particle 74,299 · pronoun 68,648 |

Every stored sentence carries a contextual `partOfSpeechDict`, which is what makes a
corpus-derived grammar possible at low effort. A word's `partsOfSpeech` lists every tag it
can take (好 has five), which is the wrong input for a referee (§ 4b).

**Clauses are the playable unit**, because whole sentences are long and need punctuation.

**Depends on:** `exampleSentences` on `dictionaryentries_zh`
([EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md)); `partsOfSpeech` on the same table.

---

## 4. Feasibility tests

Throwaway simulations, 2026-10-31. Clauses were split 90/10 and rules were learned from the
90%. "Real" is held-out clauses accepted. "Shuffled" is the same clauses with their words in
random order accepted. Some shuffles are legitimate Chinese, so that column overstates the
error rate, and the tests say nothing about whether a line makes sense.

### 4a. Lookup rules

| Rule | Real accepted | Shuffled accepted | Verdict |
|---|---|---|---|
| Random character rack spells a stored sentence | n/a | n/a | P ≈ 0, even with 30 tiles |
| Every adjacent word pair seen in corpus | 16–34% | 1–3% | Rejects most correct Chinese |

### 4b. POS grammar, using every tag a word can take

Tag n-gram rules on the word's full `partsOfSpeech` list: about 95% of real clauses accepted,
but also about **67% of shuffles**, even at the strictest setting tried (n = 4, seen ≥ 10).
Words with many possible tags can fill almost any slot. **Not viable alone.**

### 4c. POS grammar, using one main tag per word

Each word uses its most common contextual tag. A line passes if its whole tag sequence is one
of the N most common clause patterns. "Lexicalized" keeps particles, conjunctions and
prepositions as themselves (`particle:的`), which is the better variant.

| Patterns kept (lexicalized) | Real accepted | Shuffled accepted |
|---|---|---|
| 100 | 20% | 5% |
| 500 | 36% | 9% |
| 2,000 | 52% | 14% |
| 10,000 | 67% | 21% |
| All 29,065 | 76% | 25% |

Spot checks at 2,000 patterns:

| Line | Verdict | Correct? |
|---|---|---|
| 我很高兴 / 我的书 / 我喜欢吃苹果 | Accepted | Yes |
| 很我高兴 / 的我书 | Rejected | Yes |
| 吃我苹果 | Accepted | No: wrong word order |
| 桌子吃飞机 | Accepted | No: grammatical shape, meaningless |
| 最后面是一个小花园 / 如果不努力学习 | Rejected | No: real Chinese |

**Limits of this approach:**

- It checks shape, never meaning. Fixing that would need verb-object knowledge, which
  [WORD_TAXONOMY.md](./WORD_TAXONOMY.md) might later supply.
- A single tag loses words with real double duty: 在 as a verb, 到 as a preposition.
- Rack solvability under this stricter rule is unmeasured. A looser trigram rule always found
  lines in random 7- and 10-word racks, but most were word salad, so dealing should still
  be seeded (§ 6).

---

## 5. Referee recommendation

Use a **tiered referee**, built in order:

1. **Stored clause match:** always accepted.
2. **POS pattern match** (lexicalized main-tag patterns, about 2,000–10,000 kept): accepted.
   This tier is instant, free, needs no migration and is deterministic, so it works for
   multiplayer. The cutoff is tuned by playtest.
3. **AI judge, later phase:** rules on lines the patterns reject and can audit accepted
   lines. Verdicts are cached by line, which keeps them deterministic.

The patterns and main-tag map are generated offline from the corpus and shipped as a server
asset. Regenerating them changes rulings, so a running multiplayer game must stay pinned to
the version it started on.

Before the AI tier exists, feedback must say the line "isn't recognised", never that it is
wrong Chinese. With no marks, a false accept costs no mastery data, but it can still teach a
bad pattern, so the game should be presented as play rather than proof of correctness.

**Depends on:** `server/dal/shared/dictJoin.ts` (reading `exampleSentences`).

---

## 6. Proposed rules

### Round setup

1. The server picks seed clauses and uses their words as the tile pool, plus distractors.
2. Racks are dealt so at least one seed line can always be completed.
3. In multiplayer, players draw from one shared seeded pool.

### Placement

- A word tile covers one cell per character.
- A turn places tiles in one straight line, across or down, forming a clause.
- After the opening line, a new line must **cross an existing line through a shared
  character**: 学习 can run across and 学校 down through the same 学.
- **Parallel play is not allowed.** Touching tiles would form runs that must themselves be
  sentences, which almost never holds. The board reads like a crossword lattice.
- Punctuation is not a tile.

### Scoring (sketch; needs playtesting)

- Tile value rises as a word gets rarer.
- Bonuses for longer lines, for using the whole rack, and for each crossing.
- Whether premium squares earn their place is still open.

---

## 7. App integration

- **No marks:** the game calls neither `POST /api/flashcards/mark` nor `fetchGamePool`'s
  mark-bucket logic. Because `GameDef.markType` is omitted, it stays outside the Study
  Challenge pool.
- **Card supply:** with no marks, the game does not need a `CARD_BASELINES` entry or
  provisional lending, provided tiles come from the discoverable corpus. Biasing tiles
  toward the learner's deck is a separate choice (§ 10).
- **Pinyin:** word tiles have a stable reading in nearly all cases, which avoids the tile
  ambiguity character tiles would have had. The per-game pinyin setting applies
  ([GAMES_FEATURE.md § Pinyin is a per-game setting](./GAMES_FEATURE.md#pinyin-is-a-per-game-setting)).
- **Definitions:** any meaning shown on a tile goes through `resolveDisplayDefinition`.

**Depends on:** `src/games/registry.ts` → `challengeScoringFor`; `server/contracts/wire.ts` →
`CARD_BASELINES`.

---

## 8. Layers

| Layer | Component | Phase |
|---|---|---|
| **Contract** | `KNOWN_GAME_IDS`, `GAME_FLAGS`; game, move and verdict wire types | 1 |
| **Controller** | Start game, submit move, read game; matchmaking later | 1 / 3 |
| **Service** | Dealer; rules engine; referee; turn order; matchmaking later | 1 / 3 |
| **DAL** | Sentence reads; saved games; moves; AI verdict cache later | 1 / 2 |
| **Offline script** | Generates the pattern asset from `partOfSpeechDict` | 1 |
| **Client: `src/games/sentence-tiles/`** | Page, panning board, rack, move submission | 1 |
| **Client: shared** | `GameEndPopup`, `clockPaused` for any timed mode | 1 |

**Build order:** phase 1 is solo; phase 2 adds the AI judge; phase 3 adds friends, then other
app users. Solo should go through the same server rules engine, so multiplayer does not need
a second implementation.

**New tables are unavoidable** for turn-based play, at minimum for games, their players and
their moves, plus a verdict cache for the AI tier. No schema is proposed yet; each table and
column must be confirmed with the owner before a migration is written.

**Depends on:** `server/contracts/featureFlags.ts` → `GAME_FLAGS`; `server/constants.ts` →
`KNOWN_GAME_IDS`; [FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md);
[BACKEND_LAYERING.md](./BACKEND_LAYERING.md); [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md).

---

## 9. UI constraints

The game inherits these app-wide rules. A visual design has not been started.

- Leaf page with no footer; `touchAction: "none"`; `useBlockEdgeSwipe(true)`
  ([UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md)).
- Tiles are tappable entities, so they carry `border: 1px solid ${COLORS.border}`.
- Characters render through `ForeignText`, and colours come from `src/theme/*`. The game hue
  must be a `RampHue` key.
- **Gesture proposal for the panning board:** drag from the rack moves a tile; drag on empty
  board pans; tap-to-select then tap-to-place is the fallback for precise placement. The
  board should auto-pan when a tile is dragged near its edge.
- Word tiles are several cells wide, so rack layout must handle mixed lengths.

---

## 10. Open questions

| # | Question | Current proposal |
|---|---|---|
| 1 | Is the tiered referee in § 5 accepted? | Yes, starting with stored clauses + POS patterns |
| 2 | How are "other app users" matched: live, or asynchronous turns? | Asynchronous, as with friends |
| 3 | Is a round timed? | Untimed solo; turn deadline in multiplayer |
| 4 | Do tiles lean toward the learner's deck and level? | Yes, weighted; otherwise beginners see unknown words |
| 5 | Does play earn minute points, given no marks? | Yes |
| 6 | How large is the board? | Decide with a prototype |
| 7 | Are there premium squares? | Omit until playtested |
| 8 | What is the final name? | Unnamed |

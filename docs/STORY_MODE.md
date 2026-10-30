# Story Mode — choose-your-own-path stories (Authored vs Improvised)

> STATUS: **DESIGN / DRAFT — nothing is built, no migration exists, no table is approved.**
> Started 2026-10-29. Decided so far: DAG structure (Q4), DB + editor on PPE (Q3),
> target-language-only input (Q9), loose-goal endings for Improvised (Q2). Every section
> marked **PROPOSED** is still a draft; the open questions are collected in § 13. Do not build
> from this doc until § 13's 🔴 questions are answered.

**Working name:** "Story Mode". The two variants under test are called **Authored** and
**Improvised** throughout this doc (rename freely — see Q1).

---

## 1. What it is

The app tells the learner a short story in their target language, one passage at a time.
After each passage the learner decides what their character does next, and the story
continues from that choice. Every story has a fixed **ending catalog** — a handful of
prescribed endings — and the meta-goal is to **collect them all**, which means replaying the
story and choosing differently.

Two variants, built to be compared against each other:

| | **Authored** | **Improvised** |
|---|---|---|
| Who writes the story | A human, in full, ahead of time | A model, live, from an authored premise |
| How the learner chooses | Taps one of 2–3 canned choices | Writes their own action, free text |
| Structure | A graph of passages (tree or DAG — Q4) | No structure; a running transcript |
| Endings | Specific terminal passages in the graph | An authored catalog of **goals** the model steers toward, but it may also invent an ending (§ 5.3) |
| Exercises mainly | **Reading**: every choice is a comprehension check, written in the target language | **Reading + writing**: the learner writes every action in the target language (§ 5.4) |
| Cost per play | ~$0 (static content) | Model calls per turn (§ 5.6) |
| Content risk | None at runtime — every line was reviewed | Unreviewed model text on screen (§ 5.7) |

**Both variants have an authored ending catalog, but it binds them differently.**
✅ **DECIDED 2026-10-29 (Q2): the Improvised catalog is loose goals.** The model is told the
authored endings and steers toward them, but it may also bring the story to an ending that is
**not** in the catalog. So an Improvised story has two kinds of ending: **catalog endings**
(collectable, with silhouettes, counted in "3 / 7") and **unscripted endings** (made up by the
model, see § 5.3 for how they are recorded). Authored endings are exhaustive by construction.

### 1a. What it is NOT (PROPOSED)

- **Not Immersive World.** iw ([IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md)) is a walkable scene
  with voiced NPCs; the target language is the *control interface* and latency is the hard
  constraint. Story Mode is a **reading surface** — text on a page, no avatar, no voice by
  default, no ~500 ms budget. It reuses a lot of iw's server plumbing (§ 5) but none of its
  world engine.
- **Not a drill.** Whether it marks cards at all is open (Q11). The default in this draft
  follows iw § 1a: no marks, minute points only.
- **Not graded.** No choice is "wrong". A choice that leads to a bad ending is still a
  collected ending.

---

## 2. Shared concepts (PROPOSED)

| Term | Meaning |
|---|---|
| **Story** | One authored unit: title, cover, language, level, variant (`authored` / `improvised`), and its ending catalog. |
| **Ending** | One entry in a story's catalog: stable id, title, a one-line teaser shown once collected, and a **silhouette** shown before (e.g. "??? — an ending involving the night train"). Optionally a tone (good / bad / secret — Q6). |
| **Run** | One playthrough of one story by one learner, from the opening passage to an ending (or abandoned). |
| **Collection** | Per (user, story): which endings the learner has reached, when first reached. This is the only *durable* progress Story Mode needs. |

The collection is what the learner sees on the story's shelf tile: **"3 / 7 endings"**, with
the uncollected ones as silhouettes. Collecting all of them could mark the story complete and
unlock something (a badge, a secret ending, the next story — Q7).

---

## 3. The reading surface (shared by both variants)

Both variants put **target-language passages** on screen and must make them readable by a
casual learner ([PROJECT_GOAL.md](./PROJECT_GOAL.md)):

- **Foreign text renders through `ForeignText`** (zh: cpcd segments with pinyin; es: plain
  text) — never `CPCDRow` directly.
- **Every word is tappable** for the same definition popup the est uses, exactly as iw
  § 5.3b reuses it rather than building a second one. Drilling into the eip from a passage
  (iw § 5.3c) is a later phase.
- **Segmentation.** Authored passages are segmented **once, at publish time** (gsa,
  [greedySegmentation.md](./greedySegmentation.md)) and stored segmented in the published
  snapshot (§ 4.4), so the client does no work. Improvised passages are segmented **per turn on the server**, the way iw does it
  (`server/services/iw/lineSegments.ts` → `partsToLineSegments`).
- **An English translation toggle** per passage (Q10). Authored: written by the author or
  generated and reviewed once. Improvised: requested from the model alongside the passage.
- ✅ **Choices are in the target language** (Q9, decided 2026-10-29: target language only, in
  both variants). For Authored this is the whole learning mechanic: to pick deliberately you
  have to understand the choices. Whether a choice can show its English translation is Q10,
  and it matters more now that the choices themselves are never in English.

---

## 4. Variant A — Authored

### 4.1 Structure: a DAG (✅ DECIDED 2026-10-29, Q4)

The brief says "can be structured as a tree, but all parts must be written." Both are
compatible with "every passage written by a human"; the difference is how much has to be
written.

**A pure tree explodes.** With *b* choices per passage and *d* choices deep, a tree has
*b*^*d* leaves and (*b*^(*d*+1) − 1)/(*b* − 1) passages:

| Choices per passage | Depth | Passages to write | Leaves |
|---|---|---|---|
| 2 | 4 | 31 | 16 |
| 2 | 6 | 127 | 64 |
| 3 | 4 | 121 | 81 |
| 3 | 5 | 364 | 243 |

And every leaf is an ending, so a tree with 7 prescribed endings either dead-ends very early
or has many leaves sharing the same ending (which is really a DAG written out the long way).

**✅ DECIDED: a DAG, i.e. "branch and bottleneck."** Branches can **rejoin** a shared passage,
so a 7-ending story is roughly 25–40 passages regardless of depth. Rules:

1. Exactly one **start** passage.
2. Every non-ending passage has **2–3 choices**; every choice points at exactly one passage.
3. **Ending passages** have no choices and carry one ending id from the catalog.
4. **Every ending in the catalog is reachable**, and **every passage reaches at least one
   ending** — no orphans, no loops that cannot exit. The editor validates this on save
   (§ 4.4); the iw editor's `server/services/iw/sceneValidation.ts` is the precedent. A
   **draft** may be invalid; only a valid story can be **published** to learners.
5. Cycles: **disallowed** in v1 (keeps "reachable" and "progress" well-defined). Q5.

Optional later: **flags** ("you took the key") that a later passage reads to show or hide a
choice. That is how gamebooks make a DAG feel like a tree without writing one. It is
deliberately out of v1 — it turns the validator from a graph walk into a state search (Q5).

### 4.2 Passage shape (PROPOSED)

```ts
// server/contracts/story.ts (PROPOSED — does not exist)
interface StoryPassage {
  id: string;                  // stable within the story; never reused
  text: string;                // target language, as authored
  segments?: Segment[];        // offline gsa output; absent until segmented
  translation?: string;        // English, author-written or reviewed
  choices: StoryChoice[];      // empty ⇔ this is an ending passage
  endingId?: string;           // present ⇔ choices is empty
}
interface StoryChoice {
  id: string;
  text: string;                // target language
  translation?: string;
  to: string;                  // StoryPassage.id
}
```

### 4.3 Collecting endings is the replay loop

A collect-all game lives or dies on how painful replay is. PROPOSED, in order of value:

1. **Story map.** After the first ending, the learner can open a map of the passages they have
   *visited* (unvisited ones are fogged), and **start from any visited choice point**. This
   turns "replay the whole story to try branch C" into one tap. Q8 — it may make collecting
   too easy.
2. **Visited-choice tint.** A choice the learner has already taken in an earlier run is shown
   dimmed with a small mark, so they can deliberately go somewhere new.
3. **No undo inside a run** (v1). Rewind is the map, not a back button.

### 4.4 Authoring: a story editor on PPE (✅ DECIDED 2026-10-29, Q3)

Stories are **data, authored in an in-app editor on PPE**, like iw scenes (`iw_scenes`) and
sort packs ([SORT_PACKS_IMPLEMENTATION.md](./SORT_PACKS_IMPLEMENTATION.md) § 2.1). It is not
content as code. Consequences:

- **The editor is on the critical path.** iw found its editor was the biggest piece of
  phase 1 ([IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md) § 12); expect the same here. Phasing
  (§ 11) now starts with it.
- **Gate:** `users.isTemplateAuthor`, the existing authoring grant (Q21: reuse it, or a new
  `isStoryAuthor` grant?).
- **PPE is the source of truth** for story content. Dev needs a pull path: extend the
  `/template-pull` skill (PPE authored content → local) or `/data-ppe-to-dev` (Q22).
- **Draft / published.** An author edits a draft freely; publishing runs the § 4.1 validator
  and makes that version visible to learners. Q23: what happens to an in-progress run when its
  story is re-published with passages removed?
- **Both variants are authored in the same editor.** An Improvised story is a premise +
  opening + goal catalog form (§ 5.1); an Authored story adds the passage graph.

**Editor shape (PROPOSED, needs a design pass):** a passage list with a detail pane is the
cheap v1 (edit a passage's text, translation, choices and their targets, mark it as an
ending). A visual node-graph canvas is nicer but costs much more. A **"play from here"**
preview is cheap and catches most broken links (Q24).

**Segmentation on publish.** Since content is authored as data, gsa segmentation of every
passage and choice runs **at publish time** on the server, and the segments are stored with
the published version (§ 3).

**Levels and languages multiply authoring.** iw dodged this with one scene per situation and
the level as a prompt input (iw § 9.4). Authored text cannot adapt, so each (story, language,
level) is its own piece of writing. PROPOSED: v1 ships **one story, zh, one level** (Q12).

---

## 5. Variant B — Improvised

### 5.1 What the author writes (PROPOSED)

An Improvised story is still authored, just much less:

- **Premise**: setting, the learner's character, the opening situation (a paragraph, English
  OK — it is a prompt input, not displayed).
- **Opening passage**: written by the author, so the first screen is reviewed and instant.
- **Goal catalog**: each catalog ending's id, title, silhouette, and a **prose condition** the
  model judges against ("the learner reaches the summit before nightfall"). These are goals,
  not a fence (§ 5.3).
- **Guardrails**: things that must not happen (no character death, stay in the city, …).

### 5.2 The turn loop

```
learner writes an action  ──►  POST /api/story/:runId/turn
                                 │  checkInput (length, rate, budget)
                                 │  prompt = premise + endings + rolling state + action
                                 │  model → { passage, translation, ending | null, stateNote }
                                 │  ending = { catalogId } | { unscripted: title + summary }
                                 │  validate catalogId ∈ this story's catalog
                                 │  sanitize → segment → persist
                               ◄──  passage (+ ending reached?)
```

- **Model access reuses iw's ladder** (`server/services/iw/modelLadder.ts` → `getIwLadder`)
  or a sibling ladder with its own env var (Q13). Latency is not critical here — there is no
  voice clock — so a **stronger model than iw's Haiku primary** is affordable per turn, and
  streaming the passage in with the typewriter reveal hides most of the wait.
- **Context stays bounded.** The prompt carries the premise, the catalog, a short
  model-maintained **state note** (what has happened, what the learner holds, which endings
  are still plausible) and only the last few passages — not the whole transcript.

### 5.3 Endings: loose goals (✅ DECIDED 2026-10-29, Q2)

The catalog is **guidance**, the same policy iw § 9.4 settled for vocabulary. The model ends
the story in one of two ways:

- **On a catalog ending:** it names a catalog id. As in iw § 5.4 the id is matched against what
  the story authored; an unknown id is **not** silently accepted. It is treated as an
  unscripted ending (below), so a typo can never mint a fake catalog ending.
- **On an unscripted ending:** the story reached a natural conclusion that matches no goal.
  The model returns a short title + one-line summary, which is sanitized and stored on the run.

**⚠️ What loose goals cost, stated plainly:**

1. **The ending-id backstop is gone as a safety layer.** "End the story" is now something the
   learner can provoke at will, including by injection. The worst case is still only text (a
   sanitized title on the learner's own run), but § 5.7 loses a layer.
2. **The comparison gets noisier** (§ 10). "Endings collected" means something different in
   each variant. The fair metric is **catalog endings collected**, with unscripted endings as a
   separate column.
3. **A drifting model makes the catalog uncollectable.** If the model goes unscripted too
   readily, learners never reach the goals. The bench has to measure the **catalog landing
   rate** as well as reachability (below).

**Open follow-ups this raises:**

- Q25: Do unscripted endings go **into the learner's collection**? Shown how: a separate
  "Your own endings" shelf, or not kept at all?
- Q26: Is there a **floor** where the model must prefer a catalog ending (e.g. on the forced
  final turn)? The draft says yes: the turn-budget landing below targets the nearest catalog
  goal.

**A turn budget forces a landing.** PROPOSED: a run has N turns (≈12–15, Q14). From turn
  N − 3 the prompt tells the model to steer toward the **nearest** plausible catalog goal; on
  turn N it must end, on a catalog ending if any fits (Q26). The learner sees this in-world ("the sun is setting…"), not as a quota —
  the same rule iw § 7 set for its session budget.
- **A learner who targets an uncollected ending** ("I want the secret ending") is fine —
  steering toward a goal is the game. The prompt gets the learner's uncollected endings so it
  can favour new ones when the action is ambiguous (Q15).
- **Endings must be reachable in practice, not just in principle.** A bench script, like iw's
  `server/scripts/bench/npc-latency/`, should replay scripted action sequences and report which
  endings each reaches, how many turns it took, and the **catalog landing rate** (share of runs
  ending on a catalog goal rather than unscripted). A catalog ending the bench never reaches is
  a bug in its condition prose.

### 5.4 What the learner writes in: target language only (✅ DECIDED 2026-10-29, Q9)

Every action is written in the target language. This makes Improvised real production practice.
zh learners get the Beginner Keyboard ([BEGINNER_KEYBOARD.md](./BEGINNER_KEYBOARD.md)) for
free, since it mounts app-wide on focus. es learners use the OS keyboard.

The reply should **not correct the learner's grammar inline** (that would break the story). A
later, optional "how you could have said it" line on the ending screen is a separate idea (Q16).

**Follow-ups this raises:**

- Q27: **What happens when the learner writes English anyway** (or pinyin, or gibberish)?
  Options: (a) the server rejects it before the model call, using a cheap script check
  (CJK ratio for zh), with a gentle in-world nudge; (b) the model treats it in character
  ("the shopkeeper looks confused"); (c) it is accepted. The draft's lean: (a) for zh, since it
  is free and saves a billed turn; (b) for es, where a script check cannot tell Spanish from
  English.
- Q28: **Beginners.** A learner with ~50 words cannot write much. Is there an assist, such as a
  tappable row of library words or "suggested actions" in the target language that they can
  edit? iw's palette idea (iw § 9a) is the precedent. Or is Improvised simply for
  intermediate learners?

### 5.5 Vocabulary and level

Follow iw § 9.4's decided policy: **guidance, not a gate.** The prompt gets the learner's level
and their own library words (`getGameVocabPool`) with "work these in where it is natural." No
allowed-list enforcement.

### 5.6 Cost and abuse

Same shape as iw § 7: server-enforced input length cap, minimum gap between turns, per-run
turn budget (§ 5.3), and a per-user daily turn cap with a counter checked before and
incremented after a billed call (the `dictionary_ai_usage` precedent). Whether Story Mode shares
iw's daily cap or has its own is Q13.

### 5.7 Content safety

Inherits iw § 11 wholesale, and it is the same threat model (free text into a model, model text
onto a screen):

1. A narrow, author-written premise + guardrails.
2. Learner text is **quoted as data in a user turn**, never concatenated into the system prompt.
3. Every passage goes through the shared sanitizer (`server/utils/sanitizeContent.ts` →
   `sanitizeDocumentContent`) before it is stored or shown.
4. ~~The ending-id backstop~~: **weakened by Q2** (§ 5.3). A catalog id is still validated,
   but the model can always go unscripted, so it no longer bounds what a run can do.
5. An injection probe set in the bench, re-run on every prompt edit.
6. **Author-written content is reviewed, model text is not.** Premises and guardrails come from
   a trusted author (`isTemplateAuthor`), so the system layer is never learner-controlled.

---

## 6. What a run earns (PROPOSED)

| Currency | Authored | Improvised |
|---|---|---|
| **Minute points** | Yes — time-based, like every surface ([MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)), gated on recent activity (a choice made / words tapped within ~90 s, iw § 9.5's rule) | Same, gated on a turn submitted within ~90 s |
| **Endings** | Collected per (user, story) | Same |
| **Card marks** | None in v1 (Q11) | None in v1 (Q11) |

---

## 7. Data model (PROPOSED — ⚠️ nothing here is approved; see Q17)

Authoring on PPE (§ 4.4) means story **content** is now a table too. Following iw's lesson
(migration 159 collapsed child tables into jsonb on `iw_scenes`), the passage graph is one jsonb
blob per story version rather than `story_passages` / `story_choices` tables. A story is always
read, validated and published whole, so nothing queries an individual passage.

**Content (authored on PPE):**

| Table | Columns (draft) | Why |
|---|---|---|
| `stories` | `id`, `language`, `level`, `variant` (`authored` / `improvised`), `title`, `coverIcon`, `status` (`draft` / `published` / `retired`), `draft` jsonb, `published` jsonb (nullable), `publishedVersion` int, `authorId`, `createdAt`, `updatedAt` | One row per story. `draft` is the editor's working copy; `published` is the validated, segmented snapshot learners play. The jsonb holds the passage graph (Authored), or premise + opening + guardrails (Improvised), plus the ending catalog. |

**Learner progress:**

| Table | Columns (draft) | Why |
|---|---|---|
| `story_runs` | `id`, `userId`, `storyId`, `storyVersion`, `variant`, `language`, `startedAt`, `endedAt`, `endingId` (nullable, catalog id), `unscriptedEnding` jsonb (nullable, `{title, summary}`), `turnCount`, `path` jsonb (passage ids for Authored / turns for Improvised) | Resume an unfinished run, the story map's "visited" set (§ 4.3), and every metric in § 10. `storyVersion` pins the run to the version it started on (Q23). |
| `story_endings_collected` | `userId`, `storyId`, `endingId`, `firstReachedAt`, `runCount` · PK (`userId`, `storyId`, `endingId`) | The collection (§ 2). One row per **catalog** ending ever reached. Unscripted endings stay on their run unless Q25 decides otherwise. |

Improvised turns (learner text + model passage) live in `story_runs.path`, which is fine at
~15 turns a run. If transcripts get large, split them into a `story_run_turns` table.

⚠️ **Ending ids must be stable across re-publishes**, because `story_endings_collected` keys on
them. The editor generates ids once and never lets an author edit or reuse one. Deleting an
ending from the catalog **retires** its id (collected rows are kept and shown as "retired").

**Language scoping:** `storyId` is per language (a story is written in one language), and
every read filters by the learner's selected language.

---

## 8. Layering (PROPOSED)

| Layer | Component |
|---|---|
| **Contract** | `server/contracts/story.ts`: passage/choice/ending/run shapes, input length cap, turn budget (client-visible limits live in contracts, per iw § 7) |
| **DAL** | `StoryDAL` (`stories`, `story_runs`, `story_endings_collected`): SQL only, no story logic |
| **Service** | `StoryAuthoringService`: draft save, § 4.1 validation, publish (validate → segment → snapshot). `StoryService`: start/resume run, apply an Authored choice, record an ending. `StoryImprovService`: prompt build, model call via the ladder, catalog-id check, sanitize, segment |
| **Pure logic** | `storyGraph.ts`: the § 4.1 reachability validator, with no I/O so it is unit-testable and shared by the editor's live warnings and the publish gate |
| **Controller / routes** | `storyRoutes.ts` under `/api/story/*` (learner) and `/api/story/authoring/*` (`isTemplateAuthor`), mounted only when the `storyMode` feature flag is on ([FEATURE_FLAGS.md](./FEATURE_FLAGS.md)) |
| **Client** | `src/features/story/`: shelf of stories, the reader page (passage + choices / composer), ending screen, story map, and the author-only editor. All calls through `src/api/http.ts` |

---

## 9. Entry point and UI (Q18)

Candidate homes: a **Menu (hp) Bento tile** (alongside Games, Reader, Arena), or a card on the
**Reading Center** belt, since Authored is mostly a reading exercise. Visual design is not
drafted yet; it should come from a claude.ai/design pass like the Centers did.

---

## 10. The experiment: what "test both versions" measures (Q19 — 🔴)

PROPOSED: both variants ship side by side to **feature testers** (`users.isFeatureTester`),
each tester sees both, and we compare from `story_runs`:

| Metric | Tells us |
|---|---|
| Runs started → runs reaching an ending | Does the format hold attention to the end? |
| Distinct endings collected per learner per story | Does the collect-all loop pull replays? |
| Median minutes per run, turns per run | Engagement and pacing |
| Words tapped per passage | Comprehension load: is the text pitched right? |
| (Improvised) % of runs where the budget forced the ending | Is the model actually steering, or just being cut off? |
| (Improvised) catalog vs. unscripted endings | With loose goals (Q2), does the learner reach the authored goals at all? Compare **catalog** endings collected across variants. |
| (Improvised) turns rejected as not-target-language | Is target-only input (Q9) a wall for learners? |
| (Improvised) cost per completed run | Whether it is affordable at all |

Plus qualitative feedback from testers. **Fairness note:** to compare the variants rather
than the stories, ideally both are built on the **same premise and the same ending catalog**:
one hand-written graph and one improvised over it (Q20).

---

## 11. Phasing (PROPOSED)

| Phase | Ships | Kill / continue signal |
|---|---|---|
| **1 — The editor** | Contracts, `stories` table, `storyGraph.ts` validator, authoring routes, list + detail-pane editor with "play from here", publish-time segmentation, PPE → dev pull. | An author writes and publishes a whole Authored story (zh, one level, ~30 passages, ~6 endings) with no engineering help: iw's phase-1 kill condition. |
| **2 — Authored playable** | `story_runs` + `story_endings_collected`, reader page, ending screen, collection on the shelf tile. Flag ON for testers. | Testers finish runs and replay for endings. |
| **3 — Improvised playable** | Improvised form in the editor, turn endpoint, prompt, ladder, budget + caps, target-language check, sanitizer, server segmentation, ending bench. | The bench reaches every catalog goal at an acceptable landing rate; cost per run is acceptable. |
| **4 — Compare and decide** | Metrics query (§ 10). Story map (§ 4.3). | Pick a winner, or keep both. |
| **Later** | Visual graph canvas, flags/state in Authored graphs, more stories/levels/languages, es, audio narration, marks. | — |

---

## 12. Referenced code (keep in sync)

Nothing in Story Mode exists yet. It plans to reuse:

- `server/services/iw/modelLadder.ts` → `getIwLadder`, `buildIwLadder`: model access (§ 5.2)
- `server/services/iw/turnBudget.ts` → `IWTurnBudget`, `checkUtterance`: precedent for the turn/daily caps (§ 5.6)
- `server/services/iw/lineSegments.ts` → `partsToLineSegments`: runtime segmentation (§ 3)
- `server/services/iw/sceneValidation.ts`: precedent for save-time graph validation (§ 4.1)
- `server/services/iw/validateStoredNpcIds.ts`: precedent for warn-don't-crash boot validation (§ 8)
- `server/utils/sanitizeContent.ts` → `sanitizeDocumentContent`: passage sanitizer (§ 5.7)
- `server/contracts/featureFlags.ts` → `FEATURE_FLAGS`: the `storyMode` flag (§ 8)
- `ForeignText` + the est definition popup: passage rendering (§ 3)

---

## 13. Question log

🔴 = blocks phase 0/1. Each answer gets recorded here with its date and folded into the
section it affects.

| # | Question | Draft's assumption |
|---|---|---|
| Q1 | Names: "Story Mode", "Authored", "Improvised": keep or rename? | Keep as working names |
| Q2 | Does the Improvised variant have prescribed endings? | ✅ **2026-10-29: loose goals.** Catalog endings are targets; the model may also end unscripted (§ 5.3) |
| Q3 | Where does story content live? | ✅ **2026-10-29: DB + editor on PPE**, gated by authoring grant (§ 4.4) |
| Q4 | Strict tree, or a DAG where branches can rejoin? | ✅ **2026-10-29: DAG** (§ 4.1) |
| Q5 | Allow cycles / state flags in Authored graphs? | Not in v1 |
| Q6 | Ending tones (good/bad/secret), and are some endings hidden even as silhouettes? | Tones optional; all silhouettes visible |
| Q7 | What does collecting every ending unlock, if anything? | Nothing in v1 beyond a "complete" state |
| Q8 | Story map with jump-to-choice: replay aid or too easy? | Build it in phase 3 |
| Q9 | Choices / learner input language? | ✅ **2026-10-29: target language only**, both variants (§ 3, § 5.4) |
| Q10 | English translation toggle per passage? Always available or limited? | Always available |
| Q11 | Should Story Mode emit card marks (e.g. reading marks for library words in passages)? | No, minutes only (iw precedent) |
| Q12 | v1 scope: one story, zh only, one level? Which level? | Yes; level TBD |
| Q13 | Share iw's model ladder and daily cap, or a separate ladder/cap? | Separate cap, shared ladder code |
| Q14 | Improvised turn budget per run? | ~12–15 turns |
| Q15 | Should the model favour the learner's *uncollected* endings? | Yes, when the action is ambiguous |
| Q16 | Any feedback on the learner's written language (e.g. on the ending screen)? | None in v1 |
| Q17 🔴 | Approve the three tables in § 7 (`stories`, `story_runs`, `story_endings_collected`) and their columns? | Pending |
| Q18 | Entry point: Menu Bento tile, Reading Center belt, or both? | Pending |
| Q19 🔴 | How is the comparison judged: metrics, tester feedback, or your own play? Who sees which variant? | Testers see both; § 10 metrics + feedback |
| Q20 | Build both variants on the *same* premise + catalog? | Yes |
| Q21 | Authoring grant: reuse `isTemplateAuthor`, or a new `isStoryAuthor`? | Reuse |
| Q22 | PPE → dev pull: extend `/template-pull` or `/data-ppe-to-dev`? | `/template-pull` (it already carries authored content) |
| Q23 | Re-publishing a story mid-run: pin runs to their starting version, or migrate them? | Pin (`story_runs.storyVersion`) |
| Q24 | Editor v1: list + detail pane, or a visual node graph? | List + detail pane + "play from here" |
| Q25 🔴 | Are unscripted (model-invented) endings collected? Where are they shown? | Kept on the run only; not in "3 / 7" |
| Q26 | On the forced final turn, must the model pick a catalog ending if any fits? | Yes |
| Q27 🔴 | Learner writes English/pinyin anyway: reject before the call, handle in character, or accept? | zh: cheap script check + in-world nudge; es: in character |
| Q28 🔴 | Beginner assist for target-only writing (word palette / editable suggestions), or Improvised is for intermediate learners only? | Pending |

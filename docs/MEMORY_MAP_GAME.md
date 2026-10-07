# Memory Map

A persistent map of what you are learning to **read**: an archipelago of 50 tilted
words drawn as bare ink straight onto the water, each hanging off its neighbour in a tree. Your not-yet-reading-mastered cards
occupy its slots (lent cards fill any the library cannot), and when you read-master a
word it fades off and a new word moves into its slot. A **run** walks the map: an English
gloss appears at the top, you find the word it belongs to and tap it twice — once to
select, once to confirm (§ 3.3a) — and the word takes a colour recording how well you
knew it.

**Status: SHIPPED (migration 151 is on PPE). The SLOT-TREE REWORK (2026-10-06,
migration 173) is BUILT ON DEV, NOT ON PPE** — it replaced absolute `x`/`y` placements
with a tree of slots (§ 2.3–§ 2.4), replaced the word tiles with bare characters (outlined
only when armed or marked) that touch glyph to glyph, filled the map to 50 with lent
cards (§ 2.1) and made graduation refill the same slot (§ 3.6). Deploy:
[MEMORY_MAP_SLOTS_DEPLOY_RUNBOOK.md](./MEMORY_MAP_SLOTS_DEPLOY_RUNBOOK.md). The original
32 design questions are in § 12 (several since overruled, marked there); what the first
build changed is § 14.

It differs from the other four games in three ways, and those three differences are
where all the design cost sits:

| | Every other game | Memory Map |
|---|---|---|
| Server state | none (Word Search saves a board to `localStorage`) | **a durable per-user slot tree** in two tables |
| Run | fixed and short (20 rounds / 30 seconds / one grid) | **the whole map** — 50 words, save-backed, resumable |
| Outcome | win/lose, medals, a wins counter | **neither** — the only outputs are reading marks and a colour |

---

## 1. The two halves

Memory Map is two systems that meet only at "which words are on the map".

* **The map (durable).** The slot tree — which slot hangs off which, at what bearing,
  tilt and size — and which word occupies each slot. Lives in Postgres; slots are never
  moved or deleted, only gain new occupants. This is the thing the learner grows
  attached to.
* **The run (ephemeral-ish).** Which words have been answered, what colour each took,
  the prompt queue, the camera. Lives in `localStorage`, is restored on re-entry, and
  is cleared only by **Restart**.

Nothing about a run reaches the server except the reading marks it emits; nothing about
the map is changed by a run except a graduate's slot changing occupant.

---

## 2. The map

### 2.1 Which cards get a spot

**The reading track decides membership, not core mastery.** A word you have fully
mastered for recognition but never learned to read still lives on the map. The map is a
portrait of your *reading* journey specifically.

The eligible set is:

```
(vetSortedClause()  OR  ve.id = ANY(lentIds))  AND  NOT masteredBarClause('reading')
```

both clauses from `server/dal/shared/vetTable.ts`, in
`MemoryMapDAL.getUnplacedCandidates`.

* **The map is always full (2026-10-06).** Every load fills the map to
  `MEMORY_MAP_CAPACITY` (50) — empty slots first, then new ones — drawing occupants down
  the same ladder the game pools use ([PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) § 4b):
  1. the learner's **rested** sorted cards, flp priority order (`rankCardQueue`);
  2. their **cooling** sorted cards, nearest-to-ready first (`rankCardQueueCooled`) —
     a card they chose, shown early, beats a stranger; marks fired at a still-cooling
     card are dropped by the mark endpoint's guard, the same accepted trade the game
     pools make;
  3. **lent** cards (`ProvisionalCardService.acquireLentCards`), for whatever is still
     open — in up to three rounds, because a lent word can lose the dd guard below.

  *Code: `server/services/MemoryMapService.ts` → `selectOccupants`, `prioritize`.*

  > **This overrules Q12** ("no baseline — lent words must not homestead a permanent
  > map"), by owner decision on 2026-10-06. Lent rows still enter only BY NAME
  > (`lentIds`): the candidate read is otherwise sorted-only, so the learner's pile of
  > outstanding provisional rows never out-competes their own deck. A lent card that the
  > learner later sorts is promoted in place (`StarterPacksService.sortCard`) and keeps
  > its slot. It is not a `CARD_BASELINES` entry — see `MEMORY_MAP_CAPACITY`'s comment
  > in `server/contracts/wire.ts` for why.
* `masteredBarClause('reading')` is **goal-independent since migration 143**. The
  reading track is computed for every learner whether or not `users.readingGoal` is set;
  a learner without the goal simply never sees a reading progress bar in the UI. Memory
  Map works identically for both — it just quietly drives a track one of them can't see.
  See [MASTERY_REWORK.md](./MASTERY_REWORK.md).

#### Two words never read the same

On top of the eligibility clauses, a candidate is rejected if its **dd** matches one
already on the map. The prompt bar names a definition and asks you to tap the word that
means it, so 高兴 and 开心 both sitting there as "happy" gives the prompt two
right-looking answers and scores only one.

Enforced in `MemoryMapService.selectOccupants` with a `takenDds` set keyed on
`ddCollisionKey` (`server/utils/definitions.ts`), seeded from the words already on the
map and extended as occupants are accepted — so it holds on the mid-run graduation refill
(§ 3.6) as well as on a fresh map, and across all three ladder tiers including lent
cards. A collision costs the map nothing: the next candidate down the ladder takes the
slot instead (for lent cards, by lending again).

Memory Map is the strictest instance of this app-wide games rule, because a placement is
**durable** — a collision admitted once sits on the map for as long as the word does,
not for one round. The dd inputs (`selectedSense`, `definition`, `definitionClusters`)
ride out of `MemoryMapDAL.getUnplacedCandidates` unresolved, for the same reason
`getSlots` returns them unresolved: SQL cannot express `resolveDisplayDefinition`.

Full rule and the other two chokepoints:
[GAMES_FEATURE.md](./GAMES_FEATURE.md) § "No two cards may share a dd in one round".
**Memory Map deliberately stops here.** The designed phase-2 extension to NEAR-identical
glosses ([GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md)) **does not apply to this game**
(decided 2026-08-22, § 10 Q3 there). A placement is durable, so a later re-cluster of the
meaning groups would act RETROACTIVELY on words already on the map — and both remedies are
bad: evicting deletes a learner's reading progress, grandfathering leaves the map permanently
wrong. Exact-dd equality has no such problem, being a property of the strings rather than of
a model that gets rebuilt. If you are adding the meaning-group key to the other chokepoints,
**skip `selectOccupants`.**

### 2.2 The map holds 50 words

`MEMORY_MAP_CAPACITY = 50` (`server/contracts/wire.ts`; 100 → 70 → 49 on 2026-10-06 for a
shorter run, then 50 with the slot-tree rework). It is both the ceiling and, since the
rework, the fill target (§ 2.1). A learner with 400 eligible cards gets the top 50.

Every map was wiped by migration 173, so no map is over the cap any more and the old
"drain an oversized map" rule in `graduate` is gone.

**Which 50: the flp offering priority list.** The same rule the flp uses to decide
which card to serve next — the utcm category ladder (Target → Unfamiliar → Comfortable
→ Mastered) with the card queue (`server/services/cardQueueRanking.ts`) ordering
*within* a category (longest-waiting-first; never-marked cards always last). Reusing it
means the map is populated by the same judgement of "what should this learner be
working on now" as every other surface. See § 13 for the one adaptation it needs.

The cap is also the performance answer: 50 absolutely-positioned nodes need no
viewport culling.

### 2.3 Words: bare outlined characters, measured per font

*Code: `src/games/memory-map/glyphShapes.ts` → `useGlyphShapes`, `measureWord`,
`shapeFromMeasure`, `mapFontFamily`; `src/games/memory-map/MemoryMapWord.tsx`;
`server/services/memoryMapLayout.ts` → `estimatedShape`, `ShapePart`;
`server/services/memoryMapSpawn.ts` → `drawScale`, `drawTilt`; constants `OUTLINE_PX`,
`OUTLINE_SELECTED`, `OUTCOME_OUTLINE` in
`src/games/memory-map/constants.ts`; `MEMORY_MAP_SCALE_RANGE`, `MEMORY_MAP_TILT_RANGE`,
`MEMORY_MAP_TILT_SIGMA` in `server/contracts/wire.ts`.
Tests: `src/__tests__/memoryMapGlyphShapes.test.ts`.*

**No containers (2026-10-06).** A word is just its characters — ink fill, bold, each with
a coloured **1px outline** (`OUTLINE_PX`) once it is armed or marked — sitting directly on
the blue water. There is no tile, fill or border behind it. The outline is the word's
state, and an unanswered word has none (owner, 2026-10-06):

| State | Outline |
|---|---|
| unanswered | **none** — plain ink (a transparent stroke, so a colour fades in) |
| armed by the first tap (§ 3.3a) | **blue** (`OUTLINE_SELECTED` = `bluMk`) |
| answered | **green / orange / red** by outcome (`OUTCOME_OUTLINE`, mark tier) |
| wrong-tap flash | red (`redMk`) |

Blue sits outside the outcome set, so an armed word never looks graded. (Unanswered words
wore the game's orange outline from the first 2026-10-06 pass until later that day, which
made them indistinguishable from an orange outcome; dropping it removed that ambiguity.)

**Words touch character to character.** The collision shape of a word is one rectangle
per character — that character's **ink** box, grown by the outline on every side — not a
box around the word. Two words come to rest where their nearest characters' outlines
meet. Characters with no ink (a space) have no box.

**Ink is per typeface, so it is measured on load, in the browser.** `useGlyphShapes`
waits for `document.fonts.load` of exactly the characters on the map (the faces are
unicode-range-sliced web fonts), then measures each word with canvas `measureText` —
the only browser API that reports ink bounds (`actualBoundingBox*`). It re-measures when
the account's Chinese typeface (`users."chineseFont"`, passed as `fontKey`) changes,
because a round face's 口 is fatter than a kai face's and every touching distance moves.
The map is not drawn until the measurement lands; laying it out with guesses first would
make every word jump. The face is resolved for canvas by `mapFontFamily` (canvas cannot
read the `--cjk-font` custom property `FONTS.cjk` uses).

**Drawn exactly where it was measured.** `measureWord` returns, in em, each character's
advance start `x`, its ink box, and the baseline's position in a `line-height: 1` box.
The SAME numbers build the collision boxes (`shapeFromMeasure`) and position the
rendering: `MemoryMapWord`'s node is the word's 1em line box, centred on the layout's
anchor and rotated about it by the tilt, and each character is its own span at its
measured `x`. So the map **does not render through `ForeignText`** — CPCDRow lays
characters out on its own column widths, not the font's advances, and the ink would not
land where it was measured. This is a deliberate, flagged exception to the ForeignText
container rule. (Pinyin was never shown on the map, so nothing is lost.)

The outline is `-webkit-text-stroke` at twice `OUTLINE_PX` with `paint-order: stroke
fill`: the fill covers the inner half, leaving exactly `OUTLINE_PX` outside the glyph —
the amount the collision boxes were grown by. It is in world-layer px, so it scales with
the camera zoom but not with the word's own scale.

**Size, tilt and bow** are drawn once per slot and frozen, and belong to the slot (a
refill inherits them, § 3.6):

| | Range | Meaning |
|---|---|---|
| `scale` | 0.95×–1.8× | the word's font size in world units (1 world unit = 40px at zoom 1). Only the max/min RATIO matters on screen, because the camera re-fits the map |
| `tilt` | −30°…+30°, **normal around 0°** (σ `MEMORY_MAP_TILT_SIGMA` = 6°: ~95% of words within ±12°; out-of-range draws redrawn) | none — organic texture. Positive = clockwise on screen (same sense as CSS `rotate()`; world y grows downward) |
| `bow` | −15°…+15°, **normal around 0°** (σ `MEMORY_MAP_BOW_SIGMA` = 5°; out-of-range draws redrawn) | none — organic texture. The lean of the outer characters of a multi-character word; + = smile. See § 2.3a |

**No world grid.** Word edges used to snap to an 8px lattice (§ 14.5b). Arbitrary
bearings, tilts and glyph shapes cannot hold one, so positions are continuous. The 8px
grid still governs the game's chrome (`src/games/memory-map/constants.ts`).

**The map never shows pinyin.** The prompt bar gives the sound (§ 3.1); the map makes you
find the characters that carry it.

**Empty slots.** A slot with no occupant (its card was deleted, or a refill found nothing
to lend) draws nothing but keeps its place in the tree — laid with the font-free
`estimatedShape` of a two-glyph word — so its children stay put. The next load fills it.

### 2.3a The bow: multi-character words sit on a light arc

*Code: `server/services/memoryMapLayout.ts` → `bowOffsets`, `bowShape`, `ShapePart.pivotDx`
/ `.rotate`; `server/services/memoryMapSpawn.ts` → `drawBow`; `src/games/memory-map/glyphShapes.ts`
→ `bowedChars`; `MemoryMapWord.tsx` (per-span transform); `MEMORY_MAP_BOW_RANGE`,
`MEMORY_MAP_BOW_SIGMA` in `server/contracts/wire.ts`. Tests: `memoryMapLayout.test.ts`
(`bow` block), `memoryMapSpawn.test.ts`, `memoryMapGlyphShapes.test.ts`.*

Added 2026-10-06. Each slot draws a frozen **bow** alongside its tilt: the characters of
a multi-character word sit on a gentle arc instead of a straight line.

* **What is stored** is the lean of the OUTERMOST characters, in degrees (+ = smile: both
  ends raised, the right end turned counter-clockwise; − = frown). Storing the lean rather
  than a depth makes the curve length-independent: a 2- and a 6-character word with the
  same bow trace the same arc, the longer one spanning more of it.
* **The arc** is a parabola through the characters' pivots. With the outer pivots ±H from
  the middle, the end slope is tan(bow), so the depth is H·tan(bow)/2. It is centred on
  the line (middle down half the depth, ends up half), so a bowed word stays balanced on
  its anchor. Each character moves by the arc's `dy` at its pivot and turns to the arc's
  tangent there (`bowOffsets`).
* **The pivot** is the centre of the character's ADVANCE box at the line-box mid-height —
  not its ink centre. The renderer turns each span about exactly that point
  (`transform-origin`, then `translateY` + `rotate`), and `bowShape` turns the collision
  box about the same point, so ink and box move together.
* **It is geometry.** `layoutMap` bends every shape with `bowShape` before colliding it,
  and each box carries its extra rotation (`ShapePart.rotate`) on top of the tilt, so a
  bowed word still touches its neighbours outline to outline. Spawn scores candidates on
  the bowed estimate too.
* **One character has no arc**; its slot keeps the bow anyway, for a longer word that
  refills it. Inkless characters (spaces) take no part in the arc.
* **Light by design** (owner, 2026-10-06): σ 5° of end lean, capped at 3σ. On a
  2-character word a typical bow is an arc ~0.02 em deep.

### 2.4 The slot tree

*Code: `server/services/memoryMapLayout.ts` → `layoutMap`, `laySlot`, `slideOut`,
`islandsOf`, `ISLAND_GAP`. Tests: `server/__tests__/memoryMapLayout.test.ts`.*

**No position is stored.** Each slot stores only how it hangs off its parent:

* `parentSlotId` — NULL for exactly one slot per map, the **first root**, at the origin;
* `link` — `grow` (part of the parent's island) or `island` (the root of a new island);
* `angle` — the bearing from the parent's centre, 0–360°, 0 = east, clockwise on screen.

**`layoutMap` derives every position from that, deterministically,** and both halves run
it with different SHAPES (`shapeOf`): the client (`MemoryMapWorld`) with glyph shapes
measured from the learner's font (§ 2.3), the server — which has no fonts — with
`estimatedShape`, only to choose bearings and score compactness at spawn time. The two
layouts therefore differ by a few percent. That is fine because nothing positional is
stored: only the client's layout is ever seen, and it is overlap-free by construction
for any shapes. (The client imports the server module — precedent:
`src/features/flashcards/collectionRef.ts`.)

The algorithm, slot by slot in ascending `slotId` (a parent always precedes its children):

1. Start the word's anchor (its line-box centre) at its parent's anchor.
2. **Slide it out along `angle`** until none of its tilted character boxes overlaps any
   box laid so far:
   * `grow` — clear of every box. Usually that is the instant it leaves its parent, so
     it **touches its parent**. If another word is in the way it **keeps sliding** along
     the same bearing and ends up touching that word instead — it never re-aims
     (owner-settled 2026-10-06).
   * `island` — clear of every box by **`ISLAND_GAP`** (1.75 world units) of water.

The slide is exact, not stepped: for straight-line motion each obstacle blocks one
interval of slide distance, which the separating-axis theorem gives in closed form
(`blockedInterval`); a word's boxes move rigidly together, so every (moving box,
obstacle box) pair just adds its interval to one list. The word stops at the first
distance outside every interval, plus a
`CONTACT_NUDGE` (1e-7) that keeps float rounding from landing it a hair inside.

**Why it is robust to change.** Because positions are derived, a slot whose occupant
changes length (a refill, § 3.6) just re-lays: a longer word pushes its subtree further
out along the stored bearings instead of overlapping it. Tests pin "no overlap" over
randomized trees, including that case.

**Islands are the tree's structure.** An island is a root (the first root or an
`island`-linked slot) plus every slot `grow`n from it — `islandsOf` reads it straight off
the tree. No `islandId` is stored because the tree already is one. The off-screen compass
(§ 6) keys its markers on the island root's `slotId`, which never changes.

**Defensive degradation.** A slot whose parent is missing (the parent FK refuses to delete
a slot with children, so this "cannot happen") or a second parentless slot is laid as an
island off the first slot rather than thrown on.

### 2.4a Spawning: choosing a parent and a bearing

*Code: `server/services/memoryMapSpawn.ts` → `planSlots`, `chooseIsland`, `chooseGrowth`,
`frameCost`. Tests: `server/__tests__/memoryMapSpawn.test.ts`.*

For each new word, in priority order: draw its scale, tilt and bow, then

* **empty map →** it becomes the first root;
* **10% (`NEW_ISLAND_CHANCE`) → a new island.** `ISLAND_BEARING_PROBES` (16) random
  (coast slot, bearing) rays are each slid out by `laySlot` with the island gap. A ray
  whose landing drifted more than `ISLAND_MAX_DRIFT` (12) past where the coast slot alone
  would have stopped it — i.e. it had to cross the map to find water — is discarded. The
  most compact survivor wins; if none survives, the word grows instead, so a crowded map
  gains a neighbour rather than an outlier;
* **otherwise → grow.** Random (parent, bearing) pairs, each slid out, keeping the most
  compact of the first `GROW_CANDIDATES` (8) **legal** ones. Legal = it does not come
  within `ISLAND_GAP` of a word on a DIFFERENT island — without that rule one word could
  land against two islands and visually merge them. If no attempt is legal within
  `GROW_ATTEMPTS` (40), the most compact illegal one is used.

Candidates are tried with `laySlot`, the very step `layoutMap` repeats, so the spot that
is scored is exactly the spot the client will draw.

**Compactness (`frameCost`)** is the height of the smallest phone-shaped
(`VIEWPORT_ASPECT` 2 : 1, portrait) frame that would contain the map with the candidate
added (its character boxes' rotated bounding rect), plus a tiny area tie-breaker. A candidate that fills
slack beside a column costs nothing, so the map fills coves before it pushes its
coastline out. Raw area was tried before the rework and rejected: it rewards a thin map
that then fits the phone at a tiny zoom.

**Portrait bias.** Bearings are drawn squashed toward vertical — the x-component of a
uniform direction is scaled by `GROW_BEARING_ASPECT` (0.6) / `ISLAND_BEARING_ASPECT` (0.3)
before the angle is taken back out. A bias, not a constraint: every bearing stays
reachable.

**Temp ids.** `planSlots` returns `PlannedSlot`s whose `tempId`s sit above every
existing id, in plan order; a planned slot may hang off an earlier planned one.
`MemoryMapDAL.writeSpawn` inserts them one at a time in that order, so the database's
ascending ids match the order the layout was computed in, and maps each `tempId` parent
to its real id.

Measured over 100 simulated 50-word maps grown in five batches (mixed 1–3 glyph zh
words): **~5.8 islands**, **width/height ≈ 0.50**, **land ≈ 40%** of the bounding rect
(the axis-aligned packing reached 47%; tilted tiles cannot pack as tightly) — measured
with whole-word tiles before the switch to per-character shapes, **0
overlaps**, ~13 ms to plan a full map. On dev, the first loads for two test accounts
came out with 4 and 6 islands.

### 2.5 Growth is announced

New words placed at load are reported as a brief toast — *"3 new words joined your
map"* — with no auto-pan. Without it the map's growth is invisible, which is the whole
emotional point of the feature.

---

## 3. The run

### 3.1 The prompt

A compact bar shows the target's **English gloss and its pronunciation**, in tone
colours, a speaker button that replays the word (§ 3.1a) and a worded **Skip** button
(§ 3.2a). No try count (the pips were removed 2026-10-06), no part of
speech. The target's pronunciation is also **spoken** as each prompt appears (§ 3.1a). The gloss is `SIZE.bodyLg`
(16px); the pinyin is `SIZE.body` (14px — raised from `caption` on 2026-10-06 so it reads
at a glance), in `MemoryMapPrompt`.

The player's job is to find the word on the map that carries that meaning and that sound
— a **character-recognition** task. It is worth being precise that this is no longer
cold reading: the prompt hands over the pronunciation, so what is being exercised is
"which characters spell this?" rather than "what does this say?". It still feeds the
reading track, and that is intended.

> **How this arrived (2026-08-18).** Pinyin was originally not shown at all — the game
> was a pure reading drill and a bar that printed the pronunciation would have made it a
> matching drill. It then became a *Show pinyin* spoiler that **cost** the prompt its
> green; the cost was overruled, and then the spoiler itself was, in two steps. Each step
> was a deliberate softening by the owner. If a stricter variant is ever wanted, it
> belongs as a **mode**, not as a reversal of this — the current shape is the settled one.

The gloss is the **dd**, resolved through `resolveDisplayDefinition` so it honours the
learner's `vet.selectedSense` — the games-wide sense-correctness rule
([GAMES_FEATURE.md](./GAMES_FEATURE.md) § "Sense correctness",
[DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md)). Showing a different gloss than the
learner's own flashcard reads as the game not knowing their word.

### 3.1a Each new prompt speaks its word

*Code: `src/games/memory-map/MemoryMapPage.tsx` → the prompt-autoplay effect (keyed on
`targetId`), `speakWord`, `answerAudioRef`; `PROMPT_AUDIO_GAP_MS` in
`src/games/memory-map/constants.ts`; `src/components/AudioModeChip.tsx` in the header.*

Added 2026-10-06. Whenever a new target appears — the first prompt when the map loads or
a saved run resumes, and every prompt after an answer, a skip or a restart — the page
autoplays the target's pronunciation (`useTTS.autoSpeakSentence(entryKey,
pronunciation)`, the sense-resolved reading on screen).

* **Muted by the header's `AudioModeChip`** — the same app-wide narration chip every other
  game header carries (docs/AUDIO_PLAYBACK.md § 1). It is automatic narration, so `mute`
  silences it, and so does the answer narration (§ 3.3b).
* **The speaker button beside the pinyin replays it on demand** (`SpeakerButton` in
  `MemoryMapPrompt`, `MemoryMapPage` → `replayTarget`). That is MANUAL narration
  (`speakSentence`), so it speaks even when the chip says mute — the learner's one way to
  hear the word when autoplay is off (AUDIO_PLAYBACK.md § 4). Its spinner reads
  `speakingKey`, so it also turns while the autoplay is sounding the same word.
* **Keyed on the target's identity only**, never on the setting, so turning audio back on
  does not narrate the prompt already showing (AUDIO_PLAYBACK.md § 1).
* **It waits for the answer narration.** A correct commit speaks the committed word and
  advances the prompt in one tap; since every speak cancels the one before it, the new
  target waits for that narration to end, then `PROMPT_AUDIO_GAP_MS` (500 ms) of silence.
  A skip, or the first prompt of a load, speaks at once. A prompt that moves on before its
  word started is dropped.
* **It hands nothing over.** The bar already prints the pinyin, so the audio is the sound
  of what is on screen, not a clue to where the word is — which is why the chip is shown
  on every Memory Map run, unlike Bubble Match / Bucket Drop reading runs, which hide it.
* **The first word after load has no gesture in its call stack.** The app-wide
  pointerdown listener has primed both sinks from the tap that opened the game
  (AUDIO_PLAYBACK.md § 5), so it normally plays; on iOS's `media` route a suspended
  AudioContext can still drop that one word until the next tap.

### 3.2 Order

A random shuffle over every unfinished word, fixed at run start and stored in the save.
Deliberately **not** spatial — a spatial order would let the player sweep the map
left-to-right instead of recalling anything.

### 3.2a Skip

A **Skip** button in the prompt bar — a worded, outlined pill since 2026-10-06 (it was a
skip-next icon, which read as "next track"; `MemoryMapPrompt` → `memory-map-prompt__skip`)
— sends the current word to the **back of the queue**.
It comes back later with a fresh three tries, and **no mark is written** — the whole
point is "not this one, not right now".

Two details that are not obvious from the description:

* **`position` does not move.** The entry is spliced out of the queue and pushed to the
  end, which slides the following entry into the same index — and the target is a
  *derived* value (§ 3.2), so it advances on its own. Advancing `position` as well would
  skip two words.
* **Skipping a FAILED prompt resolves it red instead of requeuing it.** Once the three
  tries are spent the outcome is already decided and only the lock-in tap remains;
  requeuing there would let a player dodge every negative mark by failing and skipping,
  quietly turning the reading track into a record of successes only. So the button
  accepts the red and moves on — exactly what tapping the pulsing word would have done.

  That second rule also removes a real dead end: a player who genuinely cannot find the
  pulsing word would otherwise have no way to continue at all.

The button is disabled when there is no other unanswered word to move to, since splicing
the only remaining entry out and pushing it back lands it in the same place and the
prompt would appear frozen with no explanation.

### 3.3 Tries and colours

Three tries. Tapping **another uncoloured word** flashes it red and burns a try — but
only once that tap has been *confirmed*; see § 3.3a. Tapping empty space never answers
(it is the pan gesture, and it also clears a selection).

| Outcome | Colour | Meaning |
|---|---|---|
| Correct on try 1 | **green** | knew it |
| Correct on try 2 or 3 | **orange** | recovered |
| Three misses | **red pulsing glow**, then **solid red** once tapped | didn't know it |

Hue alone carries the result — no icons, no patterns. Accepted knowingly: the game has
no fail condition, so a misread colour costs the player nothing real.

**Since 2026-10-06 the hue is the glyphs' OUTLINE** — the mark tier of each (`COLORS.grnMk`
/ `orgMk` / `redMk`, `OUTCOME_OUTLINE` in `src/games/memory-map/constants.ts`) around ink
glyphs (§ 2.3); the wrong-tap flash and the pulse glow are `redMk` (`MemoryMapWord.tsx`).
It was the parcel's fill (mid tier, `OUTCOME_FILL`) while words sat on tiles. The end
popup's tally counts still sit on the mid-tier fills (`OUTCOME_FILL`, `MemoryMapPage.tsx`).
Unanswered words have no outline, so any outline on the map means the word is armed or
answered.

**On the third miss the target starts pulsing red on the map** (`MemoryMapWord.tsx`,
the `memory-map-pulse` glow). That is the entire find-the-failed-word affordance. No
camera ease, no edge arrow, no directional hint — searching is the game.

The prompt bar used to turn red at the same moment (Q17 — the bar's fill `COLORS.redM`
since v2, red gloss text before that), and the bar ended in three try pips. **Both were
removed 2026-10-06 (owner):** the bar never changes colour and shows no try count, so
the pulse alone tells the player the question is over.

### 3.3a Answering takes two taps: select, then confirm

**The first tap on an uncoloured word ARMS it; a second tap on the SAME word answers.**
The armed word gains a **blue** outline (`OUTLINE_SELECTED` = `COLORS.bluMk`, since
2026-10-06; it was an ink ring around the tile before) — deliberately none of the three
outcome hues, because a selected word has no result yet. Tapping a different word moves
the selection; **tapping open water drops it**.

Why: the words are small, the board is dense, and the finger that answers is the same
finger that pans it. With a single-tap answer a fumble burned a try, or resolved the
prompt orange, with no way to take it back. Arming makes every answer deliberate.

Two taps stay **single**, both because there is nothing to take back:

| Tap | Taps needed | Why |
|---|---|---|
| Uncoloured word (the answer) | **2** — select, confirm | A wrong one costs a try or a colour |
| Coloured word (§ 3.4) | 1 | Opens a definition; burns nothing |
| Failed prompt's pulsing target | 1 | The red is already decided; confirming is ceremony |

Selection is **page state, not run state** (`MemoryMapPage`, `selectedId`) — nothing
about it is saved, marked or scored, and `useMemoryMapRun.tapWord` is unchanged: it
still means "this tap is an answer", the page just decides which tap gets to say it. A
selection belongs to one prompt and is cleared whenever the target changes.

The tap-vs-pan test itself (`TAP_SLOP_PX`, § 14.6) is shared by the words and the water
via `useTapGesture` — one rule, one file, so the two ends cannot drift apart.

### 3.3b The confirming tap speaks the word

**The tap that commits an answer narrates the word it committed to** (`MemoryMapPage`
→ `speakWord`, `useTTS.autoSpeakSentence` — automatic, so the header chip mutes it).
Alongside the prompt autoplay and the prompt bar's speaker (§ 3.1a) it is the only
narration on the page, and the arming tap is silent — sound is the reward for deciding, not for
pointing.

* **The tapped word, not the target.** They are the same word on a correct answer. On a
  wrong one, the prompt bar is showing the *target's* pronunciation, so hearing something
  else is the answer to "why was that wrong?". (The target itself was already spoken when
  the prompt appeared, § 3.1a; replaying it on a miss would only drown out the word the
  player actually chose.)
* **Every committed tap speaks**, including the failed prompt's single lock-in tap
  (§ 3.3a), which is where hearing the word you could not find is worth the most.
* It is the **only** sound on a tap — the app has no answer-feedback sound
  (docs/AUDIO_PLAYBACK.md § 7) — and it is fire-and-forget: narration failing must never break an answer. `useTTS` handles the
  cloud → browser fallback itself, and no-ops when the learner has TTS off.
* `word.pronunciation` is passed straight through as the pinyin hint. The server already
  sense-resolved it when it built the placement, so it is the reading on screen — the
  games-wide rule that what is *heard* must match what is *read*.

### 3.4 Coloured words are tappable, and free

Tapping an already-coloured word opens a **definition popup**, at any time, including
mid-prompt, and **never burns a try**. The rule is: *coloured = reference, uncoloured =
answer surface*. This makes the map a study surface between prompts rather than only a
game board.

(Known minor leak: a popup shows that word's English, so a determined player could
narrow the current target by elimination. Accepted — there is nothing to win.)

### 3.5 Marks

**Exactly one reading mark per word per run**, emitted when the word resolves, via
`POST /api/flashcards/mark` with `markType: 'reading'`:

| Outcome | Mark |
|---|---|
| green | **positive** |
| orange | **negative** — they missed it, and the colour already says so |
| red | **negative** |

One prompt, one mark. Unlike Speed Reading, an individual wrong tap emits nothing, and a
**skipped word emits nothing** until it is eventually answered (§ 3.2a).

The mark follows the COLOUR, and the colour follows **wrong taps alone**. Nothing else
moves it — the prompt's pinyin is given freely (§ 3.1) and costs nothing.

### 3.6 Fading off, and the slot refill

When an answer leaves a word **reading-mastered**, it **fades off the map immediately**
— it holds its colour for a beat (`FADE_OUT_MS`), then dissolves. It has graduated.

**Its slot stays, and a new word moves in** (owner-settled 2026-10-06). The server
(`MemoryMapService.graduate`) picks the next occupant down the § 2.1 ladder — lending
one if the learner has none — and swaps it into the same slot
(`MemoryMapDAL.replaceOccupant`). The slot keeps its bearing, tilt, bow and scale, so nothing
else on the map moves except as the newcomer's length pushes that slot's own subtree.
If nothing can be found or lent, the slot is left **empty** (§ 2.3) and the next load
fills it. If reading mastery ever regresses, the word becomes a candidate again and
lands in whatever slot next opens.

On the client (`useMemoryMapRun` → `resolve`) the swap waits for the fade: two words
cannot share a slot on screen, so the replacement appears — and **joins the current
run's queue** — only when the graduate has dissolved. It therefore can never be
prompted while still invisible.

> ⚠️ **Consequence, accepted:** a productive run gets longer as you play — every
> graduation adds one prompt. It still terminates (each graduation consumes one eligible
> word), but "colour the whole map" is not a fixed 50 prompts on a good day. If this
> proves annoying in play, the fix is § 12 Q32's third option: refill the slot but
> don't enqueue the newcomer.

---

## 4. Save, resume, restart

Word Search's model (`src/games/word-search/gameStateStorage.ts`), extended to hold
colours, keyed **per `(userId, language)`**:

* The save holds the **prompt queue and position, every answered word's colour, the
  per-outcome tallies, and the camera**.
* Leaving the game and returning **resumes exactly where you were**, colours intact.
  This is what makes a 100-word map playable at all. (This reverses the original
  "colours are lost on exit" — see Q10.)
* **Restart** clears the colours and reshuffles, behind a confirm. The map itself is
  untouched: placements are server-side and no client action can move a word.
* Switching language loads the **other map and its own independent save**; switching
  back resumes the first exactly as left.

---

## 5. Completion

When every word on the map has a colour, a modal `GameEndPopup`
(`src/games/runtime/GameEndPopup.tsx`) reports:

* **Accuracy** = greens ÷ total answered
* The green / orange / red tally
* **Play Again** (reshuffles, clears colours; placements untouched) and **Exit**

Not minimizable — there is no post-run cleanup mode to uncover, the rule `GameEndPopup`
already encodes (Speed Reading is the precedent).

There is **no winning and no losing**: no medals, no `POST /api/users/me/wins`, no hub
stat badge.

---

## 6. Chrome, camera, gestures

**Leaf page** — down arrow → `/games`, no footer, slides up on enter.

Header: back arrow · **audio chip** (`AudioModeChip`, § 3.1a) · a **Restart button**
(`restart_alt`, the house restart icon — Bubble Match's header uses the same one)
opening a confirm · **minute-credit badge, rightmost**.

**The progress count (`23/50`) is not in the header.** Since 2026-10-06 it floats over
the TOP-LEFT corner of the map with no container — `GameHudLabel` (the house in-play fact
style: full ink, mono) passed into `MemoryMapWorld`'s `overlay` slot, viewport-fixed and
`pointerEvents: none` so a drag starting on it still pans. It sits beside what it counts,
and full ink stays legible on the water where the header's faint meta grey would not.
It can overlap an island compass marker riding that same corner; the marker draws
beneath it.

The header's controls are SHARED header primitives — `HeaderIconButton`
(`src/components/PageHeader.tsx`), and `HeaderMetaLabel` for the count until it moved —
as of 2026-08-23. This header was
the last one in the app still styling its own text (a raw `Typography`) and drawing its own
icon (a `@mui/icons-material` `IconButton`), both predating
[SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A2b/D3. Being the shared components is also the
only reason the game's accent ground (§ A6b) can repaint them white; a hand-rolled
`Typography` is invisible to that rule and shipped dark ink on the saturated orange ground the game wore before it turned blue
(2026-10-06, `GAME_HUE` in `src/games/memory-map/constants.ts`).

Restart used to sit behind a settings **gear**, but Restart was the gear's only item and
a cog that opens a one-row sheet is a drawer hiding a single tool. The **confirm** is
what was actually doing the work and it stays: a run can be dozens of prompts long, so
destroying it takes a deliberate second tap (Word Search's confirm-before-clobber).

**The flame is always the rightmost item, and this page no longer renders it.** Since
2026-08-24 `PageHeader` appends `MinutePointsFireBadge` to every header itself, after the
page's own `rightContent` — so it holds the same corner on every surface in the app and
game-specific controls queue up to its left. It is therefore present in every phase,
including the empty and error states, which is what this route wants: it is in
`MINUTE_POINTS_ELIGIBLE_PAGES` and in the `/games` **start-on-entry** subset, so time is
credited from the moment the page mounts whether or not a run is under way.

The badge calls `useMinutePoints()` **internally** rather than taking it as a prop, so
its per-second tick re-renders the badge alone. That matters more on this page than
anywhere else: a page-level re-render every second would interrupt an in-progress pan.

**The prompt bar is ONE COMPACT ROW**, sitting below LeafPage's ordinary header:

```
[↓]  Memory Map                                  🔊default  ⟳  🔥
     ────────────────────────────────────────────────────────
     goodbye  zàijiàn 🔊                                ( Skip )
     23/50
       (map …)
```

It used to be four stacked rows — gloss, a standing hint line, the spoiler and the try
pips — which cost close to a fifth of a phone screen before the map got any. The hint
line (*"Find this word on your map"*) is gone entirely, and a long gloss now ellipsizes
rather than wrapping the bar to a second line. The try pips and the failed-state red
fill went later (2026-10-06, § 3.3), and the speaker arrived the same day, leaving
gloss · pinyin · speaker · Skip.

**Its colour is the in-game strip's house treatment**, the same as every game's `GameHud`
(`src/games/shared/GameFrame.tsx`): the game hue's near-white tint (`RAMP[hue].tint`, read
from `useGameSurfaceHue`, so blue now) with a full-ink hairline under it. It was the
neutral `COLORS.header` grey with a `rowBorder` line until 2026-10-06; that remains the
fallback off a game surface.

> An earlier revision went further and hid LeafPage's header entirely, folding the
> prompt in beside the controls. That bought a little more space at the cost of the page
> title and of putting the question in amongst the chrome. **The question deserves its
> own line, it just does not deserve four.** The wasted space was always in the prompt
> block, not in having two bars.

Camera: pan + pinch-zoom over a world layer. Restore the saved camera when resuming;
on a fresh run, fit the whole map (`MemoryMapWorld` → `fitToMap`) and then push in by
`FIT_ZOOM_BOOST` (1.4, `src/games/memory-map/constants.ts`; was 1.15 until 2026-10-06), so
the opening frame starts noticeably closer than an exact fit — the outermost words sit
past the edge, reachable by a pan and pointed at by the island compass. Zoom clamped so text stays legible at minimum zoom.

**Panning stops at the coast.** The water beyond the map is sized to the view, not fixed:
at the furthest pan in any direction the map's outermost edge sits on the
`PAN_EDGE_FRACTION` line of the **game viewport** (0.25, `src/games/memory-map/constants.ts`), so
at most three quarters of it is ever open water. The game viewport is the
`.memory-map-world` water panel — inside the GameFrame, below the prompt bar — measured
by `MemoryMapWorld`'s `viewportRef`; it is never the window, so the header, prompt and
frame inset do not count toward the 25%. Because the limit is
`fraction × viewport ÷ (zoom × PIXELS_PER_WORLD_UNIT)` world units past the bounds, it
tightens as the player zooms in and loosens as they zoom out, and a 5-word map and a
50-word map stop the same distance from their coast in the viewport. The bounds are the map's
bounding **rect**, so a diagonal pan can frame an empty rect corner; along either axis
alone the edge is always a word.

Every camera write — drag, pinch, wheel — goes through `MemoryMapWorld`'s `commit`, which
applies the pure `clampCameraToMap` (`src/games/memory-map/cameraBounds.ts`). A second
effect re-clamps when the *limit* moves instead of the camera (a graduation shrinks the
map, the screen rotates, a resumed run restores a camera saved on a different screen), so
no run starts stranded in open water.

*Code: `src/games/memory-map/cameraBounds.ts` → `clampCameraToMap`;
`src/games/memory-map/MemoryMapWorld.tsx` → `commit`; `src/games/memory-map/constants.ts`
→ `PAN_EDGE_FRACTION`. Tests: `src/__tests__/memoryMapCameraBounds.test.ts`.*

**Off-screen islands get an edge marker.** The archipelago is larger than a phone
screen, so a learner panned into a corner can face open water with no evidence the rest
of the map exists. `MemoryMapIslandCompass` pins one chevron to the viewport edge per
island that has **no word on screen** (tested against each word's character boxes),
rotated toward it and labelled with its word count. The marker is a fully opaque
`COLORS.card` pill with the app's standard 1px `COLORS.border` outline (both 2026-10-06;
it was an unoutlined pill at 85% opacity, which let words and water show through it).

It is **navigation, not a hint**: every off-screen island is marked identically whether
or not the target is on one, so it never narrows the search — the player could learn the
same thing by pinching out. Q17's rule (no directional aid toward the *target*) stands.
The markers are `pointerEvents: none`, because the whole viewport is the pan surface and
a marker that swallowed touches would create dead zones exactly at the edges, where
dragging is most needed.

`useBlockEdgeSwipe(true)` is mandatory, and the page is `touchAction: "none"` — the map
owns its gestures.

**Empty map:** since the map lends to stay full (§ 2.1), the empty state —
*"Your map is empty — sort some cards and they'll appear here"*, with a button to
`/discover` — is now reachable only when the dictionary has nothing left to lend.

---

## 7. Rendering

**The ground is water.** The world layer sits on `COLORS.blueAccent`; clusters of
touching words read as islands and the gaps between them as sea — which is what makes the
archipelago legible at a glance rather than looking like words scattered on a page. It
also gives the off-screen compass chips (§ 6) something to sit against. The token is
light enough that ink glyphs and all four outline hues (blue, green, orange, red) stay
readable on it; no new colour was introduced.

Since 2026-10-06 the game's hue (`GAME_HUE`) is also blue, so the page's accent ground is
the blue MID tier (`bluM`, #A9DFFF) framing the paler water (`blueAccent`, #F0F7FF) — one
hue family, the panel reading as the lighter sea inside it. The armed word's `bluMk`
outline is the strong tier of the same family, which stays distinct from the water and is
still none of the outcome hues.

**DOM + CSS `transform` on a world layer. No `requestAnimationFrame` loop, no Pixi.**
Same class as Match Speed: pan/zoom is a transform, colours are CSS transitions, the
pulse is a keyframe animation. The 50-slot cap is what makes this safe — no viewport
culling needed. A game that genuinely needed a scene graph should borrow the night
market's Pixi host (`src/features/nightmarket/pixiRuntime.ts`), not invent one.

---

## 8. Data model

**Two tables, one per language**, mirroring the vet split — which is what buys a real
foreign key, because `cvet` and `svet` are separate tables sharing one id sequence with
no union view. Created by migration 151 as `memory_map_placements_*`; reshaped into a
slot tree and renamed by **migration 173** (2026-10-06):

```sql
CREATE TABLE memory_map_slots_zh (                -- as of migration 173
  id             SERIAL PRIMARY KEY,
  "userId"       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "vocabEntryId" INTEGER     NULL REFERENCES vocabentries_zh(id) ON DELETE SET NULL,
  language       VARCHAR(10) NOT NULL DEFAULT 'zh',
  "parentId"     INTEGER     NULL REFERENCES memory_map_slots_zh(id),  -- NO ACTION
  link           VARCHAR(10) NOT NULL CHECK (link IN ('grow', 'island')),
  angle          REAL        NULL,                -- degrees, 0 = east, clockwise
  tilt           REAL        NOT NULL,            -- degrees, −30…+30 (normal, σ 6), frozen
  bow            REAL        NOT NULL,            -- outer-char lean, degrees, −15…+15 (normal, σ 5), frozen
  scale          REAL        NOT NULL,            -- 0.95–1.8, frozen
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_memory_map_slots_zh_user_entry UNIQUE ("userId", "vocabEntryId")
);
-- index idx_memory_map_slots_zh_user_language ("userId", language)
-- …and the identical memory_map_slots_es referencing vocabentries_es(id).
```

Design notes:

* **A row is a slot, not a word's placement.** It outlives its occupants: graduation
  swaps `vocabEntryId` (§ 3.6); nothing ever deletes a slot except deleting the user.
* **`vocabEntryId` is `ON DELETE SET NULL`**, not CASCADE. Deleting a card empties its
  slot; a cascade would delete the row and orphan its children. The UNIQUE constraint
  still stops one card from occupying two slots — Postgres treats NULLs as distinct, so
  any number of empty slots coexist.
* **`parentId` is NO ACTION, deliberately not RESTRICT.** Either refuses to delete a
  parent alone (its subtree would have no position to derive). RESTRICT, though, is
  checked row by row, so deleting a USER — which cascades to every slot at once — could
  fail on whichever parent went first; NO ACTION is checked at end of statement, when
  the whole tree is gone. Verified on dev.
* **No `x`/`y`, no `islandId`** — both are derived by `layoutMap` (§ 2.4).
* **`language` is stored** even though it is implied by the table: immutable, and it
  keeps every read identical in shape across the two tables, which is what lets one DAL
  method serve both by swapping a whitelisted table name (`MemoryMapDAL.slotsTableFor`).
* **Concurrent loads.** `MemoryMapDAL.writeSpawn` runs in a transaction under a per-(table,
  user) advisory lock and writes nothing if the slot count no longer matches the count
  the plan was computed against; the loser re-reads and serves the winner's map.
* **Not `gameprogress`, not a vet column.** A JSONB blob would rewrite the whole map on
  every spawn; a jsonb on the vet tables would put a one-game concern in a core table,
  twice.

### 8.1 Map wipes

Twice now the map's geometry changed in a way existing rows could not follow, and both
times every map was **wiped and regenerated** rather than converted: the 8px grid
(a manual `DELETE`, no migration) and the slot tree (migration 173's `TRUNCATE` — an
absolute `(x, y)` cannot become a `(parent, bearing)` without inventing a tree). The
learner loses only the *arrangement*, which is cosmetic; membership comes from the
reading track and marks live on the vet, so every map re-spawns on the next load.

## 9. Layering

| Layer | Files |
|---|---|
| **DAL** | `server/dal/implementations/MemoryMapDAL.ts` — slot reads/writes (`getSlots`, `writeSpawn`, `replaceOccupant`), plus the eligible-card query. No geometry, no policy. |
| **Geometry (pure, shared with the client)** | `server/services/memoryMapLayout.ts` — the slot tree → positions (`layoutMap`, given a `shapeOf`), the font-free shape estimate, oriented-box collision, islands, bounds (§ 2.3–§ 2.4). No DB, no I/O, no randomness, no DOM. |
| **Glyph measurement (client only)** | `src/games/memory-map/glyphShapes.ts` — waits for the learner's face, measures each word's per-character ink with canvas, and turns it into the layout's collision shape and the renderer's character positions (§ 2.3). |
| **Spawn (pure)** | `server/services/memoryMapSpawn.ts` — chooses a new slot's parent, link, bearing, tilt, bow and scale (`planSlots`, § 2.4a). Randomness injected. Kept out of both the DAL (game rules in SQL) and the service (which stays orchestration). |
| **Service** | `server/services/MemoryMapService.ts` — orchestrates a load: read the slots, pick occupants down the rested → cooling → lent ladder, fill empty slots, plan new ones, persist, return the map. Also the graduation refill. Lends through `ProvisionalCardService` (narrowed to `MemoryMapLender`). |
| **Controller** | `server/controllers/MemoryMapController.ts` |
| **Routes** | `server/routes/memoryMapRoutes.ts` — `GET /api/memoryMap` (load + fill), `POST /api/memoryMap/graduate` (slot refill, returning the replacement). camelCase paths per [BACKEND_LAYERING.md](./BACKEND_LAYERING.md). |
| **Contract** | `server/contracts/wire.ts` — `MemoryMapSlot`, `MemoryMapWord`, `MemoryMapResponse`, `MemoryMapGraduateResponse`, `MemoryMapLink`, `MEMORY_MAP_CAPACITY`, `MEMORY_MAP_SCALE_RANGE`, `MEMORY_MAP_TILT_RANGE` |
| **Client API** | `src/api/memoryMap.ts` via `apiGet`/`apiPost` (`src/api/http.ts`) — **no function takes a token** ([FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)) |
| **Game** | `src/games/memory-map/` — `MemoryMapPage.tsx`, `MemoryMapWorld.tsx` (pan/zoom layer), `MemoryMapWord.tsx`, `MemoryMapPrompt.tsx`, `MemoryMapRestartDialog.tsx`, `constants.ts` (`MARK_TYPE = 'reading'`), `types.ts`, `runStorage.ts`, `useMemoryMapRun.ts`, `useTapGesture.ts`, `promptQueue.ts` |

The load effect must key on `user?.id` / `isAuthenticated`, **never on `token`** — the
map plus an in-progress run is exactly the state a silent-refresh reload would destroy
([TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md)).

---

## 10. How it sits in the games framework

| Hook | Memory Map |
|---|---|
| Registry | one `GameDef` in `src/games/registry.ts`, `gameId: "memory-map"`, `markType` from its `constants.ts`. **No `languages` gate** (all languages), **no `challengeScoring`**, **no `unlock`**. Route, leaf chrome (`GAME_ROUTE_META`) and the mobile-demo allowlist all derive from that entry |
| Collection selector | **Not supported.** The map *is* your library and cannot be a deck. *(Since 2026-10-06 the game is off the hub entirely — `hiddenFromHub`, launched only from the Reading Center carousel; the gate below is now a dormant guard.)* The hub **hides the Memory Map row entirely whenever the selected collection is anything other than All Cards** — a visible row that ignores the selector reads as a bug, and the existing precedent is hiding rather than showing-and-blocking |
| Card baseline / provisional | **Lends to stay full at 50** (§ 2.1, since 2026-10-06), without a `CARD_BASELINES` entry — the map's deficit is "eligible and not already on the map", not the sorted count a baseline compares against |
| Minute points | route in `MINUTE_POINTS_ELIGIBLE_PAGES`, in the **start-on-entry** subset — the player reads the map before their first tap |
| Wins | **none** |
| Study Challenge | **not eligible** — it marks `reading`, and the challenge pool is recognition/production only ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.4) |
| Pause on background | **deliberately skipped.** The rule exists to stop a *clock* draining while the app is backgrounded. Memory Map has no clock and no timed state, so `useBackgroundPause` / `GamePausedOverlay` would render an overlay that protects nothing. Documented here so its absence is not later "fixed" |

---

## 11. Docs to update when this is built

* [GAMES_FEATURE.md](./GAMES_FEATURE.md) — Status list, shipped-games table, and a
  "what Memory Map introduced" section (durable per-game server state is a first)
* [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) — record the deliberate no-baseline
* [MASTERY_REWORK.md](./MASTERY_REWORK.md) — a reading-track consumer that works with
  the goal switched off
* [FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md](./FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)
  — a new reading-mark emitter
* [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) — a second pan/zoom surface after the
  night market
* CLAUDE.md — a feature link, **after asking**

---

## 12. Question log — all settled (2026-08-18)

| # | Question | Decision |
|---|---|---|
| Q1 | Where placements live | **New tables**, not `gameprogress`, not a vet column (§ 8) |
| Q2 | Map geometry | **Free-form coordinates + bounding boxes**, not a tile grid (§ 2.3). Coordinates were continuous at build time and were quantized to an **8px lattice** afterwards (§ 14.5b) — a grid the geometry lands on, still not a grid it is placed by: a word goes wherever it fits, and only then rounds to the nearest lattice line. |
| Q3 | Mark policy | **One reading mark per word per run, by outcome**: green +, orange −, red − (§ 3.5) |
| Q4 | Run length | **The whole map**, made playable by a save; Restart is the escape hatch (§ 4) |
| Q5 | Size driver | **Random, frozen at spawn** — not length, not mastery (§ 2.3) |
| Q6 | Already-mastered words holding a placement | **Prompted like any other word**, then faded off when answered (§ 3.6) |
| Q7 | Languages | **All.** One map per (user, language); render via `ForeignText` |
| Q8 | What burns a try | **Only a CONFIRMED tap on another UNCOLOURED word** (§ 3.3a — the first tap only selects). Empty space is the pan gesture *and* the deselect; coloured words are free (§ 3.3–3.4) |
| Q9 | Fade-off storage | **Delete the row.** The space is freed; a regressed word respawns somewhere new (§ 3.6) — *superseded 2026-10-06: the SLOT stays and a new word moves into it.* |
| Q10 | Colours across exits | **Backtracked from "lost on exit" — the save keeps them.** Restart clears (§ 4) |
| Q11 | Help finding the target | **None** during the three tries (§ 3.3) — *superseded 2026-08-18: the prompt now shows the target's PINYIN outright (§ 3.1), free of any scoring penalty. It helps you READ the word, not LOCATE it, so Q17's "no locating aid" still stands.* |
| Q12 | Card baseline | **None.** Lent words must not homestead a permanent map (§ 10) — *overruled 2026-10-06: the map lends to stay full at 50 (§ 2.1).* |
| Q13 | Island formation | **10%** of spawns start a new island; 90% must touch (§ 2.4a) |
| Q14 | Which cards are placed | **Playable and NOT reading-mastered** — the reading track, not core (§ 2.1) |
| Q15 | Win/lose | **Neither exists** (§ 5) |
| Q16 | Wrong attempts | **3 tries**, then the red-glow lock-in (§ 3.3) |
| Q17 | The off-screen failed word | **The English prompt turns red.** That is the whole affordance — no camera ease, no edge arrow (§ 3.3) — *superseded 2026-10-06: the bar no longer turns red; the target's red pulse on the map is the whole affordance. "No directional aid toward the target" stands.* |
| Q18 | Store `language` on the row | **Yes** — immutable, and keeps both tables' reads identical (§ 8) |
| Q19 | The vet FK problem | **Split per language**, `_zh` / `_es`, which buys a real FK (§ 8) |
| Q20 | `islandId` | **Not stored** — geometry is the truth (§ 2.4). *Since 2026-10-06 the tree is: an island is a root plus everything grown from it.* |
| Q21 | Hub collection selector | **Ignored, and the game is hidden from the hub** unless All Cards is selected (§ 10) |
| Q22 | Pause on background | **Skipped**, with the reason documented (§ 10) |
| Q23 | Colour-blind redundancy | **None** — hue only, accepted knowingly (§ 3.3) |
| Q24 | Empty map | **Empty state pointing at `/discover`** (§ 6) — now reachable only when nothing can be lent |
| Q25 | Header during a run | **Progress count + gear → Restart**, behind a confirm (§ 6) |
| Q26 | Tapping a finished word | **Opens a definition popup, any time, free** (§ 3.4) |
| Q27 | Performance ceiling | **Cap the map at 100 words** (lowered to 70, then 49, then 50, all on 2026-10-06) — which removes the need for culling (§ 2.2, § 7) |
| Q28 | Language switch mid-run | **Separate map AND separate save per language** (§ 4) |
| Q29 | Orphan placements | **Real FK with ON DELETE CASCADE** — they cannot exist (§ 8). *Since migration 173: ON DELETE SET NULL — a deleted card empties its slot.* |
| Q30 | Fade timing | **Immediately**, right after the word is answered (§ 3.6) |
| Q31 | Which 100 words | **The flp offering priority list** — category ladder + the card queue (§ 2.2) |
| Q32 | Refill after a graduation | **Immediately, mid-run**, and the newcomer joins the queue (§ 3.6) |

---

## 13. Assumptions carried into the build — both resolved

1. **The flp priority list is core-track shaped; Memory Map marks reading.** ✅ Resolved
   by EXTRACTION, not duplication. The five private methods on `OnDeckVocabService`
   that implemented "longest-waiting first, never-marked last" now live in
   `server/services/cardQueueRanking.ts` as a pure module, parameterized on two axes:
   which mark types count as ready, and which utcm category supplies the cooldown
   window. The flp passes recognition+production with the core category (unchanged
   behaviour); Memory Map passes reading with the reading category.
   `MemoryMapService.prioritize` then walks the ladder outermost and the queue within
   each rung. Covered by `server/__tests__/cardQueueRanking.test.ts`, whose last case
   pins the difference directly: a word read correctly a minute ago is rested for
   Memory Map and still offered by the flp.

2. **Map capacity is a contract constant.** ✅ `MEMORY_MAP_CAPACITY` (50) lives in
   `server/contracts/wire.ts`, deliberately NOT in `CARD_BASELINES`. Originally because it
   was a ceiling rather than a floor; since 2026-10-06 it is both, and stays out because a
   baseline compares against the SORTED count while the map's deficit is "eligible and
   not on the map" (see the constant's comment).

---

## 14. What the build changed

> **Historical geometry (read with care).** § 14.4–§ 14.5c and § 14.7 describe the FIRST
> build's geometry — absolute `x`/`y` per word, axis-aligned tangent boxes, fences on
> shared edges, the 8px world grid, `connectedIslands`. All of that was replaced on
> 2026-10-06 by the slot tree (§ 2.3–§ 2.4, migration 173). They are kept for the reasoning
> (why compactness is scored on a phone frame, why island distance must be capped, why
> geometry is authoritative), not as a description of the current code; symbols they name
> such as `spawnPosition`, `touchedSidesForAll` and `WORLD_GRID` no longer exist.

Seven things the design did not anticipate. All are settled in code; they are recorded
here because each one is a decision a future reader would otherwise have to re-derive.
The last three were found in play rather than at build time.

### 14.1 The membership clause was named wrong (§ 2.1)

The spec said `vetPlayableClause()` while describing what `vetSortedClause()` does.
`vetPlayableClause()` is `starterPackBucket IN ('library','provisional')` — it *includes*
the lent cards the paragraph said it excluded. Q12 settles which half was intended, and
the code uses `vetSortedClause()`.

This made Memory Map **the first game to select on the SORTED clause**. As of
2026-08-20 every game pool does (PROVISIONAL_CARDS.md § 4b) — a lent card turned out
*not* to be fine even for the length of one round, because lent rows are never on
cooldown and always band `Unfamiliar`, so they out-competed real cards in every round.
Memory Map keeps the stricter form: the other pools admit lent rows by id when a round
genuinely has to borrow, while here a borrowed word would homestead a permanent spot on
a map meant to portray the learner's own library.

### 14.2 The placement columns are UUID and VARCHAR, not INTEGER and TEXT

`users.id` is a **uuid**, not a serial integer, and `vocabentries_*.language` is
`VARCHAR`. The first draft of migration 151 wrote `INTEGER`/`TEXT` and was rejected
outright by the FK checker. Worth knowing before writing any other satellite table:
`vocabEntryId` really is an integer, `userId` really is not.

### 14.3 A data-modifying CTE cannot read its own writes

`insertPlacements` was first written as one statement — `WITH inserted AS (INSERT …
RETURNING …) SELECT … FROM memory_map_placements_zh` — and returned **zero rows while
correctly persisting twenty placements**. Every part of a statement sees the same
snapshot, taken before the statement ran, so the outer SELECT cannot see rows the CTE
just wrote. The symptom was a map that saved perfectly and rendered empty.

The insert and the read-back are now two statements (`hydratePlacements`). Reading back
by the ids we *asked* to place — rather than by what the INSERT returned — is also what
makes the `ON CONFLICT DO NOTHING` path correct: a row a concurrent request placed a
moment ago still belongs in the response, with its real coordinates.

### 14.4 Geometry is authoritative; typography conforms to it

`wordBoxSize` (now `server/services/memoryMapLayout.ts`) is imported by the CLIENT as well as
the service, and that is load-bearing rather than convenient. The server places boxes by
that formula, so a word drawn at its natural rendered width would visibly overlap or
float away from its island wherever the real font metrics disagreed with the estimate.
`MemoryMapWord` therefore renders into a fixed box and scales the glyphs to fit.

(Precedent for a client import of a shared server module:
`src/features/flashcards/collectionRef.ts` imports from `server/dal/shared/vetTable`.)

### 14.5 The camera gesture must bind to the NODE, not to React props

Two separate mistakes, both of which present as "panning is broken on mobile", and both
worth knowing before touching `MemoryMapWorld`.

**`drag: { pointer: { touch: true } }` is required when pinch is bound alongside drag.**
Without it the pointer-event stream is cancelled on touch devices as soon as the browser
starts arbitrating between the two gestures, and the symptom is precise: panning works
with a mouse and does nothing at all on a phone. `useDrag` used alone does not need this
— `SortCardsPage` binds a plain `useDrag` and pans fine — so the working precedent in
the repo does not warn about it. **It is the combination that breaks.**

**`target: viewportRef` is required because `eventOptions.passive: false` is.** Pinch and
wheel have to `preventDefault` the browser's own zoom, and React's synthetic listeners
are *always* passive, so `@use-gesture` cannot honour a non-passive request through
spread handler props. Asking for both — `eventOptions: { passive: false }` *and*
`{...bind()}` — yields a half-bound gesture rather than an error.

That second one is what produced the reported failure: **marking a word wrong killed the
pan.** A wrong tap re-renders this component twice in quick succession (the red flash
sets, then clears 500 ms later), and every re-render handed the gesture a fresh set of
spread handler props. With `target`, the listeners are native, attached once to the node,
and immune to render churn. The handlers already read the live camera through
`cameraRef`, so nothing depends on the closures being refreshed.

> **Rule for any future camera surface here:** if you need `passive: false`, you must use
> `target`. Never spread `bind()` alongside it.

### 14.5a The pan dropped deltas whenever touch outran React

Reported in play as **"pan seems to be warped sometimes — the sensitivity seems to be
changing"**, which is a fair description of a gesture that moves a *varying* fraction of
the finger's distance rather than one that is plainly broken.

`touchmove` samples faster than React commits (≈120 Hz against ≈60 Hz on a modern
phone), and React 18 batches state updates even inside the native listeners
`@use-gesture` attaches via `target`. So several drag events land between two renders.
The camera ref was refreshed from the prop on **every render**, and each handler
computed its new camera from whatever the ref held — meaning every event in a batch
started from the **same stale camera**, the last write won, and the earlier deltas were
silently discarded. How much of the pan survived depended on how many events happened to
fall inside each frame, which is exactly why it felt inconsistent rather than merely slow.

`MemoryMapWorld` now routes every camera change through a `commit` helper that advances
`cameraRef` **synchronously** before calling `onCameraChange`, so consecutive events
within one frame accumulate. The prop is adopted into the ref only when it carries a
camera this component did not itself produce (tracked in `ownCameraRef`) — the initial
fit, a restart, a resumed run — because a render replaying an already-superseded value
would undo the accumulation and reintroduce the same drop.

> **Rule:** any gesture that reads-modifies-writes React state at input frequency must
> keep its own synchronously-advanced ref. Reading the committed prop is a lossy channel.

### 14.5b The 8px grid — one grid, both layers

**Memory Map is drawn on an 8px grid, and that grid governs the map itself, not just its
chrome.** This is the only surface in the app where the spacing quantum reaches the
geometry.

*Code: `src/games/memory-map/constants.ts` (the grid docblock, `PIXELS_PER_WORLD_UNIT`);
`server/services/memoryMapSpawn.ts` (`WORLD_GRID` and the snapping helpers).*

| Layer | What is on the grid | Enforced by |
|---|---|---|
| **Chrome** | every padding, gap, inset and control dimension in the prompt bar, the compass markers and the page furniture | plain `8`-multiple pixel literals |
| **World** | every word-box **edge**, on both axes | `WORLD_GRID` = 0.2 world units × `PIXELS_PER_WORLD_UNIT` 40 = 8px |

**There is no `grid(n)` helper, and that is deliberate.** An earlier pass put the chrome
on a 4px grid through a `GRID` constant and a `grid(n)` helper. Both are gone: 8 is also
MUI's spacing unit, so `gap: 1` / `mb: 2` are already on the grid, and a second spelling
of the same number only invites the two to disagree. Chrome values are written as literal
`"8px"` / `"16px"`.

What the move to 8 changed, beyond doubling the odd 4px steps: `PIXELS_PER_WORLD_UNIT`
34 → 36 → **40** (each step also buying legibility at the same zoom), the skip icon
20 → 24, `COMPASS_INSET_PX` 20 → 24, and `CORNER_RADIUS_PX` is now the literal 8 rather
than `GRID * 2`.

**The world layer is no longer exempt, and the reasoning that exempted it was wrong in an
instructive way.** It was left continuous because snapping was expected to open gaps along
the shared edges that fuse an island into one landmass. That is true only if you snap
sizes *or* positions. Snap **both** and tangency does not merely survive — it becomes
exact, since two neighbours now abut at an identical coordinate instead of at two floats
that agree to within `OVERLAP_EPSILON`. The invariant, the edges-not-centres rule, the
top-left origin anchor and the cost in size texture are all in § 2.3.

**One exemption remains: hairlines.** `BORDER_PX` (1.5) and stroke widths generally are
not spacing, and an 8px fence between two words would be a wall. `box-sizing: border-box`
keeps them from pushing anything else off the grid.

The grid is covered by the `the 8px grid` suite in
`server/__tests__/memoryMapSpawn.test.ts`, which asserts the lattice on every edge of a
full 100-word map. It is worth keeping green: an off-lattice map looks completely normal,
so nothing else would ever report the regression.

### 14.5c Rounded corners — all four, and what that costs

The parcels have rounded corners (`CORNER_RADIUS_PX`, `MemoryMapWord`), applied to **all
four** corners of every box.

This shipped for one revision as *coastline-only* — rounded where a side faced open
water, square where it abutted a neighbour — so that an island's interior seams stayed
flush and the landmass read as continuous. **Owner-settled the other way: round them
all.**

The consequence is worth writing down so it is not later filed as a rendering bug: at an
interior junction the two rounded parcels no longer meet edge to edge, so a small lens of
blue shows through where their corners pull away from each other. An island reads as a
cluster of tiles rather than one fused mass. The geometry underneath is untouched — the
boxes are still exactly tangent, `touchedSidesForAll` still drives the fences, and
`connectedIslands` still groups them — this is purely how the tiles are painted.

### 14.5d ⚠️ CPCDRow's cell padding is asymmetric, and it decentres the glyph

Related to, but distinct from, the reserved-pinyin trap noted in § 2.3. Every CPCDRow
character cell carries `VERTICAL_PADDING` on **top** (8px at `md`) and — once no pinyin
is passed — **zero** on the bottom. Flex-centring centres the padded *box*, so the glyph
inside it sits 8px low, and the fit measurement counts that padding as text and shrinks
the characters to pay for empty space.

`MemoryMapWord` therefore zeroes both paddings on `.cpcd-row__char-cell` inside its
glyph wrapper. The measured box then *is* the line box, which is symmetric about the
glyph (line-height distributes its leading evenly), so centring the box centres the
character. The padding is CPCDRow's own inter-row breathing room and has no job inside a
single-word parcel that already supplies its margin via `TEXT_FIT`.

### 14.6 A pan that crosses a word is not a tap on it

Words carry their own `onPointerUp` for the answer tap. On a dense map most drags START
on a word, so that handler fired on every pan — **panning across the board answered the
prompt with whatever word happened to be under the finger.**

`useTapGesture` now records the press position on `pointerdown` and only counts a
release as a tap if the pointer moved less than `TAP_SLOP_PX` (8 screen px), clearing
the press on `pointercancel` so a stale one cannot match a later release. It is measured
by hand rather than read off the gesture layer because the world's drag listens to
*touch* events while these are *pointer* handlers — the two never see the same event
object and cannot be correlated.

Both `MemoryMapWord` and `MemoryMapWorld` use that one hook: the word needs it so a pan
which merely crosses it is not an answer, the world needs it so a pan that ENDS over
open water is not a deselect (§ 3.3a). A word's tap calls `stopPropagation` before the
world sees it, so a tap is consumed exactly once.

### 14.7 Island placement was unbounded, and compounding

Reported in play as "the islands are spread way too far". `placeNewIsland` pushed each
new island to `halfDiagonal + ISLAND_GAP` from the map's **centre** — a radius that grows
with the map, so every island landed further out than the one before it and total area
grew super-linearly:

| words | old area | new area | change |
|---|---|---|---|
| 20 | 701 | 282 | 2.5× smaller |
| 50 | 3,426 | 745 | 4.6× smaller |
| 100 | 15,034 | 1,468 | **10× smaller** |

(world units², mean of 20 runs). The fix anchors a new island on a randomly chosen
**coast box** and probes outward under a hard `ISLAND_MAX_DRIFT` cap, so distance no
longer scales with map size. `ISLAND_GAP` also came down 6 → 2.5.

Two regression tests now pin this: a 100-word map must stay under 90 units on a side,
and the 100-word extent must be under 3.5× the 25-word extent — a shape test, since the
failure mode was *growth rate* rather than any single bad number.

A separate ask to "reduce the map area by about half" is subsumed by this: the fix
already overshoots half by a wide margin at every size, and stacking a further halving on
top would make the map cramped.

**Two follow-on bugs came out of the same fix**, both reported as "I generated a single
island map", and both now covered by `island formation` tests:

* the probe's cap applied to the WHOLE ray, so a bearing pointing into the anchor's own
  island gave up before clearing the coast — the cap now applies past the coast, and the
  ray may cross the map's own span to get there;
* a *grown* word could land tangent to two islands and merge them, which eroded the
  archipelago one word at a time.

`ISLAND_MAX_DRIFT` was later raised 8 → 22, giving the probe more room to find water
before giving up.

Final measurements (mean of 30 runs, mixed word lengths), after the portrait bias of
§ 2.4a: 65 words → ~6 islands, 0/30 single-island, ratio 0.51; 100 words → ~11 islands,
0/30 single-island, ~2,250 units² and ratio 0.52 (still 6.7× tighter than the original
15,034).

---

### 14.8 The prompt cursor could strand the run

Reported in play as **"no word and no pinyin — it defaults to showing a hyphen"**. Two
independent faults, one visible symptom.

**The cursor scanned forward only.** `useMemoryMapRun` derives the current prompt by
scanning the queue from `position` for the first entry that is still on the map and still
uncoloured. Scanning only *forward* returned -1 whenever the cursor outran the askable
entries, which leaves `target` null while unanswered words remain — and completion never
fires, because that is derived from the MAP being fully coloured. The run is then
permanently parked on an empty question.

`position` drifts out of step with the queue in at least three ordinary ways:

* **A resumed run's queue is filtered; its position is not.** The load reconciler drops
  saved entries whose words have left the map (graduated in an earlier session, card
  deleted, placements reset) but restores `position` verbatim. Lose enough entries and
  the restored cursor points past the end of what survived. *This is what the play-test
  hit: the map had just been wiped and respawned, so the saved queue was heavily filtered
  against a restored position from the previous session.*
* **Skip pushed to the back.** An entry sent to the end of the queue is unreachable once
  the cursor has passed that point.
* **`position` counts resolutions, not indices**, while the queue is spliced and appended
  underneath it.

The scan now **wraps** (`nextPromptIndex`, `src/games/memory-map/promptQueue.ts`, covered
by `src/__tests__/memoryMapPromptQueue.test.ts`). The queue is circular, so all three
drifts become "start again from the top" rather than dead ends. Termination is unaffected:
it only ever returns available entries, and every answer removes one.

> **Rule:** a derived cursor into a list that is filtered, reordered *and* appended under
> it must wrap. A forward-only scan over such a list is a latent dead end, not a
> simplification.

**Skip became a cursor move.** Wrapping exposed the second fault: an entry pushed to the
*end* is the first thing a wrapped forward scan reaches when nothing else is available
ahead of the cursor, so skipping the last unanswered word ahead of `position` silently
re-selected the word just skipped. `skipWord` now advances `position` past the target and
leaves the queue alone. The circular scan offers every other available word before coming
back around — which is all skip ever promised — and a stable queue order makes a saved run
easier to reason about.

### 14.9 No placeholder glyph in the prompt slot

The empty prompt rendered `definition ?? "—"`. On a Chinese map an em dash reads as **一**,
so the player saw a character in the question slot and went hunting for it. Any dash,
hyphen or bullet has the same collision against CJK script.

The empty state is now genuinely empty; the prompt row keeps its height from the skip
button and the try pips. It should also be unreachable — a null target while playing was
the symptom of § 14.8, not a state the game has.

### 14.10 The map's pronunciation is sense-resolved

`MemoryMapService.toWord` resolved the DEFINITION through `resolveDisplayDefinition` but
passed the raw `pronunciation` column beside it, so a heteronym with a learner sense pick
showed one sense's gloss over another sense's tones (过去 = `guò qù` "the past" vs `guò qu`
the directional suffix). It now goes through `resolveDisplayPronunciation`, the twin that
exists for exactly this pairing (docs/DEFINITION_CLUSTERS.md).

Latent while the map hid pinyin behind a spoiler; live from the moment the prompt bar
started showing it outright.

## 15. Deploying

Migration **151** (the original two tables) is on PPE.

Migration **173** (the slot tree) is a **contract** migration — it renames both tables
and drops `x`/`y`, which the old code reads by name — so it is not a plain `/deploy`.
Follow [MEMORY_MAP_SLOTS_DEPLOY_RUNBOOK.md](./MEMORY_MAP_SLOTS_DEPLOY_RUNBOOK.md)
(TEMPORARY; not yet deployed).

---

## 16. File map

| Layer | File |
|---|---|
| Migrations | `database/migrations/151-create-memory-map-placements.sql`, `database/migrations/173-memory-map-slots.sql` |
| Contract | `server/contracts/wire.ts` — `MEMORY_MAP_CAPACITY`, `MEMORY_MAP_SCALE_RANGE`, `MEMORY_MAP_TILT_RANGE`, `MEMORY_MAP_TILT_SIGMA`, `MemoryMapLink`, `MemoryMapSlot`, `MemoryMapWord`, `MemoryMapResponse`, `MemoryMapGraduateResponse` |
| Layout (pure, shared with the client) | `server/services/memoryMapLayout.ts` — `layoutMap`, `laySlot`, `slideOut`, `placeShape`, `bowOffsets`, `bowShape`, `estimatedShape`, `estimatedShapeOf`, `tilesOverlap`, `partsOverlap`, `allParts`, `tileAabbHalf`, `mapBounds`, `islandsOf`, `bearingVector`, `ISLAND_GAP`; types `ShapePart`, `ShapeOf`, `LaidSlot` |
| Spawn (pure) | `server/services/memoryMapSpawn.ts` — `planSlots`, `drawScale`, `drawTilt`, `NEW_ISLAND_CHANCE` |
| Ranking (pure, shared) | `server/services/cardQueueRanking.ts` — `rankCardQueue`, `rankCardQueueCooled` (called with `{ bar: 'reading' }`) |
| DAL | `server/dal/interfaces/IMemoryMapDAL.ts`, `server/dal/implementations/MemoryMapDAL.ts` — `getSlots`, `getUnplacedCandidates`, `writeSpawn`, `replaceOccupant`, `isReadingMastered` |
| Service | `server/services/MemoryMapService.ts` — `loadMap`, `graduate`, `selectOccupants`, `prioritize` |
| Controller | `server/controllers/MemoryMapController.ts` |
| Routes | `server/routes/memoryMapRoutes.ts` — `GET /api/memoryMap`, `POST /api/memoryMap/graduate` |
| Client API | `src/api/memoryMap.ts` — `fetchMemoryMap`, `graduateMemoryMapWord` |
| Game | `src/games/memory-map/` — `MemoryMapPage.tsx`, `MemoryMapWorld.tsx`, `MemoryMapWord.tsx`, `glyphShapes.ts` (per-font glyph measurement), `MemoryMapPrompt.tsx`, `MemoryMapIslandCompass.tsx`, `MemoryMapRestartDialog.tsx`, `cameraBounds.ts`, `useMemoryMapRun.ts`, `useTapGesture.ts`, `promptQueue.ts`, `runStorage.ts`, `constants.ts`, `types.ts` |
| Registry | `src/games/registry.ts` (the `memory-map` entry), `src/games/GamesPage.tsx` (the All-Cards-only gate), `src/constants.ts` (`MINUTE_POINTS_ELIGIBLE_PAGES`) |
| Tests | `server/__tests__/memoryMapLayout.test.ts`, `server/__tests__/memoryMapSpawn.test.ts`, `server/__tests__/memoryMapService.test.ts`, `server/__tests__/cardQueueRanking.test.ts` (shared with the flp), `src/__tests__/memoryMapPromptQueue.test.ts`, `src/__tests__/memoryMapCameraBounds.test.ts`, `src/__tests__/memoryMapGlyphShapes.test.ts` |

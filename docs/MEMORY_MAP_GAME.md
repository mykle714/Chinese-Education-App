# Memory Map

A persistent map of what you are learning to **read**. Every card whose reading track
is not yet mastered owns a permanent spot on it; the map grows as your library grows,
and words fade off it as you read-master them. A **run** walks the map: an English
gloss appears at the top, you find and tap the word it belongs to, and the word takes
a colour recording how well you knew it.

**Status: BUILT ON DEV (2026-08-18). Not on prod.** Migration **151** is applied to the
dev database; the route, page, tables, endpoints and tests all exist. All 32 design
questions were settled before the build (§ 12) and both carried assumptions have been
resolved (§ 13). What the build changed about the design is recorded in § 14.

It differs from the other four games in three ways, and those three differences are
where all the design cost sits:

| | Every other game | Memory Map |
|---|---|---|
| Server state | none (Word Search saves a board to `localStorage`) | **durable per-user placements** in two new tables |
| Run | fixed and short (20 rounds / 30 seconds / one grid) | **the whole map** — up to 100 words, save-backed, resumable |
| Outcome | win/lose, medals, a wins counter | **neither** — the only outputs are reading marks and a colour |

---

## 1. The two halves

Memory Map is two systems that meet only at "which words are on the map".

* **The map (durable).** Where each word sits and how big it is. Lives in Postgres,
  survives forever, changes only when words spawn in or fade off. This is the thing the
  learner grows attached to.
* **The run (ephemeral-ish).** Which words have been answered, what colour each took,
  the prompt queue, the camera. Lives in `localStorage`, is restored on re-entry, and
  is cleared only by **Restart**.

Nothing about a run reaches the server except the reading marks it emits; nothing about
the map is changed by a run except a fade-off deletion.

---

## 2. The map

### 2.1 Which cards get a spot

**The reading track decides membership, not core mastery.** A word you have fully
mastered for recognition but never learned to read still lives on the map. The map is a
portrait of your *reading* journey specifically.

The eligible set is:

```
vetSortedClause()  AND  NOT masteredBarClause('reading')
```

both from `server/dal/shared/vetTable.ts`.

* `vetSortedClause()` — **cards the learner sorted themselves**, which excludes lent
  provisional cards. A borrowed word must never take permanent residence on a map meant
  to portray the learner's own library ([PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md)).

  > **Corrected at build time (2026-08-18).** This section originally named
  > `vetPlayableClause()` while describing what `vetSortedClause()` does — but
  > `vetPlayableClause()` is `starterPackBucket IN ('library','provisional')`, i.e. it
  > *includes* the lent cards it was said to exclude. Memory Map is the **first game
  > that wants the SORTED clause**, because it is the only one whose selection creates
  > a durable artifact rather than a single round; every other game pool is rightly
  > PLAYABLE. Q12's "lent words must not homestead a permanent map" settles which half
  > of the contradiction was the intent.
* `masteredBarClause('reading')` is **goal-independent since migration 143**. The
  reading track is computed for every learner whether or not `users.readingGoal` is set;
  a learner without the goal simply never sees a reading progress bar in the UI. Memory
  Map works identically for both — it just quietly drives a track one of them can't see.
  See [MASTERY_REWORK.md](./MASTERY_REWORK.md).

### 2.2 The map is capped at 100 words

`MEMORY_MAP_CAPACITY = 100`. A learner with 400 eligible cards gets the top 100.

**Which 100: the flp offering priority list.** The same rule the flp uses to decide
which card to serve next — the utcm category ladder (Target → Unfamiliar → Comfortable
→ Mastered) with `OnDeckVocabService.rankFlpEligible` ordering *within* a category
(longest-waiting-first; never-marked cards always last). Reusing it means the map is
populated by the same judgement of "what should this learner be working on now" as
every other surface, rather than inventing a second opinion. See § 13 for the one
adaptation it needs.

The cap is also the performance answer: 100 absolutely-positioned nodes need no
viewport culling.

### 2.3 Coordinates, sizes

Continuous world coordinates, **not** a grid. Each placement is an axis-aligned
**bounding box** centred on `(x, y)`, sized by the word's rendered text at a `scale`
**drawn randomly at spawn (≈0.95×–1.8×) and frozen forever**.

Size carries no meaning — it exists to make the archipelago look organic — and freezing
it is what keeps the map stable. A size that tracked mastery would reflow every
neighbour each time you studied.

> **What the range controls is its RATIO, not its magnitude.** The camera fits the whole
> map on load, so scaling every word by the same factor grows the map's world extent and
> shrinks the fitted zoom by exactly as much — a wash on screen. Only `max / min` changes
> what a player sees: the size CONTRAST across the map. It was widened from 0.7–1.6
> (ratio 2.3) to 0.95–1.8 (ratio 1.9) so the smallest words read comfortably instead of
> as specks. To make everything bigger on screen, the lever is `FIT_PADDING` — how
> tightly the fitted map fills the viewport — not this.

Words render through **`ForeignText`** (never `CPCDRow` directly — the container rule),
so Spanish works unchanged.

**The map never shows pinyin** (`showPinyin={false}`), and that matters more now that the
prompt does (§ 3.1): with romanization on both sides the player could match the prompt's
pinyin against the map's letter for letter and never look at a character. The prompt
gives the sound; the map makes you find the characters that carry it.

**Every word is a white parcel with fences on its shared edges.** The box the server
placed the word by is drawn — white land on the blue water (§ 7) — with a border only on
the edges it actually **shares with a neighbour** (`touchedSidesForAll`). Because tangent
boxes abut exactly, an island fuses into one continuous landmass whose internal
boundaries are visible and whose **coastline is open to the sea**. That is what the
tangent placement was always for; until the parcels were drawn, nothing showed it.

Two details that are load-bearing rather than stylistic:

* **All four corners are rounded** (§ 14.5c). The interior junctions therefore show
  small blue lenses where two rounded corners pull apart, so an island reads as a cluster
  of tiles rather than one fused landmass. Owner-settled; not a rendering fault.
* **`box-sizing: border-box`.** A border that grew the parcel would push fenced words
  apart and open a gap along every shared edge.

Fences are drawn in a neutral line colour, not the word's outcome hue: a boundary belongs
to *both* parcels, so colouring it by one would make an answered word appear to claim its
neighbour's edge.

> This replaced four **corner brackets** marking each box's extent. Corners stated the
> same geometry but drew it twice wherever two words met, and drew it on the coast where
> there is nothing to divide.

**The glyphs are measured and scaled to fit their parcel.** `wordBoxSize` allocates ~36px
per Chinese glyph at scale 1 while `ForeignText`'s `md` preset renders a 50px column —
about 40% wider. While the box was invisible that overflow went unnoticed; the moment
each word became a white parcel with fences, text visibly spilled across its neighbours.
The fit is **measured** (`offsetWidth`/`offsetHeight`, which are layout values and ignore
CSS transforms, so neither the camera zoom nor the applied scale feeds back into it)
rather than derived from CPCDRow's constants, which are private to that component and
differ again for Latin script. `TEXT_FIT` is the fill fraction on whichever axis binds
first, and is the direct lever if the text ever looks too small or too tight.

> ⚠️ **Never pass `pronunciation` to the map's `ForeignText`.** CPCDRow reserves vertical
> space for the pinyin row whenever an item *has* a pinyin — even with
> `showPinyin={false}` — so that toggling pinyin visibility does not shift surrounding
> layout. Handing it a pronunciation therefore added ~22px of invisible padding under
> every glyph at `md`, which the measurement above dutifully counted: words filled barely
> half their parcel's height and sat high in it. The map never shows pinyin, so it must
> never be given any; `showPinyin={false}` alone is not enough.

**The map never shows pinyin** (`showPinyin={false}`), and that matters more now that the
prompt does (§ 3.1): with romanization on both sides the player could match the prompt's
pinyin against the map's letter for letter and never look at a character. The prompt
gives the sound; the map makes you find the characters that carry it.


### 2.4 Spawn algorithm

For each unplaced word, in flp priority order:

* **10% of the time → a new island.** Pick a random placed box as the **coast**, pick a
  random bearing, and step outward from it until the water is free — starting at
  `ISLAND_GAP` (~one word-width) and giving up after `ISLAND_MAX_DRIFT`. A denied island
  falls through to the growth branch rather than drifting out to sea, so a crowded map
  gains a neighbour instead of an outlier.

  The probe is allowed to CROSS LAND on its way out, and the cap governs how far past
  the coast it may drift — not how far it may travel. The bearing is random, so it often
  points *into* the anchor's own island; budgeting the cap for the whole ray meant any
  inward bearing gave up before reaching water, almost every island attempt fell through
  to growth, and maps came out as **one island**. A candidate must also clear real water
  (`ISLAND_GAP` of separation from every box), not merely fail to overlap — a box a
  hair off a coast reads as part of it.

  Growth carries the matching rule: **a grown word may not come within `ISLAND_GAP` of
  an island other than the one it is joining.** Without it a single word could land
  tangent to two islands at once and merge them, eroding the archipelago one word at a
  time — which still collapsed a 65-word map about once in thirty attempts after the
  probe itself was fixed.

  > **The distance is capped, and the cap is the whole point.** The first version placed
  > each island outside the WHOLE MAP's bounding rect at `halfDiagonal + gap` from the
  > map's *centre*. That radius grows with the map, so every island landed further out
  > than the last and the map's area grew super-linearly — at 100 words the archipelago
  > measured ~123×122 units against ~47×31 today, a **10× area reduction**, and the run
  > was mostly panning between specks. Anchoring on a coast rather than on the centre is
  > what bounds it: a new island is always within a fixed swim of land that already
  > exists, however large the map gets.
* **90% of the time → grow an existing island.** Pick a random placed box, pick a
  side, slide the new box in along that side until **tangent** — sharing a border within
  a small epsilon — then reject if it **overlaps** anything and retry with a different
  anchor/side. Boxes may touch; they may never overlap.
* The first word on an empty map sits at the origin.

### 2.4a The map grows PORTRAIT, because the phone is

Growth is biased vertically so the archipelago comes out roughly twice as tall as it is
wide — near enough the ~0.46 width/height of the screen it is played on. A map that grew
isotropically is the wrong shape for its container: fitting a square map to a tall
viewport leaves fat empty margins above and below and shrinks every word to suit.

Three knobs, and all three are needed — the first alone does not do it:

| Constant | Effect |
|---|---|
| `VERTICAL_GROWTH_BIAS` | how often growth picks a top/bottom edge over a left/right one |
| `VERTICAL_SIDE_OFFSET_DAMP` | how far a stacking word may slide sideways along that edge |
| `ISLAND_BEARING_ASPECT` | how much a new island's bearing is squashed horizontally |

The damping matters as much as the bias: a word box is **wider than it is tall**
(~2.4 × 1.45 units for two characters), so a vertical stack free to slide the full width
of its anchor fans the island back out sideways and undoes the bias one stack at a time.

All three are **biases, not constraints**. Horizontal growth still happens and every
bearing stays reachable — a map that could never put an island due east would read as a
rule rather than as a coastline. Measured over 30 runs: **width/height ≈ 0.51** at 65–100
words, with island count and area unchanged.

**Islands are not stored.** There is no `islandId` column: an island is whatever the
connected components of the tangency graph happen to be, computed from the boxes when
needed. Geometry is the only source of truth, so nothing can drift — and a fade-off
that splits an island in two doesn't leave a lying column behind.

`connectedIslands(boxes)` (`server/services/memoryMapSpawn.ts`) is that computation, and
the off-screen compass (§ 6) is its first consumer. It is a BFS over `boxesTouch`, which
is the deliberate inverse of `boxesOverlap`: tangent along an edge segment counts as
connected, a bare **corner touch does not** — two boxes meeting at a point read as two
nearby islands, which is the same judgement `MIN_EDGE_OVERLAP` enforces when placing.

Freed space is reusable — later words can spawn into the hole a graduated word left.

### 2.5 Growth is announced

New words placed at load are reported as a brief toast — *"3 new words joined your
map"* — with no auto-pan. Without it the map's growth is invisible, which is the whole
emotional point of the feature.

---

## 3. The run

### 3.1 The prompt

A compact bar shows the target's **English gloss and its pronunciation**, in tone
colours, plus the try pips. No audio, no part of speech.

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

### 3.2 Order

A random shuffle over every unfinished word, fixed at run start and stored in the save.
Deliberately **not** spatial — a spatial order would let the player sweep the map
left-to-right instead of recalling anything.

### 3.2a Skip

A **skip** button in the prompt bar sends the current word to the **back of the queue**.
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

Three tries. Tapping **another uncoloured word** flashes it red and burns a try.
Tapping empty space is a no-op (it is also the pan gesture).

| Outcome | Colour | Meaning |
|---|---|---|
| Correct on try 1 | **green** | knew it |
| Correct on try 2 or 3 | **orange** | recovered |
| Three misses | **red pulsing glow**, then **solid red** once tapped | didn't know it |

Hue alone carries the result — no icons, no patterns. Accepted knowingly: the game has
no fail condition, so a misread colour costs the player nothing real.

**On the third miss the English prompt itself turns red.** That is the entire
find-the-failed-word affordance: the red prompt tells you to stop recalling and start
looking for a pulsing word. No camera ease, no edge arrow, no directional hint —
searching is the game, and the red prompt is what stops the player thinking they are
still being tested.

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

### 3.6 Fading off, and mid-run refill

When an answer leaves a word **reading-mastered**, it **fades off the map immediately**
— it holds its colour for a beat, then dissolves — and its placement row is **deleted**.
It has graduated. If reading mastery ever regresses, it will spawn again somewhere new.

The map then **self-heals back to 100 straight away**: the next word in flp priority
order spawns in and **joins the current run's queue**.

> ⚠️ **Consequence, accepted:** a productive run gets longer as you play — every
> graduation adds one prompt. It still terminates (the eligible pool is finite and each
> graduation consumes one), but "colour the whole map" is not a fixed 100 prompts on a
> good day. If this proves annoying in play, the fix is § 12 Q32's third option:
> refill the map but don't enqueue the newcomer.

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

Header: back arrow · **progress count (`23 / 100`)** · a **Restart button**
(`RestartAltRounded`, the house restart icon — Bubble Match's header uses the same one)
opening a confirm · **minute-credit badge, rightmost**.

Restart used to sit behind a settings **gear**, but Restart was the gear's only item and
a cog that opens a one-row sheet is a drawer hiding a single tool. The **confirm** is
what was actually doing the work and it stays: a run can be dozens of prompts long, so
destroying it takes a deliberate second tap (Word Search's confirm-before-clobber).

**The flame is always the rightmost item.** It occupies the same corner slot on every
surface that shows it (flp, Sort Cards, Quick Mark), so a learner can find their minute
credits without reading the header; game-specific controls queue up to its left.

The **minute badge (`MinutePointsFireBadge`) is shown in every phase**, including the
empty and error states — the route is in `MINUTE_POINTS_ELIGIBLE_PAGES` and in the
`/games` **start-on-entry** subset, so time is credited from the moment the page mounts
whether or not a run is under way. A counter that appeared only once you were playing
would misreport that. The progress count and gear appear only during a run.

The badge calls `useMinutePoints()` **internally** rather than taking it as a prop, so
its per-second tick re-renders the badge alone. That matters more on this page than
anywhere else: a page-level re-render every second would interrupt an in-progress pan.

**The prompt bar is ONE COMPACT ROW**, sitting below LeafPage's ordinary header:

```
[↓]  Memory Map                                  23/100  ⟳  🔥
     ────────────────────────────────────────────────────────
     goodbye                                          👁  ●●○
```

It used to be four stacked rows — gloss, a standing hint line, the spoiler and the try
pips — which cost close to a fifth of a phone screen before the map got any. The hint
line (*"Find this word on your map"*) is gone entirely: the red-prompt state already
carried the only message that ever changed, and a long gloss now ellipsizes rather than
wrapping the bar to a second line.

> An earlier revision went further and hid LeafPage's header entirely, folding the
> prompt in beside the controls. That bought a little more space at the cost of the page
> title and of putting the question in amongst the chrome. **The question deserves its
> own line, it just does not deserve four.** The wasted space was always in the prompt
> block, not in having two bars.

Camera: pan + pinch-zoom over a world layer. Restore the saved camera when resuming;
on a fresh run, fit the whole map. Zoom clamped so text stays legible at minimum zoom.

**Off-screen islands get an edge marker.** The archipelago is larger than a phone
screen, so a learner panned into a corner can face open water with no evidence the rest
of the map exists. `MemoryMapIslandCompass` pins one chevron to the viewport edge per
island that has **no box on screen**, rotated toward it and labelled with its word count.

It is **navigation, not a hint**: every off-screen island is marked identically whether
or not the target is on one, so it never narrows the search — the player could learn the
same thing by pinching out. Q17's rule (no directional aid toward the *target*) stands.
The markers are `pointerEvents: none`, because the whole viewport is the pan surface and
a marker that swallowed touches would create dead zones exactly at the edges, where
dragging is most needed.

`useBlockEdgeSwipe(true)` is mandatory, and the page is `touchAction: "none"` — the map
owns its gestures.

**Empty map:** a learner with no eligible cards sees an empty state — *"Your map is
empty — sort some cards and they'll appear here"* — with a button to `/discover`. This
is the one place the no-baseline decision (§ 10) is visible to a user.

---

## 7. Rendering

**The ground is water.** The world layer sits on `COLORS.blueAccent`, so tangent boxes
read as land and the gaps between islands read as sea — which is what makes the
archipelago legible at a glance rather than looking like words scattered on a page. It
also gives the off-screen compass chips (§ 6) something to sit against. The token is
light enough that the default glyph colour and all three outcome hues stay readable on
it; no new colour was introduced.

**DOM + CSS `transform` on a world layer. No `requestAnimationFrame` loop, no Pixi.**
Same class as Match Speed: pan/zoom is a transform, colours are CSS transitions, the
pulse is a keyframe animation. The 100-word cap is what makes this safe — no viewport
culling needed. A game that genuinely needed a scene graph should borrow the night
market's Pixi host (`src/features/nightmarket/pixiRuntime.ts`), not invent one.

---

## 8. Data model

**Two tables, one per language**, mirroring the vet split — which is what buys a real
foreign key, because `cvet` and `svet` are separate tables sharing one id sequence with
no union view:

```sql
CREATE TABLE memory_map_placements_zh (
  id             SERIAL PRIMARY KEY,
  "userId"       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "vocabEntryId" INTEGER NOT NULL REFERENCES vocabentries_zh(id) ON DELETE CASCADE,
  language       TEXT    NOT NULL,          -- 'zh'; see below
  x              REAL    NOT NULL,          -- world coords, box CENTRE
  y              REAL    NOT NULL,
  scale          REAL    NOT NULL,          -- frozen at spawn
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("userId", "vocabEntryId")
);
CREATE INDEX ON memory_map_placements_zh ("userId", language);
-- …and the identical memory_map_placements_es referencing vocabentries_es(id).
```

Design notes:

* **`ON DELETE CASCADE` on `vocabEntryId` is the payoff of the split.** Deleting a card
  deletes its placement; **orphans cannot exist**, so there is no sweep, no cron step,
  and no orphan-tolerant read path.
* **`language` is stored** even though it is implied by the table. It is immutable once
  written (a card never changes language) and it keeps the per-user index and every read
  identical in shape across the two tables — the alternative saves nothing.
* **No `islandId`** (§ 2.4).
* **Not `gameprogress`, not a vet column.** A JSONB blob would rewrite the whole map on
  every spawn and can't answer "which words lack a placement"; a `mapPlacement` jsonb on
  the vet tables would put a one-game concern in a core table, twice.

⚠️ Exact table names, column names and the migration number need confirming at build
time (CLAUDE.md: confirm all new tables and columns). The shape above is signed off; the
naming is not yet.

---

## 9. Layering

| Layer | Files |
|---|---|
| **DAL** | `server/dal/implementations/MemoryMapDAL.ts` — placement reads/writes only, plus the eligible-card query. No geometry. |
| **Geometry** | `server/services/memoryMapSpawn.ts` — a **pure module**: given existing boxes and a new box's size, return a position (§ 2.4). No DB, no I/O, unit-testable in isolation. Kept out of both the DAL (which would be writing game rules in SQL) and the service (which stays orchestration). |
| **Service** | `server/services/MemoryMapService.ts` — orchestrates a load: read eligible cards, diff against placements, top up to 100, call the geometry module, persist, return the map. Also the fade-off delete. |
| **Controller** | `server/controllers/MemoryMapController.ts` |
| **Routes** | `server/routes/memoryMapRoutes.ts` — `GET /api/memoryMap` (load + spawn), `POST /api/memoryMap/graduate` (fade-off + refill, returning the replacement). camelCase paths per [BACKEND_LAYERING.md](./BACKEND_LAYERING.md). |
| **Contract** | `server/contracts/wire.ts` — `MemoryMapPlacement`, `MemoryMapResponse`, `MEMORY_MAP_CAPACITY` |
| **Client API** | `src/api/memoryMap.ts` via `apiGet`/`apiPost` (`src/api/http.ts`) — **no function takes a token** ([FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)) |
| **Game** | `src/games/memory-map/` — `MemoryMapPage.tsx`, `MemoryMapWorld.tsx` (pan/zoom layer), `MemoryMapWord.tsx`, `MemoryMapPrompt.tsx`, `MemoryMapRestartDialog.tsx`, `constants.ts` (`MARK_TYPE = 'reading'`), `types.ts`, `runStorage.ts`, `useMemoryMapRun.ts`, `promptQueue.ts` |

The load effect must key on `user?.id` / `isAuthenticated`, **never on `token`** — the
map plus an in-progress run is exactly the state a silent-refresh reload would destroy
([TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md)).

---

## 10. How it sits in the games framework

| Hook | Memory Map |
|---|---|
| Registry | one `GameDef` in `src/games/registry.ts`, `gameId: "memory-map"`, `markType` from its `constants.ts`. **No `languages` gate** (all languages), **no `challengeScoring`**, **no `unlock`**. Route, leaf chrome (`GAME_ROUTE_META`) and the mobile-demo allowlist all derive from that entry |
| Collection selector | **Not supported.** The map *is* your library and cannot be a deck. The hub **hides the Memory Map row entirely whenever the selected collection is anything other than All Cards** — a visible row that ignores the selector reads as a bug, and the existing precedent is hiding rather than showing-and-blocking |
| Card baseline / provisional | **none.** No entry in `CARD_BASELINES`. Nothing blocks on card count because nothing can block; a small library is simply a small map (§ 6 empty state) |
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
| Q2 | Map geometry | **Continuous coordinates + bounding boxes**, not a tile grid (§ 2.3) |
| Q3 | Mark policy | **One reading mark per word per run, by outcome**: green +, orange −, red − (§ 3.5) |
| Q4 | Run length | **The whole map**, made playable by a save; Restart is the escape hatch (§ 4) |
| Q5 | Size driver | **Random, frozen at spawn** — not length, not mastery (§ 2.3) |
| Q6 | Already-mastered words holding a placement | **Prompted like any other word**, then faded off when answered (§ 3.6) |
| Q7 | Languages | **All.** One map per (user, language); render via `ForeignText` |
| Q8 | What burns a try | **Only tapping another UNCOLOURED word.** Empty space is the pan gesture; coloured words are free (§ 3.3–3.4) |
| Q9 | Fade-off storage | **Delete the row.** The space is freed; a regressed word respawns somewhere new (§ 3.6) |
| Q10 | Colours across exits | **Backtracked from "lost on exit" — the save keeps them.** Restart clears (§ 4) |
| Q11 | Help finding the target | **None** during the three tries (§ 3.3) — *superseded 2026-08-18: the prompt now shows the target's PINYIN outright (§ 3.1), free of any scoring penalty. It helps you READ the word, not LOCATE it, so Q17's "no locating aid" still stands.* |
| Q12 | Card baseline | **None.** Lent words must not homestead a permanent map (§ 10) |
| Q13 | Island formation | **10%** of spawns start a new island; 90% must touch (§ 2.4) |
| Q14 | Which cards are placed | **Playable and NOT reading-mastered** — the reading track, not core (§ 2.1) |
| Q15 | Win/lose | **Neither exists** (§ 5) |
| Q16 | Wrong attempts | **3 tries**, then the red-glow lock-in (§ 3.3) |
| Q17 | The off-screen failed word | **The English prompt turns red.** That is the whole affordance — no camera ease, no edge arrow (§ 3.3) |
| Q18 | Store `language` on the row | **Yes** — immutable, and keeps both tables' reads identical (§ 8) |
| Q19 | The vet FK problem | **Split per language**, `_zh` / `_es`, which buys a real FK (§ 8) |
| Q20 | `islandId` | **Not stored** — geometry is the truth (§ 2.4) |
| Q21 | Hub collection selector | **Ignored, and the game is hidden from the hub** unless All Cards is selected (§ 10) |
| Q22 | Pause on background | **Skipped**, with the reason documented (§ 10) |
| Q23 | Colour-blind redundancy | **None** — hue only, accepted knowingly (§ 3.3) |
| Q24 | Empty map | **Empty state pointing at `/discover`** (§ 6) |
| Q25 | Header during a run | **Progress count + gear → Restart**, behind a confirm (§ 6) |
| Q26 | Tapping a finished word | **Opens a definition popup, any time, free** (§ 3.4) |
| Q27 | Performance ceiling | **Cap the map at 100 words** — which removes the need for culling (§ 2.2, § 7) |
| Q28 | Language switch mid-run | **Separate map AND separate save per language** (§ 4) |
| Q29 | Orphan placements | **Real FK with ON DELETE CASCADE** — they cannot exist (§ 8) |
| Q30 | Fade timing | **Immediately**, right after the word is answered (§ 3.6) |
| Q31 | Which 100 words | **The flp offering priority list** — category ladder + `rankFlpEligible` (§ 2.2) |
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

2. **Map capacity is a contract constant.** ✅ `MEMORY_MAP_CAPACITY = 100` lives in
   `server/contracts/wire.ts`, deliberately NOT in `CARD_BASELINES` — a baseline is a
   floor the server lends cards to reach, and this is the opposite quantity, a ceiling.
   The comment there says so, because the two constants sitting near each other invites
   exactly that confusion.

---

## 14. What the build changed

Seven things the design did not anticipate. All are settled in code; they are recorded
here because each one is a decision a future reader would otherwise have to re-derive.
The last three were found in play rather than at build time.

### 14.1 The membership clause was named wrong (§ 2.1)

The spec said `vetPlayableClause()` while describing what `vetSortedClause()` does.
`vetPlayableClause()` is `starterPackBucket IN ('library','provisional')` — it *includes*
the lent cards the paragraph said it excluded. Q12 settles which half was intended, and
the code uses `vetSortedClause()`.

This makes Memory Map **the first game to select on the SORTED clause**. Every other
game pool is rightly PLAYABLE, because a lent card is fine for the length of one round.
Here selection creates a durable artifact, so a borrowed word would homestead a
permanent spot on a map meant to portray the learner's own library.

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

`wordBoxSize` (`server/services/memoryMapSpawn.ts`) is imported by the CLIENT as well as
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

### 14.5b The 4px grid, and the two things exempt from it

Every padding, gap, inset and control dimension in the game's **chrome** is a whole
multiple of `GRID = 4` (`src/games/memory-map/constants.ts`), written through the
`grid(n)` helper rather than as a bare pixel literal. Retrofitting it removed a drift of
hand-tuned values that had accumulated during play-testing — `7px 14px`, `3px`,
`2px 6px 2px 4px`, a 19px icon — and moved `PIXELS_PER_WORLD_UNIT` from 34 to **36**
(9 × GRID), which also bought a little legibility at the same zoom.

MUI's `sx` shorthands are left alone: the theme's spacing unit is 8px, so `gap: 1` and
`mb: 2` are already on the grid. Only quarter/three-quarter steps would fall off it, and
none are used.

Two exemptions, both deliberate:

1. **Hairlines.** `BORDER_PX` (1.5) and stroke widths generally are not spacing, and a
   4px fence between two words would be a wall. `box-sizing: border-box` keeps them from
   pushing anything else off the grid.
2. **The world layer.** Word boxes are sized by `wordBoxSize` at continuous scales
   (0.95–1.8) and drawn through a continuous camera zoom, so their pixel dimensions are
   fractional by construction. Snapping them would open gaps along the shared edges that
   make an island read as one landmass — not worth breaking the game's central piece of
   geometry for.

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

`MemoryMapWord` now records the press position on `pointerdown` and only counts a
release as a tap if the pointer moved less than `TAP_SLOP_PX` (8 screen px), clearing
the press on `pointercancel` so a stale one cannot match a later release. It is measured
locally rather than read off the gesture layer because the world's drag listens to
*touch* events while this is a *pointer* handler — the two never see the same event
object and cannot be correlated.

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

Migration **151** is **expand-only and additive** — two new tables, no changes to
existing ones — so it is safe to apply with `migrate.sh` **before** the container
rebuild, and it needs no temporary runbook. It is independent of migration 150 (the
study-challenge week-index rename, which has its own runbook) and the two may land in
either order.

Nothing pre-exists to back-fill: a learner's map is built lazily on their first visit to
the game.

---

## 16. File map

| Layer | File |
|---|---|
| Migration | `database/migrations/151-create-memory-map-placements.sql` |
| Contract | `server/contracts/wire.ts` — `MEMORY_MAP_CAPACITY`, `MEMORY_MAP_SCALE_RANGE`, `MemoryMapPlacement`, `MemoryMapWord`, `MemoryMapResponse`, `MemoryMapGraduateResponse` |
| Geometry (pure) | `server/services/memoryMapSpawn.ts` — `wordBoxSize`, `spawnPosition`, `spawnBatch`, `boxesOverlap`, `boxesTouch`, `boxSeparation`, `connectedIslands`, `touchedSidesForAll`, `mapBounds` |
| Ranking (pure, shared) | `server/services/cardQueueRanking.ts` — `rankCardQueue`, `readyMarkTypes`, `queueArrivalAt` |
| DAL | `server/dal/interfaces/IMemoryMapDAL.ts`, `server/dal/implementations/MemoryMapDAL.ts` |
| Service | `server/services/MemoryMapService.ts` — `loadMap`, `graduate`, `prioritize` |
| Controller | `server/controllers/MemoryMapController.ts` |
| Routes | `server/routes/memoryMapRoutes.ts` — `GET /api/memoryMap`, `POST /api/memoryMap/graduate` |
| Client API | `src/api/memoryMap.ts` — `fetchMemoryMap`, `graduateMemoryMapWord` |
| Game | `src/games/memory-map/` — `MemoryMapPage.tsx`, `MemoryMapWorld.tsx`, `MemoryMapWord.tsx`, `MemoryMapPrompt.tsx`, `MemoryMapIslandCompass.tsx`, `MemoryMapRestartDialog.tsx`, `useMemoryMapRun.ts`, `promptQueue.ts`, `runStorage.ts`, `constants.ts`, `types.ts` |
| Registry | `src/games/registry.ts` (the `memory-map` entry), `src/games/GamesPage.tsx` (the All-Cards-only gate), `src/constants.ts` (`MINUTE_POINTS_ELIGIBLE_PAGES`) |
| Tests | `server/__tests__/memoryMapSpawn.test.ts` (45), `server/__tests__/cardQueueRanking.test.ts` (17), `src/__tests__/memoryMapPromptQueue.test.ts` (8) |

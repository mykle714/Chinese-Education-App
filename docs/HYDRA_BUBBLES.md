# Hydra Bubbles — endless recognition drill

**Status: BUILT (2026-08-18), UNPLAYED.** The game ships: `src/games/hydra-bubbles/`,
the `/games/hydra-bubbles` route, a registry entry, a `CHALLENGE_GAMES` spec, and the
server's rolling-supply lending. No migration was needed at any point — Hydra adds no
table and no column. See § 12 for the citation list.

**Not yet validated by play.** Everything below § 3 is a first tuning that nobody has
sat down with; § 11 O1 is the standing invitation to move the numbers. Two things
were corrected during implementation and are called out where they live: the § 3.1
squeeze is a step rather than an interpolated anchor, and § 8's "no wire change"
claim did not survive contact with the undo contract.

Named for the myth: cut off one head and more grow back. The game id is
`hydra-bubbles`; this doc says **Hydra** for short throughout.

---

## 1. Concept

A recognition game built on Bubble Match's infrastructure, with the opposite pressure
model.

* **No clock. No bubble drift. No descending ceiling.** Bubbles are placed and then
  stay put.
* The run starts with **3 bubbles**: 1 Chinese + 2 English (one live pair and one
  stray). Both slots **roll the spawn table at fill 0** (§ 3.1) rather than hard-coding
  a color, so the opening is a consequence of the economy rather than a second, silent
  source of truth beside it. Since the fill-0 row is blue-only, the run still opens on
  a blue pair — but because the table says so, and a retune of that row moves the
  opening with it.
* Drag a bubble onto another to match. **One wrong match ends the run**, immediately.
* A correct match clears both bubbles and spawns **0–3 new ones**, decided by the
  **color** of the Chinese bubble that was cleared.
* Score = **bubbles cleared** (+2 per match).

Where Bubble Match's tension is a shrinking play area against a fixed pool, Hydra's
tension is a board that **grows on its own** and can only be held back by taking
riskier matches. See § 3.

---

## 2. The payout ladder

The color of a Chinese bubble is a contract with the player: it tells them exactly
what clearing it will cost or earn. English bubbles are **always grey** and carry no
color information — the color channel is reserved for payout.

| Color | Bucket | Bubbles spawned | Bubbles cleared | **Net board Δ** |
|---|---|---|---|---|
| 🔴 red | Unfamiliar | 1 | 2 | **−1** |
| 🟡 yellow | Target | 2 | 2 | **0** |
| 🟢 green | Comfortable | 3 | 2 | **+1** |
| 🔵 blue | Mastered | 4 | 2 | **+2** |

**The ladder was raised by 1 across the board on 2026-08-19** (it was 0/1/2/3). The
one-bubble step between colors — the thing the player actually reads — is unchanged;
what moved is where the ladder sits against the fixed 2-bubbles-removed cost:

* **Red no longer pays nothing.** It is still the only color that shrinks the board,
  but at −1 rather than −2, so the squeeze (§ 3.1) takes twice as many correct hard
  clears to escape.
* **Yellow is now the break-even color** and green has become a grower. Only red
  shrinks the board; every other color grows it or holds it.
* **The steady-state mix had to be reweighted with it.** Expected payout is
  `2 + (2·blue + green − red)/100`, so raising every payout by 1 moved break-even from
  `2b+g−r = 100` down to `2b+g−r = 0` — 100 points of slack. The old 48/20/24/8 row
  under the new ladder would have grown the board at **+1.08** bubbles per match
  instead of +0.08. That slack was spent on yellow and red; see § 3.1.

Colors are the existing `CATEGORY_COLORS` (`src/utils/categoryColors.ts`) — red
`#EF476F`, green `#05C793`, blue `#779BE7` — so a bubble's color means the same thing
here as on the decks page and the cdp progress bars.

**Yellow is the one exception: Hydra paints Target `#FFD166`, not the app-wide
`#FF9E5A`** (`HYDRA_TARGET_YELLOW`, `HydraStage.tsx`). The shared token is an orange
despite the app calling that band yellow everywhere, including in its own code
comments. On a decks chip that passes; blown up to a bubble filling a chunk of the
screen, beside a red band that is genuinely red, it reads as a second orange rather
than as the third step of a red → yellow → green → blue ladder. In Hydra that ladder
is not decoration — it *is* the payout the player reads off the bubble, so the four
steps have to be four obviously different colors.

`#FFD166` is the canonical sibling of the hues already in the set (`#EF476F` /
`#FFD166` / `#06D6A0` is a standard palette, and Unfamiliar is exactly `#EF476F`
while Comfortable is `#05C793`), so this moves Target **onto** the family rather than
off it. Target's bubble fill is also lighter than the other three (`#FFF4D6`), because
a pale border needs a paler fill behind it to still read as an edge.

> If the app-wide Target band is ever retuned to a true yellow, delete
> `HYDRA_TARGET_YELLOW` and go back to `CATEGORY_COLORS.Target`. Nothing else in the
> game depends on the divergence.

---

## 3. The spawn table — the economy is NOT self-stabilizing

**This is the central design decision.** An earlier draft keyed payouts to bands and
let the board settle at an equilibrium; that was rejected. The table below keeps the
expected payout **above 2 at every count**, so the board always creeps upward on its
own. Holding it back is the player's job, and the only way to do it is to
deliberately clear **yellow and red** bubbles — which are, by construction, the words
they know least well and are most likely to get wrong.

> Safe matches grow the board. Risky matches shrink it. That trade *is* the game.

### 3.1 Anchor table

Anchor rows, **linearly interpolated** between anchors, keyed on the board's current
**fill ratio** — the same occupied-area measure the overflow loss reads
(`LOSE_FILL_RATIO`, and `physics.ts`'s fill-ratio helper once it is extracted). Keying
the table on area rather than on a bubble count is deliberate (Q2, resolved): the
spawn system and the loss condition now consult the *same* number, so they cannot
disagree about how full the board is on a phone, on a tablet, or after any radius
change. There is deliberately **no drift with matches cleared** — an identical board
always rolls an identical distribution, no matter how long the run has gone. Hydra is
pure endurance, not an escalating curve.

The table is **three states**, not a curve:

```
OPENING          fill 0.00
  blue 100%  green 0%  yellow 0%  red 0%
  E[payout] 4.00   net dN +2.00

    ↓ interpolated across the first tenth

STEADY STATE     fill 0.10 → 0.75   (one mix, held)
  blue  25%  green 10%  yellow 30%  red 35%
  E[payout] 2.25   net dN +0.25

    ↓ hard step

SQUEEZE          fill >= 0.75
  blue 0%  green 0%  yellow 0%  red 100%
  E[payout] 1.00   net dN -1.00
```

**Simplified to two growth anchors on 2026-08-18.** The table previously carried rows
at 0.10 / 0.25 / 0.45 / 0.60 whose weights drifted a few points each while red stayed
flat — four breakpoints describing a change no player could perceive, and four more
numbers a tuning pass had to keep mutually consistent. Difficulty in Hydra comes from
the board **filling up** and from the 0.75 step, not from a slow drift in the mix.

Flattening also removed a problem the drift had introduced: growth is uniform
everywhere in the steady state (**+0.25** bubbles per match since the 2026-08-19
reweight, +0.08 before it), rather than decaying near the squeeze, where a skilled
player could have hovered indefinitely.
`hydraSpawnTable.test.ts` asserts there are exactly **two** growth anchors and that the
steady state is genuinely flat, so reintroducing an intermediate row is a deliberate
act rather than an accident.

**Red arrives early and stays heavy.** It used to be 0% below fill 0.45 and 2–3% above.
That was a design error rather than a tuning one: red is the player's *only* way to
shrink the board, so withholding it until the board was already half full meant the
risky-clear trade § 3 calls "the game" was not on offer during the half of a run where
the player most wants to practise it. Red went to a flat 8% from fill 0.10 onward, and
since the **2026-08-19 reweight it is the largest single share of the steady state at
35%** — the board is now mostly words the player knows least well.

**Reweighted 2026-08-19: 48/20/24/8 → 25/10/30/35** (blue/green/yellow/red), alongside
the +1 payout ladder (§ 2). Blue and green come down, yellow and red go up. This is
only affordable *because* of the raise: the +1 freed 100 points of economy slack, and
spending it here holds growth at a playable **+0.25** per match instead of the +1.08
the old mix would have produced under the new ladder. Yellow is back up to **30%** —
higher than it has ever been — so challenge words (§ 7.5) surface *more* often per
spawn, reversing the 2026-08-18 reduction that had taken it to 24%.

**The fill-0 row is blue-only** (2026-08-18). An empty board rolls nothing but the
safest, highest-paying color; the other three ramp back in over the interval to the
0.25 anchor, where the full mix is restored. A run therefore *opens* on words the
player certainly knows and has to earn its way into risk — and the steepest growth in
the game (net +2.00 per match) sits exactly where the player has the most room to
absorb it. Blue-only is a **point, not a zone**: a step here instead of a ramp would
hand the player a cliff a few bubbles into every run.

This is the one place the yellow-share floor below is suspended, and § 7.5's challenge
words consequently cannot spawn onto a completely empty board. That costs a challenge
nothing — the board is empty for one spawn batch at the very start of a run — but it
is asserted as **exactly one** zero-yellow anchor in `hydraSpawnTable.test.ts`, so a
future tuning pass cannot quietly starve challenge scoring by adding a second.

Below 0.75 fill every point on the curve is net-positive. At 0.75 and above the table
**switches** to red-only: nothing but the hardest words spawn, each paying 1 against
the 2 a match removes, so the board can only shrink — at −1 per match since the
2026-08-19 ladder, half the −2 it used to be. That zone is the squeeze — the player has to clear their
hardest words to climb back out of it, and every one of those clears is a chance to
lose. The red-only floor sits well below the 0.94 loss line, so the squeeze is
reachable by construction rather than by luck.

> ⚠️ **Corrected on implementation (2026-08-18): the squeeze is a STEP, not another
> interpolated anchor.** This section originally listed red-only as an anchor row at
> 0.75, blended into like every other. It cannot be, and the reason is arithmetic:
> interpolating the last growth row down to red-only drags expected payout below the
> break-even 2 well before 0.75 is reached (from about **fill 0.61** against the
> 2026-08-18 numbers, and from about **fill 0.23** against the current ones — the
> reweight made this failure mode worse, not better, because the steady state now sits
> closer to break-even). That would make "below 0.75 every point
> is net-positive" false across a fifth of the range and hand the board a
> self-stabilizing region — the exact economy § 3 exists to reject — while the HUD's
> "red only" badge stayed dark at 0.73 on a board already rolling ~80% red.
>
> Between the last growth anchor and 0.75 the distribution therefore **holds**, then
> steps. `src/__tests__/hydraSpawnTable.test.ts` pins both signs (net-positive
> throughout the growth zone, below break-even inside the squeeze), so a tuning pass can move
> every number freely without being able to reintroduce this by accident.

**Yellow's share (30%) — everywhere except the blue-only opening — is held above what
an economy-only tuning would pick, and it is held in *all* modes** — not only inside a Study Challenge. Challenge words
ride the yellow slot (§ 7.5), and free-play Hydra must roll the same table as
challenge Hydra or players would be practicing a different game from the one they
compete in.

### 3.2 What the table controls

The table decides the **category rolled for a spawn slot**. It does not decide
zh-vs-en side (§ 4.2) and it does not override the match guarantee (§ 4.3).

---

## 4. The spawn algorithm

Run after every correct match, with a slot budget `k` = the cleared pair's payout
(1–4).

### 4.1 Order of operations

1. **Spend `k − 1` slots by the ratio rule** (§ 4.2). Roll a category per slot from
   the § 3.1 table; when the roll can be placed as a **matched pair** (the Chinese
   word and its own English gloss, both new to the board), prefer that over a stray.
2. **Check for a live match.** A *live match* is a Chinese bubble whose exact partner
   English bubble is also on the board.
3. **The last slot** goes to the ratio rule if a live match already exists, and is
   **forced to create one** if it does not — normally by completing an existing stray
   with its partner.

Worked cases:

| `k` | Color cleared | Behavior |
|---|---|---|
| 3 | blue | 2 slots by ratio (preferring a pair), 1 slot by ratio or forced completion |
| 2 | green | 1 slot by ratio, 1 slot by ratio or forced completion |
| 1 | yellow | 0 slots by ratio; the single slot is by ratio, or a forced completion |
| 0 | red | no slots — unless the anti-zero guarantee fires (§ 4.3) |

### 4.2 The ratio rule

The board targets **50% Chinese / 50% English**, and on an odd total it carries **one
extra English** bubble. The rule is evaluated against the **post-spawn totals**, not
against the trio being spawned.

### 4.2b Stray colors are BALANCED, not rolled

A slot that introduces a new card does not roll its color independently. It picks
whichever color is furthest **below** the § 3.1 target mix for the board's current
size — closing the gap rather than sampling.

An independent roll is correct on average, but the player does not experience the
average; they experience the board in front of them right now. Five independent rolls
at the steady-state mix land all-blue often enough to matter, and a board with no red
on it offers the player no way to shrink it — the one move § 3 says the game is about.
Balancing makes availability *predictable*: whatever is scarcest is what comes next.

**It does not move the economy**, and that is the point of targeting the table rather
than a flat 25% each. Uniform colors would average `(1+2+3+4)/4 = 2.5` payout against
2 bubbles removed per match — a mix nobody tuned, growing the board 10× faster than the
+0.25 § 3.1 asks for. Targeting the table only reduces variance around it;
`E[payout]` stays 2.25.

Deficits are counted in **absolute cards**, not proportionally, which is what makes
the long-run frequencies match the weights. An **empty board** has no mix to balance
and falls back to a plain roll — which is also what keeps the blue-only opening intact.

> The test that matters here asserts the **board's** composition converges on the
> table, not the **spawn frequency**. Those are different claims, and only the first
> survives a real player: they clear colors selectively, so the balancer keeps
> replacing whatever they drain and spawn frequencies drift by design. That drift is
> the feature — availability holds up under any play style.

### 4.2c Stray aging — old bubbles buy their way to a partner

Every card on the board accrues **shares** for each spawn round it spends as a stray
(one half showing). A slot that would introduce a new card instead runs a small
lottery: `NEW_CARD_SHARES` (6) for "something new", against the accumulated shares of
every waiting stray. The longer a bubble has been stranded, the likelier it is to
finally get its partner.

Nothing previously guaranteed a stray would **ever** be completed — `complete` was
only reachable through `forceLiveMatch`, i.e. when the board had no live match at all.
A board could therefore silt up with orphans the player could never act on: the fill
ratio climbs toward the loss line while the number of things they can actually match
stays flat. That is a bad way to lose, because it is not a decision the player made.

The mechanism is **self-limiting**, so it needs no cap: shares SUM across strays, so a
board carrying many old orphans overwhelms the new-card option and spends nearly every
slot clearing the backlog, while a single fresh stray barely shifts the odds. A stray
created this round has zero shares and is never completed immediately, so the board can
still build up something for the player to work toward.

**It does not touch the economy.** A `complete` costs the same one slot and puts the
same one bubble on the board as a `newStray`; only *which* bubble differs. A test pins
that a payout buys the same number of bubbles whether the board is full of aged strays
or fresh ones.

`NEW_CARD_SHARES` is the half-life knob: at 6, a stray that has waited 6 rounds is as
likely to be completed as a new card is to spawn. The round counter lives on the stage
(`HydraPair.strayRounds`) rather than in the planner, because a "round" is a spawn
batch and the planner is pure — it sees one board snapshot and has no notion of time.

### 4.3 The invariants

Two guarantees, in priority order:

1. **Anti-zero (highest priority).** The board must never be able to run down to
   nothing, and must never dead-end with no valid match. This guarantee **overrides
   the red-only wall** — if honoring it requires spawning a green or blue pair while
   the board is at or above 0.75 fill, that is allowed. Its whole purpose is to stop
   the board reaching 0.

   It is **purely reactive** (Q7, resolved): it fires only when a spawn would
   otherwise leave the board with no live match. There is **no floor count** below
   which the board is topped up regardless — a floor would quietly re-stabilize the
   economy at the low end, and player control of board size is the whole point of
   § 3.
2. **A live match always exists.** Enforced by step 3 of § 4.1.

### 4.4 No duplicate cards

A given card contributes **at most one Chinese bubble and one English bubble** to the
board at a time. This makes "live match" unambiguous and guarantees a drag has exactly
one correct target.

---

## 5. Colors vs mastery — deliberately disjoint

**The color guarantees the payout.** Which *system* assigns the color is an
implementation detail the game owns:

| Card | Color source |
|---|---|
| Library card (has mark history) | its real **recognition** category, i.e. the `gameCategory` stamp already returned by `getGameVocabPool` (`server/services/OnDeckVocabService.ts`) |
| **Provisional / lent** card | its assigned **difficulty tier** (§ 6.2), *not* its real category — and it keeps that tier for as long as it is lent, even after it has marks (docs/PROVISIONAL_CARDS.md § 3c) |

A freshly minted card has no `typedMarkHistory`, so its real recognition category is
Unfamiliar. Coloring lent cards red would make every one of them pay 0 and collapse
the board for exactly the learners who have the smallest libraries — which is the
population most likely to be playing on lent cards. So for lent cards the color
comes from difficulty instead of from mastery, and the two systems are allowed to
disagree.

### 5.1 Grey is reserved for English

English bubbles are grey, so Hydra cannot also use grey to mean "held". Bubble Match
renders held/hovered bubbles as *enlarged + greyed* (`BubbleStatus`,
`src/games/bubble-match/types.ts`); Hydra replaces the grey half of that cue with an
**outline ring**, keeping the scale-up (Q5, resolved). Color then means exactly one
thing on a Hydra board — payout tier, or English — and the interaction cue stays
visible on a grey bubble, where a grey-on-grey tint would vanish. Bubble Match's own
held state is **not** changed; the divergence is Hydra-local.

---

## 6. Card supply

An endless run needs a rolling supply, unlike Bubble Match's fixed 20 pairs.

### 6.1 The rolling supply, and why it is unusual

Every other game rolls its board once. Hydra fetches **every spawn** as a partial refill
(`need=N&exclude=…&avoid=…`), which is the same call shape Bubble Match's *Play Again*
uses — and that call shape used to skip lending entirely. Hydra **opts out of that
exemption**: a game whose whole supply model is the refill must be able to lend on a
refill, or with no baseline at all (§ 6.5) it could never lend at any point in a run.
See docs/PROVISIONAL_CARDS.md § 4.

**Built (2026-08-18).** Hydra declares out by naming itself in `ROLLING_SUPPLY_SURFACES`
(`server/contracts/wire.ts`) and sending `?surface=hydra-bubbles`;
`OnDeckVocabController.getGamePool` turns that into `lendOnRefill`, and
`OnDeckVocabService.getGameVocabPool` widens its fill-tier-2 lend guard accordingly. The
companion param `?lendLevel=1..6` pins the tier (§ 6.2) and reaches
`ProvisionalCardService.lendCards` as `targetLevel`.

### 6.2 Cooldown first, then lend by tier

The per-type cooldown is honored **as far as the supply allows**. Serving a card the
learner cannot be marked on is the last thing we do, not the first — see § 8, which
makes an unmarkable card a genuinely wasted play.

**When a rolled color has no uncooled card behind it, lend one at that color's
difficulty tier.** The tier is derived from the learner's estimated level `L`
(`StarterPacksService.estimateLevel`):

```
L = the learner's estimated level (1..6)

red    = L
yellow = L - 1
green  = L - 2
blue   = L - 3
```

Floored: when `L <= 4` the mapping collapses to the fixed

```
blue = 1,  green = 2,  yellow = 3,  red = 4
```

which is the same thing the general formula produces at `L = 4`. A learner at level 6
therefore plays blue = level 3 through red = level 6.

**Last fallback:** when a tier's own level is exhausted, pull from **the next level up**.

Levels are 1..6 for every language (`StarterPacksService`, `de."difficulty" BETWEEN 1
AND 6`); the zh-facing label is "HSK n" and other languages read "Level n"
(`src/features/discover/SortCardsPage.tsx`).

Two app-wide rules this leans on, both written up in docs/PROVISIONAL_CARDS.md:

* **Re-lend before minting (§ 3b).** A tier-targeted draw first looks at provisional
  cards the learner already holds at that tier and that are off cooldown, and mints a
  new row only for what that cannot cover. The cooldown is never broken to re-lend.
  Hydra is not merely the heaviest user of this — it is the **only** one, and that is
  structural rather than incidental: no ordinary pool query selects by difficulty, so a
  held provisional card is always already reachable at fill tier 1 or 3 for every other
  caller. Re-lend is therefore scoped to the tier-targeted draw and does **not** attach
  to `lendCards`, whose contract is "mint N more playable rows" and which
  `ensureBaseline` depends on meaning exactly that.
* **A lent card keeps its tier while lent (§ 3c).** A card lent as green stays green
  for the rest of the time it is provisional, even once it has accumulated marks and
  its real utcm category says otherwise. Payouts stay stable within and across runs,
  which is what § 3's economy assumes. The tier is derived from the det row's existing
  `difficulty` against `L` — **no new column, no new table**.

### 6.2b The four color pools

The client keeps **four buffers, one per color**, prefilled from the pool fetch. A
spawn that rolls green pops from the green buffer; a background fetch tops that buffer
back up asynchronously, so in the normal case a spawn never waits on the network.

This is what makes the color system tractable on the client: the game never has to ask
"what color is this card?" at spawn time, because the card was already drawn from the
buffer of the color it is. Provisional cards enter the buffer their tier names
(§ 6.2); library cards enter the buffer their real `gameCategory` names (§ 5).

Buffers are **client-side only** — no new table, no persisted server state.

#### A dry buffer is WAITED ON, never substituted (corrected 2026-08-18)

`draw` is **async**. When the rolled color has no stock it kicks (or joins) that
color's refill and **awaits** it, then pops. The spawn arrives a beat late, which on a
clockless game costs the player nothing — whereas a substituted color misstates what
the match will pay, which is the one thing § 2's contract cannot survive.

> ⚠️ This section previously said the roll "falls through to the next color that has
> stock", and the implementation iterated `HYDRA_COLORS` in **ascending** order. Since
> that array runs red → yellow → green → blue, a dry **blue** buffer produced a **red**
> bubble: the game's best-paying slot silently became its worst-paying one, and the
> economy inverted exactly when supply was tightest. It was reported from live play as
> "a red card on the opening board" and is the reason the whole supply path was
> re-examined. Blue is the color most likely to be dry (§ 6.2c), so this was not a
> rare edge — it was the common case.

A last-resort fall-through does remain, reached only after the await has already
failed (the request errored, or the server has none of that color at all). It walks
**outward from the rolled color** — blue → green → yellow → red — so the payout error
is as small as it can be, and it exists only because a stalled board is worse than an
occasionally mis-priced one. The anti-zero guarantee (§ 4.3) is the floor beneath all
of it.

#### Every async spawn path must be cancellable

Making `draw` await turned two previously-synchronous paths — the opening seed and
each spawn batch — into suspension points, and both needed a guard that a synchronous
version did not:

* **The opening seed** is cancelled by the stage's mount-effect cleanup. React
  StrictMode double-invokes mount effects, so run 1 was still awaiting its first card
  when run 2 reset the board and seeded again; run 1's await then resolved and placed
  its bubbles into the fresh board. **The board opened with exactly double the bubbles
  — 2 Chinese + 4 English instead of 1 + 2.** The same window is reachable outside dev,
  because the stage is remounted on `runId` for Play Again.
* **Each spawn batch** re-checks the run phase before every slot. A run can end
  mid-batch (overflow detected in the rAF loop) and the remaining bubbles would land
  on a board that is already frozen and scored.

The rule for anything added here later: **after every `await`, the board you are about
to touch may no longer be the board you started on.**

#### 6.2c Why blue is the color that runs dry

Blue asks for `?Mastered=N`, and a learner's Mastered cards are the ones **least**
likely to be servable: the recognition cooldown for a Mastered card is **180 days**, so
one correct answer removes a card from the blue pool for half a year. A real dev
account was measured at **48 Mastered cards, 0 of them off cooldown**. Blue is also the
most-rolled color (100% at fill 0, 40–50% through the growth zone).

This is why blue's supply is the load-bearing part of the whole design, and why § 6.2d
exists.

#### 6.2d A single-bucket request never gets another bucket's cards

Hydra is the only caller that asks the game pool for **one category at a time**
(`?Mastered=4`), and that request is not a difficulty *preference* — it is a question
whose answer is the category itself. `getGameVocabPool`'s fill tiers were built for
multi-bucket callers, where topping a short quota up from a neighbouring bucket is the
best-effort fill those callers want. For a single-bucket caller the same behavior
returns cards of the wrong category, which Hydra then files into the requested color's
buffer and **pays the player for at the wrong rate**.

> ⚠️ Measured on a dev account: a `?Mastered=4` request was answered with Target and
> Unfamiliar cards, every one of them subsequently played and paid as **blue (3
> spawns)**. Combined with the fall-through bug above, the color channel was
> mispricing in both directions at once.

So the fill order **collapses to the requested bucket alone** when the distribution
names exactly one category:

| tier | multi-bucket caller (every other game) | single-bucket caller (Hydra) |
|---|---|---|
| 1 | fresh, requested buckets | fresh, requested bucket |
| 2 | lend (if allowed), capped by what tier 3 still holds | lend (if allowed) — tier-colored per § 6.2, uncapped in practice: tier 3 is skipped, so there is nothing to subtract |
| 3 | fresh, **fallback buckets** | *skipped* |
| 4 | cooling, requested then fallback | **cooling, requested bucket** |
| 5 | avoided, requested then fallback | avoided, requested bucket |

Tier 4 is the one that matters here, and it **deliberately breaks the per-type
cooldown**: a genuinely Mastered card that is merely resting is a *truthful* blue
bubble, whereas a minted HSK-1 word colored blue by its lend tier is not. The
consequence is accepted rather than worked around — a mark on a still-cooling card is
dropped by the § 8 guard, so those cards are **playable but do not advance mastery**.
That is what the cooldown is *for*: re-answering a Mastered card inside its window
should earn nothing. Blue is play, not progress.

A single-bucket request would rather come back **short** — the client waits (§ 6.2b) or
skips the slot — than come back **wrong**.

### 6.3 Collection- and deck-restricted runs

When the run is restricted (`?deck=` / `?collection=`), **do not lend** and **do not
honor cooldown**. The set the learner chose is the set they play. Marks earned on
those cooled cards do not count — see § 8.

### 6.4 What the learner sees

* **First time lending fires mid-run:** one popup saying we have started lending
  words, with a single "Got it" dismissal. **No table of words** — this is a
  notification, not a review step. It fires **once per run**, and it **freezes the
  board** while it is up (Q6, resolved) — not to protect a clock, which Hydra does
  not have, but because a modal over a live drag either eats the pointer or strands a
  half-finished match underneath it. Freezing also lets Hydra reuse the same notice
  component as every other game.
* **End of run:** the standard `ProvisionalSortOffer`
  (`src/components/ProvisionalSortOffer.tsx`, sequenced by
  `useProvisionalSortOffer`), listing every lent card actually used, opening over the
  score card as soon as the run ends (no delay).

### 6.5 There is no card minimum

Hydra declares **no baseline at all** (Q4, resolved) — it is absent from
`CARD_BASELINES` rather than present with a 0, following the precedent Memory Map
already set (`server/contracts/wire.ts`). Absent and zero behave identically at the
controller (`parseSurface` returns null and the top-up branch no-ops either way), but
absent is the honest statement: there is no floor to top up to. A run may lend from the very
first bubble; there is no library size at which the hub row is gated or a pre-round
notice appears. This is the cleanest expression of the provisional-cards rule that no
game blocks on card count (docs/PROVISIONAL_CARDS.md) — Hydra simply never had a
minimum to convert into a baseline.

There is **no pre-round itemized notice** for Hydra. An endless run cannot know its
card set in advance, so `ProvisionalCardsNotice`'s itemized form does not apply and
Hydra is not in `CARD_BASELINE_ITEMIZED` (`server/contracts/wire.ts`).

---

## 7. Losing, scoring, and the end of a run

### 7.1 Two loss conditions

1. **A wrong match.** Immediate, no confirmation, no dwell-to-arm. Fat-fingering is
   part of the game; the matching interaction is Bubble Match's, unchanged — with the
   one deliberate escape hatch in § 7.1b.
2. **Overflow.** Reuses Bubble Match's fill-ratio loss — `LOSE_FILL_RATIO` 0.94 with
   the danger vignette from `DANGER_FILL_RATIO` 0.72 — but with **no descending
   ceiling**. The play area is fixed; the field only fills from spawns.

### 7.1b The cancel strip

A **96 px safe-release strip** across the bottom of the stage (`CANCEL_ZONE_HEIGHT`,
shared with Bubble Match). Releasing a held bubble over it **abandons the match**: no
mark, no shake, no run end. A **correct** match dropped there still counts, so the
strip can never cost the player a match they had already earned.

An earlier draft of this doc argued Hydra should NOT have one, on the grounds that
§ 7.1 makes fat-fingering part of the game and a drop on empty space is already a
harmless no-op. That reasoning does not survive a full board. Hydra plays up to
`LOSE_FILL_RATIO` 0.94, and near that line **there is no empty space left to drop
onto** — every release lands on some bubble, and a release onto the wrong bubble ends
the run. Without the strip, backing out of a drag becomes impossible exactly when the
stakes are highest and the player most needs it. The strip restores an escape that a
sparse board has for free.

It is not a softening of the wrong-match rule: a wrong match on the field is still
instant death. The strip only makes "I have changed my mind" expressible.

**The strip is carved OUT of the play area**, matching Bubble Match: its top edge is
the play-area floor, so nothing spawns into it (`planSpawn`), settled bubbles are
walled out of it (`stepPhysics`), and it is excluded from the fill ratio — which
keeps § 3.1's spawn table and the overflow loss reading the same number. Only the
held bubble may enter it, and the wall clamp lifts it back out on release.

> ⚠️ **This shrinks the play area by 96 px, so a given board is now "fuller".** The
> fill ratio is area-relative, so the danger vignette (0.72), the red-only squeeze
> (0.75) and the loss line (0.94) all arrive after fewer bubbles than before on the
> same screen. That is consistent with Bubble Match and is the intended trade, but it
> is a real change to the § 3.1 tuning surface and belongs in the § 11 O1 tuning pass.

### 7.1c No background pause

Hydra deliberately **opts out** of the app-wide rule that backgrounding pauses a game
(docs/GAMES_FEATURE.md § "Backgrounding pauses the clock"). That rule protects a
CLOCK — it exists so a round cannot run down while nobody is watching. Hydra has no
clock and nothing that advances on its own: bubbles do not drift
(`stepPhysics(..., { drift: false })`), there is no descending ceiling, and the board
changes only in response to a match. Backgrounding therefore costs the player nothing,
and a tap-to-resume overlay on return is pure friction over a board that is exactly as
they left it.

The field still freezes for an **input-blocking modal** (§ 6.4) — that is about the
pointer and a half-finished drag, not about time.

> ⚠️ **This reverses with challenge mode.** A challenge round is scored on time to
> clear (§ 7.5), which makes that variant genuinely timed and puts it back under the
> rule. Re-add `useBackgroundPause(challenge && phase === "playing")` and
> `GamePausedOverlay` when the challenge flow is wired to this page — and heed the
> hook's own warning that the pause is only real if elapsed time is accumulated ACTIVE
> time rather than `now − startedAt`.

### 7.2 Score

Score = **bubbles cleared**, +2 per match. **Session-only** — nothing is persisted,
no new table, no `wins` row. A personal best can be added later once the tuning has
settled.

### 7.3 End popup

Bubble Match's shape: a score card ("You cleared 142 bubbles") with **Play Again**
primary over **Back to Games** secondary, **minimizable to a corner puck**. Play
Again starts a wholly fresh board.

### 7.4 Marks

* Correct match → **positive recognition mark** on the cleared card.
* The fatal wrong match → **negative recognition mark** on the card that was dragged.

Both subject to § 8.

### 7.5 Study Challenge mode

Hydra **is** challenge-eligible (Q3, resolved), but a challenge run is scored on a
different axis from a free-play run, because an endless run has no comparable length.

| Aspect | Free play | Challenge |
|---|---|---|
| Score | bubbles cleared | **time to match all 10 challenge words** |
| Run ends | wrong match, or overflow | **the last challenge word is matched** |
| Spawn table | § 3.1 | § 3.1, unchanged |

Rules:

* **Challenge words are always yellow.** Their payout is yellow's (2 since the
  2026-08-19 ladder, § 2) regardless of the
  learner's real mastery of them — the same color/mastery disjunction § 5 already
  allows for lent cards.
* **Only a yellow roll can place a challenge word.** When the table rolls yellow and
  an unspawned challenge word remains, that word takes the slot; otherwise the slot
  takes a filler yellow. Rolls of blue, green or red never place challenge words.
  This is why yellow's share is raised in § 3.1 rather than reweighted per mode.
* **The run ends the moment the tenth challenge word is cleared**, and the timer stops
  there. Filler bubbles still on the board are irrelevant, and overflow after that
  point cannot happen because the run is already over.
* **A wrong match still ends the run**, early and without score for what is left:
  challenge words already matched are banked, unmatched ones score **zero**. A player
  who cleared 8 of 10 therefore outranks one who cleared 3, which speed alone could
  not express.

Open for the `ChallengeScoringSpec` itself (`CHALLENGE_GAMES`,
`server/contracts/wire.ts`): the exact contested/filler numbers, and how a partial
run's time is compared against a complete one. See docs/STUDY_CHALLENGE.md § 5.4.

---

## 8. App-wide rule change: cooldown means "next markable at"

**Agreed in this pass and NOT specific to Hydra.**

> A mark on a card whose cooldown has not expired is **not recorded**.

Enforcement is **server-side, at `POST /api/flashcards/mark`**. The endpoint checks
the card's own cooldown and no-ops when it has not expired, returning success. Every
present and future surface inherits the rule without having to know it exists, which
is the point.

> ⚠️ **Corrected on implementation (2026-08-18): this DID need a wire change.** The
> section originally promised "no wire change, no client flag". Two things made that
> impossible, and both are contract-level rather than cosmetic:
>
> * **`markTimestamp` is the undo key.** `markFlashcard` (`src/api/flashcards.ts`)
>   THROWS when the response carries no timestamp, and the flp working loop treats a
>   throw as a retryable save failure. A silently-suppressed mark would therefore have
>   surfaced to the learner as **"Failed to save progress."** on a perfectly healthy
>   app. The response now carries `suppressed: true` with a null `markTimestamp`, and
>   the loop leaves its state untouched instead of offering an undo for a mark that
>   was never written.
> * **§ 8.1 needs to know WHICH surface served the card**, and only the client knows
>   that. The request gained an optional `surface` string, sent by every call site.
>   Nothing branches on it — it exists purely so the suppressed-mark log can tell
>   fill-tier-4 suppression (the collision we are measuring) apart from deck/collection
>   suppression (§ 6.3, intended). Without it the log is one undifferentiated count
>   and answers nothing, which would have defeated the whole reason for shipping the
>   guard instrumented.
>
> The spirit of the original decision survives: enforcement is still a single
> server-side chokepoint, no surface opts in or out, and no game changes behavior.

Downstream of a suppressed mark:

* the game **still scores** the clear (Hydra +2), and Hydra does not react to the
  flag at all;
* minute points are unaffected (they accrue by time);
* nothing else changes.

The cooldown stops being an advisory scheduling hint and becomes a hard
**"next markable at"** timestamp.

### 8.1 Known consequence: tier-4 marks stop counting (accepted, instrumented)

`getGameVocabPool` (`server/services/OnDeckVocabService.ts`) fills a game board in
five tiers: (1) fresh cards from the requested buckets, (2) **lend**, (3) fresh cards
from the fallback buckets, (4) **cooled cards**, (5) avoided cards. Tier 4 fires on
*ordinary* runs — no deck, no collection — whenever tiers 1–3 cannot fill the board,
which is the small-library learner playing two rounds back to back. Those marks are
recorded today; under this guard they silently stop being recorded.

**Resolved: ship the guard as designed, and log every suppressed mark server-side.**
*(Built. The log line is `[MarkSuppressed]` in `server/routes/flashcardRoutes.ts`.)*
Tier 4 stays. The frequency of the collision is unknown, and the alternatives (delete
tier 4 and lend instead; or scope the guard by serving context, which needs the wire
flag the single-chokepoint design rules out) both trade a known cost for an unmeasured
one. The log tells us which, if either, is worth paying.

What the log carries: user (truncated), card id, language, mark type, the cooldown
window that was in force, the serving surface, and whether the mark was positive — so
a follow-up can tell tier-4 suppression apart from deck/collection suppression
(§ 6.3), which is intended. Tracked in docs/DEFERRED_WORK.md.

⚠️ Until that follow-up happens, a small-library learner can play a full round and see
no movement in their history, with no error and nothing visibly different in the UI.

---

## 9. Plumbing

| Concern | Decision |
|---|---|
| Route | `/games/hydra-bubbles`, leaf page (derived automatically by `GAME_ROUTE_META`, `src/routes/routeMeta.ts`) |
| Registry | one `GameDef` in `src/games/registry.ts` — `gameId: "hydra-bubbles"`, `title: "Hydra Bubbles"`, `markType: "recognition"` |
| Levels | **none** — single mode, one hub row. Board size is the difficulty curve. |
| Minute points | eligible; `/games/hydra-bubbles` joins `MINUTE_POINTS_ELIGIBLE_PAGES` and the start-on-entry subset (`src/constants.ts`); fire badge in the header |
| Collection selector | honored (`?deck=` / `?collection=`) on **every** pool fetch including mid-run top-ups |
| Study Challenge | **in the pool** as a recognition game, scored on time-to-clear the challenge words (§ 7.5); needs a `ChallengeScoringSpec` in `CHALLENGE_GAMES` (`server/contracts/wire.ts`) |
| Languages | **no `languages` gate** — offered for Spanish as for Chinese, matching Bubble Match. Levels 1..6 exist for every language and nothing in the payout or spawn logic is zh-specific |
| Header controls | pinyin show/hide toggle + TTS autoplay on pickup / drop-onto a Chinese bubble, as Bubble Match |
| `CARD_BASELINES` | **0** — no minimum; a run may lend from the first bubble (§ 6.5) |

---

## 10. Code layout

Bubble Match is ~1200 lines of drag, physics and render that Hydra would otherwise
duplicate. The agreed approach is **extraction, not a fork**:

As built:

```
src/games/bubbles/          <- shared module, extracted from bubble-match
    types.ts                (BubbleBody, BubbleStatus, BubbleFill)
    constants.ts            (sizing, drift, spawn, fill/loss, feedback palette)
    physics.ts              (stepPhysics, planSpawn, fillRatio — Hydra's spawn
                             table reads the same fill ratio the loss condition
                             does, see § 3.1)
    bodyFactory.ts          (makePair, launchBody, per-kind radii)
    Bubble.tsx              (one bubble; outer node = transform, inner = CSS anim.
                             Takes `fill` and `heldCue` so each game supplies its
                             own base palette and pickup cue)
src/games/bubble-match/     <- converted to import from bubbles/; keeps its level
                               table, kind-keyed palette, ceiling and spawnSelection
src/games/hydra-bubbles/    <- imports from bubbles/
    HydraBubblesPage.tsx    (run state machine)
    HydraStage.tsx          (the field)
    HydraLendNotice.tsx     (§ 6.4)
    useColorBuffers.ts      (§ 6.2b)
    spawnTable.ts           (§ 3.1 fill-ratio anchors + interpolation + the step)
    spawnPlanner.ts         (§ 4 algorithm + invariants)
    constants.ts
    types.ts
```

`useBubbleDrag.ts` was planned here and deliberately not built — see § 12.

Accepted risk: converting Bubble Match to the shared module can regress a shipped
game. The extraction landed as its own change, with
`src/__tests__/bubbleMatchSpawn.test.ts` still passing, **before** any Hydra code was
written — and it was behavior-preserving for Bubble Match by construction: it kept its
grey `heldCue="dim"` and its kind-keyed palette, which now live in
`src/games/bubble-match/constants.ts` rather than in the shared module.

Hydra keeps its own stage rather than adopting Bubble Match's: no launcher, no
ceiling, no drift integration, and a spawn planner Bubble Match has no concept of.
What is genuinely shared is the bubble itself, the placement/separation math, and the
drag interaction.

---

## 11. Open questions

Q1–Q8 were resolved on 2026-08-18. What they decided is recorded in the section that
owns each decision (linked below); this section now carries only what is still open.

### Resolved 2026-08-18 (second pass — the lending model)

| Question | Resolution | Lives in |
|---|---|---|
| Hydra's every fetch is a partial refill, and partial refills never lend | The exemption becomes **per game**; Hydra opts out and lends on refills | § 6.1, PROVISIONAL_CARDS.md § 4 |
| Lending cannot be aimed at a difficulty level | `lendCards` takes a **tier**; the HSK model picks the word for the rolled color | § 6.2 |
| Lending always mints a new row, so a long run inflates the holding forever | **Re-lend before minting**, app-wide, never breaking cooldown | PROVISIONAL_CARDS.md § 3b |
| A lent card's color would flip once it earned marks | A lent card **keeps its tier** until it is sorted; derived from det `difficulty`, no new column | PROVISIONAL_CARDS.md § 3c |
| The client cannot tell what color a lent card is | Four **client-side color buffers**, drawn from at spawn, topped up async | § 6.2b |

### Still open

**O1 — The § 3.1 numbers are a tuning, not a measurement.** The steady-state row
holds `E[payout]` at 2.25, so the board creeps upward by 0.25 bubbles per match — about
one extra bubble every four matches. Whether that *feels* like a slow squeeze or an
unwinnable flood is not knowable on paper. With the table simplified to two growth
anchors there are only four knobs left, which is the point: the **steady-state mix**,
the **0.10 ramp end**, the **0.75 red-only floor**, and the 0.94 loss line.

**O2 — `ChallengeScoringSpec` numbers.** § 7.5 fixes the *shape* of challenge scoring
(time to clear the 10 challenge words, zero for unmatched). The contested/filler point
values, and how a partial run's time compares against a complete one, still need to be
written into `CHALLENGE_GAMES` (`server/contracts/wire.ts`) against
docs/STUDY_CHALLENGE.md § 5.4.

**O3 — Suppressed-mark logging (§ 8.1).** The guard ships with tier 4 intact and a
server-side log of every dropped mark. Somebody has to read that log and decide
whether tier 4 should be deleted in favor of lending. Until then, small-library
learners can lose marks invisibly. This belongs in docs/DEFERRED_WORK.md once the
guard is actually built.

### Resolved

| # | Question | Resolution | Lives in |
|---|---|---|---|
| Q1 | The mark guard silently kills tier-4 marks that count today | Ship the guard, keep tier 4, log suppressed marks and revisit | § 8.1 |
| Q2 | The `34` count cliff vs the area-keyed overflow loss | Re-key the whole spawn table on **fill ratio**, so both systems read one number | § 3.1 |
| Q3 | Hydra's challenge scoring, given no fixed round count | Challenge words are yellow-only; score = time to clear all 10; wrong match ends the run and banks what was matched | § 7.5 |
| Q3c | Yellow's share is too small to deliver 10 challenge words | Raise yellow to 25–30% **in all modes**, so free play and challenge roll one table | § 3.1 |
| Q4 | `CARD_BASELINES` value | **0** — no minimum, lend from the first bubble | § 6.5 |
| Q5 | Grey English bubbles vs the grey held/hovered state | Hydra's held cue becomes an outline ring + scale, no grey; Bubble Match unchanged | § 5.1 |
| Q6 | Does the mid-run lend popup freeze the board? | Yes — a modal over a live drag is the hazard, not the clock | § 6.4 |
| Q7 | Anti-zero: reactive or a floor count? | Purely reactive; no floor, because a floor re-stabilizes the economy | § 4.3 |
| Q8 | Spanish, or zh-only? | Both — no `languages` gate | § 9 |

---

## 12. Dependencies

### Docs this one depends on / must be kept in step with

| Doc | Relationship |
|---|---|
| [GAMES_FEATURE.md](./GAMES_FEATURE.md) | needs a Hydra row in the shipped-games list and a `## Game: Hydra Bubbles` section once built |
| [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) | **updated 2026-08-18** — its § 3b (re-lend before minting, scoped to the tier-targeted draw), § 3c (a lent card keeps its tier) and § 4 (`targetLevel`; partial refills provision per-game) were all written for Hydra's § 6; § 4's half is built, § 3b's is not. Its § 5 table still needs a Hydra row for the mid-run notice |
| [MASTERY_REWORK.md](./MASTERY_REWORK.md) | § 8 changes what a cooldown means app-wide; § 5 makes color and mastery deliberately disjoint |
| [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) | § 9 adds a recognition game to the challenge pool (Q3) |
| [HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md) | single hub row, no array item (no levels) |
| [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) | leaf-page chrome, `useBlockEdgeSwipe(true)` |
| [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) | English bubbles show the dd via `resolveDisplayDefinition`, as Bubble Match |

### Code this doc describes

| Concern | Symbol |
|---|---|
| **Shared bubble substrate** (extracted from Bubble Match first, as § 10 required) | |
| domain types | `src/games/bubbles/types.ts` → `BubbleBody`, `BubbleStatus`, `BubbleFill` |
| field constants | `src/games/bubbles/constants.ts` → sizing, drift, spawn, `LOSE_FILL_RATIO`, feedback palette |
| simulation | `src/games/bubbles/physics.ts` → `stepPhysics` (with `StepOptions.drift`), `planSpawn`, `fillRatio` |
| body construction | `src/games/bubbles/bodyFactory.ts` → `makePair`, `launchBody`, `wordRadius`, `definitionRadius` |
| bubble render | `src/games/bubbles/Bubble.tsx` — takes `fill` (§ 5) and `heldCue` (§ 5.1) |
| **Hydra** | |
| spawn distribution (§ 3) | `src/games/hydra-bubbles/spawnTable.ts` → `rollColor`, `HYDRA_SPAWN_ANCHORS`, `RED_ONLY_WEIGHTS`, `expectedPayoutAt` |
| spawn algorithm + invariants (§ 4) | `src/games/hydra-bubbles/spawnPlanner.ts` → `planSpawnBatch`, `hasLiveMatch`, `nextKindByRatio` |
| color buffers (§ 6.2b) | `src/games/hydra-bubbles/useColorBuffers.ts` → `useColorBuffers` |
| tier offsets (§ 6.2) | `src/games/hydra-bubbles/constants.ts` → `TIER_OFFSET_BY_COLOR` |
| the field | `src/games/hydra-bubbles/HydraStage.tsx` |
| page shell | `src/games/hydra-bubbles/HydraBubblesPage.tsx` |
| mid-run notice (§ 6.4) | `src/games/hydra-bubbles/HydraLendNotice.tsx` |
| registry + hub row | `src/games/registry.ts` → `GAME_REGISTRY`; `COLORS.tealAccent` (`src/theme/colors.ts`) |
| minute points (§ 9) | `src/constants.ts` → `MINUTE_POINTS_ELIGIBLE_PAGES` |
| challenge spec (§ 7.5) | `server/contracts/wire.ts` → `CHALLENGE_GAMES` |
| **Server** | |
| refill lending opt-out (§ 6.1) | `server/contracts/wire.ts` → `ROLLING_SUPPLY_SURFACES`, `isRollingSupplySurface`; `OnDeckVocabService.getGameVocabPool` → `lendOnRefill` |
| tier resolution (§ 6.2) | `ProvisionalCardService.resolveLendLevel`; `?lendLevelOffset=` on the pool endpoint |
| re-lend before minting | `OnDeckVocabService.fetchRelendable`, called from `lendGameCandidates` |
| cooldown mark guard (§ 8) | `server/routes/flashcardRoutes.ts` → the `[MarkSuppressed]` branch |
| **Tests** | |
| economy signs | `src/__tests__/hydraSpawnTable.test.ts` |
| spawn invariants | `src/__tests__/hydraSpawnPlanner.test.ts` |

### Deliberately not done

* **`src/games/bubbles/useBubbleDrag.ts`** (listed in § 10). Hydra's drag lives inside
  `HydraStage`; Bubble Match's is longer and carries cleanup mode and the green
  partner reveal, which Hydra has no equivalent of. Unifying them today would produce
  a hook with several Bubble-Match-shaped flags, which is worse than two honest
  implementations.

  The case for extraction is now **stronger than it was**: both games carry a cancel
  strip (§ 7.1b), so the bottom-unclamped drag, the overlap predicate and the
  tint-on-hover state are duplicated between them verbatim. If a third bubble game
  appears, or the strip's behavior needs to change, extract at least that much.

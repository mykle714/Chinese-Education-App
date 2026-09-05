# Hydra Bubbles — endless recognition drill

**Status: BUILT (2026-08-18), UNPLAYED. Reworked to TWO colors 2026-08-21; the tier
palette is now YELLOW / BLUE (2026-08-24, § 2.2).** (§ 2 —
still no migration). The game ships: `src/games/hydra-bubbles/`,
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
  source of truth beside it. Since the fill-0 row is bloom-only, the run still opens on
  a bloom pair — but because the table says so, and a retune of that row moves the
  opening with it.
* Drag a bubble onto another to match. **One wrong match ends the run**, immediately.
* A correct match clears both bubbles and spawns **1 or 3 new ones**, decided by the
  **color** of the Chinese bubble that was cleared — one step either side of the two
  it removed.
* Score = **bubbles cleared** (+2 per match).

Where Bubble Match's tension is a shrinking play area against a fixed pool, Hydra's
tension is a board that **grows on its own** and can only be held back by taking
riskier matches. See § 3.

---

## 2. The payout ladder

The color of a Chinese bubble is a contract with the player: it tells them exactly
what clearing it will cost or earn. English bubbles are **always grey** and carry no
color information — the color channel is reserved for payout.

| Color | Drawn from | Bubbles spawned | Bubbles cleared | **Net board Δ** |
|---|---|---|---|---|
| ⚫ drain | Unfamiliar + Target | 1 | 2 | **−1** |
| 🟡 bloom | Comfortable + Mastered | 3 | 2 | **+1** |

### 2.1 Two colors, not four (2026-08-21)

The ladder was four steps — red 1 / yellow 2 / green 3 / blue 4, one per utcm band.
It is now **two, symmetric about break-even**. What the player reads off a bubble is
no longer a rung on a scale they have to remember; it is **one bit**: does clearing
this cost me board space, or buy me some.

The two middle rungs were the ones carrying the least information. **Yellow was
break-even** — clearing it changed the board size by nothing, so it expressed no
decision at all — and **green was a weaker blue**. Cutting them loses no move the
player was actually making, and it makes the remaining choice legible at a glance
while a bubble is mid-drag, which is the only moment the color is ever read.

Each Hydra color is now a **union of two mastery bands**, which is the single most
important consequence to hold on to:

* **A color is no longer a band**, so it no longer wears the band's name in code
  (`HydraColor` is `"drain" | "bloom"`, `types.ts`) or the band's hue on screen
  (§ 2.2). Both of those used to be deliberate reuse; under a union they would
  simply be false about half the cards inside each color.
* **Supply roughly doubled per color** — the bloom-runs-dry problem in § 6.2c is
  materially better, because bloom may now be served from Comfortable as well as
  Mastered.
* **The steady-state mix had to invert.** See § 3.

### 2.2 The palette

Each bubble is a **flat body** with no ring. The ladder is **yellow / blue**
(2026-08-24) — warm is the harder tier, cool the easier one:

**Three bubbles share the field, not two.** The two payout tiers plus the **English**
bubbles, which carry no payout meaning at all. A palette that separates drain from
bloom beautifully is still broken if either of them reads as English.

| Bubble | Body | Char ink | Means |
|---|---|---|---|
| English | `#E7E7EA` inert grey (`COLORS.grey`) | dark | nothing — scenery |
| bloom — **light blue** | `#D2EBFF` (`COLORS.blu`) | dark | net +1, the known words |
| drain — **light yellow** | `#F5E7B4` (`COLORS.yel`) | dark | net -1, the hard words |

**All three take black text**, and that is a constraint on any replacement rather than an
accident: the two tiers are one object at two settings, and a rung whose glyphs invert to
white stops reading as *"the same thing"* and starts reading as *"a different thing"*.
`inkOnFill` derives that automatically, so a future swap cannot strand dark text on a dark
body.

Every bubble's border is its own body color: the shared `Bubble` draws a fixed 2px
border, so a same-color border is how a bubble reads as ringless without changing its
border box. `YELLOW_DRAIN` / `BLUE_LIGHT` / `DEFINITION_FILL` live in `HydraStage.tsx`.

**`COLORS.yel` and not `COLORS.org`.** `org` (hue 70) IS `CATEGORY_COLORS.Target`, and
drain is Unfamiliar + Target — a bubble wearing Target's exact fill would read as a band
label rather than as a tier. `yel` (hue 92) exists in the ramp precisely to be a gold that
is not Target's orange.

#### The channel is HUE, and the value read is gone

The three bodies all sit at the ramp's 93–94% tier, so drain-vs-bloom and drain-vs-scenery
are carried by **hue and chroma alone**:

| | drain vs bloom | drain vs scenery | bloom vs scenery |
|---|---|---|---|
| charcoal / gold | 1.22:1 | 1.33:1 | 1.09:1 |
| blue ladder, first cut (`bluA` drain) | 4.46:1 | 4.44:1 | 1.00:1 |
| blue ladder, shipped 2026-08-22 → 08-24 | 1.80:1 | 1.79:1 | 1.00:1 |
| **yellow / blue, shipped** | **1.16:1** | **1.16:1** | 1.00:1 |

⚠️ **Read that honestly: on value this is the weakest ladder the game has had**, and a
color-blind player has less to go on than they did with the blue pair, which was both
better separated and *monotonic* (darker = harder). What carries the current ladder is hue
distance — hue 92 against hue 250 is the widest warm/cool split in the ramp, a strong read
for most players and no read at all for some.

**The lever, if it needs one, is BLOOM.** Moving bloom to `COLORS.bluTint` `#EEF8FF` was
previously a trade (it closed the drain gap, since drain was also hue 250); with drain off
that axis it is now a **free move that helps both weak reads at once** — it opens a value
gap back into the ladder AND lifts bloom off the scenery grey. Its cost is a near-white
bubble on the white `.play` panel. One token, on `BLUE_LIGHT` in `HydraStage.tsx`.

#### What the yellow bought

- **Tone-3 pinyin, which § 2.2 called "the real constraint on this whole file".** Tone 3 is
  `#779BE7`, a light BLUE, and it was nearly invisible on the old hue-250 drain body
  (1.25:1). On a hue-92 yellow it separates by hue instead of competing for value, so the
  drain bubble's pinyin is legible for the first time. The table below still governs
  **bloom** and any future move back onto a blue axis.
- **Half the mastery collision.** The old drain wore the saturated end of the hue the app
  trains as "mastered" (`COLORS.blu` IS `CATEGORY_COLORS.Mastered`) while containing
  Unfamiliar + Target. Drain no longer makes that claim. Its own nearest misreading — `yel`
  sitting near Target's `org` — is half-true, since Target genuinely is half of drain.

#### Retired: the two blue rungs, and why neither survived

Kept because the constraints they were solving for are still live.

**`#79B3EE` — the shipped drain, 2026-08-22 → 2026-08-24.** Authored on the ramp's own
axis at the lightness where black text is comfortable — **oklch(75% 0.105 250)**, between
`blu` (93%) and `bluA` (52%), in oklch and shipped as hex per SHELF_REDESIGN § A1. Black
text scored 5.71:1 on it and its luminance 0.425 sat well clear of `inkOnFill`'s 0.26
pivot. It gave the ladder its only monotonic read. Replaced by request.

**`COLORS.bluA` `#1F6CB0` — the first cut.** Separated two and a half times better again
(4.46:1) and was given up because it is dark enough to need **white** glyphs, which breaks
the premise that two rungs of one hue only read as *one scale* if the ink is the same on
both. That premise no longer binds the tiers to one hue, but the black-text rule it
protected still binds any replacement.

⚠️ **Bloom and the scenery grey are the same value** (1.00:1) — `blu` and `grey` are
both the ramp's 93% tier, so bloom-vs-English is carried by chroma alone (a blue tint vs
a neutral). It is tolerable because bloom is the bubble you *want* to clear: mistaking
scenery for bloom costs a wasted look, not a wrong match. See the BLOOM lever above — with
drain off hue 250, lightening bloom now fixes this instead of costing elsewhere.

#### ⚠️ Tone-3 pinyin: retired for drain, still binding for bloom

**A word bubble renders tone-colored pinyin** (`TONE_COLORS`,
`src/utils/toneColors.ts`), and tone 3 is `#779BE7` — a light blue at roughly oklch 68%.
Its contrast against a hue-250 body is worst **exactly in the middle** of the lightness
range, and both ends beat the middle:

| drain body | tone 3 |
|---|---|
| `#5E9DDC` — oklch 68% | 1.04:1 — invisible |
| `#79B3EE` — oklch 75%, the retired drain | 1.25:1 — very weak |
| `#CBC9D2` — the charcoal that shipped | 1.68:1 |
| `#1F6CB0` — `bluA`, oklch 52% | 1.99:1 |

"Light enough for black text" lands in the middle. So **the ladder trades tone-3 pinyin
legibility for uniform black glyphs** — an explicit choice, on the grounds that the glyph
is what the player is drilling and the pinyin is a crutch sitting behind a toggle (the
header's `pinyin` chip).

The overlay cannot be recolored to escape it: `ForeignText.characterColor` is documented
to leave the tone overlay alone, and `TONE_COLORS` are design-owned literals.
**The only real fix is to leave hue 250** — a ladder on **purple** (hue 300, `COLORS.pur`
/ `COLORS.purA`) has no tone color anywhere near it and would free the whole lightness
range, giving back both the dark rung and the pinyin. Teal (195) does *not* help: tone 2
`#05C793` sits next to it.

Text ink itself is derived, not declared: `inkOnFill` in `src/games/bubbles/Bubble.tsx`
picks white or near-ink from body luminance, so no game can strand dark text on a dark
body. Its pivot is the derived crossover **0.26**, not a guess — see the note there.

#### ⚠️ The mastery collision, re-opened on purpose

`COLORS.blu` is **exactly** `CATEGORY_COLORS.Mastered`, and blue is the hue the app
trains as "mastered". This is the collision § 5 exists to avoid, and it was the stated
reason the ember/ocean pair below was rejected.

Taken anyway, and here is the defence:

* Bloom is **Mastered + Comfortable**, so the pastel is *half-true* rather than false —
  the best any single token can do for a union.
* Drain is the harder claim: it wears the saturated end of the "mastered" hue while
  containing **Unfamiliar + Target**.
* What holds it together is that **both tiers are one hue**, so nothing on the field
  asks to be decoded as a band. Value is the whole message.

**If a learner is observed reading a dark blue bubble as "mastered"**, the fix is to move
the *whole ladder* to a hue with no band — teal, hue 195, `COLORS.tea` / `COLORS.teaA`,
the same structure and a one-token swap — **not** to split the tiers across two hues
again.

**Drain used to stay achromatic on purpose** — being the one property no mastery
surface could collide with, since the four bands, Learn Now's gold (purple until 2026-09-01) and the
mastered-bar hues are all chromatic. Both ladders since have given that up knowingly: the
blue one bought ~3.7x the tier separation with it, and the current yellow keeps drain
chromatic while at least moving it OFF the "mastered" hue the blue drain wore.

#### How it got here

Three attempts, each rejected for its own reason:

1. **The band colors** (`MARK_TYPE_COLORS`, `#EF476F` / `#FFD166` / `#05C793` /
   `#779BE7`), inherited from the four-color ladder on the argument that a Hydra bubble
   should mean what a decks chip means. Dead once a tier became a **union of two bands**:
   wearing one band's hue lies about the other half of its contents. And the deeper
   reason — a Hydra bubble is about **board economy, not mastery** (a lent card is
   colored by difficulty tier, § 5), so any resemblance to the ramp actively misleads.
2. **Ember / ocean** (`#D64545` / `#1B6CA8`). Off the tokens, but not off the *read*:
   the app trains a learner that red = Unfamiliar and blue = Mastered, so a red bubble
   still decodes as "hard card". For a library card that decode is true; for a **lent**
   one it is false, and nothing on screen distinguishes them. Worse than an arbitrary hue.
3. **Charcoal / gold, first cut** (drain body `#DEDDE4`). Off the ramp entirely, but one
   value step from the English grey `#ECECEF` — two greys on one field. Reported straight
   away as *"charcoal looks too close to the English bubble"*, which is what forced the
   three-way framing above.
4. **Charcoal / gold, second cut** (`#CBC9D2` / `#F4DD98`, shipped 2026-08-21). Fixed
   that adjacency by moving the *inert* bubble to pure white and adding ring weight as a
   third channel. It worked. It was replaced on 2026-08-22 anyway, by the blue ladder —
   not because it read badly but because **two arbitrary hues at nearly the same
   lightness can never be monotonic**, and because unifying the two bubble games on one
   style took the ring channel away, leaving 1.22:1 between the tiers.
5. **Two shades of one blue** (`#79B3EE` / `COLORS.blu`, 2026-08-22 → 2026-08-24). The
   best-separated ladder this game has had and the only monotonic one. Replaced by request
   with the current yellow/blue pair — which, note, lands the game back at a two-hue,
   same-lightness ladder much like #4, minus the ring channel. § 2.2 records the trade in
   both directions; the mitigations if it needs them are the BLOOM lever and, failing
   that, restoring ring weight.

> ⚠️ A note in `HydraStage.tsx` used to claim the English grey was **shared with Bubble
> Match** and therefore immovable. That was wrong: Bubble Match builds its own
> definition fill from `DEFINITION_BUBBLE_BG` (`src/games/bubble-match/constants.ts`), and
> Hydra's `DEFINITION_FILL` is local to its stage. The false claim is why the fix looked
> more expensive than it was — it ruled out the cheap half of the answer.
>
> They have since CONVERGED rather than diverged: as of 2026-08-22 both games draw the
> definition bubble in the ramp's `grey` token. That is now a deliberate alignment
> (scenery is scenery in both games), not a shared constant — the two fills are still
> declared per game, so either can move without the other.

**The gold/Target adjacency this section used to track is gone with gold.** What replaced
it is a much larger, deliberate collision — the ladder is now the *mastery hue itself*.
See "The mastery collision, re-opened on purpose" above.

> The old `HYDRA_TARGET_YELLOW` deviation (`#FFD166`, kept because the app-wide Target
> token had been retuned to a pale peach that could not carry a ring) is **gone with
> yellow itself**. Nothing in Hydra reads `CATEGORY_COLORS` or `MARK_TYPE_COLORS` any
> more.

## 3. The spawn table — the economy is NOT self-stabilizing

**This is the central design decision.** An earlier draft keyed payouts to bands and
let the board settle at an equilibrium; that was rejected. The table below keeps the
expected payout **above 2 at every count**, so the board always creeps upward on its
own. Holding it back is the player's job, and the only way to do it is to
deliberately clear **drain** bubbles — which are, by construction, the words they know
least well and are most likely to get wrong.

> Safe matches grow the board. Risky matches shrink it. That trade *is* the game.

### 3.0 The two-color identity, and why the old mix could not be carried over

Under a symmetric ±1 ladder the arithmetic collapses to one line:

```
net bubbles per match  =  2 · bloomShare − 1
```

So **the board grows if and only if bloom is over half of every roll.** That single
constraint drove the whole retune, and it is worth stating plainly because it is
counter-intuitive: *the more the table favours the words the learner needs to
practise, the faster the board drains.*

The four-color steady state was 25 blue / 10 green / 30 yellow / 35 red — **65% on the
two hard colors**. Merged straight into two colors that is bloom 35 / drain 65, i.e.
**−0.30 bubbles per match**: a board that shrinks on its own, with the anti-zero
guarantee (§ 4.3) left carrying every run. That is precisely the self-stabilizing
economy this section exists to reject, so the mix had to invert.

The choice made, and the alternative rejected:

| Steady state | Net per match | Verdict |
|---|---|---|
| bloom 62 / drain 38 | +0.25 — reproduces the old growth exactly | **rejected**: nearly two thirds of rolls on words the learner already knows turns a drill into a victory lap |
| **bloom 55 / drain 45** | **+0.10** | **chosen**: the board still creeps upward, and 45% of rolls stay on the words that need the work |
| bloom 35 / drain 65 | −0.30 | rejected: inverts § 3 |

**The cost of the thin margin, and the first thing to watch in playtest.** At +0.10 a
player who clears drain selectively can hover near whatever fill they like almost
indefinitely — there is very little pushing them upward. If runs never end, the
steady-state row is what to move: **every point taken off drain buys +0.02 growth per
match.**

### 3.1 Anchor table

Anchor rows, **linearly interpolated** between anchors, keyed on the board's current
**fill ratio** — the same occupied-area measure the overflow loss reads
(`LOSE_FILL_RATIO`, and `physics.ts`'s fill-ratio helper). Keying the table on area
rather than on a bubble count is deliberate (Q2, resolved): the spawn system and the
loss condition now consult the *same* number, so they cannot disagree about how full
the board is on a phone, on a tablet, or after any radius change. There is
deliberately **no drift with matches cleared** — an identical board always rolls an
identical distribution, no matter how long the run has gone. Hydra is pure endurance,
not an escalating curve.

The table is **three states**, not a curve:

```
OPENING          fill 0.00
  bloom 100%  drain 0%
  E[payout] 3.00   net dN +1.00

    ↓ interpolated across the first tenth

STEADY STATE     fill 0.10 → 0.75   (one mix, held)
  bloom  55%  drain 45%
  E[payout] 2.10   net dN +0.10

    ↓ hard step

SQUEEZE          fill >= 0.75
  bloom 0%  drain 100%
  E[payout] 1.00   net dN -1.00
```

**Two anchors, not five** (simplified 2026-08-18). An earlier table carried rows at
0.10 / 0.25 / 0.45 / 0.60 whose weights drifted a few points each — four breakpoints
describing a change no player could perceive, and four more numbers a tuning pass had
to keep mutually consistent. Difficulty in Hydra comes from the board **filling up**
and from the 0.75 step, not from a slow drift in the mix. `hydraSpawnTable.test.ts`
asserts there are exactly **two** growth anchors and that the steady state is
genuinely flat, so reintroducing an intermediate row is a deliberate act rather than
an accident.

**Drain arrives early and stays heavy.** It used to be 0% below fill 0.45 — a design
error rather than a tuning one: drain is the player's *only* way to shrink the board, so
withholding it until the board was already half full meant the risky-clear trade § 3
calls "the game" was not on offer during the half of a run where the player most wants
to practise it. It is now a flat **45%** from the first tenth onward, which is the
most it can be while the board still grows on its own.

**The fill-0 row is bloom-only** (2026-08-18). An empty board rolls nothing but the
safe, board-growing color; drain ramps back in over the interval to the 0.10 anchor. A
run therefore *opens* on words the player certainly knows and has to earn its way into
risk — and the steepest growth in the game (net +1.00 per match) sits exactly where
the player has the most room to absorb it. Bloom-only is a **point, not a zone**: a
step here instead of a ramp would hand the player a cliff a few bubbles into every run.

Below 0.75 fill every point on the curve is net-positive. At 0.75 and above the table
**switches** to drain-only: nothing but the hardest words spawn, each paying 1 against
the 2 a match removes, so the board can only shrink — at −1 per match. That zone is
the squeeze — the player has to clear their hardest words to climb back out of it, and
every one of those clears is a chance to lose. The drain-only floor sits well below the
0.94 loss line, so the squeeze is reachable by construction rather than by luck.

> ⚠️ **The squeeze is a STEP, not another interpolated anchor**, and this is
> load-bearing. Interpolating the growth row down to drain-only drags expected payout
> below the break-even 2 from about **fill 0.15** — and the *thinner* the steady-state
> margin, the earlier that crossing lands, so the two-color reweight made this failure
> mode worse, not better. That would make "below 0.75 every point is net-positive"
> false across almost the whole range and hand the board a self-stabilizing region —
> the exact economy § 3 exists to reject — while the HUD's "drain only" badge stayed
> dark on a board already rolling mostly drain.
>
> Between the growth anchor and 0.75 the distribution therefore **holds**, then steps.
> `src/__tests__/hydraSpawnTable.test.ts` pins both signs (net-positive throughout the
> growth zone, below break-even inside the squeeze) **and the bloom-majority constraint
> itself**, so a tuning pass can move every number freely without being able to
> reintroduce this by accident.

**Bloom is available everywhere except the squeeze**, and that matters beyond the
economy: challenge words ride the bloom slot (§ 7.5), and free-play Hydra must roll the
same table as challenge Hydra or players would be practising a different game from the
one they compete in. The squeeze is the one place a challenge word cannot spawn, which
is accepted — it is a bounded emergency zone the player is actively digging out of,
not a state a run sits in.

### 3.2 What the table controls

The table decides the **category rolled for a spawn slot**. It does not decide
zh-vs-en side (§ 4.2) and it does not override the match guarantee (§ 4.3).

---

## 4. The spawn algorithm

Run after every correct match, with a slot budget `k` = the cleared pair's payout
(1 for drain, 3 for bloom).

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
| 3 | bloom | 2 slots by ratio (spent as a fresh matched **pair**), 1 slot by ratio or forced completion |
| 1 | drain | 0 slots by ratio; the single slot is by ratio, or a forced completion |

A slot is one bubble and a whole new card costs two, so this is also why **a drain clear
can never open with a fresh matched pair** while a bloom one buys a pair and still has
a slot left over.

**Every ratio-rule slot is claimed first by the per-color guarantee** (§ 4.3 invariant
3): before the stray-aging lottery runs, the slot checks whether the board is missing a
live match of one of the two colors and, if so, spends itself on that color instead. It
is a redirection of a slot, never an extra one, so the table above is unchanged.

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
at the steady-state mix land all-bloom often enough to matter, and a board with no drain
on it offers the player no way to shrink it — the one move § 3 says the game is about.
Balancing makes availability *predictable*: whatever is scarcest is what comes next.

**It matters MORE under two colors, not less.** A four-color board that came up short
on its cheapest color still had the next one up — a below-average clear to reach for.
With two tiers an
all-bloom board offers no way to shrink at all, so the balancer is the only thing
standing between a run of lucky rolls and a board the player cannot act on.

⚠️ **The balancer alone was never sufficient for that**, and § 4.3 invariant 3 is what
actually closes the gap: this balances the colors of the cards **on** the board, which
is not the same as the colors that are **matchable**. A perfectly balanced board whose
drain cards are all strays still offers no shrink move.

**It does not move the economy**, and that is the point of targeting the table rather
than a flat 50/50. An even split would average `(1+3)/2 = 2` against the 2 bubbles a
match removes — exactly break-even, i.e. the self-stabilizing economy § 3 rejects.
Targeting the table only reduces variance around it; `E[payout]` stays 2.10.

Deficits are counted in **absolute cards**, not proportionally, which is what makes
the long-run frequencies match the weights. An **empty board** has no mix to balance
and falls back to a plain roll — which is also what keeps the bloom-only opening intact.

> The test that matters here asserts the **board's** composition converges on the
> table, not the **spawn frequency**. Those are different claims, and only the first
> survives a real player: they clear colors selectively, so the balancer keeps
> replacing whatever they clear out, and spawn frequencies drift by design. That drift is
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

Three guarantees, in priority order:

1. **Anti-zero (highest priority).** The board must never be able to run down to
   nothing, and must never dead-end with no valid match.

   **What it overrides is the BUDGET, not the weights** (corrected 2026-08-21 — this
   section previously said it could spawn "a green or blue pair" inside the drain-only
   zone, which the implementation has never done). The color is still rolled from the
   table, so inside the squeeze it spawns a **drain** pair. What is suspended is the
   payout: called as step 3 of `planSpawnBatch`, it spends slots the payout did not
   buy, so a drain clear that would otherwise strand the board pays out 2 bubbles
   against the 2 it removed instead of 1. A dead end is worse than a free bubble.

   It is **purely reactive** (Q7, resolved): it fires only when a spawn would
   otherwise leave the board with no live match. There is **no floor count** below
   which the board is topped up regardless — a floor would quietly re-stabilize the
   economy at the low end, and player control of board size is the whole point of
   § 3.
2. **A live match always exists.** Enforced by step 3 of § 4.1.
3. **Both colors are matchable — as far as one slot allows.** The board owes the
   player a live **drain** match *and* a live **bloom** match: a move that shrinks the
   board and a move that grows it.

   **Why invariants 1 and 2 were not enough.** They only ask whether the board is a
   dead end; they say nothing about what the available match *pays*. A board can sit at
   a perfect § 3.1 color mix with every drain card a stray and only bloom cards
   completable, and the player's only legal move is the one that grows the board — the
   shrink lever § 3 says the whole game is about has quietly been taken away.
   `pickBalancedColor` (§ 4.2b) does **not** cover this: it balances the colors of the
   cards **on** the board, not the colors that are **matchable**.

   **Within budget only — this is what separates it from anti-zero.** It never buys a
   slot the payout did not pay for. It only steers a slot the batch was already going
   to spend, and a `complete` costs the same one slot and puts the same one bubble on
   the board as a `newStray` (§ 4.2c), so **E[payout] is untouched**. Two ways the slot
   gets spent, in order:

   | board state | action | effect |
   |---|---|---|
   | a stray of the needed color exists | `complete` it (oldest-waiting first) | guarantee met this instant, board composition unchanged |
   | no stray of that color | `newStray` of that color, overriding the balancer | a later slot has something to complete |

   A single slot cannot do better: `newPair` is the only one action that makes a live
   match out of nothing and it costs **two** slots, and buying that here would be
   exactly the budget override reserved for anti-zero.

   **Therefore it is BEST-EFFORT, not absolute.** A drain clear buys exactly one slot,
   so a board missing both colors can only be given one of them back per match. When
   both are missing, **fill breaks the tie** (`COLOR_NEED_TIEBREAK_FILL` = 0.5,
   `constants.ts`):

   ```
   fill <  0.5   →  bloom   (room to spare; the growth move is the one worth having)
   fill >= 0.5   →  drain   (filling up; the shrink move is)
   ```

   This makes the guarantee mildly **stabilizing** at the margin — the one place in
   Hydra where that is accepted, because it governs whether the player has a *choice*
   at all, not what the choice *costs*. The economy still comes entirely from the § 3.1
   table.

   **Bloom is never manufactured inside the squeeze.** At and above `DRAIN_ONLY_FILL`
   the guarantee stops asking for bloom, because a guaranteed +1 escape there would
   dismantle the one state overflow loss depends on (§ 3.1). Bloom cards *already* on
   the board stay matchable — nothing is taken away, the board simply stops being
   topped up with the color the table has switched off.

   **It outranks the stray-aging lottery** (§ 4.2c), which is a visible consequence: a
   *fresh* drain stray is completed immediately when no drain match exists, even though
   its aging shares are zero. Once both colors are matchable the guarantee goes quiet
   and the lottery runs normally.

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
| Library card (has mark history) | the color whose **two bands** cover its real category **on the run's track** — the `gameCategory` stamp `getGameVocabPool` already returns for the requested `?markType=` (`server/services/OnDeckVocabService.ts`), mapped through `BUCKETS_BY_COLOR`. That track is `recognition` today and becomes the run's latched track under § 6.0. |
| **Provisional / lent** card | its assigned **difficulty tier** (§ 6.2), *not* its real category — and it keeps that tier for as long as it is lent, even after it has marks (docs/PROVISIONAL_CARDS.md § 3c) |

The band → color mapping (`BUCKETS_BY_COLOR`, `src/games/hydra-bubbles/constants.ts`):

```
bloom  ←  Mastered, Comfortable
drain   ←  Unfamiliar, Target
```

A freshly minted card has no `typedMarkHistory`, so its real recognition category is
Unfamiliar. Coloring every lent card drain would put the whole board on the shrinking
side of the ladder for exactly the learners who have the smallest libraries — which is
the population most likely to be playing on lent cards. So for lent cards the color
comes from difficulty instead of from mastery, and the two systems are allowed to
disagree.

**This disjunction is why the color no longer wears a band's name or a band's hue**
(§ 2.1, § 2.2). Under the four-color ladder the reuse was defensible; under a union of
two bands, on a channel that a lent card fills from difficulty instead, it would just
be false.

### 5.1 The held cue is the shared grey wash

Held/hovered bubbles are *enlarged + greyed*, the same cue in both bubble games
(`Bubble` → `.bubble__dim`).

**This reverses Q5.** Hydra used to draw an **outline ring** instead, on the grounds
that grey was its English-bubble color and a grey wash would read as a card color. That
premise expired on 2026-08-21, when the English bubble moved to **pure white** to open
the value gap against drain (§ 2.2) — and note that the bubble has since come back to
grey (2026-08-22) without the ring coming back with it: the wash and the body are read
at different moments, and a held bubble also scales up — grey stopped being a Hydra card color at that
moment, and the ring was left standing on a reason that no longer held. The cue was
unified on 2026-08-22 along with the ring weight, leaving the two games one bubble in
two palettes.

The wash is a pure overlay: it does not change a bubble's own colors, so a tier-colored
bubble still reads as its tier while it is being dragged.

---

## 6. Card supply

> **Hydra marks `recognition` unconditionally TODAY.** The conversion to a
> pinyin-picked track is designed but **not built** — see § 6.0.

An endless run needs a rolling supply, unlike Bubble Match's fixed 20 pairs.

### 6.0 Pinyin picks the track here too

> STATUS: **DESIGN — decided 2026-08-23, NOT BUILT.** Depends on pinyin becoming a
> per-game setting first
> ([GAMES_FEATURE.md § "Pinyin is a per-game setting"](./GAMES_FEATURE.md)); today
> Hydra reads the SHARED `showPinyin` for **display only** and always writes
> `recognition`, so hiding pinyin here changes what the bubbles draw and nothing about
> what they record. The rule being adopted:
> [MASTERY_REWORK.md § 1a](./MASTERY_REWORK.md).

Hydra is a foreign → meaning drill, so it takes the same rule as Bubble Match and the
flp: **pinyin shown ⇒ `recognition`; pinyin hidden on a zh board ⇒ `reading`**, because
the player then reaches the meaning from the characters alone. Spanish never switches
(no phonetic layer to hide).

This is **not** a copy of Bubble Match's patch. There, the track is essentially a
label on a fixed 20-pair deal; here it is an **input to the economy**:

1. **Latch before the FIRST spawn, not at deal — because there is no deal.** § 6.1
   makes *every* spawn a partial refill. The run's track has to be fixed ahead of the
   first pool fetch and honored by every refill for the rest of the run, or one run
   mixes tracks and half its marks are dropped.
2. **The color ladder re-bands.** § 5's `BUCKETS_BY_COLOR` maps a library card's
   **recognition** `gameCategory` onto bloom/drain. On a reading run it must read the
   card's **reading** `gameCategory` instead. The plumbing already exists — that is
   exactly what `getGameVocabPool`'s `?markType=` selects and stamps — but the
   distribution feeding the ladder changes completely.
3. **⚠️ A reading run's bands are nearly all Unfamiliar, and that is the real risk.**
   This is the trap [MASTERY_REWORK.md § 6](./MASTERY_REWORK.md) already documents for
   Speed Reading and Word Search No-Pinyin: a sparsely-marked track puts almost every
   card in `Unfamiliar`/`Target` — i.e. **drain**. Bloom is the union of `Mastered` +
   `Comfortable`, so a reading run's bloom buffer runs dry far more often than a
   recognition run's, and § 6.2c ("why bloom is the color that runs dry") gets sharply
   worse. Since growth is `2·bloomShare − 1` (§ 3.0), a board that cannot source bloom
   cannot stop growing. What absorbs it is tier lending (§ 6.2): a lent card's color
   comes from **difficulty**, not from mastery, so it is track-independent and can
   still fill the bloom buffer. **Confirm the § 3.1 spawn table still terminates on a
   reading run before shipping this** (tracked as O5 in § 11).
4. **A reading run must be SILENT** — no autoplay, no `onSpeak`, no TTS prefetch, same
   as Bubble Match and for the same reason: hearing the word hands over the reading
   being tested.
5. **The cooldown gate follows the track for free.** § 8's "next markable at" is
   already per mark type, so a reading run is gated on the reading clock — a card just
   cleared on a recognition run is still fresh for a reading one, and vice versa.

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

drain   = L
bloom  = L - 1
```

**One level apart, not three** (2026-08-21). The four-color ladder spread its tiers
across `L` … `L-3`; collapsing to two colors, the tightest mapping is the one that
keeps each color's promise. Drain is the word the learner is currently working at; bloom
is one level below it — comfortably within reach without being trivial. Widening the
gap (bloom = `L-2`) would make every safe bubble a word they outgrew two levels ago,
which is a worse drill and no easier to read.

Clamped into 1..6, which is also the floor: at `L = 1` both colors lend from level 1,
because a level-1 learner has nothing below them to draw an easier word from.

**Last fallback:** when a tier's own level is exhausted, pull from **the next level up**.

Levels are 1..6 for every language (`StarterPacksService`, `de."difficulty" BETWEEN 1
AND 6`); the zh-facing label is "HSK n" and other languages read "Level n"
(`src/features/discover/SortCardsPage.tsx`).

Two app-wide rules this leans on, both written up in docs/PROVISIONAL_CARDS.md:

* **Re-lend before minting (§ 3b).** A lend first looks at provisional cards the
  learner already holds near the target tier, and mints a new row only for what that
  cannot cover. The cooldown is never broken to re-lend. Hydra was the only user of
  this when it shipped (no ordinary pool query selected by difficulty, and every other
  caller could already reach its held rows through a PLAYABLE bucket clause); since
  2026-08-20 selection is sorted-only app-wide, so re-lending is **unconditional** and
  every lend on every surface goes through it.
* **Lending is the LAST fill tier (§ 4b, 2026-08-20).** Hydra reaches for cooling cards
  of the rolled colour **before** it lends — the same ladder every other surface uses.
  This does not weaken the colour ladder: a colour whose buckets hold no card of the
  learner's at all (a beginner's bloom = `Mastered` + `Comfortable`) has nothing to
  cool, so it still lends at its tier. What changed is that a learner who *does* hold
  bloom cards now replays them instead of being handed new words.
* **A lent card keeps its tier while lent (§ 3c).** A card lent as bloom stays bloom
  for the rest of the time it is provisional, even once it has accumulated marks and
  its real utcm category says otherwise. Payouts stay stable within and across runs,
  which is what § 3's economy assumes. The tier is derived from the det row's existing
  `difficulty` against `L` — **no new column, no new table**.

### 6.2b The two color pools

The client keeps **one buffer per color — two of them** since 2026-08-21 — prefilled
from the pool fetch. A spawn that rolls bloom pops from the bloom buffer; a background
fetch tops that buffer back up asynchronously, so in the normal case a spawn never
waits on the network.

This is what makes the color system tractable on the client: the game never has to ask
"what color is this card?" at spawn time, because the card was already drawn from the
buffer of the color it is. Provisional cards enter the buffer their tier names
(§ 6.2); library cards enter the buffer whose two bands cover their real
`gameCategory` (§ 5).

Halving the buffer count halves the cards in flight at the same `BUFFER_TARGET`, and
each buffer now drains about twice as fast — the low-water top-up is what absorbs that.

Buffers are **client-side only** — no new table, no persisted server state.

#### A dry buffer is WAITED ON, never substituted (corrected 2026-08-18)

`draw` is **async**. When the rolled color has no stock it kicks (or joins) that
color's refill and **awaits** it, then pops. The spawn arrives a beat late, which on a
clockless game costs the player nothing — whereas a substituted color misstates what
the match will pay, which is the one thing § 2's contract cannot survive.

> ⚠️ This section previously said the roll "falls through to the next color that has
> stock", and the implementation iterated `HYDRA_COLORS` in **ascending** order. Since
> that array ran red → yellow → green → blue (the four-color spelling of the time), a
> dry **top-of-ladder** buffer produced a **bottom-of-ladder** bubble: the game's
> best-paying slot silently became its worst-paying one, and the economy inverted
> exactly when supply was tightest. It was reported from live play as "a red card on the
> opening board" and is the reason the whole supply path was re-examined. The safe tier
> — bloom now — is the one most likely to be dry (§ 6.2c), so this was not a rare edge;
> it was the common case.

A last-resort fall-through does remain, reached only after the await has already
failed (the request errored, or the server has none of that color at all). **Under two
colors it is no longer a graded degradation** — the only substitute left is the
opposite sign, a two-bubble swing — so it is now strictly a stall-breaker rather than a
"keep the error small" fallback, and the await above is what keeps it rare. It exists
only because a stalled board is worse than an occasionally mis-priced one. The
anti-zero guarantee (§ 4.3) is the floor beneath all of it.

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

#### 6.2c Why bloom is the color that runs dry

Bloom is the **most-rolled color** (100% at fill 0, 55% through the growth zone) and it
is drawn from the bands whose cards are **least** likely to be servable: the
recognition cooldown for a Mastered card is **180 days**, so one correct answer removes
it from the pool for half a year. A real dev account was measured at **48 Mastered
cards, 0 of them off cooldown**.

**The two-color rework materially helps this** (2026-08-21), and it is the one place
where merging bands is a straightforward win rather than a trade. Bloom used to ask for
`Mastered` alone; it now asks for **Mastered + Comfortable** (`BUCKETS_BY_COLOR`),
roughly doubling its supply and adding a band with a far shorter cooldown. Drain gained
the same widening — Unfamiliar + Target — but drain was never the scarce side.

Bloom's supply is still the load-bearing part of the design, and § 6.2d is still what
protects it from being "helpfully" filled with the wrong cards.

#### 6.2d A strict-bucket request never gets another bucket's cards

Hydra asks the game pool for a **specific set of bands** and pays the player by the
color those bands make up. That request is not a difficulty *preference* — it is a
question whose answer is the bucket itself. `getGameVocabPool`'s fill tiers were built
for callers describing a difficulty MIX, where topping a short quota up from a
neighbouring bucket is the best-effort fill they want. For Hydra the same behavior
returns cards of the wrong color, which it then files into the rolled color's buffer
and **pays the player for at the wrong rate**.

> ⚠️ Measured on a dev account, back when Hydra requested one band per color: a
> `?Mastered=4` request was answered with Target and Unfamiliar cards, every one of
> them subsequently played and paid as **bloom**. Combined with the fall-through bug
> above, the color channel was mispricing in both directions at once.

So a strict-bucket request **collapses the fill order to the requested buckets alone**:

| tier | mix caller (every other game) | strict-bucket caller (Hydra) |
|---|---|---|
| 1 | fresh, requested buckets | fresh, requested buckets |
| 2 | lend (if allowed), capped by what tier 3 still holds | lend (if allowed) — tier-colored per § 6.2, uncapped in practice: tier 3 is skipped, so there is nothing to subtract |
| 3 | fresh, **fallback buckets** | *skipped* |
| 4 | cooling, requested then fallback | **cooling, requested buckets** |
| 5 | avoided, requested then fallback | avoided, requested buckets |

> ⚠️ **It is an explicit flag now, not an inference** (2026-08-21) — and this was a
> live trap the two-color rework walked into. The collapse used to be inferred from
> `requested.length === 1`, which held only while Hydra asked for exactly ONE band per
> color. Asking for two bands per color would have read as "a mix, please substitute
> freely" and silently reintroduced the exact mispricing the rule was written to stop.
> The client now sends **`?strictBuckets=1`**
> (`useColorBuffers.fetchColor`), the controller parses it, and
> `getGameVocabPool` honors it via `opts.strictBuckets`. The length-1 inference is kept
> underneath as a backstop for a future single-bucket caller that does not know about
> the flag.
>
> **Note for anyone auditing other games:** Match Speed's Review and Challenge modes
> also request a two-band subset (`Comfortable`+`Mastered`, `Unfamiliar`+`Target`) and
> do **not** set the flag, so a "Review" board can legitimately be topped up with
> Unfamiliar cards. That is pre-existing behavior and was left alone — but it is the
> same question, and if those mode names are meant as promises the flag is how to keep
> them.

Tier 4 is the one that matters here, and it **deliberately breaks the per-type
cooldown**: a genuinely Mastered card that is merely resting is a *truthful* bloom
bubble, whereas a minted HSK-1 word colored bloom by its lend tier is not. The
consequence is accepted rather than worked around — a mark on a still-cooling card is
dropped by the § 8 guard, so those cards are **playable but do not advance mastery**.
That is what the cooldown is *for*: re-answering a Mastered card inside its window
should earn nothing. Bloom is play, not progress.

A strict-bucket request would rather come back **short** — the client waits (§ 6.2b)
or skips the slot — than come back **wrong**.

### 6.3 Collection- and deck-restricted runs

When the run is restricted (`?deck=` / `?collection=`), **do not lend** and **do not
honor cooldown**. The set the learner chose is the set they play. Marks earned on
those cooled cards do not count — see § 8.

### 6.4 What the learner sees

* **While lending is in play:** every lent bubble wears the shared **lent mark** in
  its top-right corner — the icons8 hourglass every other surface uses for a borrowed
  card (`LentCardBadge`, docs/PROVISIONAL_CARDS.md § 5). It is passed in by `HydraStage` as the shared `Bubble`'s `lent` prop rather than derived
  inside `Bubble`, so Bubble Match — which itemizes its lent cards before the round —
  is unaffected. The badge is on the **word (foreign) bubble only** — both bubbles of a
  pair carry the same entry, so badging the definition side as well would let a player
  pair them by badge instead of by reading (the foreign-side-only rule,
  docs/PROVISIONAL_CARDS.md § 5).
  > **This replaced a one-shot mid-run popup** (2026-09-05). That popup said lending
  > had started, froze the board, and named no words; the badge says the same thing
  > continuously, on the exact bubbles it is true of, and costs no interruption. The
  > earlier claim that "a bubble is far too small to carry a corner badge" did not
  > survive contact — at 12px on a 40%-radius squircle, inset 10% from the corner so it
  > stays on the curve at every spawn radius, it reads fine. Q6 (does the popup freeze
  > the board?) is therefore moot for lending; the freezing rule itself still stands for
  > any input-blocking modal Hydra does show.
* **End of run:** the standard `ProvisionalSortOffer`
  (`src/components/ProvisionalSortOffer.tsx`, sequenced by
  `useProvisionalSortOffer`), opening over the score card as soon as the run ends (no
  delay). It lists the lent cards the player actually **matched against** —
  `useMarkedLentWords`, recorded in `markCard` — not the ones the buffers dealt. An
  endless run pops plenty of bubbles that overflow untouched, and asking the player to
  keep a word they never read is the same mistake as never mentioning the lending at all.
  Any attempt counts, including a miss (which ends the run) and a mark the server drops
  on cooldown; the reasoning is in docs/PROVISIONAL_CARDS.md § 5.

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

**The SIDES give exactly as far as the bottom, and mean the opposite of it.** A held
bubble may be pulled clean off any of the three edges — `HELD_OVERDRAG_RADII`, measured
from the stage edge — and springs back on release (`clampHeldCenter` → `stepPhysics`).
Identical distance, opposite consequence: the bottom's over-drag passes through the
strip, which is real on-screen space, and **cancels the match**; past a side wall is
past the stage, so the bubble is clipped and the release means nothing at all. That is
a boundary having give, not a second escape hatch — backing out of a drag is still the
strip's job alone.

> ⚠️ **This shrinks the play area by 96 px, so a given board is now "fuller".** The
> fill ratio is area-relative, so the danger vignette (0.72), the drain-only squeeze
> (0.75) and the loss line (0.94) all arrive after fewer bubbles than before on the
> same screen. That is consistent with Bubble Match and is the intended trade, but it
> is a real change to the § 3.1 tuning surface and belongs in the § 11 O1 tuning pass.

### 7.1c No background pause — in FREE PLAY

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

> ✅ **AND IT DOES REVERSE IN CHALLENGE MODE — done 2026-08-22, as this note asked.**
> A challenge round is timed (§ 7.5), so `HydraBubblesPage` arms
> `useBackgroundPause(phase === "playing" && isChallengeLaunch)`, feeds it into
> `framePaused` (which the lend notice used to share, before it was replaced by the
> per-bubble badge in § 6.4), and renders `GamePausedOverlay`. The round's
> elapsed time is accumulated ACTIVE time — the shared `useChallengeRound` clock ticks
> only while unpaused — so the pause is real rather than cosmetic. Free play is
> unchanged and still exempt.

### 7.2 Score

Score = **bubbles cleared**, +2 per match. **Session-only** — nothing is persisted,
no new table, no `wins` row. A personal best can be added later once the tuning has
settled.

### 7.2b The HUD

*(Shelf redesign entry 16 — `docs/SHELF_REDESIGN.md`.)* A real `GameHud` row above the
field, not the `top: 8` overlay it used to be, where bubbles drifted under the score and
the field's measured bounds were larger than the area a bubble could be read in.
`HydraStage` returns a fragment: HUD row, then the measured field.

| Slot | Content |
|---|---|
| left | `endless` — **or `shrink only`** the moment the table enters the squeeze band (§ 3.1) |
| right | `{score} cleared` |
| bar | the field's **fill ratio**, `teaA` → `dangerInk` on the danger band |

**The mode slot doubles as the warning** because there is only one mode: a constant
"endless" is dead pixels, but drain-only is urgent, and saying it where the mode was keeps
the strip at three facts instead of four. The copy says what the board can now DO, not
which tier is spawning — "drain only" is the internal name (`types.ts`) and means nothing
to a player. It takes `BLUE_DARK` — exactly the color the drain bubbles on screen are
wearing (§ 2.2) — so the warning and the bubbles it is about are the same blue, rather
than any mastery token (§ 5).

**The bar is fill, not progress.** An endless run has no denominator, and fill is both the
number that ends the run (`LOSE_FILL_RATIO`, § 7.1) and the one the whole spawn table is
keyed on (§ 3). It is **quantized to 5% steps** (`fillBucket`) before it reaches React:
the raw ratio changes every frame because bubbles are always settling, so storing it as-is
would re-render the stage 60×/s to move a 4px bar. The physics and the spawn table keep
reading the exact ratio; only the display is coarse.

### 7.3 End popup

Bubble Match's shape: a score card ("You cleared 142 bubbles") with **Play Again**
primary over **Back to Games** secondary, **minimizable to a corner puck**. Play
Again starts a wholly fresh board.

### 7.3b Cleanup mode — the post-run review board (built 2026-08-24)

Minimizing the end popup turns the final board into a **no-stakes review
playground**, the same affordance Bubble Match has offered post-loss since it
shipped (`cleanupMode` in `src/games/bubble-match/BubbleStage.tsx`). Hydra had the
minimizable popup but not the mode behind it, so the puck revealed a board that
looked live and answered nothing: `onPointerDown`/`onUp` both returned early on
`phaseRef.current !== "playing"`, and the rAF loop had already shut itself down.

The contract, `HydraStage` → `cleanupMode` (page: `phase === "over" && popupMinimized`):

| While reviewing | Behaviour |
|---|---|
| Grab | Allowed on any non-`correct` bubble. The pair frozen red by a wrong-match loss is **released back to idle on entry**, so the drop that ended the run can be re-tried. |
| Drop hint | The held bubble's partner lights **green** (`revealed`). No partner on the field → the grabbed bubble itself flags **light-red** (`nomatch`) while held. Hydra's board is mostly strays (§ 4.2), so `nomatch` is the *common* case here, not the edge case it is in Bubble Match. |
| Correct match | Pops and removes the pair. **No mark, no score, no payout spawn**, and the card is **not** `release`d from the color buffers — the run is over, so spending it would only make it scarcer for the next one. The board drains toward empty and never refills. |
| Wrong match | Shakes, then settles back to idle. No mark, and **no second run end** — `finishRun` is already spent. |
| HUD | The danger vignette and the drain-only squeeze warning are **permanently dismissed** on entry (`dangerDismissed`): neither has anything left to warn about, and a pulsing red wash makes a board being read harder to read. The fill bar stays, and falls as the field clears. |
| Physics | The post-run shutdown is skipped while cleanup is on, so bubbles keep separating and settling under the drags. |

There is no ceiling to retract (Bubble Match does that here) because Hydra has none;
an overflow board is packed but not crushed, so it settles on its own.

### 7.4 Marks

* Correct match → **positive mark** on the cleared card.
* The fatal wrong match → **negative mark** on the card that was dragged.

The track is **`recognition`** today, unconditionally. Under § 6.0 it becomes the
run's latched track (`recognition`, or `reading` on a pinyin-off zh run) — the mark
must always name the same track the pool was bucketed and cooled on.

Both subject to § 8.

### 7.5 Study Challenge mode

✅ **BUILT 2026-08-22.** Hydra **is** challenge-eligible (Q3, resolved), but a challenge
run is scored on a different axis from a free-play run, because an endless run has no
comparable length.

| Aspect | Free play | Challenge |
|---|---|---|
| Score | bubbles cleared | **±100 per contested word only** (filler pays 0) over the **9** challenge words (`CHALLENGE_WORD_COUNT`), **plus a clear bonus of up to +300 that decays with time and is forfeited unless the set is cleared** |
| Run ends | wrong match, or overflow | **the last challenge word is matched** |
| Spawn table | § 3.1 | § 3.1, unchanged |

Rules:

* **Challenge words are always bloom** (moved off yellow on 2026-08-21, when yellow was
  removed — § 2.1). Their payout is bloom's (3) regardless of the learner's real mastery
  of them, the same color/mastery disjunction § 5 already allows for lent cards.

  Bloom rather than drain was a deliberate choice: challenge words are the ones the run is
  *scored* on, so making them the board-growing color means chasing them never forces
  the player toward the squeeze. It does decouple them from § 3's risk trade — a
  challenge word is now a safe clear — which is accepted, because a challenge round is
  already scored on speed rather than on board management.
* **Only a bloom roll can place a challenge word.** When the table rolls bloom and an
  unspawned challenge word remains, that word takes the slot; otherwise the slot takes
  a filler bloom. A drain roll never places a challenge word.
* **The clear bonus is how the round finally scores TIME (O2, resolved 2026-09-02).**
  **+300** for clearing all nine, held flat through the first **1:00** of *active* time,
  then decaying **−25 every 15 s** to a floor of **0** at **4:00**. Forfeited entirely by
  any run that did not clear the set, and drawn on the scoreboard as an explicit
  `clear bonus (lost) · 0` line so the player can see what the wrong match cost.

  **Why it must be gated on completion, rather than being a plain per-second penalty.**
  A Hydra run stops for one of two unrelated reasons — you finished, or you erred — so a
  penalty charged to *every* run pays players to **fail fast**. A wrong match at 0:30
  posts a better clock than a clean 9-of-9 at 4:00, and the finisher played longer *by
  definition*, so lowering the rate shrinks the subsidy without ever fixing its sign.
  Gating on completion means the term only compares runs that are comparable: every
  player holding it cleared the same nine words.

  **It cannot invert the word ranking**, which is what lets the pot be large. A complete
  run scores `900 + bonus ≥ 900`; the best possible partial run is eight clears plus the
  miss that ended it, `800 − 100 = 700`. So a fast partial can never beat a slow complete
  one at any tuning, and 300-against-900 simply says how much speed separates two
  finishers — the same register as Bubble Match's 500.

  **The numbers are a first guess, and the grace is what makes that safe.** Nothing
  stores a round's duration (only `completedAt`), so there is no telemetry on real clear
  times, and the deal rate is partly out of the player's hands anyway: contested words
  arrive one per bloom roll, filler clears are what buy those rolls, and the squeeze
  (§ 3.1) locks contested spawns out entirely. A flat first minute means a rate guessed
  too aggressively cannot *punish* a genuinely fast run, only fail to separate it.
  Revisit once real rounds exist.

  Implemented with the existing `survival` bonus kind — `trigger: 'runStart'`,
  `forfeitOnLoss: true` — plus one addition to the shared runner: the `survival` branch
  now honours `graceMs` (Bubble Match sets none and is unchanged). `HydraBubblesPage`
  arms it by emitting `{kind: "survivalStart", ruleId: "clearBonus"}` when `phase`
  becomes `playing`. ⚠️ The KIND is named for its first user, not for what it does: what
  it expresses is a decaying pot armed by an event and forfeited on a loss. `decayingPot`
  would be the honest name.

* **Filler pays NOTHING (`fillerHit: 0`, changed 2026-09-02), and Hydra is the only
  game where that is true.** Everywhere else filler is near-free points that cannot
  decide the match; here it could, because the run ends on the LAST contested clear and
  nothing charges for time. A player who cleared eight of nine and then farmed filler
  bubbles outscored one who finished cleanly and fast — and overflow forfeits nothing
  (there is no survival bonus to lose), so the farm's only downside was the risk of a
  wrong match. **`fillerMiss` deliberately stays at −20**: a filler clear is not
  optional — draining is how the board is kept off the ceiling — so filler is now pure
  risk rather than inert. Right earns nothing, wrong still costs.

  The consequence for the round is that **the contested ledger is the whole score bar
  the clear bonus**: the word half of a Hydra total is always a multiple of 100 minus
  any miss, so reading it tells you exactly how many challenge words the player cleared.
  Zeroing filler is also what forced the clear bonus above — it removed the last
  (accidental, farmable) separator between two players who both clear all nine, who
  would otherwise have tied at exactly 900.

* **Bloom is 55% of the growth zone and 100% of the opening**, so challenge words
  surface far more readily than they did on the old 30% yellow slot — and the § 3.1
  table needs no per-mode reweighting to deliver the whole set. The one place they cannot
  spawn is the **squeeze** (drain-only), which is a bounded zone the player is digging
  out of rather than a state a run sits in.
* **The run ends the moment the LAST challenge word is cleared**, and the timer stops
  there. Filler bubbles still on the board are irrelevant, and overflow after that
  point cannot happen because the run is already over.
* **A wrong match still ends the run**, early and without score for what is left:
  challenge words already matched are banked, unmatched ones score **zero**. A player
  who cleared 8 of 9 therefore outranks one who cleared 3, which speed alone could
  not express.

⚠️ **THE SET SIZE HAS MOVED TWICE.** This section was written when a challenge set was
ten words; `CHALLENGE_WORD_COUNT` went to 12 on 2026-08-17 and to **9** on 2026-08-28.
Read every "ten"/"tenth" here as "the challenge set" / "the last of it", which the code
reads from the constant and never hard-codes.

#### How it is wired (2026-08-22)

| Piece | Where |
|---|---|
| The contested cards | fetched once before the run by `HydraBubblesPage` (`GET /api/onDeck/gamePool?challengeId=…&need=CHALLENGE_WORD_COUNT`), then **filtered through `challengeRound.isContested`** and handed to `useColorBuffers` as its third argument |
| The bloom slot | `useColorBuffers`'s `take()` serves the challenge queue first **for bloom only**; the cards are also hard-excluded from every refill so one cannot arrive twice |
| The ending | `HydraStage`'s new `shouldEndRun(entry)` prop, asked after every correct match, fires `finishRun("challengeComplete")` once the last contested word is cleared — after the pop animation, so the board does not freeze mid-pop |
| The score | the shared runner (`useChallengeRound`), same as every other eligible game |

⚠️ **THE POOL RESPONSE IS NOT THE CONTESTED SET** (fixed 2026-09-02). `getChallengeGamePool`
tops a short contested set up with **filler** (`need − contested.length`), so a
`need = CHALLENGE_WORD_COUNT` response can contain cards the challenge never named.
`HydraBubblesPage` used to seed both the bloom queue and `remainingContestedRef` from the
whole response, which put the ending out of step with `challengeRound.isContested` — the
same clear that scored as filler was still being counted as a word the run was waiting on,
so a player who had cleared all nine challenge words watched the board keep spawning.
Both now come from the filtered set: the ending set is the challenge's word list, and the
bloom queue holds contested words ONLY, so every bloom slot advances the ending rather than
dealing filler the board's own colour economy would have supplied anyway. A round whose
pool contains no contested card at all is now **blocked** rather than started — it has
nothing to score and no ending.

⚠️ **HYDRA'S FILLER IS NOT `mastered-first`, and that is the one deliberate exception to
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.2.** Everywhere else, a challenge board is
padded from the player's easiest own cards so filler is not a source of difficulty. Here
the filler IS the colour economy: bands decide colour (§ 5), so a board padded entirely
from Mastered cards would be a board of nothing but bloom — the ladder inverted and the
squeeze unreachable. A Hydra challenge round therefore draws only the CONTESTED set from
the challenge and leaves the buffers untouched. Its difficulty comes from the challenge
SHAPE (clear all nine, a wrong match ends the run), exactly as this section already
argued.

**Background pause is now armed for challenge rounds** (§ 7.1c's own caveat, honoured):
a challenge run is timed, so it gets `useBackgroundPause` + `GamePausedOverlay`, while
free play stays exempt.

**O2 is now closed** (2026-09-02). Zeroing filler had left two clean 9-of-9 runs tied at
exactly 900 with nothing to separate them; the clear bonus above is the separator, and it
is gated on completion rather than charged per second for the reason set out in its
bullet. See docs/STUDY_CHALLENGE.md § 5.4.

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

### 8.1 Known consequence: cooled-tier marks stop counting (accepted, instrumented)

`getGameVocabPool` (`server/services/OnDeckVocabService.ts`) fills a game board in
five tiers: (1) fresh cards from the requested buckets, (2) fresh cards from the
fallback buckets, (3) **cooled cards**, (4) avoided cards, (5) **lend**. The cooled tier
fires on *ordinary* runs — no deck, no collection — whenever the fresh tiers cannot fill
the board, which is any learner playing two rounds back to back. Those marks were
recorded before the guard; under it they silently stop being recorded.

**Resolved: ship the guard as designed, and log every suppressed mark server-side.**
*(Built. The log line is `[MarkSuppressed]` in `server/services/FlashcardMarkService.ts` → `applyMark`.)*
The cooled tier stays — and on **2026-08-20 it was promoted above lending**
(PROVISIONAL_CARDS.md § 4b), which settles the open question below in its favour and
makes suppression *more* common by design: re-showing a resting card that earns nothing
is the intended answer, and minting a word the learner never chose is not. The
alternative the log was collected to evaluate — delete the cooled tier and lend instead
— is now explicitly rejected.

The log keeps its other job: telling ordinary cooled-tier suppression apart from the
deck/collection suppression that is intended (§ 6.3).

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
                             Takes `fill` — COLOR IS THE ONLY THING A GAME VARIES.
                             Shape, ring weight, gloss and held cue are fixed here,
                             with Bubble Match as the reference, § 2.2/§ 5.1)
src/games/bubble-match/     <- converted to import from bubbles/; keeps its level
                               table, kind-keyed palette, ceiling and spawnSelection
src/games/hydra-bubbles/    <- imports from bubbles/
    HydraBubblesPage.tsx    (run state machine)
    HydraStage.tsx          (the field)
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
grey held wash and its kind-keyed palette; the palette now lives in
`src/games/bubble-match/constants.ts` rather than in the shared module, and the wash is
the shared cue both games use.

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
| Lending always mints a new row, so a long run inflates the holding forever | **Re-lend before minting**, app-wide, never breaking cooldown (unconditional since 2026-08-20) | PROVISIONAL_CARDS.md § 3b |
| A lent card's color would flip once it earned marks | A lent card **keeps its tier** until it is sorted; derived from det `difficulty`, no new column | PROVISIONAL_CARDS.md § 3c |
| The client cannot tell what color a lent card is | **Client-side color buffers** — one per tier, so two since the 2026-08-21 rework — drawn from at spawn, topped up async | § 6.2b |

### Still open

**O5 — Does the § 3.1 spawn table still terminate on a READING run?** (opened
2026-08-23 with § 6.0.) The table is tuned against the bloom/drain mix a *recognition*
library produces. A reading track is far more sparsely marked, so nearly every library
card bands `Unfamiliar`/`Target` = drain, and bloom has to come almost entirely from
tier lending. If bloom cannot be sourced at the steady-state share, `2·bloomShare − 1`
stays positive and the board grows without bound. **Blocks shipping § 6.0**; the same
question applies to any future game pooled on a sparse track.

**O1 — The § 3.1 numbers are a tuning, not a measurement.** The steady-state row
holds `E[payout]` at 2.10, so the board creeps upward by 0.10 bubbles per match — about
one extra bubble every ten matches. Whether that *feels* like a slow squeeze or an
unwinnable flood is not knowable on paper. With the table simplified to two growth
anchors there are only four knobs left, which is the point: the **steady-state mix**,
the **0.10 ramp end**, the **0.75 drain-only floor**, and the 0.94 loss line.

**O1b — The +0.10 margin is thin ON PURPOSE, and it is the first thing to playtest.**
Under two colors the growth rate is `2·bloomShare − 1` (§ 3.0), so 55/45 buys the board
very little upward pressure. The specific failure mode to watch for is a **run that
never ends**: a player clearing drain selectively can hover near a comfortable fill
almost indefinitely. Every point moved from drain to bloom buys **+0.02** bubbles per
match; 62/38 restores the old +0.25 at the cost of putting two thirds of every roll on
words the learner already knows.

**O4 — The blue ladder vs the Mastered band wants a real-player check (§ 2.2).** The
tiers are now `COLORS.blu` / `COLORS.bluA`, and `blu` IS `CATEGORY_COLORS.Mastered`.
Reasoned through and accepted — a single-hue ladder asks to be read as *value*, not as a
band — but nobody has yet watched a learner meet a dark blue bubble cold. The question to
answer is narrow: **does drain read as "mastered" to someone who has been using the decks
page?** If yes, swap the whole ladder to teal (`COLORS.tea` / `COLORS.teaA`), which is one
token change and no structural work. Also unchecked on a phone in daylight: tone-1 pinyin
`#EF476F` on the drain body at 1.51:1.

> The other adjacency this item used to carry — charcoal's body against the English
> grey — was **not** a paper risk, it was a real one: it was reported from play the same
> day and fixed by the three-channel palette in § 2.2. Worth remembering as a pattern:
> a bubble palette has to be checked against **every** bubble on the field, not just
> against the other member of its own pair.

**O2 — `ChallengeScoringSpec` numbers. RESOLVED 2026-09-02.** Settled in two moves on the
same day, and the second only became necessary because of the first.

* **Filler went to 0** (`fillerHit`, was 20). The run ends on the LAST contested clear
  and nothing charged for time, so paid filler was farmable: clear eight of nine, then
  harvest bubbles for as long as you dared — with overflow forfeiting nothing, the only
  downside was the risk of a wrong match. `fillerMiss` stays at −20 so filler is pure
  risk rather than inert.
* **A clear bonus** now scores time: **+300**, flat for the first 1:00 of active time,
  −25 per 15 s thereafter, floor 0 at 4:00, and **forfeited unless the set is cleared**.

The forfeit is the whole design, not a detail. A naive per-second penalty charged to
every run pays players to fail fast, because a run that ends on a wrong match at 0:30
posts a better clock than a clean 9-of-9 at 4:00 — the finisher played longer *by
definition*, so no rate fixes the sign. Gating on completion means the term only ever
compares runs that are comparable. It also cannot invert the word ranking (complete =
`900 + bonus ≥ 900`, best partial = `800 − 100 = 700`), which is what allows a pot as
large as a third of the round.

The numbers are a **first guess** — nothing stores a round's duration, so there is no
telemetry on real clear times, and the deal rate is partly RNG (contested words arrive
one per bloom roll; the squeeze locks them out entirely). The 1:00 grace is the hedge: a
rate guessed too aggressively can fail to separate a fast run but cannot punish one.
Revisit once real rounds exist. Full rationale in § 7.5. That is a defensible floor and not the final design — the honest
fix is a completion bonus that decays with elapsed active time, which the existing
`survival`/`elapsedPenalty` bonus kinds can already express without new machinery.

**O3 — Suppressed-mark logging (§ 8.1). RESOLVED 2026-08-20.** The question the log was
collected to answer — *should the cooled tier be deleted in favour of lending?* — has
been answered the other way: lending moved to the BOTTOM of the ladder and the cooled
tier now fires ahead of it (PROVISIONAL_CARDS.md § 4b). Marks suppressed on a resting
card are the intended behaviour, not a cost to be engineered away. What remains open is
purely a UI question: nothing tells the learner that a card is resting and earning
nothing.

### Resolved

| # | Question | Resolution | Lives in |
|---|---|---|---|
| Q1 | The mark guard silently kills cooled-tier marks that count today | Ship the guard, keep the cooled tier, log suppressed marks and revisit — revisited 2026-08-20: the cooled tier was promoted **above** lending | § 8.1 |
| Q2 | The `34` count cliff vs the area-keyed overflow loss | Re-key the whole spawn table on **fill ratio**, so both systems read one number | § 3.1 |
| Q3 | Hydra's challenge scoring, given no fixed round count | Challenge words are single-color; score = time to clear all 10; wrong match ends the run and banks what was matched. **Their color moved yellow → bloom on 2026-08-21** with the two-color rework | § 7.5 |
| Q3c | The challenge slot's share is too small to deliver 10 challenge words | Was: raise yellow to 25–30% in all modes. **Moot since 2026-08-21** — challenge words ride bloom, which is 55% of the growth zone and 100% of the opening | § 3.1 |
| Q9 | Four payout colors, or fewer? | **Two** (2026-08-21): net −1 drain and net +1 bloom, each a union of two utcm bands. Yellow was break-even and green a weaker blue; the player reads one bit instead of a four-rung table | § 2.1 |
| Q9b | Can the old 65%-hard mix survive the merge? | **No.** Growth is `2·bloomShare − 1`, so bloom must be over half or the board drains. Steady state inverted to bloom 55 / drain 45 | § 3.0 |
| Q9c | Keep the mastery palette for the two colors? | **No** — a tier is now a union of two bands and a lent card is colored by difficulty, so band hues would mislead. Hydra owns its hues | § 2.2 |
| Q9d | Is "off the mastery *tokens*" enough? | **No** (same day). The first replacement was an ember/ocean pair, which is off the tokens but still reads as the ramp's red/blue — a learner decodes it as hard/known, which a lent bubble makes false. Repainted **charcoal/gold**, and `HydraColor` renamed off hue names to `"drain" \| "bloom"` so the next palette pass touches no identifier — which paid off on 2026-08-22, when the ladder became two shades of blue and **no identifier moved**. Note that answer has now been partly walked back: the blue ladder IS on the mastery hue, accepted for the reasons in § 2.2 | § 2.2, types.ts |
| Q4 | `CARD_BASELINES` value | **0** — no minimum, lend from the first bubble | § 6.5 |
| Q5 | Grey English bubbles vs the grey held/hovered state | ~~Hydra's held cue becomes an outline ring + scale, no grey~~ — **reversed 2026-08-22**, and the original tension is BACK: the English bubble is grey again (§ 2.2), so grey once more means both "English" and "held". Accepted, because the wash is not a tint of the same value — `rgba(90,90,90,0.32)` over `#E7E7EA` lands near `#BABABA`, ~1.5:1 against the resting body — and the cue also scales the bubble up. Revisit if a held English bubble proves hard to spot mid-drag | § 5.1 |
| Q6 | Does the mid-run lend popup freeze the board? | Yes — a modal over a live drag is the hazard, not the clock. **MOOT since 2026-09-05:** the popup was replaced by a per-bubble hourglass badge, so lending no longer opens a modal at all. The freeze rule still applies to any modal Hydra does show | § 6.4 |
| Q7 | Anti-zero: reactive or a floor count? | Purely reactive; no floor, because a floor re-stabilizes the economy | § 4.3 |
| Q8 | Spanish, or zh-only? | Both — no `languages` gate | § 9 |
| Q9 | Per-color match guarantee: may it spend a slot the payout did not buy? | **No — within budget only.** That makes it best-effort rather than absolute, since a drain clear buys one slot | § 4.3 |
| Q10 | When both colors lack a live match, which one does the single slot go to? | **Board fill decides:** below 0.5 bloom, at or above 0.5 drain | § 4.3 |

---

## 12. Dependencies

### Docs this one depends on / must be kept in step with

| Doc | Relationship |
|---|---|
| [GAMES_FEATURE.md](./GAMES_FEATURE.md) | needs a Hydra row in the shipped-games list and a `## Game: Hydra Bubbles` section once built |
| [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) | **updated 2026-08-20** — its § 3b (re-lend before minting, now unconditional), § 3c (a lent card keeps its tier) and § 4 (`targetLevel`; partial refills provision per-game) were written for Hydra's § 6 and are built. Its § 4b moved lending to the LAST fill tier app-wide, which changes Hydra's ladder (cooling cards first). Its § 5 table still needs a Hydra row for the mid-run notice |
| [MASTERY_REWORK.md](./MASTERY_REWORK.md) | § 8 changes what a cooldown means app-wide; § 5 makes color and mastery deliberately disjoint — and since 2026-08-21 a Hydra color is a UNION of two utcm bands, wearing neither their names nor their hues nor anything a learner could mistake for them (§ 2.1, § 2.2) |
| [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) | § 9 adds a recognition game to the challenge pool (Q3) |
| [BENTO_SYSTEM.md](./BENTO_SYSTEM.md) | single hub row, no array item (no levels) |
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
| bubble render | `src/games/bubbles/Bubble.tsx` — takes `fill` (§ 5); everything else about a bubble is fixed there (§ 2.2, § 5.1) |
| **Hydra** | |
| the two payout tiers (§ 2.1) | `src/games/hydra-bubbles/types.ts` → `HydraColor` (`"drain"` \| `"bloom"`), `HYDRA_COLORS` |
| spawn distribution (§ 3) | `src/games/hydra-bubbles/spawnTable.ts` → `rollColor`, `PAYOUT_BY_COLOR`, `HYDRA_SPAWN_ANCHORS`, `DRAIN_ONLY_WEIGHTS`, `expectedPayoutAt` |
| spawn algorithm + invariants (§ 4) | `src/games/hydra-bubbles/spawnPlanner.ts` → `planSpawnBatch`, `hasLiveMatch`, `nextKindByRatio` |
| per-color guarantee (§ 4.3 invariant 3) | `src/games/hydra-bubbles/spawnPlanner.ts` → `neededColor`, `oldestStrayOf`, `completionOf`; threshold `COLOR_NEED_TIEBREAK_FILL` in `constants.ts` |
| color buffers (§ 6.2b) | `src/games/hydra-bubbles/useColorBuffers.ts` → `useColorBuffers`, `fetchColor` (sends the band split + `strictBuckets=1`) |
| band → color mapping (§ 5) | `src/games/hydra-bubbles/constants.ts` → `BUCKETS_BY_COLOR` |
| tier offsets (§ 6.2) | `src/games/hydra-bubbles/constants.ts` → `TIER_OFFSET_BY_COLOR` |
| the field + palette (§ 2.2) | `src/games/hydra-bubbles/HydraStage.tsx` → `FILL_BY_COLOR`, `BLUE_DARK`, `BLUE_LIGHT`; text ink is derived in `src/games/bubbles/Bubble.tsx` → `inkOnFill` |
| page shell | `src/games/hydra-bubbles/HydraBubblesPage.tsx` |
| post-run review board (§ 7.3b) | `HydraStage.tsx` → the `cleanupMode` prop, `cleanupModeRef`, `revealPartner`, `clearRevealedPartner`, `dangerDismissed`; `HydraBubblesPage.tsx` → `popupMinimized`. Reference implementation: `src/games/bubble-match/BubbleStage.tsx` → `cleanupMode` |
| per-bubble lent mark (§ 6.4) | `src/games/bubbles/Bubble.tsx` → the `lent` prop; `src/games/hydra-bubbles/HydraStage.tsx` passes it |
| the mark itself | `src/components/LentCardBadge.tsx` (`LentCardBadge` / `LentCardIcon`) |
| lent words the run reviewed | `src/hooks/useMarkedLentWords.ts` |
| registry + hub row | `src/games/registry.ts` → `GAME_REGISTRY`; `COLORS.tealAccent` (`src/theme/colors.ts`) |
| minute points (§ 9) | `src/constants.ts` → `MINUTE_POINTS_ELIGIBLE_PAGES` |
| challenge spec (§ 7.5) | `server/contracts/wire.ts` → `CHALLENGE_GAMES` |
| challenge round wiring (§ 7.5) | `src/games/runtime/useChallengeRound.ts` (scorer + active-time clock) and `ChallengeRoundScoreboard.tsx`; `HydraBubblesPage.tsx` → `fetchChallengeCards`, `shouldEndRun`, `remainingContestedRef`; `useColorBuffers`'s third argument (the bloom-slot queue); `HydraStage.tsx` → the `shouldEndRun` prop |
| **Server** | |
| refill lending opt-out (§ 6.1) | `server/contracts/wire.ts` → `ROLLING_SUPPLY_SURFACES`, `isRollingSupplySurface`; `OnDeckVocabService.getGameVocabPool` → `lendOnRefill` |
| tier resolution (§ 6.2) | `ProvisionalCardService.resolveLendLevel`; `?lendLevelOffset=` on the pool endpoint |
| strict buckets (§ 6.2d) | `OnDeckVocabController.getGamePool` → `strictBuckets`; `OnDeckVocabService.getGameVocabPool` → `opts.strictBuckets`, `substituting` |
| re-lend before minting | `ProvisionalCardService.acquireLentCards` → `ProvisionalCardDAL.findHeldProvisional`, called from `lendGameCandidates` (was `OnDeckVocabService.fetchRelendable`, removed 2026-08-20) |
| lend as the last fill tier (§ 4b) | `OnDeckVocabService.getGameVocabPool` → tier 5; `fetchRowsByIds` (was `fetchLentRows`, generalised 2026-08-22 when the challenge board needed the same hydration) |
| challenge board (§ 7.5) | `OnDeckVocabService.getChallengeGamePool`; `StudyChallengeService.getRoundContext` |
| cooldown mark guard (§ 8) | `server/services/FlashcardMarkService.ts` → `applyMark`, the `[MarkSuppressed]` branch |
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

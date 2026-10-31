# Deck Tower Transitions (deck switch)

Tapping the Deck Tower's floor plate switches the tower between the learner's **Learning**
and **Mastered** decks. The plate cuts straight to the other deck's colour and name. Then a
**deck transition** clears the old tower off the platform, a **pawn entrance** brings on a
new pawn, and the new deck's tower grows. Transitions and entrances each come from a
registry with one random pick per swap. Each registry has one entry today. Each world
(main, reading, writing) swaps on its own (§ "Several worlds").

Parent: [DECK_TOWER.md](./DECK_TOWER.md). The drawing primitives are in
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md).

## Status

- Built on dev, 2026-10-18. Front-end only: no new endpoint, table or migration. The
  Learning figure comes from the existing `GET /api/onDeck/flpReadyCounts`
  (`useFlpReadyCounts`), the Mastered figure from `GET /api/onDeck/masteredCounts`
  (`useMasteredCounts`).
- Registries: one deck transition (**trap door**) and one pawn entrance (**fall from the
  sky**).
- The page always opens on Learning. The chosen deck is not persisted.

## Layers

| Layer | File → symbol | Role |
|---|---|---|
| Page | `src/features/deckTower/DeckTowerPage.tsx` → `DeckTowerPage` | Reads the counts, runs one `useDeckSwap` per world (`swaps`), wires the plate to `onPlateTap`, measures the on-screen world's `fallDistance` and `splatFloor` in the scene memo, and hands the platform what that world's swap says each frame |
| Page view | `src/features/deckTower/DeckTowerPlatform.tsx` → `DeckTowerPlatform` | Draws the platform from that: the plate face, the hinge angle, the falling old tower and pawn (`fallSx`), and the pawns' depth slots (`pawnDepthRanks`) |
| Page logic | `src/features/deckTower/useDeckSwap.ts` → `useDeckSwap`, `swapView`, `PLATE_SETTLE_MS` | Owns which deck is up and the clock of a running swap. It draws nothing. It returns a `DeckSwapView` (pure `swapView(plan, now)`) |
| Page logic | `src/features/deckTower/deckTransitions.ts` → `DeckTransition`, `TRAP_DOOR`, `DECK_TRANSITIONS`, `pickDeckTransition` | Pure timelines that clear the old tower |
| Page view | `src/features/deckTower/CardSplat.tsx` → `CardSplat`, `SPLAT_MAX_MS` | The optional card splat at the bottom edge, driven by the swap clock |
| Page constants | `src/features/deckTower/towerDecks.ts` → `TOWER_DECKS`, `TowerDeckId`, `otherTowerDeck` | The two decks' title, plate label, plate colour (`band`), the same in every world |
| Framework | `src/features/deckTower/iso/pawnEntrances.ts` → `PawnEntrance`, `FALL_FROM_SKY`, `PAWN_ENTRANCES`, `pickPawnEntrance`, `entranceStartFor` | Pure timelines of how a pawn arrives |
| Framework | `iso/usePawnMotion.ts` (`entrance` mode, `floorDrop`), `iso/IsoPawn.tsx` (`entrance`, `floorDrop` props) | Plays an entrance, then hands the pawn to its idle wander; drops the old pawn through the trap door on its own and pops its "!" |
| Framework | `iso/IsoPlatform.tsx` (`hingeAngle`, `decals`), `iso/geometry.ts` → `Hinge`, `hingePoint`, `hingedOutline`, `hingedPrism`, `hingedPlaneTransform` | The trap door |
| Page logic | `src/features/deckTower/usePlatePress.ts` → `usePlatePress` | The plate's push-button press: held flush, fires on release, pops back up with the new face |
| Framework | `iso/IsoFloorLabel.tsx` (`raised`, `RAISED_HEIGHT`) | The raised plate |
| Framework | `iso/IsoShadow.tsx` (`solid`) | The shadow of the tilted door |

## The decks

`TOWER_DECKS` (`towerDecks.ts`):

| Id | Title | Plate label | Band (plate + top card head band) | Count |
|---|---|---|---|---|
| `learn-now` | Learning | LEARNING | `RAMP[LEARNING_HUE].mid` (`yelM`) in every world | `bandTotal` over the READY counts (`useFlpReadyCounts(bar)`): off-cooldown cards in all four utcm bands (`TOWER_MODES.mix.bands`, [DECK_TOWER.md](./DECK_TOWER.md) § Study mode) |
| `mastered` | Mastered | MASTERED | `RAMP[MASTERY_BAR_HUES.core].mid` (`bluM`) for both — blue in every world | `builtinCollectionCount({ kind: "mastered", bar }, …)`: `useMasteredCounts().counts[bar]` |

`bar` is the world's id (`core` / `reading` / `writing`, towerWorlds.ts). Learning
is the ready cards of all four bands, by the flp's readiness rule — the study hand's Mix
figure — NOT the fdp's Learning tile, which counts cooling cards and leaves out
Mastered. Mastered matches the Mastered tile. A band is the deck's fdp hue at the `mid` tier, because the pale
`surface` tier washes out on the cream card face.

`titleDeck` is the deck face-up on the plate; it changes at the moment the plate's face
changes (the pawn's shaded copy of the plate follows it). The page title names the world,
not the deck ([DECK_TOWER.md](./DECK_TOWER.md) § "Worlds").

## The swap timeline

`useDeckSwap` runs one swap on one clock, in ms since the tap:

```
0 ── PLATE_SETTLE_MS ──▶ t = 0 ─────────── clearedMs ─────────── readyMs ──────── durationMs
 plate + title cut     transition starts:  old tower + pawn     new pawn LANDS;   follow-through
 to the new deck;      door drops, old     are gone; the scene  new tower starts  ends; the swap
 plate pops back up    tower falls, its    refits to the new    growing           settles
                                                   pawn pops "!"; the  deck's count
                                            new pawn mounts,
                                            hidden until its
                                            entrance starts
                                      (optional impactMs — the trap door's = clearedMs: the card splat)
```

- **Two beats.** Every transition plan names `clearedMs` and `readyMs`, and the rest of
  the swap hangs on them:
  - `clearedMs`: `towerDeck` switches to the new deck, so the scene memo refits the
    viewBox. The scroll re-snaps to the bottom.
  - Between the two beats, `towerOnStage` is false. No stack is drawn, `cardsOnTower` is
    0, and `useBuildProgress` resets to 0.
  - `readyMs`: the build-up starts for the new count. The clouds, wind, sky → space
    and the 50-card startle all replay off the new build-up.
- **Landing is the sync point.** The new pawn's entrance is scheduled backwards from
  `readyMs` (`entranceStartFor(entrance, readyAt) = readyAt − entrance.landMs`). Any pair
  of transition and entrance therefore lands the pawn on the beat. With the trap door,
  that beat is the moment the door slams shut.
- **The incoming pawn mounts at t = 0** and stays hidden until its own start. Mounting it
  early keeps its mount and first paint away from the landing beat. A new pawn key per
  swap makes the entrance play on mount.
- **The old tower falls as it stood.** `frozenProgress` is the build-up's progress at the
  tap, so a tap mid-build drops a half-built tower.
- **Taps are ignored** while that world's swap runs (`busy`), while the camera is
  panning between worlds, and until its counts have loaded (`countsLoaded`).
- **On tap the scroller smooth-scrolls to the bottom.** `fallDistance` is measured from
  the bottom, and the refit at `clearedMs` re-snaps there.
- **Reduced motion:** a tap switches the deck instantly, with no transition or new
  pawn.
- **The clock** is React state ticked by rAF only while a swap runs (about 2–3 s). This is
  the same per-frame-render pattern as the tower's build-up.

### Several worlds

Every world ([DECK_TOWER.md](./DECK_TOWER.md) § "Worlds") has its OWN `useDeckSwap`
(`DeckTowerPage` → `swaps`): its own deck, plate, transition pick, pawn keys and splat
roll. Swapping one never touches the others. Only the world on screen is drawn, so only
its plate can be tapped.

- **No pan mid-swap.** The world swipe and the edge arrows are off while the on-screen
  world's swap runs, and the plate is off while the camera pans — so a fall is always
  measured for, and played in, the scene on screen.
- **Fall distance** (`scene.fallDistance`) and **the splat** (`scene.splatFloor`) are the
  on-screen world's: its tower's top to the screen's bottom edge, and its tower's screen-x
  span, in that world's band.
- **Regrowth.** A skill world's tower otherwise stands at full height without a build-up;
  after its swap the new tower grows like the main one's (`useBuildProgress` `animate` =
  that world's swap is busy).

### Pawns during a swap

`DeckSwapView.pawns` lists every pawn to draw. Normally that is one pawn. Mid-swap it is
the outgoing pawn (until `clearedMs`) plus the incoming one (from t = 0).

- **Fall wrapper.** `DeckTowerPlatform` wraps each pawn in its own keyed wrapper, so a pawn
  that starts falling is not remounted. Unlike the tower's, the outgoing pawn's wrapper takes
  only the `deck-tower-page__falling` class (its shadow fades), NOT the drop's translate: the
  pawn follows the drop itself (next bullet).
- **Depth slots.** Each pawn reports its depth slot under its own key (`pawnDepthRanks`).
- **Startle.** The incoming pawn can only be startled once the old tower is gone. The
  motion loop also drops a startle that arrives mid-entrance.
- **The pawn falls on its own.** `DeckTowerPlatform` hands the outgoing pawn the door's drop in
  world units (`IsoPawn` `floorDrop` = `dropPx / proj.unit`). With nothing to stand on, the
  pawn's feet run in free flight (`usePawnMotion.ts` → FLOOR DROP): a pawn the plate has just
  LAUNCHED (the release that started this swap: it peaks about its own height up ~209 ms
  later, and `PLATE_SETTLE_MS` is never shorter than that) is already coming back down when
  the door opens — ~1.4 units up at today's timings. Its height then blends over
  `FALL_BLEND_MS` (350 ms) from its own free fall (pawn gravity, 110) into where it would be
  standing on the falling door (`lift − floorDrop`; NOT measured from where its fall began,
  or it would trail the door by its launch height and still be on screen when unmounted). So
  it falls out of the air instead of being yanked down with the door, merges into the door's
  curve with no reversal, and is off-screen by `clearedMs`, even for the shortest (12-unit,
  ~0.41 s) fall. A pawn standing on the floor does the same from rest. A pawn mid edge hop falls from wherever the hop's arc had it.
- **Alarm.** Its white "!" bubble pops the moment its own fall starts (not at t = 0 — a
  launched pawn notices on the way down). That is the startle's bubble alone, with no lean or
  leap (emote `leanSign: 0`). It keeps walking in mid-air, legs still.

## The plate

Every world's floor plate (`TowerPlatformLayout.labelPlate`) is that world's deck switch. Its hit
area is the plate grown by 0.5 units on every side (`labelPlateHit`), because the printed plate is only about
18 px deep on a phone. It is a `role="button"` `<g>` that also responds to Enter and Space.

### The plate button

`usePlatePress` (spread on the plate's `<g>` by `DeckTowerPlatform`). At rest the plate
stands slightly raised (`IsoFloorLabel` `raised` = 1) so it reads as a push button.

1. **Press** (pointer down, or Enter / Space down): it sinks flush with the floor over
   `PRESS_MS` (80 ms, ease-out).
2. **Release over the plate** (pointer up, key up): the deck switch fires (`onPlateTap`).
   A quick tap waits for the plate to bottom out first, so the switch always starts from
   flush.
3. **Pop back up** straight away, over `POP_MS` (220 ms, ease-out with a small overshoot —
   the button's spring), already showing the other deck (below).

Sliding off the plate, a scroll taking the pointer (`pointercancel`) or losing focus lets it
back up without firing. Because touch pointers are implicitly captured, the release checks
`document.elementFromPoint` to be sure it lifted over the plate. It does not press mid-swap
or while the camera pans between worlds. A horizontal drag that starts on the plate becomes
a world swipe: the scroller captures the pointer, so the plate lets go without firing.
If the page ignores the tap (counts not loaded) the plate simply pops back up. Under
prefers-reduced-motion the height jumps instead of easing.
While the tower is studied the plate fades away with the platform and ignores taps
(`DeckTowerPlatform` → `plate.busy`; [DECK_TOWER.md](./DECK_TOWER.md)
§ Studying the tower → "The platform fades").

**The face change is a hard cut.** On release the plate's band and label switch to the
other deck in a single frame — no flip, fade or colour blend (`useDeckSwap` →
`titleDeck` becomes the new deck the instant the swap starts). The page title cuts over in
the same frame.

The plate then has `PLATE_SETTLE_MS` (300 ms) — during which it pops back up — before the
transition starts, so the new label reads as settled before the door drops out from under it.
It is `max(PLATE_POP_SETTLE_MS, PLATE_LAUNCH_APEX_MS)`: never shorter than a launched pawn's
time to apex (`usePawnMotion.ts` → `PLATE_LAUNCH_APEX_MS`, ~209 ms), so the door never opens
under a pawn still on its way up. At today's pawn gravity the 300 ms settle is the longer.

- **Always a floor decal.** The plate never leaves the floor, so it is drawn among the
  platform's floor decals throughout and swings with the trap door.
- **The pawn's shaded copy** (`decals`) shows the same face as the plate.
- **A pawn on the plate is thrown by it.** The plate is also the pawn's step (`DeckTowerPlatform` →
  `plateStep`, `IsoPawn` `steps`) at its live `raised · RAISED_HEIGHT`. The pawn's feet run
  under gravity (`usePawnMotion.ts` → feet physics, docs/ISO_ART_FRAMEWORK.md § "IsoPawn"):
  pressing the plate drops it out from under the pawn, which FALLS onto it a moment later;
  releasing it LAUNCHES the pawn into the air off the plate's spring, landing in a couple of
  shrinking bounces — and since the release also starts the swap, the door opens under it
  as it comes back down and it drops from the air (§ "Pawns during a swap"). Walking onto or
  off the plate is a standing hop with a crouch before and a recovery after (the edge hop).

## Deck transitions

`deckTransitions.ts`. A `DeckTransition` is `{ id, plan(ctx) }`:

- **Context.** `ctx` is a `DeckTransitionContext`. It holds `fallDistance`: the world
  units the old towers must drop for the highest one's top, or its platform's back corner
  when the tower is short, to pass below the scroller's bottom edge (+ `FALL_CLEARANCE`).
- **Plan.** It returns a `DeckTransitionPlan`: `{ clearedMs, readyMs, durationMs, impactMs?, frame(t) }`.
  `impactMs`, when set, is the moment the fallen tower hits a floor below the screen; the
  page plays the card splat from then (see § "The card splat").
- **Frames.** `frame(t)` returns a `DeckTransitionFrame`. Every field rests at its
  "nothing happening" value. Today the fields are `hingeAngle` (→ `IsoPlatform`) and
  `outgoingDrop` (world units the old tower and pawn have fallen; the page translates them
  by `drop · UNIT` screen px).

**Adding one:** write a `DeckTransition` and list it in `DECK_TRANSITIONS`. If it needs a
new effect (a sideways slide, a fade, …), add the field to `DeckTransitionFrame` with a
resting default and draw it in `DeckTowerPlatform` (fed by `DeckTowerPage`).

### Trap door (`TRAP_DOOR`)

The platform drops open like a trap door hinged on its **back-left** top edge: the
`xMin` edge, upper-left on screen. The tower and the pawn fall straight down off the bottom
of the screen. The door then swings back up and slams shut, and the new pawn lands on the
slam.

| Phase | Constant(s) | Motion |
|---|---|---|
| Drop | `TRAP_DROP_MS` 340, `TRAP_OPEN_ANGLE` 86° | `θ = open·u²`, an ease-in as gravity takes it |
| Bounce | `TRAP_BOUNCE_MS` 300, `TRAP_BOUNCE_ANGLE` 10° | It hits its stop and rebounds once (`open − 10°·sin πu`) |
| Fall | `TRAP_FALL_DELAY_MS` 50, `TRAP_GRAVITY` 140 u/s², `TRAP_FALL_MAX_MS` 1400 | The contents start a beat after the door, so the gap visibly opens under them. Gravity is raised just enough that a tall tower clears within 1.4 s. `clearedMs = delay + fall` |
| Hold | `TRAP_HOLD_MS` 220 | The empty door hangs open after `max(clearedMs, drop + bounce)` |
| Close | `TRAP_CLOSE_MS` 560 | `θ = open·cos(πu/2)`: slow start, fast finish, so it slams. It ends at `readyMs` |
| Rebound | `TRAP_REBOUND_MS` 220, `TRAP_REBOUND_ANGLE` 3° | It bounces off the frame. `durationMs = readyMs + rebound` |

Sample durations from t = 0: a short tower (fall 12 u) is ready at about 1.4 s, a
60-unit fall at about 1.8 s, and a 240-unit tower at about 2.2 s. Add `PLATE_SETTLE_MS`
(300 ms) for time since the tap.

**How the door is drawn** (`IsoPlatform` with `hingeAngle`):

- **The slab.** `hingedPrism` rotates the slab's two outlines about the hinge
  (`hingePoint`: a rotation in the XZ plane that sends +x down). A rotated convex solid is
  still convex, so its silhouette is still the hull of the two outlines.
- **Faces.** The top face stays toward the viewer up to 3π/4 and the underside never
  shows, so the `IsoSolid` recipe (walls, then the top over them) holds at every angle the
  door swings through.
- **Floor and decals.** The inset floor is flat, so one affine `hingedPlaneTransform`
  carries it and the decals onto the swung plane, with no re-projection. The plate is
  raised (it has height), so it reads the open hinge from `IsoDeckHingeContext`, cancels that
  transform and draws itself swung in true 3-D (`hingedPrism` walls, a hinged face) —
  otherwise its walls would lie along the door instead of standing square off it.
- **Shade.** As the top turns to face +x (the way the right walls face), a veil of
  the world's platform right-wall tone (`PlatformTone.material.right`; gold's is `ISO.platform.right`) darkens it, up to `SWING_SHADE_MAX` (0.7) at π/2. The veil stops
  short of 1 so it shades the print instead of erasing it.
- **Shadow.** The ground shadow is `IsoShadow`'s `solid` form: every rotated vertex slides
  along the light for its own height, and the shadow is the hull of where they land. The
  ground is only 1.6 units under the slab (`GROUND_Z`), so a door hanging at 86° would
  plunge through it: the shadow fades out as the door's lowest point nears the ground
  (`IsoPlatform` → `swungShadow`; gone by ~8° open on the default platform) and fades back
  in on the close — the slam's 3° rebound dims it briefly.
- **Clipping.** Hanging at 86°, the door reaches below the scene's bottom edge, so the
  scroller clips its lower part at the footer bar.

**The fall** (`DeckTowerPlatform` → `fallSx`; the CSS rule is in `DeckTowerPage`): the stack and the outgoing pawn sit in keyed
`<g>` wrappers that take `translate(0, drop·UNIT)` and the class
`deck-tower-page__falling`. That class fades their floor shadows out over 120 ms, because
the floor has gone from under them. The CSS targets the shadow paths' own classes, because
the pawn's shadow group has its opacity written inline every frame. The fall is a straight
drop: nothing tips or slides off the tilting door.

**The splat roll.** Each plan rolls `TRAP_SPLAT_CHANCE` (0.2). On a hit it sets
`impactMs = clearedMs`: the splat comes only after the last card has dropped out of sight.

### The card splat

`CardSplat.tsx`, page view. When the plan has `impactMs`, `DeckSwapView.splat` is
`{ id, elapsedMs, cards, deck }` from then on (`id` = the swap's start time, used as the
React key). `cards` and `deck` are the FALLEN tower's: the page hands its standing card
count to `toggle` at the tap (`DeckSwapStart.cards`), because by `clearedMs` it has moved
on to the new deck. The page draws the on-screen world's `CardSplat` over the whole scene, after the platform.
It has no timer of its own: it is a function of `elapsedMs` from the swap clock.

- **The burst** is rolled once on mount (`rollBurst`): one flying card per
  `CARDS_PER_FLYER` (20) cards that were on the tower, clamped to 5–14. No cards on the
  tower means no burst. The count and band come from the swap view (the fallen deck).
- **The cards** are flat screen-space silhouettes: card stock (`ISO.card.top`, outlined
  `ISO.cardSeam`) with the fallen deck's head band. They spin in the picture plane, and
  flip end over end by squashing one axis; the back shows `ISO.card.left`. Each is
  `FLYER_SCALE_MIN`–`MAX` (0.32–0.48) of a card's footprint, since the floor they bounce
  off is further down.
- **The motion.** The cards leave from across the tower's screen-x span
  (`scene.splatFloor`), starting half a card below the edge so they emerge rather than
  pop in. Departures are spread over `SPLAT_SPREAD_MS` (220 ms), most of them early. Each
  rises 3.5–9 units under `SPLAT_GRAVITY` (170 u/s²) and sprays mostly outward (one in
  five crosses over).
- **Timing guarantee.** Every card is back below the edge within `SPLAT_MAX_MS` (950 ms).
  That fits inside the shortest stretch between a trap door's impact (`clearedMs`) and the swap's end
  (hold + close + rebound = 1000 ms), so the splat never outlives the swap clock that
  drives it.

## Pawn entrances

`iso/pawnEntrances.ts`. A `PawnEntrance` is
`{ id, landMs, durationMs, frame(t) → PawnEntranceFrame }`:

- `landMs` is when the feet first rest on the floor. Entrances are always scheduled by
  this landing time, never by their start.
- `durationMs` covers the landing's follow-through.
- A frame is `{ hop, sx, sy, shadowScale, shadowOpacity }`.

**How it plays** (`usePawnMotion`): a pawn mounted with `entrance: { animation, startAt }`
starts in the `entrance` mode from its first render.

- **Hidden until `startAt`.** `travel` is set to `visibility: hidden`, and `IsoPawn`
  hides it from the first paint so it never flashes on the floor.
- **Then frames.** It plays the frames, writing `hop`, `pose` and the shadow from them.
- **Then idle.** It goes into the idle wander's opening pause.
- **Startles are dropped** mid-entrance.
- **Reduced motion:** nothing plays and the pawn simply stands there.

**Adding one:** write a `PawnEntrance` and list it in `PAWN_ENTRANCES`.

### Fall from the sky (`FALL_FROM_SKY`)

The pawn drops from `SKY_FALL_HEIGHT` (55 units, off the top of a phone screen over the
platform) under `SKY_FALL_GRAVITY` (60 u/s² — its own, gentler than the pawn's 110
`PAWN_GRAVITY`, which read as too fast from this height). That gives `landMs` ≈ 1354 ms and
~81 u/s at impact. `landMs` must stay under the shortest trap-door `readyMs` (1420 ms, an
empty tower), or the entrance would be scheduled to start before the swap does.
`FALL_FROM_SKY` is the module-private `fallFromHeight(SKY_FALL_HEIGHT)` (`landMs` = √(2h / g)).

- **In the air** it is stretched (0.92 × 1.1).
- **Shadow.** Its shadow is a faint dot while it is high, and grows to full size and tone
  over the last `SKY_FALL_SHADOW_REACH` (12) units. That is the "something is coming down
  here" cue.
- **Landing.** It lands with a `SKY_FALL_SQUASH` (0.3) squash that eases out over
  `SKY_FALL_SQUASH_MS` (260 ms). This is harder than a startle's landing because it fell
  a long way.
- **Shadow position.** The shadow stays under the landing spot, like the pawn's step and
  leap shadows. It does not slide along the light with height.

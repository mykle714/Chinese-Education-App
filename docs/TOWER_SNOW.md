# Tower Snow

Snow on the Deck Tower (td): flakes falling in front of the platform, and snow that
**settles** on the platform's components and stays there until the learner clears it.
Purely aesthetic. It rides on the weather ([DECK_TOWER.md](./DECK_TOWER.md) § Weather), so
it shows only with Settings → Display → Weather effects on, or with a feature tester's
weather pin.

Parent: [DECK_TOWER.md](./DECK_TOWER.md) § Weather. The drawing parts are in
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § Snow and § IsoSnow.

**Status:** built 2026-11-09, client only. No migration, no server change. Not yet
checked in a browser.

## Layers

| Layer | File → symbol | Role |
|---|---|---|
| Page logic | `src/features/deckTower/towerSnow.ts` → `settleOnEntry`, `clearedClock`, `SNOW_SETTLES_AFTER_MS`, `SnowComponent`, `SNOW_COMPONENTS`, `snowKey`, `readSnowClocks`, `writeSnowClocks`, `clearSnowStorage` | The rule (pure) and the per-device store |
| Page logic | `src/features/deckTower/useTowerSnow.ts` → `useTowerSnow`, `TowerSnow` | Live state: settling each world on entry, `clear` (with or without a brush-off), each world's trail store, the tester `reset` |
| Page | `src/features/deckTower/DeckTowerPage.tsx` → `towerSnow`, `snowCoverText`, `platformSnow`, `snowFall`, the swap / study / drop clear effects (`swapBefore`, `studyWorld`, `dropLandedKey`), the lever / notebook / sort-bin `onTap` wrappers | Wires state to the scene and calls the clears |
| Page view | `src/features/deckTower/DeckTowerPlatform.tsx` → `snow`, `snowFall` props, `ground`, `snowTop`, `textSurface`, `textOverSnow`, `plateBuried`, `plateDrift`, `PLATE_DRIFT_RECT`, `floorSlide`, `snowLying`, `shadowReceiverFor`, `shadowGround`, `trailWalkers`, `SNOW_SLID_OFF_ANGLE` | Draws every cover, the floor sheet + trail, the falling snow |
| Page view | `src/features/deckTower/TowerCoverCard.tsx` → `snow` prop | The study's count card carrying the snow off |
| Page | `src/features/deckTower/SnowResetChip.tsx` → `SnowResetChip` | Tester "❄ Reset" chip |
| Framework | `iso/IsoSnowCap.tsx` → `SnowCover`, `IsoSnowShed`, `SnowSlab`, `IsoSnowCap`, `IsoCardSnow`, `IsoBallSnow`, `SNOW_CAP_DEPTH`, `SNOW_SHED_MS`; `iso/IsoSnowFloor.tsx` → `IsoFloorSnow` (`drift`), `IsoSnowSkirt`, `FLOOR_SNOW_DEPTH`; `iso/snowTrail.ts` → `SnowTrail`, `newSnowTrail`, `capSnowTrail`, `MAX_TRAIL_POINTS`; `iso/pawnFigure.ts` → `PAWN_BODY_RADIUS`, `pawnSnowClip`; `iso/snowChannel.ts` → `useSnowTrailRecorder`, `useSnowChannel`, `SnowWalker`; IsoPawn / usePawnMotion `snowDepth`, `PawnStep` `snowDepth`; `shadowReceiver` on `IsoCardStack`, `IsoPaperStack`, `IsoSortPlatform`; `iso/IsoSnow.tsx` → `IsoSnow`, `IsoSnowFall`; `iso/palette.ts` → `snowMaterial` | The drawing parts |
| Framework | `snow` props on `IsoCardStack`, `IsoLever`, `IsoSortPlatform`, `IsoPaperStack` | Each object draws its own snow |
| Page | `src/features/deckTower/usePlatePress.ts` → `onPress` | The plate's press, which brushes its snow off |
| Constants | `src/features/deckTower/towerWeather.ts` → `SNOW_ALPHA`, `SNOW_R`, `SNOW_SPEED`, `SNOW_SWAY`, `SNOW_SWAY_RATE` | The flake look, shared by the sky's snow (`WeatherLayer`) and `IsoSnow` |
| si | `src/softIntro/softIntroRegistry.ts` → `towerSnowCover` | Whether snow may cover text |

## The rule

`towerSnow.ts` → `settleOnEntry`, `clearedClock`; `useTowerSnow.ts` (entry effect).

Each **component** of each world keeps a clock: `{ lastClearedAt, snowy }`. The
components are `floor`, `plate`, `tower`, `lever`, `sortBin` and `notebook`
(`SNOW_COMPONENTS`), keyed `<world>:<component>` (`snowKey`).

- **The plate has no rule of its own.** It is the floor's snow lying over the deck plate.
  On entry it is buried whenever the floor's snow is new (it just settled) or it has no
  clock yet; a plate pressed clear stays clear until the trap door clears the floor
  (`useTowerSnow` entry effect).

- **Only on page entry.** A world is settled once per td mount, when the weather has its
  first answer (`useTowerWeather` → `settled`) and the world's tower count has loaded. If
  it is snowing then (`weather.kind === "snow"`, a tester pin included) and a component
  was last cleared `SNOW_SETTLES_AFTER_MS` (6 h) ago or more, it turns snowy. A component
  that has never been cleared counts as infinitely stale. Snow that starts while the
  learner is on td adds nothing until they leave and come back (owner's rule, 2026-11-09).
- **Sticky.** Once snowy, a component stays snowy, snowing or not, until something clears
  it.
- **A clear resets the clock whether or not the component was snowy.** The rule reads the
  time since the last clearing action, so a lever pulled every few hours never snows over.
- **Shown** only while weather effects are on, or a tester's weather pin is set
  (`useTowerSnow` `shown`). Hidden snow keeps its clocks.

## Storage

Per device, in localStorage under `deckTower.snow` (owner's choice): one JSON object of
clocks by `snowKey`. It is not keyed by user or language, so two accounts on one device
share their snow. Unreadable entries are dropped (that component reads as bare and never
cleared). `clear` writes the store synchronously, because Add Cards and the notebook
navigate away in the same tap and the page can unmount before an effect would run.

## The tower

`DeckTowerPage` → `platformSnow.covers.tower`; `IsoCardStack` `snow`; `IsoCardSnow`.

- **Cloud line.** A Learning tower whose count is at or above the cloud base
  (`CLOUD_BAND_CARDS.from`, 150) on entry is above the snow: it is shown bare
  (`settleOnEntry` `aboveClouds`). That is not a clear: the clock is kept.
- **Look.** A slab of snow `SNOW_CAP_DEPTH` (0.3, ~6 px) thick over the whole top card,
  hiding its print (deck name and count) — the si does not apply (owner's rule, 2026-11-09).
- **Learning only.** The Mastered tower is only reached through a trap door, which clears,
  so it never carries snow.
- **Study.** The camera dives onto the snowy card. The snow then rides the count card off
  the deck (`TowerCoverCard` `snow`, only while `cover.mode === "lifting"`). While the
  count card is its own layer, the scene's top card draws no snow. Once the session is up
  (`study.phase === "studying"`), the tower's snow is cleared, so the card slides back on
  bare.
- **Sky drop.** A grow (cards off cooldown, focus off, main opening above its last height)
  drops cards onto the top card. When they land (`useTowerResize` → `dropLanded`), the snow
  is brushed off. So a snowy main tower that grew since the last visit loses its cap a
  moment after the page opens.
- **Ghost collapse.** A focus-on shrink draws `IsoCardRuns`, which has no snow, so the cap
  is missing while the collapse plays and returns on the settled tower.

## The floor

`DeckTowerPlatform` → `decals`, `ground`, `floorSlide`; `IsoFloorSnow`.

- **Look.** A slab of the washed snow `FLOOR_SNOW_DEPTH` (0.4, ~8 px) thick over the whole floor,
  out to the platform's outer edge: its walls rise flush from the platform's, burying the
  rim bevel (owner's call 2026-11-09). It is a floor decal: over the "0 cards" imprint, the
  burn marks, the si print and the plate, and under the cloud shadows. The lever's hatch
  flaps take the snow colour.
- **Standing in it.** Everything standing on the floor still stands at the floor's own z.
  While the snow lies (`snowLying`: snowy, not sliding off a door):
  - the tower and the notebook stack are banked in by an `IsoSnowSkirt`, which paints
    their walls' lowest 0.4 (all of them, if shorter) in the snow's top tone. The sort
    platform (0.28) is thinner than the snow, so on any snowy floor it is drawn as deep as
    the snow (`sortThickness`, IsoSortPlatform `thickness`): its top lies flush with the
    snow's, the snow meeting it at its outer edge with its bevel showing, and it casts no
    shadow. It takes no skirt — painting over its walls left their anti-aliased edges
    showing as lines — but does not draw its walls below the snow line at all
    (IsoSortPlatform `buriedTo`); hopping, the part lifted out of the snow shows. A thin notebook is still shorter than the snow:
    its top shows sunk below the snow's (no fix yet);
  - shadows fall on the snow's top (`shadowReceiverFor`): an object standing out of the
    snow casts onto it, and the skirt repaints the part inside its band; a buried one casts
    none. Cloud shade and a sky drop's shadow use `shadowGround`;
  - the pawns wade sunk in (see "The pawn's trail").
  The lever has no skirt: its stick is thin, and its base is the hatch in the floor.
- **The plate** lies under the sheet, buried (the sheet is deeper than the plate's
  `RAISED_HEIGHT` 0.25) — the si does not apply. The snow over it is a DRIFT standing proud
  of the sheet by the plate's live height (`IsoFloorSnow` `drift`, `PLATE_DRIFT_RECT`: the
  plate plus 0.12), offset from the floor's snow as the plate is from the floor. Its press
  handlers still take taps through the snow. Pressing it (`usePlatePress` `onPress`)
  brushes the snow over it off (`clear(…, "plate", { brush: true })`): the sheet gets a
  hole over it and the drift, with the sheet under it, hops off the hole (the corner
  fixtures' brush-off). Until then the pawn steps up onto the plate under the drift and
  ploughs its channel through the drift as through the sheet (see "The pawn's trail").
  Once holed, its step's `snowDepth` is 0 (`PawnStep`): the pawn stands on it unsunk. The label then shows until the release swaps the deck,
  and the door carries the plate off with the floor.
- **Cleared by the trap door only.** As the door swings open, the sheet (channel included)
  slides off toward the door's free edge and fades. `floorSlide` ratchets to the widest
  angle reached during the swap, so it never slides back on as the door closes. When the
  swap ends, every component of that world is cleared — in a layout effect
  (`DeckTowerPage`, `swapKey`), so the frame where the door shuts never paints the old snow
  back on. Under reduced motion the swap is
  instant (never busy), so a deck change seen while idle counts as a swap's end too.

## Covering text

The `towerSnowCover` si (1 day + 4 visits, counted on every td visit, snowy or not). It
protects only the "0 cards" imprint. The corner fixtures' si prints (Add Cards, the
notebook), the plate and the top card are always fully covered (owner's rules, 2026-11-09).

| | Intro (`textOverSnow`) | Graduated (`coverText`) |
|---|---|---|
| "0 cards" imprint | drawn on the snow's top (`snowTop`) | under the sheet: hidden |
| fixtures' si prints | under the sheet: hidden | under the sheet: hidden |

A buried si print is still drawn under the sheet, so it shows again as the sheet slides off
a trap door; its shaded copy (inside the pawn's shadow) is drawn only on a snowless floor.
Covering snow can hide a si print that is still meant to teach (they graduate on their own,
70 visits over 14 days).

## Components that brush off

`useTowerSnow` → `clear(…, { brush: true })`; `IsoSnowShed`.

A brushed-off component that was snowy keeps a `shed` cover for `delayMs + SNOW_SHED_MS`.
During that time the snow hops up, drops and fades, while eight flakes spray out.

| Component | Look | Brushed off by |
|---|---|---|
| Focus lever | A scalloped cap on the ball (`IsoBallSnow`); it rides every pull, sink and fall | Pulling it (the tap that raises its popup) |
| Sort platform (main) | A cap over the slab's whole top, hiding its four band colours; it hops with the slab | The tap, concurrent with the dash to acp |
| Notebook stack (writing) | A cap on the top sheet | The tap, concurrent with the circle into the notebook |
| Deck plate | Buried under the floor's sheet, a drift over it; a hole opens over it | The press (before the release swaps the deck) |
| Tower | (above) | A sky drop's landing |

## The pawn's trail

`snowChannel.ts` (`useSnowTrailRecorder`, `useSnowChannel`); `SnowSlab` `trail`;
`snowTrail.ts`; `useTowerSnow` → `trail(world, surface)`; `DeckTowerPlatform` (the recorders).

- **Two surfaces, one mechanism.** The floor and the tower's top each keep a trail
  (`SnowTrailSurface`: "floor", "tower"). The floor's sheet, the drift over the plate (the
  floor's trail, its channel bottoming out on the plate's top) and the top card's cap
  (`IsoCardSnow` `trail`; the count card carries it off on `TowerCoverCard` `snowTrail`)
  each plough theirs through `SnowSlab` `trail`, by the same code.
- The pawn ploughs a **channel** through the snow, as wide as its body
  (`PAWN_BODY_RADIUS` each side), round wherever the body's circle would be: at each end,
  where a pawn has only just touched down (a circle), and at every sharp turn — a run is
  broken there into smooth stretches whose round ends overlap (`runOutlines`), since
  offsetting a turn tighter than the half-width notches the inside and cuts the outside
  corner. Its floor is
  packed snow in the snow's shadow tone (`shadowTone(snow)`), not the ground; its far wall
  shows the snow's thickness. Clipped to the slab's top, so it never draws past the snow.
- **Recording.** Each recorder samples its walkers' points every frame while its snow lies
  (the floor: each live pawn's `floorSpot`, the ref lightning also reads,
  `lightning.pawnSpot`; the tower: the page's `summitSpot`). Every 0.08 units of travel
  extends that pawn's run. A pawn off that surface (the floor's: up on the tower, before
  its entrance, falling with the trap door; the tower's: down on the floor) ends its run.
  So does a pawn in the air (IsoPawn `airborne`: a jump, a throw, the flight onto the
  tower, an edge hop onto the plate; not the walk's step bounce): no channel is ploughed
  through the air, and a new run starts — a round hole — where it lands.
- **Wading.** The pawn is sunk in wherever snow lies under it: `snowDepth` (the floor's,
  `FLOOR_SNOW_DEPTH`) or its step's own (`PawnStep` `snowDepth`: `SNOW_CAP_DEPTH` on a snowy
  tower top, 0 on the pressed-clear plate; the buried plate inherits the floor's, lifted
  with it, matching its drift). usePawnMotion clips the figure to everything above the
  snow line in front of it (`pawnSnowClip`: the near half of its body's circle at the
  snow's top, which is the channel's near edge). It casts no shadow while wading (owner's
  call, 2026-11-09). Not while the floor drops.
- Kept for the visit in per-world, per-surface stores owned by `useTowerSnow`, so the
  channel survives the platform remounting on a pan. Capped at `MAX_TRAIL_POINTS` (1500)
  each, oldest first. Clearing a surface (a deck swap's trap door clears both; the flp
  and a sky drop clear the tower) starts a new store. Not persisted.

## Falling snow

`IsoSnow`; `DeckTowerPage` → `snowFall`; `DeckTowerPlatform` `snowFall`; home:
`HomeStage` / `HomeScene` `snowFall`.

The sky's flakes (`WeatherLayer`) fall behind the scene svg, so nothing reached the
platform. `IsoSnow` is the snow counterpart of `IsoRain`. Each flake has a landing point on
open floor or a solid's top (the same `rainSolids`). Its sway eases out over the last
36 px so it lands on its spot, where it lies fading for 0.9 s. The flake look is the sky's
(`towerWeather.ts` `SNOW_*`), unwashed like the sky's. It is not mounted during a study or
under an aurora, and it starts no higher than `rainCeilingY`. The home screen's platform
gets falling snow but no settled snow.

## Tester reset

`SnowResetChip` in the "actions" tester row → `towerSnow.reset`. It forgets every clock
and the trails, then settles every world again at once. With the weather pinned to Snow,
everything snows over.

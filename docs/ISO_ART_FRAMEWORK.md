# Iso Art Framework

A small SVG kit for drawing scenes in the art style of Nintendo/Paladin's *Good Job!*:
chunky, softly bevelled isometric boxes with flat three-tone shading, no outlines and hard
shadows. Code: `src/features/deckTower/iso/`. Import from its barrel,
`src/features/deckTower/iso/index.ts`, not from the individual files.

Parent: [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (sub-documents table). Its only
user so far is [DECK_TOWER.md](./DECK_TOWER.md), which uses `IsoScene`, `IsoPlatform`
(`floating`), `IsoCardStack`, `IsoFloorLabel`, `IsoPawn`, `IsoBird`, `IsoCloud` and `IsoWind`. **`IsoCarpet` currently has no user** (the
Deck Tower dropped its carpet on 2026-10-17); it is kept as part of the kit.

**Location.** The kit sits under `features/deckTower/` because the Deck Tower is its only
importer. Per [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) § 1 it moves to
`src/components/iso/` as soon as a second feature imports it.

**Outline-rule exemption.** The style tells edges apart only by flat value steps between
faces, so it deliberately ignores the app's outline rule (CLAUDE.md § Buttons & cards).
The exemption covers iso scenes only; it is not a precedent for UI chrome.

## Rules of the style

1. **Everything is an extruded rounded rect** in the world XY plane, pushed up along z.
   The exceptions are the ink figures: the pawn's body (a screen-space pill, which reads
   the same from every angle) and the bird (a screen-space silhouette). A cloud is a
   cluster of rounded rects (pills), so it follows the rule. Wind (`IsoWind`) is not a
   solid at all: it is flat round-capped strokes, the kit's one stroke-only object.
2. **Three flat tones per material:** a lit TOP, a mid LEFT wall and a dark RIGHT wall.
   No gradients except the short blend across a rounded front corner.
3. **One light.** It comes from the upper left, and every shadow falls screen down-right.
4. **Every shadow is made by `IsoShadow`.** No component draws a shadow any other way.
5. **Objects draw themselves.** A page only places objects and tells each one which
   surface it stands on.

## Layers

| Layer | File | Role |
|---|---|---|
| Scene | `IsoScene.tsx` → `IsoScene`, `sceneContext.ts` → `useIsoProjector` | The `<svg>` root and the context that hands the projector to every component inside it |
| Primitive | `IsoSolid.tsx` → `IsoSolid` | Paints one prism in three-tone shading. Takes ready-made geometry, so it needs no context |
| Primitive | `IsoShadow.tsx` → `IsoShadow` | The only shadow drawer |
| Behaviour | `IsoLevitate.tsx` → `IsoLevitate` | Bobs an object up and down; its shadow breathes in sync |
| Behaviour | `usePawnMotion.ts` → `usePawnMotion`, `depthRankAmong` | The pawn's wander and startle, and depth-sorting a moving object among obstacles |
| Behaviour | `skyTraffic.ts` → `planSidePath`, `useSkyTraffic`, `createAltitudeWander`, `useAltitudeWander`, `SkyRegion`, `SkySide`, `prefersReducedMotion` | What birds, clouds and wind share: the path along a tower's side, the wait → cross → wait slot scheduler, and the wandering spawn altitude (§ Sky traffic) |
| Behaviour | `useBirdFlights.ts` → `useBirdFlights`, `BirdFlight`, `BirdSky` | Schedules the birds crossing the sky: speed, timing, wingbeat |
| Behaviour | `useCloudDrifts.ts` → `useCloudDrifts`, `CloudDrift`, `CloudSky`, `sortCloudsBackToFront` | Schedules the clouds drifting past the tower: shapes, speed, timing, mid-sky openers |
| Behaviour | `useWindGusts.ts` → `useWindGusts`, `WindGust`, `WindStrand`, `WindPt`, `WindSky` | Schedules the wind gusts: strand shapes, curl, timing, on-screen placement |
| Object | `IsoPlatform.tsx`, `IsoCarpet.tsx`, `IsoCard.tsx`, `IsoCardStack.tsx`, `IsoFloorLabel.tsx`, `IsoPawn.tsx`, `IsoBird.tsx`, `IsoCloud.tsx`, `IsoWind.tsx` | The things a scene is made of (one component each, below) |
| Rules | `light.ts` → `IsoSurface`, `shadowFootprint`, `shadowTone` | The light and the shadow rule |
| Rules | `palette.ts` → `ISO`, `shadeHex`, `mixHex`, `Material` | Colours (`mixHex` blends two colours continuously, e.g. the Deck Tower sky → space) |
| Rules | `levitation.ts` → `BOB_HEIGHT`, `BOB_PERIOD_MS` | The bob |
| Math | `geometry.ts` | Projection and shape math (below) |
| Math | `cardStackMetrics.ts` → `cardStackMetrics` | Card thickness and seam spacing for a stack of N |

## Geometry

`geometry.ts` uses a 2:1 dimetric projection, the same flavour as the Night Market grid.
World +x runs down-right, +y down-left and +z up. Screen coordinates are
`sx = (x − y)·unit` and `sy = (x + y)·unit/2 − z·unit`.

- **`prism`.** For a convex shape extruded straight up, the screen silhouette is the convex
  hull of the top and bottom outlines.
- **`flatPath`.** A rounded rect lying flat at height z. Used for floors, decals and
  shadows.
- **`faceTransform`.** Maps flat world-unit drawing onto a top face, so printed text lies
  on it.
- **`frontContour`.** The visible front half of an outline. It is used for the card
  stack's seams.
- **`insetRect` and `translateRect`.** Helpers that shrink, grow or slide a rect.
- **`insideRoundedRect`.** Point-in-rounded-rect, corner arcs included. With `insetRect(rect, R)` it
  tests whether a circle of radius R fits in `rect`.

## The scene

`IsoScene` takes a `proj` (from `makeProjector(unit)`), a `viewBox` and an optional
`preserveAspectRatio` (default centred; `"xMidYMax meet"` pins the scene to the bottom). Every object
inside reads the projector from context (`useIsoProjector`, which throws outside a scene),
so objects take world positions only and never a `proj` prop. The page fits the viewBox to
its settled content, so the scene scales to any box.

## Surfaces

An `IsoSurface` is `{ z, color }`: a horizontal plane something can stand on and a shadow
can fall on. Every object that stands on something gets a `surface` prop; the platform's
shadow goes on `ground`. The colour belongs to the surface because a shadow's tone comes
from what it falls on.

## Light and shadows

`light.ts` holds one rule, and `IsoShadow` applies it:

> A shadow is the caster's **footprint** (its underside outline), slid along the light by
> `LIGHT_SLOPE · (casterZ − receiver.z + CONTACT_LIFT)`, laid flat on the receiver, and
> painted in the receiver's colour darkened by `SHADOW_DEPTH`.

- **Direction.** `LIGHT_DIR` points screen down-right, away from the upper-left light that
  the face shading assumes.
- **Distance grows with height.** An object resting flush on a surface still shows a short
  contact sliver (`CONTACT_LIFT`). A floating one throws its shadow further.
- **Tone comes from the receiver.** Shadows on the sky, the floor and a carpet read as the
  same strength of shade. There are no per-receiver shadow colours in the palette.
- **Flat things are part of their surface.** A carpet or floor label receives shadows but casts none.
  A shadow is an opaque fill in the *floor's* shade, so a decal it crosses (a floor label) must be
  shaded in its own tones: the caster draws the decal's `shaded` variant clipped to its shadow
  (`IsoPawn` → `decals`; `IsoFloorLabel` → `shaded`). A plain glaze cannot do this — the floor's
  shade is a saturation-boosted orange, which as a translucent overlay needs ~80% opacity and
  would repaint the decal.
- **Parts cast no shadow.** `IsoCard` used as a stack's top card is a part; the stack casts.
- **Birds and clouds cast no shadow.** They fly 40+ (birds) and 90+ (clouds) units up,
  where the rule would throw the shadow far off the platform into empty sky. `IsoBird` and
  `IsoCloud` are the only standing exceptions.
- **Draw order.** Each object draws its shadow first, then itself, so it covers the hidden
  part of its own shadow.

| Caster | Footprint | `casterZ` | Receiver |
|---|---|---|---|
| `IsoPlatform` | the slab rect | its underside (−thickness) | `ground` |
| `IsoCardStack` | the card rect | its `surface.z` | its `surface` |
| `IsoPawn` | a circle of `FOOT_RADIUS` | its `surface.z` | its `surface` |

## Levitation

`IsoLevitate` takes a `shadow` node and `children`. The shadow stays where it is while the
children rise `BOB_HEIGHT` world units and sink back once per `BOB_PERIOD_MS`. The shadow
shrinks toward its centre and fades as they rise.

The two are separate CSS animations (`LEVITATE_CSS`) with the same duration, easing and
start, so they need no shared clock. Both stop under `prefers-reduced-motion`, leaving the
object at its lowest point, where its shadow was computed. A caller fitting a viewBox must
allow `BOB_HEIGHT` of headroom.

## Objects

### IsoPlatform

`{ rect, thickness, ground, floating?, children }`. A slab whose top, the floor, is at
z = 0 and which extends down to −thickness.

It draws, in order:

1. Its shadow on `ground`.
2. The slab, with its top in the lighter rim tone.
3. The floor, inset by `RIM_WIDTH`, leaving a thin bevel line. `RIM_WIDTH` is exported so a
   scene can keep walkers (and their shadows) off the bevel — the Deck Tower's `PAWN_ROAM` is
   `insetRect(PLATFORM, RIM_WIDTH)`.
4. `children`: the carpets and objects on the floor.

With `floating`, steps 2–4 go through `IsoLevitate`.

### IsoCarpet

`{ rect, surface, thickness? }`. A low solid mat a step darker than the floor
(`ISO.carpet`), 0.07 tall by default, so a sliver of wall shows. Things standing on it use
the surface `{ z: surface.z + thickness, color: ISO.carpet.top }`.

### IsoCard

`{ rect, z, thickness, figure?, label?, caption?, bandColor? }`. One flashcard: a `cardFace` top and
`cardBeige` walls. The face carries:

- an inset beige panel;
- a head band carrying a small-caps label (`bandColor`, default `ISO.cardBand` blue);
- a big centred figure;
- a caption.

The head is the low-y edge, because printed text runs along +x.

### IsoCardStack

`{ rect, count, surface, progress?, label?, bandColor? }`. A deck of N cards (`bandColor` passes through to the top card). It is drawn as one body
solid plus a full `IsoCard` on top, not as N solids, because a deck can run to hundreds of
cards. Seams (`frontContour`) suggest the individual cards. `cardStackMetrics` sets the
proportions:

- **Fixed thickness.** Every card is `CARD_THICKNESS` (0.38 world units, about 6px on a
  phone), whatever the deck size, with a seam under each, so the height *is* the deck
  size. A 500-card stack is about 190 units tall and runs far off screen; the caller frames that by scrolling,
  not by fitting the stack (see [DECK_TOWER.md](./DECK_TOWER.md) § The scene). Until
  2026-10-17 the stack was capped at 11 units and its cards thinned to fit, which made
  big decks all look the same height.
- **Seam anchoring.** Seams are anchored to the base, one per `CARD_THICKNESS`, so as the
  body grows the placed cards stay put and new cards land on top. One extra seam always
  sits where the top card meets the body; a base seam within a quarter card of it is
  dropped, so the arriving card never shows a doubled line.

`progress` (0 → 1) grows the body upward and counts up the printed figure.

### IsoFloorLabel

`{ rect, surface, text, fontSize?, bandColor?, shaded? }`. A name plate printed flat on a floor: a
rounded rect (`bandColor`, default `ISO.cardBand`) with ink text, the same treatment as a
card's head band, mapped onto the surface with `flatPath` + `faceTransform`. Text runs
along +x. Like a carpet it is part of its surface: zero height, no shadow, and pawns walk
over it (it is not a `PawnRoam` obstacle). Draw it before anything standing on the floor,
outside any depth sort. `shaded` draws it as it looks in shadow (plate and print each through
`shadowTone`); pass that copy to a pawn's `decals` so the pawn's shadow darkens it.

### IsoPawn

`{ at, surface, startled?, roam?, startledBy?, onDepthRankChange?, decals? }`. A featureless ink
worker: a pill body and a ball head in screen space, standing at a projected world point.
Its shadow is a round world footprint cast through `IsoShadow`, like every other shadow.

**Shadow on decals.** `decals` are flat things on its floor that its shadow can cross, passed
already in their shaded tones (e.g. `<IsoFloorLabel shaded … />`). The pawn draws them over its
shadow, clipped to the shadow's outline, inside `travel` (so the clip moves with the shadow) under a
`decal-anchor` group that `usePawnMotion` counter-translates (so the decals stay put). The clip
outline shrinks and the copy fades in step with `shadow-hop`.

**How it moves.** The pawn is drawn once, at `at`. All movement is `usePawnMotion.ts` →
`usePawnMotion`, a requestAnimationFrame state machine that writes CSS transforms
straight onto four nested groups through refs: `travel` (slides the whole pawn, shadow
included), `shadow-hop`, `hop` (lifts the body and emote) and `pose` (leans and squashes
the body about its feet), plus `decalShade` / `decalClip` / `decalAnchor` for the shaded decals. The projection is affine, so sliding the drawn pawn by a
projected floor delta is the same as redrawing it there. React state changes only when
an emote fires or the depth rank changes, so a walking pawn does not re-render the page.
Under `prefers-reduced-motion` nothing runs and the pawn stands at `at`.

**Idle: wander.** With `roam` (`PawnRoam { area, obstacles }`) it loops through pause →
walk → land:

- **Where it may stand.** `area` is a rounded rect, corners honoured (`geometry.ts` →
  `insideRoundedRect`). A spot is legal when BOTH the foot circle and the shadow circle (the
  same circle slid by `light.ts` → `shadowSlide`, ~0.3 units down-right) fit inside it
  (`usePawnMotion.ts` → `onFloor`), so the shadow never lands on the bevel or past the edge.
  The pawn therefore stops ~0.3 units further from the front-right edges than the back-left
  ones. Both regions are convex, so a straight walk between legal spots stays legal.

- **Pause** for 0.7–2.6 s. The first pause after mount is a longer opening hold of 3.5–6 s
  (`OPENING_PAUSE_MIN_MS` / `OPENING_PAUSE_MAX_MS`), so the pawn stands still while the
  page settles in rather than walking off the instant it appears.
- **Walk** to a random spot in `area` 1.2–5.5 units away whose straight path keeps the
  foot circle (`PAWN_FOOT_RADIUS`) plus `OBSTACLE_CLEARANCE` off every obstacle, at
  `WALK_SPEED`. The body bounces once per step (`STEP_RATE`, `STEP_HOP`) and waddles
  side to side (`WADDLE_DEG`).
- **Land.** On arrival it keeps stepping in place until its feet touch down, so it never
  drops out of mid-air.

**Startle.** When `startled` turns true, from wherever it is:

1. **Look up.** The body snaps into a lean back (`LOOK_UP_LEAN_DEG` over `LEAN_MS`),
   which on a faceless pawn reads as looking up. It leans away from `startledBy` on
   screen.
2. **Leap.** Still leaning, it hops `LEAP_DISTANCE` away from the nearest point of
   `startledBy`, kept on a legal spot (`clampToFloor`), on a parabolic arc (`LEAP_HOP_HEIGHT`). It stretches
   on takeoff and squashes on landing (`SETTLE_MS`); the shadow shrinks at the top of
   the arc.
3. **Emote.** A white `!` bubble snaps in over the leaning head the instant the pawn is
   startled (about 70 ms, no delay: shock is sudden), holds, and fades. This one is a CSS
   keyframe one-shot (`PAWN_CSS`), remounted by key per startle. It rides the hop's arc
   but does not lean. When the one-shot ends (`onAnimationEnd`) the bubble is
   **unmounted** (`IsoPawn` → `finishedEmoteId`), not left at opacity 0. The page
   reorders the pawn as its depth rank changes, React re-inserts its DOM node to do so,
   and re-inserting a node restarts its CSS animations, so a lingering bubble would
   replay.
4. **Stare, then recover.** It holds the look-up for `LOOK_HOLD_MS` (2.8 s), straightens
   over `RECOVER_MS`, and goes back to wandering.

**Depth sorting.** A wandering pawn can be in front of or behind the things it walks
around. `depthRankAmong(point, rects)` counts the rects the point stands in front of: an
iso object is nearer the viewer than a box when it is past the box's far edge on +x or
+y. `roam.obstacles` are given back-to-front, the pawn reports its rank through
`onDepthRankChange` when it changes, and the caller renders the pawn after that many
obstacles. Children must be keyed, so the reorder moves the pawn's DOM node instead of
remounting it and losing its motion state.

### IsoBird

`{ flight }` (a `BirdFlight` from `useBirdFlights`). A bird in the pawn's ink style.

**Shape.** An oval body, a ball head, a stub tail and two wings, drawn in screen space
at the projected start of the flight. It faces its screen direction of travel (mirrored
when flying left) and tips `TILT_FRACTION` of the way along the path's 2:1 slope.

**Motion.** Its own requestAnimationFrame loop writes three transforms through refs:

- **travel** slides it along the flight line at a constant speed;
- **bounce** lifts it `FLAP_BOUNCE` on each downstroke (highest with the wings down),
  plus a slow `DRIFT` undulation;
- **wings** flap by scaling about the shoulder from spread up (1) through flat to swept
  down (`WING_DOWN`, −0.7). The flip through zero reads as the wings swinging past the
  body.

It has no shadow (§ Light and shadows). It is mounted per flight (keyed on `flight.id`)
and unmounted when the flight ends, so it never resets.

**Scheduling: `useBirdFlights({ proj, active, sky, maxAirborne })`.** `BirdSky` is a
`SkyRegion` (§ Sky traffic), and paths and slots come from there.

- **Slots.** `maxAirborne` slots (default 3). Waits are 1.5–6.5 s, and first flights are
  staggered by slot (`FIRST_WAIT_MS`).
- **Paths.** 0.7–2.6 units out from `around`, `OFFSCREEN_MARGIN` 2 past each screen edge.
  Speed (3.2–4.6 units/s) and wingbeat (2.6–3.6 Hz, random phase) are picked per flight.
- **Height.** Read from the birds' altitude wander (§ Sky traffic), `ALTITUDE_WANDER`
  `{ knotMs: 6000, maxStep: 0.2 }`.
- **No sorting among birds.** They are the same flat ink, so their overlap order is
  invisible.
- **Reduced motion.** Under `prefers-reduced-motion` no birds fly. A bird frozen in
  mid-air would read as a glitch.
- **Memoize `sky`.** A new object restarts every slot.

### IsoCloud

`{ drift }` (a `CloudDrift` from `useCloudDrifts`). A cloud drifting past the tower.

**Shape.** A cluster of low **pill** prisms (a rounded rect whose radius is half its short
side): a raised crown over two or three base lobes (`CLOUD_SHAPES` in
`useCloudDrifts.ts`). Each puff is an `IsoSolid` in `ISO.cloud`, so a cloud follows the
three-tone rule like every other solid. The shapes are authored long side along the drift
direction and turned to the path (`orientPuffs` swaps x ↔ y on a path along world y),
scaled 0.8–1.25, and sorted back-to-front by view depth: the 2:1 projection's view ray is
(1, 1, 1), so a puff is nearer the larger the x + y + z of its centre.

**Motion.** Drawn once at its starting position and slid by its own requestAnimationFrame
loop (the projection is affine, as for the bird). It fades in over `FADE_MS` (1.6 s). No
bob or wobble: a cloud only drifts.

**Scheduling: `useCloudDrifts({ proj, active, sky, maxInSky })`.** `CloudSky` is a
`SkyRegion` whose `band` is the range of cloud **bases**.

- **Slots.** `maxInSky` slots (default 3). Waits between drifts are 4–14 s.
- **Paths.** The cloud's near edge is 1.5–4.5 units out from `around`: `planSidePath` gets
  the cloud's across-path extent as `depth`, so a back-side cloud never overlaps the
  tower. The margin is the cloud's own extent plus 0.5, so it starts and ends fully off
  screen. Speed is 0.4–0.8 units/s, about a minute per crossing.
- **Height.** Read from the clouds' altitude wander (§ Sky traffic), `ALTITUDE_WANDER`
  `{ knotMs: 20000, maxStep: 0.12 }`: slow, because a cloud is up for a minute or more and
  every cloud in the sky with it should sit at a close height.
- **Openers.** A slot's first drift starts 15–75% of the way across (`startT`) and fades
  in, so the band has sky in it the moment clouds switch on instead of staying empty
  while one drifts in from the edge.
- **Sorting among clouds.** Unlike birds, overlapping clouds show their order.
  `sortCloudsBackToFront` orders them by the view depth of their path's midpoint.
  ⚠️ This is approximate: two clouds on perpendicular sides swap true order as they move,
  which a static sort cannot follow.
- **Reduced motion.** Clouds still show: a still cloud reads as a cloud. Nothing is
  scheduled. There is one opener per slot, parked at its `startT`, fully opaque.
- **Memoize `sky`.** A new object restarts every slot.

### IsoWind

`{ gust }` (a `WindGust` from `useWindGusts`). A cartoon gust sweeping past the tower.

**Shape.** Two or three dead-straight parallel strands (two points each, no wave), so
they project as clean lines at the grid's 2:1 slope and keep the kit's faceted look. The
main strand runs 6–9 units and ends in a **curl**: a spiral
entered moving forward, rising up and back over itself, and winding inward to
`CURL_INNER` (0.55) of its 0.7–1 unit radius over `CURL_TURNS` (0.85) of a turn. The one
or two side strands (`SIDE_STRANDS`) sit just above or below it, shorter and with no curl.
Every strand is authored in the gust's own **vertical plane**: `s` along its travel and
`h` straight up. That plane is parallel to one of the tower's sides, so the curl projects
as an iso-correct ellipse on an invisible wall beside the tower, not as a screen-space
sticker. Strands are flat, round-capped strokes in `ISO.wind` at `WIND_OPACITY` (0.7),
`STROKE_WIDTH` 0.2 units. There is no fill and no three-tone shading (§ Rules of the style).

**Motion.** Its own requestAnimationFrame loop plays each strand as a moving visible
window, using `pathLength = 1` so the dash maths is in fractions of the strand. The head
sweeps to the end over the first `HEAD_SPAN` (60%) of the play time on an ease-out. The
tail starts at `TAIL_FROM` (40%) and catches up at the end, erasing it. Strands stagger by
up to 220 ms. A strand shorter than `MIN_VISIBLE` is hidden, so its round cap never leaves
a dot. The whole gust also slides `drift` (1.2–2.2 units) along its travel. No shadow.

**Scheduling: `useWindGusts({ proj, active, sky, maxGusts })`.** `WindSky` is a
`SkyRegion` whose `band` is the range of gust **baselines**.

- **Slots.** `maxGusts` slots (default 2). Waits between gusts are 1–4 s.
- **Paths.** Unlike birds and clouds, a gust does not cross the screen. `planSidePath`
  runs with a negative margin (`SCREEN_INSET`, 1 unit inside each edge). The gust is then
  placed at a random point on that path where its whole extent fits (back side strand →
  curl's forward bulge + drift), so it plays fully on screen. The plane is 1–3.5 units out
  from `around`.
- **Height.** Read from the gusts' altitude wander (§ Sky traffic), `ALTITUDE_WANDER`
  `{ knotMs: 4000, maxStep: 0.15 }`.
- **No sorting among gusts.** They are the same flat white, so their overlap order is
  invisible.
- **Reduced motion.** No wind. A gust is nothing but motion, and a frozen half-drawn
  streak would read as a glitch.
- **Memoize `sky`.** A new object restarts every slot.

### Sky traffic

`skyTraffic.ts` is the part birds, clouds and wind share.

- **`planSidePath(proj, region, gap, margin, depth = 0)`.** A straight path parallel to one
  of the four sides of `region.around`, `gap` units out, along a world axis, so on screen
  it crosses at the grid's 2:1 slope. It runs from `margin` units past one edge of
  `region.screenSpan` to `margin` past the other. `depth` is the traveller's extent across
  the path from its origin toward +x/+y (0 for a bird). On the back sides the origin is
  pushed out by it, so the whole footprint stays `gap` clear.
- **Draw order.** `side` is `"front"` for the +x and +y sides (the walls a viewer sees),
  so the caller draws the traveller after the tower. It is `"behind"` for the other two,
  drawn before it so the tower hides it. This holds for the whole crossing: where a
  back-side path runs out past the tower's corner, the traveller is beside the tower on
  screen, not over it.
- **`useSkyTraffic({ active, slots, plan, firstWaitMs, waitMs })`.** Keeps `slots`
  travellers looping wait → cross → wait on their own timeouts, so 0 to `slots` are up at
  once, at irregular intervals. `plan(id, first)` builds one crossing. `first` marks a
  slot's opener. React state changes only when a crossing starts or ends. `plan` and the
  wait functions are effect dependencies, so callers memoize them.
- **`createAltitudeWander({ knotMs, maxStep })` / `useAltitudeWander(config)`.** Where a
  traveller's height comes from. Each traveller type (birds, clouds, wind) owns ONE
  wander, and every spawn reads `sample(band)` from it instead of picking its own random
  z. The wander is a bounded random walk on 0–1 of the band: a new waypoint every
  `knotMs`, at most `maxStep` from the last (reflected at 0 and 1), cosine-eased in
  between. It runs on wall-clock time, so it keeps drifting while nothing spawns. Why:
  two travellers up at once at very different heights can project into the same patch of
  screen, and in an isometric view that reads as a depth ambiguity (higher, or just
  nearer?). Spawns close in time now get close heights, while the band is still covered
  over a few knots. The fraction-of-band position means a band that changes (the tower
  settling lower) rescales the wander rather than stranding it outside.
- **`prefersReducedMotion()`.** The one reduced-motion check for the iso folder and the
  Deck Tower page.

## Palette

The base colours are all `COLORS` tokens:

| Role | `ISO` key | Token |
|---|---|---|
| Sky | `sky` | `bluMk` |
| Platform | `platform` | `gld` |
| Card top | `card.top` | `cardFace` |
| Card walls and face panel | `card.left`, `cardPanel` | `cardBeige` |
| Card head band, floor label plate (default; callers may pass `bandColor`) | `cardBand` | `bluMk` |
| Cloud top | `cloud.top` | `white` |
| Wind strokes | `wind` | `white` (at 0.7 opacity, `IsoWind` → `WIND_OPACITY`) |
| Space (Deck Tower backdrop above the sky) | `space` | derived: `shadeHex(bluMk, 0.55)` ⚠️ |
| Stars | `star` | `white` |
| Ink | `ink` | `onSurface` |

⚠️ **Divergence from the colour framework.** The darker tones are derived at runtime with
`shadeHex` (an HSL lightness step), because the framework has no darker tier for these
hues. That covers `space` (the sky's hue taken down to deep navy, since the framework has no
dark blue), the wall tones (cloud walls included, shaded off `white`), the rim, the carpet, the card seams and every shadow
(`shadowTone`). If the style spreads beyond the Deck Tower, promote them to tokens in
`src/theme/colors.ts`.

Adding an object: build it from `IsoSolid` and `flatPath`, read the projector with
`useIsoProjector`, take a `surface` if it stands on something, cast its shadow with
`IsoShadow` before drawing itself, and export it from `index.ts`.
